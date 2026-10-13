import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api.ts";
import { BrandMark } from "./Icon.tsx";

interface Session {
  user: string;
  role: "owner" | "member";
}

const SessionCtx = createContext<Session | null>(null);
/** Cuenta con la sesión iniciada. */
export const useSession = () => useContext(SessionCtx);

type State = { kind: "checking" } | { kind: "auth"; firstAccount: boolean; canRegister: boolean } | { kind: "ok"; session: Session };

/** Pide ingresar (o crear la cuenta) antes de mostrar la app. */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "checking" });

  function check() {
    api
      .session()
      .then((s) =>
        setState(
          s.authenticated && s.user && s.role
            ? { kind: "ok", session: { user: s.user, role: s.role } }
            : { kind: "auth", firstAccount: s.firstAccount, canRegister: s.canRegister },
        ),
      )
      .catch(() => setState({ kind: "auth", firstAccount: false, canRegister: false }));
  }

  useEffect(() => {
    check();
    const onUnauthorized = () => check();
    window.addEventListener("fmt:unauthorized", onUnauthorized);
    return () => window.removeEventListener("fmt:unauthorized", onUnauthorized);
  }, []);

  if (state.kind === "checking") return <div className="auth-screen" aria-busy="true" />;
  if (state.kind === "auth") return <AuthScreen firstAccount={state.firstAccount} canRegister={state.canRegister} onDone={() => location.reload()} />;
  return <SessionCtx.Provider value={state.session}>{children}</SessionCtx.Provider>;
}

function AuthScreen({ firstAccount, canRegister, onDone }: { firstAccount: boolean; canRegister: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "register">(firstAccount ? "register" : "login");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registering = mode === "register";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (registering && password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      await (registering ? api.register(user, password) : api.login(user, password));
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="auth-brand">
          <BrandMark size={44} />
          <span>FindMyTrip</span>
        </div>
        <h1>{registering ? "Creá tu cuenta" : "Ingresá"}</h1>
        <p className="muted">
          {firstAccount
            ? "Es la primera vez que se usa este sitio: esta cuenta va a ser la dueña."
            : registering
              ? "Guardá tus viajes, alertas y preferencias en tu cuenta."
              : "Ingresá para ver tus viajes, alertas y el radar de ofertas."}
        </p>
        <label className="field">
          Usuario
          <input
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={user}
            onChange={(e) => setUser(e.target.value)}
            required
            autoFocus
          />
          {registering && <span className="small muted">De 3 a 30 caracteres: letras, números, punto o guion.</span>}
        </label>
        <label className="field">
          Contraseña
          <input
            type="password"
            autoComplete={registering ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {registering && <span className="small muted">Al menos 8 caracteres.</span>}
        </label>
        {registering && (
          <label className="field">
            Repetí la contraseña
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
        )}
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy || !user || !password || (registering && !confirm)}>
          {busy ? "Un momento…" : registering ? "Crear cuenta" : "Entrar"}
        </button>
        {!firstAccount && canRegister && (
          <button
            type="button"
            className="plain"
            onClick={() => {
              setMode(registering ? "login" : "register");
              setError(null);
            }}
          >
            {registering ? "Ya tengo cuenta: ingresar" : "No tengo cuenta: crear una"}
          </button>
        )}
      </form>
    </main>
  );
}
