import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { AgentCard, TripPackage } from "../../shared/types.ts";
import { MONTH_NAMES, briefChips, clearBriefField, updateBrief, type TripBrief } from "../../shared/brief.ts";
import { capitalize, formatRange, monthName } from "../lib/format.ts";
import { SOURCE_LABEL } from "./SuggestionCard.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { useStored } from "../lib/storage.ts";
import Icon from "./Icon.tsx";
import PackageCard from "./PackageCard.tsx";

// Trippy: el agente de viajes, siempre a mano en una burbuja flotante.
// En la compu abre un panel al costado (la página sigue visible);
// en el celular, una hoja de pantalla completa.

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  packages?: TripPackage[];
  cards?: AgentCard[];
}

const FIT_LABEL = { dentro: "Entra holgado", ajustado: "Entra justo", estirando: "Un poco más" } as const;

/** Próximas preguntas probables, según lo que acaba de responder Trippy. */
function followUps(last: ChatMessage | undefined, brief: TripBrief): string[] {
  if (!last || last.role !== "assistant") return [];
  const first = last.cards?.[0];
  if (first) return [`Armame el paquete a ${first.name.split(" y ")[0]}`, "¿Hay algo más barato?", "¿Qué otro mes conviene?"];
  if (last.packages?.length) return ["¿Hay fechas más baratas?", "Mostrame alternativas parecidas"];
  if (brief.destinationName) return [`¿Cuándo conviene ir a ${brief.destinationName.split(" y ")[0]}?`, "Sorprendeme con algo distinto"];
  return ["Sorprendeme con algo distinto", "Algo más barato"];
}

const STARTERS = [
  "Tengo USD 2.500 para dos, 10 días en marzo. ¿Qué me recomendás?",
  "Quiero playa en julio sin gastar una fortuna",
  "Sorprendeme: un lugar que no se me ocurriría, con USD 1.500 por persona",
];

