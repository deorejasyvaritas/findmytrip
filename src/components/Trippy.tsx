import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { TripPackage } from "../../shared/types.ts";
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
    setMessages(next);
    setInput("");
    await ask(next);
  }

  /** Pide la respuesta para una conversación que termina en un mensaje del usuario. */
  async function ask(next: ChatMessage[]) {
    setLoading(true);
    setError(null);
    try {
      // Mandamos solo las últimas 20 vueltas para mantener el contexto acotado.
      const history = next.slice(-20).map(({ role, content }) => ({ role, content }));
      while (history.length && history[0].role !== "user") history.shift();
      const reply = await api.agent(history, profile);
      setMessages([...next, { role: "assistant", content: reply.text, packages: reply.packages }]);
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
            <button className="plain small" onClick={() => setMessages([])}>
              Nueva
            </button>
          )}
          <button className="icon-btn" onClick={close} aria-label="Cerrar">
            <Icon name="close" size={20} />
          </button>
        </header>

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
