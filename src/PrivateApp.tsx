import App from "./App.tsx";
import { AppProvider } from "./lib/app-context.tsx";

// La app con sesión (Explorar, viajes, agente...). Va en un archivo aparte para que
// las páginas públicas (/v/:id, /unirme/:id, /legal) no tengan que bajarla entera.
export default function PrivateApp() {
  return (
    <AppProvider>
      <App />
    </AppProvider>
  );
}
