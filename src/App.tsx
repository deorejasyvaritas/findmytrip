import { NavLink, Route, Routes } from "react-router-dom";
import { LegalFooter } from "./pages/Legal.tsx";
import Icon, { BrandMark } from "./components/Icon.tsx";
import { useApp } from "./lib/app-context.tsx";
import { TABS } from "./lib/icons.ts";
import Home from "./pages/Home.tsx";
import DestinationPage from "./pages/Destination.tsx";
import Trips from "./pages/Trips.tsx";
import Agent from "./pages/Agent.tsx";
import ProfilePage from "./pages/Profile.tsx";
import SearchPage from "./pages/Search.tsx";

function TabLink({ tab, badge, withIcon }: { tab: (typeof TABS)[number]; badge?: number; withIcon: boolean }) {
  const content = (
    <>
      {withIcon && <Icon name={tab.icon} size={24} />}
      <span>{tab.label}</span>
      {badge ? <span className="badge-count">{badge}</span> : null}
    </>
  );
  // "Vuelos" es una página aparte (carga completa) para el buscador en vivo.
  if (tab.external) return <a href={tab.to}>{content}</a>;
  return (
    <NavLink to={tab.to} end={tab.to === "/"}>
      {content}
    </NavLink>
  );
}

export default function App() {
  const { packages } = useApp();
  const badgeFor = (to: string) => (to === "/viajes" ? packages.length : 0);
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" aria-label="FindMyTrip, inicio">
            <BrandMark /> FindMyTrip
          </NavLink>
          <nav className="nav" aria-label="Principal">
            {TABS.map((t) => (
              <TabLink key={t.to} tab={t} badge={badgeFor(t.to)} withIcon={false} />
            ))}
          </nav>
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/destino/:id" element={<DestinationPage />} />
          <Route path="/viajes" element={<Trips />} />
          <Route path="/agente" element={<Agent />} />
          <Route path="/perfil" element={<ProfilePage />} />
          <Route path="/buscar" element={<SearchPage />} />
        </Routes>
      </main>
      <LegalFooter />
      <nav className="tabbar" aria-label="Principal">
        {TABS.map((t) => (
          <TabLink key={t.to} tab={t} badge={badgeFor(t.to)} withIcon />
        ))}
      </nav>
    </div>
  );
}
