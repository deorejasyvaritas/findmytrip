import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App.tsx";
import { AppProvider } from "./lib/app-context.tsx";
import AuthGate from "./components/AuthGate.tsx";
import LegalPage from "./pages/Legal.tsx";
import SharedTripPage from "./pages/SharedTrip.tsx";
import JoinTripPage from "./pages/JoinTrip.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { registerServiceWorker } from "./lib/pwa.ts";
import "./styles.css";

// Página pública que no hace falta en la primera carga: se baja aparte.
const HowItWorksPage = lazy(() => import("./pages/HowItWorks.tsx"));

registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* La información legal se puede leer sin iniciar sesión. */}
        <Route path="/legal/:doc" element={<LegalPage />} />
        {/* Los viajes compartidos por link también: son de solo lectura. */}
        <Route
          path="/v/:id"
          element={
            <ErrorBoundary>
              <SharedTripPage />
            </ErrorBoundary>
          }
        />
        {/* Invitación a un viaje con otros: se ve sin sesión; sumarse la pide. */}
        <Route
          path="/unirme/:id"
          element={
            <ErrorBoundary>
              <JoinTripPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/como-funciona"
          element={
            <ErrorBoundary>
              <Suspense fallback={<div className="auth-screen" aria-busy="true" />}>
                <HowItWorksPage />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="*"
          element={
            <ErrorBoundary>
              <AuthGate>
                <AppProvider>
                  <App />
                </AppProvider>
              </AuthGate>
            </ErrorBoundary>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
