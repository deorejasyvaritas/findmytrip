import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api.ts";
import { BrandMark } from "./Icon.tsx";

type State = "checking" | "login" | "ok";

/** Pide usuario y contraseña antes de mostrar la app (si el sitio lo requiere). */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    api
      .session()
      .then((s) => setState(s.authenticated ? "ok" : "login"))
      .catch(() => setState("ok")); // si la API no responde, dejamos que la app muestre su propio error
    const onUnauthorized = () => setState("login");
    window.addEventListener("fmt:unauthorized", onUnauthorized);
    return () => window.removeEventListener("fmt:unauthorized", onUnauthorized);
  }, []);

  if (state === "checking") return <div className="auth-screen" aria-busy="true" />;
  if (state === "login") return <Login onDone={() => location.reload()} />;
  return <>{children}</>;
}

function Login({ onDone }: { onDone: () => void }) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(user, password);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <BrandMark size={56} />
        <h1>FindMyTrip</h1>
        <p className="muted">Ingresá para ver tus viajes, alertas y el radar de ofertas.</p>
        <label className="field">
          Usuario
          <input autoComplete="username" autoCapitalize="none" value={user} onChange={(e) => setUser(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          Contraseña
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy || !user || !password}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
