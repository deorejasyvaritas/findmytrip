import { Suspense, lazy } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { LegalFooter } from "./pages/Legal.tsx";
import Icon, { BrandMark } from "./components/Icon.tsx";
import { useApp } from "./lib/app-context.tsx";
import { TABS } from "./lib/icons.ts";
import Home from "./pages/Home.tsx";
import { CompareBar } from "./components/Compare.tsx";
import PageSkeleton from "./components/PageSkeleton.tsx";

// Explorar (Home) viene en el archivo principal; el resto de las pantallas se baja al abrirlas.
const DestinationPage = lazy(() => import("./pages/Destination.tsx"));
const Trips = lazy(() => import("./pages/Trips.tsx"));
const Agent = lazy(() => import("./pages/Agent.tsx"));
const ProfilePage = lazy(() => import("./pages/Profile.tsx"));
const SearchPage = lazy(() => import("./pages/Search.tsx"));
const ComparePage = lazy(() => import("./pages/Compare.tsx"));

// El mapa trae Leaflet: se baja solo cuando alguien lo abre.
const FlightMapPage = lazy(() => import("./pages/FlightMap.tsx"));
const RoutesPage = lazy(() => import("./pages/Routes.tsx"));
const CruisesPage = lazy(() => import("./pages/Cruises.tsx"));

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
  const { packages, sharedTrips } = useApp();
  const location = useLocation();
  // Viajes propios más los compartidos con otros (sin contar dos veces uno que pasó a ser compartido).
  const sharedIds = new Set(sharedTrips.map((t) => t.pkg.id));
  const tripCount = sharedTrips.length + packages.filter((p) => !sharedIds.has(p.id)).length;
  const badgeFor = (to: string) => (to === "/viajes" ? tripCount : 0);
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
        {/* Una por pantalla: al cambiar de sección se reinicia y se puede seguir navegando. */}
        <ErrorBoundary key={location.pathname}>
        <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/destino/:id" element={<DestinationPage />} />
          <Route path="/viajes" element={<Trips />} />
          <Route path="/agente" element={<Agent />} />
          <Route path="/perfil" element={<ProfilePage />} />
          <Route path="/buscar" element={<SearchPage />} />
          <Route path="/comparar" element={<ComparePage />} />
          <Route path="/rutas" element={<Suspense fallback={null}><RoutesPage /></Suspense>} />
          <Route path="/cruceros" element={<Suspense fallback={null}><CruisesPage /></Suspense>} />
          <Route
            path="/mapa"
            element={
              <Suspense fallback={<div className="map-canvas map-loading" aria-busy="true" aria-label="Cargando el mapa" />}>
                <FlightMapPage />
              </Suspense>
            }
          />
        </Routes>
        </Suspense>
        </ErrorBoundary>
        <CompareBar />
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
