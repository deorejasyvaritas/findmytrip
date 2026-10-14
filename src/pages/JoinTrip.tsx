import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { InvitePreview } from "../../shared/ctrip.ts";
import Icon, { BrandMark } from "../components/Icon.tsx";
import { api } from "../lib/api.ts";
import { formatDate, formatMoney } from "../lib/format.ts";
import { clearLocalData } from "../lib/local-data.ts";

// Invitación a un viaje con otros (/unirme/:id). Se ve sin iniciar sesión; para
// sumarse hace falta una cuenta. Si el registro está cerrado, la invitación
// habilita crear una (y se gasta al usarla).

type Session = { user: string } | null;

const usd = (n: number) => formatMoney(n, "USD", 1);
const goToTrips = () => location.assign("/viajes");

export default function JoinTripPage() {
  const { id = "" } = useParams();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [session, setSession] = useState<Session | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .invite(id)
      .then((r) => alive && setInvite(r.invite))
      .catch((err: Error) => alive && setError(err.message || "No pudimos abrir la invitación."));
    api
      .session()
      .then((s) => alive && setSession(s.authenticated && s.user ? { user: s.user } : null))
      .catch(() => alive && setSession(null));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const prev = document.title;
    document.title = invite ? `Sumate al viaje a ${invite.destinationName} · FindMyTrip` : "Invitación a un viaje · FindMyTrip";
    return () => {
      document.title = prev;
    };
  }, [invite]);

  return (
    <main className="auth-screen">
      <div className="auth-card join-card">
        <div className="auth-brand">
          <BrandMark size={44} />
          <span>FindMyTrip</span>
        </div>
        {error ? (
          <div className="stack join-error">
            <h1>Esta invitación ya no sirve</h1>
            <p className="muted">{error}</p>
            <Link to="/" className="button primary full">
              Ir a FindMyTrip
            </Link>
          </div>
        ) : !invite || session === undefined ? (
          <div className="stack" role="status" aria-live="polite">
            <span className="sk" style={{ width: "40%", height: 12 }} />
            <span className="sk" style={{ width: "80%", height: 32 }} />
            <span className="sk" style={{ width: "100%", height: 80 }} />
            <span className="visually-hidden">Cargando la invitación…</span>
          </div>
        ) : (
          <>
            <TripSummary invite={invite} />
            {session ? (
              <JoinAsUser id={id} user={session.user} onSwitch={() => setSession(null)} />
            ) : (
              <JoinWithAccount id={id} by={invite.by} />
            )}
          </>
        )}
      </div>
    </main>
  );
}

function TripSummary({ invite }: { invite: InvitePreview }) {
  return (
    <div className="stack join-summary">
      <p className="eyebrow">{invite.by} te invita a un viaje</p>
      <h1>{invite.destinationName}</h1>
      <ul className="shared-facts">
        {invite.departDate && (
          <li>
            <Icon name="calendar" size={16} />
            {formatDate(invite.departDate)} – {formatDate(invite.returnDate, { day: "numeric", month: "short", year: "numeric" })}
          </li>
        )}
        <li>
          <Icon name="users" size={16} />
          {invite.travelers} {invite.travelers === 1 ? "viajero" : "viajeros"}
        </li>
        <li>
          <Icon name="tag" size={16} />
          {usd(invite.totalUSD)} en total
        </li>
      </ul>
      <p className="small muted">Al sumarte, el viaje aparece en Mis viajes y lo pueden editar juntos.</p>
    </div>
  );
}

function JoinAsUser({ id, user, onSwitch }: { id: string; user: string; onSwitch: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.joinInvite(id);
      goToTrips();
    } catch (err) {
      setError((err as Error).message || "No pudimos sumarte. Probá de nuevo.");
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="primary full" onClick={join} disabled={busy}>
        {busy ? "Sumándote…" : "Sumarme al viaje"}
      </button>
      <p className="small muted join-as">
        Entraste como <strong>{user}</strong>.{" "}
        <button
          type="button"
          className="link"
          onClick={async () => {
            await api.logout().catch(() => {});
            clearLocalData();
            onSwitch();
          }}
        >
          Usar otra cuenta
        </button>
      </p>
    </div>
  );
}

function JoinWithAccount({ id, by }: { id: string; by: string }) {
  // Lo más probable es que quien recibe la invitación todavía no tenga cuenta.
  const [mode, setMode] = useState<"register" | "login">("register");
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
      if (registering) {
        // Crear la cuenta con la invitación ya te suma al viaje.
        await api.register(user, password, id);
      } else {
        await api.login(user, password);
        await api.joinInvite(id);
      }
      goToTrips();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h2 className="headline">{registering ? "Creá tu cuenta para sumarte" : "Ingresá para sumarte"}</h2>
      <label className="field">
        Usuario
        <input
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={user}
          onChange={(e) => setUser(e.target.value)}
          required
        />
        {registering && <span className="small muted">De 3 a 30 caracteres: letras, números, punto o guion. Es el nombre que va a ver {by}.</span>}
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
        {busy ? "Un momento…" : registering ? "Crear cuenta y sumarme" : "Ingresar y sumarme"}
      </button>
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
    </form>
  );
}
