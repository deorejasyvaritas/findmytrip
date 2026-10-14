import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App.tsx";
import { AppProvider } from "./lib/app-context.tsx";
import AuthGate from "./components/AuthGate.tsx";
import LegalPage from "./pages/Legal.tsx";
import SharedTripPage from "./pages/SharedTrip.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import "./styles.css";

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
