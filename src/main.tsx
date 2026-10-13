import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { AppProvider } from "./lib/app-context.tsx";
import AuthGate from "./components/AuthGate.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthGate>
        <AppProvider>
          <App />
        </AppProvider>
      </AuthGate>
    </BrowserRouter>
  </StrictMode>,
);