export default function Trippy() {
  const { meta, profile, packages, savePackage, destinations } = useApp();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useStored<ChatMessage[]>("fmt.chat", []);
  // Resumen del viaje: se arma con lo que el usuario escribe y se manda en cada mensaje.
  const [brief, setBrief] = useStored<TripBrief>("fmt.brief", {});
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);

  // Links viejos a /agente (o ?trippy=1) abren el panel.
  useEffect(() => {
    if (location.pathname === "/agente") {
      navigate("/", { replace: true });
      setOpen(true);
    } else if (params.get("trippy") === "1") {
      params.delete("trippy");
      setParams(params, { replace: true });
      setOpen(true);
    }
  }, [location.pathname, params, setParams, navigate]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, open]);

  function close() {
    setOpen(false);
    bubbleRef.current?.focus();
  }

  if (!meta?.agent) return null;

  // En la ficha de un destino, Trippy propone hablar de ese lugar.
  const destId = location.pathname.startsWith("/destino/") ? location.pathname.split("/")[2] : null;
  const dest = destId ? destinations.find((d) => d.id === destId) : undefined;
  const starters = dest ? [`Armame un viaje a ${dest.name}: cuándo conviene y cuánto sale`, ...STARTERS.slice(0, 2)] : STARTERS;

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    const next = [...messages, { role: "user" as const, content }];
    const nextBrief = updateBrief(brief, content, destinations);
    setBrief(nextBrief);
    setMessages(next);
    setInput("");
    await ask(next, nextBrief);
  }

  /** Pide la respuesta para una conversación que termina en un mensaje del usuario. */
  async function ask(next: ChatMessage[], currentBrief: TripBrief = brief) {
    setLoading(true);
    setError(null);
    try {
      // Mandamos solo las últimas 20 vueltas para mantener el contexto acotado.
      const history = next.slice(-20).map(({ role, content }) => ({ role, content }));
      while (history.length && history[0].role !== "user") history.shift();
      const reply = await api.agent(history, profile, currentBrief);
      setMessages([...next, { role: "assistant", content: reply.text, packages: reply.packages, cards: reply.cards }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  const savedIds = new Set(packages.map((p) => p.id));
  // El último mensaje quedó sin respuesta (falló el pedido o se cerró la página): se puede reintentar.
  const unanswered = !loading && messages.length > 0 && messages[messages.length - 1].role === "user";

  return (
    <>
      {!open && (
        <button ref={bubbleRef} className="trippy-bubble" onClick={() => setOpen(true)} aria-label="Abrir a Trippy, tu agente de viajes" aria-expanded={false}>
          <span className="trippy-bubble-icon">
            <Icon name="sparkles" size={24} />
          </span>
          <span className="trippy-bubble-label">Trippy</span>
        </button>
      )}
      {open && <div className="trippy-backdrop" onClick={close} aria-hidden="true" />}
      <aside className={`trippy-panel ${open ? "open" : ""}`} aria-label="Trippy, tu agente de viajes" aria-hidden={!open} inert={!open}>
        <header className="trippy-head">
          <span className="trippy-avatar" aria-hidden="true">
            <Icon name="sparkles" size={18} />
          </span>
          <div className="grow">
            <strong>Trippy</strong>
            <span className="small muted">Tu agente de viajes</span>
          </div>
          {messages.length > 0 && (
            <button
              className="plain small"
              onClick={() => {
                setMessages([]);
                setBrief({});
                setEditing(false);
              }}
            >
              Nueva
            </button>
          )}
          <button className="icon-btn" onClick={close} aria-label="Cerrar">
            <Icon name="close" size={20} />
          </button>
        </header>

        <TripBriefBar brief={brief} onChange={setBrief} editing={editing} setEditing={setEditing} />

        <div className="trippy-log" aria-live="polite">
          {messages.length === 0 && (
            <div className="stack">
              <div className="msg assistant">
                <div className="bubble">
                  Hola{profile.name ? ` ${profile.name}` : ""}, soy Trippy. Contame qué tenés en mente: presupuesto, fechas, con quién viajás o qué te
                  gusta. Uso tu perfil para personalizar.
                </div>
              </div>
              {meta.agentProvider === "workers-ai" && (
                <p className="small muted">Versión gratuita, con un límite diario de uso. Las respuestas pueden ser más simples.</p>
              )}
              <div className="trippy-starters">
                {starters.map((s) => (
                  <button key={s} className="starter" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="bubble">{m.content}</div>
              {m.cards?.map((c) => (
                <TrippyCard key={c.destinationId} card={c} onOpen={() => window.matchMedia("(max-width: 767px)").matches && setOpen(false)} />
              ))}
              {m.packages?.map((p) => (
                <PackageCard
                  key={p.id}
                  pkg={p}
                  actions={
                    savedIds.has(p.id) ? (
                      <span className="success small row gap-sm">
                        <Icon name="check" size={14} />
                        Guardado en Mis viajes
                      </span>
                    ) : (
                      <button className="primary" onClick={() => savePackage(p)}>
                        <Icon name="bookmark" size={18} />
                        Guardar viaje
                      </button>
                    )
                  }
                />
              ))}
            </div>
          ))}
          {loading && (
            <div className="msg assistant">
              <div className="bubble typing" aria-label="Trippy está escribiendo">
                <i />
                <i />
                <i />
              </div>
            </div>
          )}
          {(error || unanswered) && (
            <div className="chat-retry" role="alert">
              <p className="error small">{error ? `No llegó la respuesta. ${error}` : "Tu último mensaje quedó sin respuesta."}</p>
              {unanswered && (
                <button type="button" className="secondary" onClick={() => ask(messages)}>
                  Reintentar
                </button>
              )}
            </div>
          )}
          {!loading && !error && (
            <div className="trippy-followups">
              {followUps(messages[messages.length - 1], brief).map((q) => (
                <button key={q} className="chip" onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form className="trippy-input" onSubmit={submit}>
          <textarea
            ref={inputRef}
            rows={1}
            aria-label="Mensaje para Trippy"
            placeholder="Preguntale a Trippy"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <button className="primary" disabled={loading || !input.trim()} aria-label="Enviar">
            <Icon name="send" size={18} />
          </button>
        </form>
      </aside>
    </>
  );
}

/** Tarjeta de un destino recomendado: foto, precio y acceso directo a la ficha. */
function TrippyCard({ card, onOpen }: { card: AgentCard; onOpen: () => void }) {
  const { money, photos } = useApp();
  const q = new URLSearchParams({ month: `${card.year}-${String(card.month).padStart(2, "0")}`, nights: String(card.nights) });
  if (card.depart) q.set("depart", card.depart);
  const when = card.depart && card.ret ? formatRange(card.depart, card.ret) : `${capitalize(monthName(card.month))} ${card.year}`;
  return (
    <Link to={`/destino/${card.destinationId}?${q}`} className="trippy-card" onClick={onOpen}>
      {photos[card.destinationId] ? (
        <img src={photos[card.destinationId]} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <span className="trippy-card-img" />
      )}
      <span className="trippy-card-body">
        <strong>{card.name}</strong>
        <span className="small muted">
          {card.country} · {when}
        </span>
        <span className="trippy-card-price">
          {money(card.totalUSD)} <span className="small muted">· {money(card.perPersonUSD)} por persona</span>
        </span>
        <span className="small muted">
          {FIT_LABEL[card.fit]} · {SOURCE_LABEL[card.flightSource]}
        </span>
      </span>
      <Icon name="chevronRight" size={18} />
    </Link>
  );
}

/** Resumen del viaje fijo arriba del chat: lo que Trippy ya sabe, editable. */
function TripBriefBar({
  brief,
  onChange,
  editing,
  setEditing,
}: {
  brief: TripBrief;
  onChange: (b: TripBrief) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
}) {
  const { destinations } = useApp();
  const chips = briefChips(brief);
  const num = (v: string) => (v ? Math.max(1, Math.round(Number(v))) : undefined);
  return (
    <div className="trippy-brief" aria-label="Resumen del viaje">
      <div className="trippy-brief-row">
        <span className="trippy-brief-title">Tu viaje</span>
        {chips.length === 0 && !editing && <span className="small muted">Se completa solo mientras charlamos.</span>}
        {chips.map((c) => (
          <span key={c.field} className="brief-chip">
            {c.label}
            <button type="button" aria-label={`Quitar ${c.label}`} onClick={() => onChange(clearBriefField(brief, c.field))}>
              <Icon name="close" size={12} />
            </button>
          </span>
        ))}
        <button type="button" className="plain small" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          {editing ? "Listo" : "Editar"}
        </button>
      </div>
      {editing && (
        <div className="trippy-brief-form">
          <label className="field">
            Destino
            <select
              value={brief.destinationId ?? ""}
              onChange={(e) => {
                const d = destinations.find((x) => x.id === e.target.value);
                onChange({ ...brief, destinationId: d?.id, destinationName: d?.name });
              }}
            >
              <option value="">Abierto a ideas</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Presupuesto total (USD)
            <input
              inputMode="numeric"
              value={brief.budgetUSD ?? ""}
              onChange={(e) => onChange({ ...brief, budgetUSD: num(e.target.value.replace(/\D/g, "")), budgetPerPersonUSD: undefined })}
            />
          </label>
          <label className="field">
            Adultos
            <input type="number" min={1} max={12} value={brief.adults ?? ""} onChange={(e) => onChange({ ...brief, adults: num(e.target.value) })} />
          </label>
          <label className="field">
            Noches
            <input type="number" min={1} max={60} value={brief.nights ?? ""} onChange={(e) => onChange({ ...brief, nights: num(e.target.value) })} />
          </label>
          <label className="field">
            Mes
            <select value={brief.month ?? ""} onChange={(e) => onChange({ ...brief, month: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Flexible</option>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
