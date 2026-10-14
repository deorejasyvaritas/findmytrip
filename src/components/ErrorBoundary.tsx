import { Component, type ReactNode } from "react";
import Icon from "./Icon.tsx";
import { isChunkLoadError, reloadOnceForNewVersion } from "../lib/pwa.ts";

// Si una pantalla falla, mostramos un aviso en su lugar y el resto del sitio
// (menú incluido) sigue funcionando. Antes, un error dejaba todo en negro.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[FindMyTrip] Error en la pantalla:", error);
    // Archivo de una versión anterior que ya no existe: recargamos una vez, sin preguntar.
    if (isChunkLoadError(error) && navigator.onLine !== false) reloadOnceForNewVersion();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (isChunkLoadError(error)) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      return (
        <div className="card empty" role="alert">
          <Icon name="info" size={28} />
          <h3>{offline ? "Sin conexión" : "Hay una versión nueva de FindMyTrip"}</h3>
          <p className="muted">
            {offline
              ? "No pudimos abrir esta pantalla. Revisá tu internet y probá de nuevo."
              : "Recargá para seguir con la última versión. Tus viajes guardados no se pierden."}
          </p>
          <div className="row gap">
            <button className="primary" onClick={() => location.reload()}>
              Recargar
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="card empty" role="alert">
        <Icon name="info" size={28} />
        <h3>Esta pantalla tuvo un problema</h3>
        <p className="muted">Podés seguir usando el resto del sitio. Probá volver a cargarla; si se repite, avisanos.</p>
        <details className="error-detail-wrap">
          <summary>Ver detalle técnico</summary>
          <code className="error-detail">{error.message}</code>
        </details>
        <div className="row gap">
          <button className="primary" onClick={() => location.reload()}>
            Volver a cargar
          </button>
          <a className="button secondary" href="/">
            Ir al inicio
          </a>
        </div>
      </div>
    );
  }
}
