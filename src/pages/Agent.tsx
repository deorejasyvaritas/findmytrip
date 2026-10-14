import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { TripPackage } from "../../shared/types.ts";
import Icon from "../components/Icon.tsx";
import PackageCard from "../components/PackageCard.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { useStored } from "../lib/storage.ts";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  packages?: TripPackage[];
}

const STARTERS = [
  "Tengo USD 2.500 para dos, 10 días en marzo. ¿Qué me recomendás?",
  "Quiero playa en julio sin gastar una fortuna",
  "¿Cuál es el mes más barato para ir a Japón 15 días?",
  "Sorprendeme: un lugar que no se me ocurriría, con USD 1.500 por persona",
];

export default function Agent() {
  const { meta, profile, packages, savePackage } = useApp();
  const [messages, setMessages] = useStored<ChatMessage[]>("fmt.chat", []);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Con llaves: en Chrome nuevo scrollIntoView devuelve una promesa, y un efecto que la devuelve rompe la pantalla al salir.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
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

  if (meta && !meta.agent) {
    return (
      <div className="stack-lg">
        <h1>Agente</h1>
        <div className="card empty">
          <Icon name="message" size={32} />
          <h3>El agente está apagado</h3>
          <p className="muted">
            Para usar el agente gratis, publicá el sitio en Cloudflare: usa la IA gratuita de Cloudflare (Workers AI). Con una clave de Claude
            la calidad es mejor, pero tiene costo por uso.
          </p>
          <Link to="/" className="button primary">
            Explorar destinos
          </Link>
        </div>
      </div>
    );
  }

  const savedIds = new Set(packages.map((p) => p.id));

  return (
    <div className="chat">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h1>Agente</h1>
        {messages.length > 0 && (
          <button className="plain" onClick={() => setMessages([])}>
            Nueva conversación
          </button>
        )}
      </div>

      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && (
          <div className="stack">
            <p className="muted">Contame qué tenés en mente: presupuesto, fechas, con quién viajás o qué te gusta. Uso tu perfil para personalizar.</p>
            {meta?.agentProvider === "workers-ai" && (
              <p className="small muted">Versión gratuita (IA abierta de Cloudflare, con un límite diario de uso). Las respuestas pueden ser más simples.</p>
            )}
            <div className="starters">
              {STARTERS.map((s) => (
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
            <div className="bubble typing" aria-label="El agente está escribiendo">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form className="chat-input" onSubmit={submit}>
        <textarea
          rows={1}
          aria-label="Mensaje para el agente"
          placeholder="Escribí tu idea de viaje"
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
    </div>
  );
}
