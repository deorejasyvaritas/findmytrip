import { Component, type ReactNode } from "react";
import Icon from "./Icon.tsx";

// Si una pantalla falla, mostramos un aviso en su lugar y el resto del sitio
// (menú incluido) sigue funcionando. Antes, un error dejaba todo en negro.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[FindMyTrip] Error en la pantalla:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card empty" role="alert">
        <Icon name="info" size={28} />
        <h3>Esta pantalla tuvo un problema</h3>
        <p className="muted">Podés seguir usando el resto del sitio. Si se repite, mandame este detalle:</p>
        <code className="error-detail">{this.state.error.message}</code>
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
