import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { TripPackage } from "../../shared/types.ts";
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
  "Tengo USD 2.500 para 2 personas, 10 días en marzo. ¿Qué me recomendás?",
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

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, loading]);

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
      <div className="card empty stack">
        <h1>Agente de viajes</h1>
        <p>El agente conversacional necesita una clave de la API de Claude.</p>
        <p className="muted small">
          Agregá <code>ANTHROPIC_API_KEY</code> en el archivo <code>.env</code> y reiniciá el servidor. Mientras tanto, podés usar{" "}
          <Link to="/">Explorar</Link>, que funciona sin IA.
        </p>
      </div>
    );
  }

  const savedIds = new Set(packages.map((p) => p.id));

  return (
    <div className="chat">
      <div className="section-head">
        <h1>Tu agente de viajes</h1>
        {messages.length > 0 && (
          <button className="ghost small" onClick={() => setMessages([])}>
            Nueva conversación
          </button>
        )}
      </div>

      <div className="chat-log">
        {messages.length === 0 && (
          <div className="stack">
            <p className="muted">
              Contame qué tenés en mente: presupuesto, fechas, con quién viajás o qué te gusta. Uso tu perfil para personalizar.
            </p>
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
                    <span className="success small">✓ Guardado en Mis viajes</span>
                  ) : (
                    <button className="primary" onClick={() => savePackage(p)}>
                      Guardar paquete
                    </button>
                  )
                }
              />
            ))}
          </div>
        ))}
        {loading && (
          <div className="msg assistant">
            <div className="bubble muted">Buscando opciones…</div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div ref={endRef} />
      </div>

      <form className="chat-input" onSubmit={submit}>
        <textarea
          rows={2}
          placeholder="Ej: quiero ir a algún lugar con montaña en abril, somos 2 y tenemos USD 3.000"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <button className="primary" disabled={loading || !input.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}
