import { NavLink, Route, Routes } from "react-router-dom";
import { useApp } from "./lib/app-context.tsx";
import Home from "./pages/Home.tsx";
import DestinationPage from "./pages/Destination.tsx";
import Trips from "./pages/Trips.tsx";
import Agent from "./pages/Agent.tsx";
import ProfilePage from "./pages/Profile.tsx";

export default function App() {
  const { packages } = useApp();
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-mark" aria-hidden>✈</span> FindMyTrip
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>Explorar</NavLink>
          {/* Página aparte (carga completa) para el buscador en vivo de Aviasales. */}
          <a href="/vuelos.html">Vuelos</a>
          <NavLink to="/agente">Agente</NavLink>
          <NavLink to="/viajes">
            Mis viajes{packages.length > 0 && <span className="badge">{packages.length}</span>}
          </NavLink>
          <NavLink to="/perfil">Perfil</NavLink>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/destino/:id" element={<DestinationPage />} />
          <Route path="/viajes" element={<Trips />} />
          <Route path="/agente" element={<Agent />} />
          <Route path="/perfil" element={<ProfilePage />} />
        </Routes>
      </main>
      <footer className="footer">
        Precios estimados en USD como referencia. Confirmá siempre en el sitio de reserva antes de comprar.
      </footer>
    </div>
  );
}
