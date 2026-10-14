import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api.ts";
import { useSession } from "./AuthGate.tsx";
import Icon from "./Icon.tsx";
import { clearLocalData } from "../lib/local-data.ts";

/** Cuenta: usuario, cambio de contraseña, registro de otras personas y cierre de sesión. */
export default function AccountSettings() {
  const session = useSession();
  const [openSignup, setOpenSignup] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (session?.role === "owner") api.accountSettings().then((s) => setOpenSignup(s.openSignup)).catch(() => {});
  }, [session?.role]);

  if (!session) return null;

  async function change(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (password.length < 8) {
      setStatus({ ok: false, text: "La contraseña nueva tiene que tener al menos 8 caracteres." });
      return;
    }
    try {
      await api.changePassword(current, password);
      setStatus({ ok: true, text: "Contraseña actualizada. Se cerró la sesión en tus otros dispositivos." });
      setEditing(false);
      setCurrent("");
      setPassword("");
    } catch (err) {
      setStatus({ ok: false, text: (err as Error).message });
    }
  }

  return (
    <section>
      <p className="grouped-title">Cuenta</p>
      <div className="grouped">
        <div className="list-row">
          <span className="alert-icon">
            <Icon name="user" size={18} />
          </span>
          <span className="grow">
            <span className="headline">{session.user}</span>
            <span className="small muted" style={{ display: "block" }}>
              {session.role === "owner" ? "Dueña del sitio" : "Cuenta"}
            </span>
          </span>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              await api.logout().catch(() => {});
              // Que la próxima persona en este navegador no vea nada de esta cuenta.
              clearLocalData();
              location.href = "/";
            }}
          >
            Cerrar sesión
          </button>
        </div>
        <div className="list-row list-row-block">
          {editing ? (
            <form className="stack" onSubmit={change}>
              <label className="field">
                Contraseña actual
                <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </label>
              <label className="field">
                Contraseña nueva
                <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <div className="row gap">
                <button className="primary" disabled={!current || !password}>
                  Guardar contraseña
                </button>
                <button type="button" className="ghost" onClick={() => setEditing(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="plain" style={{ alignSelf: "flex-start", paddingLeft: 0 }} onClick={() => setEditing(true)}>
              Cambiar contraseña
            </button>
          )}
          {status && (
            <p className={`small ${status.ok ? "success" : "error"}`} role="status">
              {status.text}
            </p>
          )}
        </div>
        {session.role === "owner" && openSignup != null && (
          <label className="list-row">
            <span className="grow">
              Permitir que otras personas creen cuenta
              <span className="small muted" style={{ display: "block" }}>
                Cada cuenta tiene sus propios viajes y alertas. Usan tu cuota de búsquedas.
              </span>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={openSignup}
              onChange={async (e) => {
                const v = e.target.checked;
                setOpenSignup(v);
                await api.saveAccountSettings({ openSignup: v }).catch(() => setOpenSignup(!v));
              }}
            />
          </label>
        )}
      </div>
    </section>
  );
}
