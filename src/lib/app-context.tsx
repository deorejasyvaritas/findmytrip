import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Destination, Meta, Party, Profile, Style, TripPackage, WatchItem } from "../../shared/types.ts";
import { api } from "./api.ts";
import { formatMoney } from "./format.ts";
import { useStored } from "./storage.ts";
import { localOwner } from "./local-data.ts";
import { useSharedTrips, type SharedTripsState } from "./shared-trips.ts";
import { useSession } from "../components/AuthGate.tsx";

export const DEFAULT_PROFILE: Profile = {
  name: "",
  origin: "BUE",
  travelers: 2,
  childAges: [],
  bags: "cabin",
  style: "mid",
  interests: [],
  currency: "USD",
  visited: [],
  maxFlightHours: null,
};

interface AppState extends SharedTripsState {
  /** Usuario con la sesión iniciada. */
  me: string;
  meta: Meta | null;
  destinations: Destination[];
  /** Foto ilustrativa por id de destino. */
  photos: Record<string, string>;
  profile: Profile;
  profileSaved: boolean;
  setProfile: (p: Profile) => void;
  packages: TripPackage[];
  savePackage: (p: TripPackage) => void;
  updatePackage: (id: string, patch: Partial<TripPackage>) => void;
  removePackage: (id: string) => void;
  watchlist: WatchItem[];
  addWatch: (w: Omit<WatchItem, "id" | "createdAt">, extra?: { party: Party; style: Style }) => void;
  removeWatch: (id: string) => void;
  money: (usd: number) => string;
  /** Convierte un monto ingresado en la moneda del perfil a USD. */
  toUSD: (amount: number) => number;
  fromUSD: (usd: number) => number;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [storedProfile, setStoredProfile] = useStored<Profile | null>("fmt.profile", null);
  const [rawPackages, setPackages] = useStored<TripPackage[]>("fmt.packages", []);
  const packages = useMemo(() => cleanPackages(rawPackages), [rawPackages]);
  const [watchlist, setWatchlist] = useStored<WatchItem[]>("fmt.watchlist", []);
  const me = useSession()?.user ?? "";
  const shared = useSharedTrips(me);

  // Tus datos viven en el servidor (protegidos y sincronizados entre dispositivos).
  // El navegador guarda una copia para abrir rápido.
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    api
      .userData()
      .then((server) => {
        // Solo se sube la copia local si es de esta cuenta (nunca la de otra persona
        // que usó el mismo navegador).
        const mine = Boolean(me) && localOwner() === me;
        const sync = <T,>(key: "profile" | "packages" | "watchlist", local: T, set: (v: T) => void, isEmpty: (v: T) => boolean) => {
          const remote = server[key] as T | null;
          if (remote != null) set(remote);
          else if (mine && !isEmpty(local)) api.saveUserData(key, local).catch(() => {});
        };
        sync("profile", storedProfile, setStoredProfile, (v) => v == null);
        sync("packages", packages, (v) => setPackages(cleanPackages(v)), (v) => !v.length);
        sync("watchlist", watchlist, (v) => setWatchlist(Array.isArray(v) ? v.filter((w) => w && w.id && w.destinationId) : []), (v) => !v.length);
      })
      .catch(() => {})
      .finally(() => setSynced(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useSave("profile", storedProfile, synced);
  useSave("packages", packages, synced);
  useSave("watchlist", watchlist, synced);

  useEffect(() => {
    api.meta().then(setMeta).catch(console.error);
    api.destinations().then(setDestinations).catch(console.error);
    api.photos().then(setPhotos).catch(() => setPhotos({}));
  }, []);

  const profile = { ...DEFAULT_PROFILE, ...storedProfile };
  const rate = meta?.usdArsRate ?? 1450;

  const value = useMemo<AppState>(
    () => ({
      ...shared,
      me,
      meta,
      destinations,
      photos,
      profile,
      profileSaved: storedProfile != null,
      setProfile: (p) => setStoredProfile(p),
      packages,
      savePackage: (p) => setPackages((prev) => [p, ...prev.filter((x) => x.id !== p.id)]),
      updatePackage: (id, patch) => setPackages((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x))),
      removePackage: (id) => setPackages((prev) => prev.filter((x) => x.id !== id)),
      watchlist,
      addWatch: (w, extra) => {
        // También se guarda en el servidor para que el radar pueda avisar por Telegram.
        api
          .saveAlert({
            destinationId: w.destinationId,
            origin: profile.origin,
            targetUSD: w.targetUSD,
            nights: w.nights,
            month: w.month,
            party: extra?.party ?? { adults: profile.travelers, childAges: profile.childAges ?? [], bags: profile.bags ?? "cabin" },
            style: extra?.style ?? profile.style,
          })
          .catch(() => {});
        setWatchlist((prev) => [
          { ...w, id: `w_${Date.now().toString(36)}`, createdAt: new Date().toISOString() },
          ...prev.filter((x) => x.destinationId !== w.destinationId),
        ]);
      },
      removeWatch: (id) =>
        setWatchlist((prev) => {
          const item = prev.find((x) => x.id === id);
          if (item) api.deleteAlert(item.destinationId).catch(() => {});
          return prev.filter((x) => x.id !== id);
        }),
      money: (usd) => formatMoney(usd, profile.currency, rate),
      toUSD: (amount) => (profile.currency === "ARS" ? amount / rate : amount),
      fromUSD: (usd) => (profile.currency === "ARS" ? Math.round(usd * rate) : Math.round(usd)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta, destinations, photos, storedProfile, packages, watchlist, rate, shared.sharedTrips, shared.sharedNotice, me],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Guarda en el servidor cada cambio (agrupando cambios seguidos). */
function useSave(key: "profile" | "packages" | "watchlist", value: unknown, enabled: boolean) {
  const first = useRef(true);
  useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      return;
    }
    if (value == null) return;
    const t = setTimeout(() => api.saveUserData(key, value).catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [key, value, enabled]);
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp fuera de AppProvider");
  return v;
}

/** Descarta o completa viajes guardados con datos incompletos (versiones viejas o datos dañados). */
function cleanPackages(list: unknown): TripPackage[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p): p is TripPackage => Boolean(p && typeof p === "object" && (p as TripPackage).id))
    .map((p) => ({
      ...p,
      destinationName: p.destinationName || "Viaje",
      departDate: typeof p.departDate === "string" ? p.departDate : "",
      returnDate: typeof p.returnDate === "string" ? p.returnDate : "",
      travelers: Number(p.travelers) > 0 ? Number(p.travelers) : 1,
      items: Array.isArray(p.items) ? p.items.filter((i) => i && typeof i.amountUSD === "number") : [],
      totalUSD: Number(p.totalUSD) || 0,
      status: p.status === "idea" || p.status === "reservado" ? p.status : "armando",
      style: p.style ?? "mid",
      // Checklist del viaje: se conserva solo si tiene el formato esperado.
      checklist: Array.isArray(p.checklist)
        ? p.checklist
            .filter((t) => t && typeof t.id === "string" && typeof t.label === "string")
            .map((t) => ({ id: t.id, label: t.label, done: Boolean(t.done) }))
        : undefined,
    }));
}
