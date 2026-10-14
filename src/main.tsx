import { StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import AuthGate from "./components/AuthGate.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { handleStaleChunks, registerServiceWorker } from "./lib/pwa.ts";
// Legal es chica y ya la usa la pantalla de ingreso: va en el archivo principal.
import LegalPage from "./pages/Legal.tsx";
import "./styles.css";

// Cada página pública se baja aparte: quien abre un link compartido no descarga la app entera.
const SharedTripPage = lazy(() => import("./pages/SharedTrip.tsx"));
const JoinTripPage = lazy(() => import("./pages/JoinTrip.tsx"));
const HowItWorksPage = lazy(() => import("./pages/HowItWorks.tsx"));

// La app con sesión: si se entra por ella, la empezamos a bajar ya, mientras se
// consulta la sesión (en paralelo, sin esperar a que AuthGate termine).
const loadPrivateApp = () => import("./PrivateApp.tsx");
if (!/^\/(v|unirme|legal|como-funciona)(\/|$)/.test(location.pathname)) void loadPrivateApp().catch(() => undefined);
const PrivateApp = lazy(loadPrivateApp);

registerServiceWorker();
handleStaleChunks();

const blank = <div className="auth-screen" aria-busy="true" />;

/** Página pública: con su propio aviso de error y un fondo liso mientras carga. */
function Public({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={blank}>{children}</Suspense>
    </ErrorBoundary>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* La información legal se puede leer sin iniciar sesión. */}
        <Route path="/legal/:doc" element={<ErrorBoundary><LegalPage /></ErrorBoundary>} />
        {/* Los viajes compartidos por link también: son de solo lectura. */}
        <Route path="/v/:id" element={<Public><SharedTripPage /></Public>} />
        {/* Invitación a un viaje con otros: se ve sin sesión; sumarse la pide. */}
        <Route path="/unirme/:id" element={<Public><JoinTripPage /></Public>} />
        <Route path="/como-funciona" element={<Public><HowItWorksPage /></Public>} />
        <Route
          path="*"
          element={
            <ErrorBoundary>
              <AuthGate>
                <Suspense fallback={blank}>
                  <PrivateApp />
                </Suspense>
              </AuthGate>
            </ErrorBoundary>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
