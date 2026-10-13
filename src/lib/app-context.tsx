import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Destination, Meta, Profile, TripPackage, WatchItem } from "../../shared/types.ts";
import { api } from "./api.ts";
import { formatMoney } from "./format.ts";
import { useStored } from "./storage.ts";

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

interface AppState {
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
  addWatch: (w: Omit<WatchItem, "id" | "createdAt">) => void;
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
  const [packages, setPackages] = useStored<TripPackage[]>("fmt.packages", []);
  const [watchlist, setWatchlist] = useStored<WatchItem[]>("fmt.watchlist", []);

  useEffect(() => {
    api.meta().then(setMeta).catch(console.error);
    api.destinations().then(setDestinations).catch(console.error);
    api.photos().then(setPhotos).catch(() => setPhotos({}));
  }, []);

  const profile = { ...DEFAULT_PROFILE, ...storedProfile };
  const rate = meta?.usdArsRate ?? 1450;

  const value = useMemo<AppState>(
    () => ({
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
      addWatch: (w) =>
        setWatchlist((prev) => [
          { ...w, id: `w_${Date.now().toString(36)}`, createdAt: new Date().toISOString() },
          ...prev.filter((x) => x.destinationId !== w.destinationId),
        ]),
      removeWatch: (id) => setWatchlist((prev) => prev.filter((x) => x.id !== id)),
      money: (usd) => formatMoney(usd, profile.currency, rate),
      toUSD: (amount) => (profile.currency === "ARS" ? amount / rate : amount),
      fromUSD: (usd) => (profile.currency === "ARS" ? Math.round(usd * rate) : Math.round(usd)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta, destinations, photos, storedProfile, packages, watchlist, rate],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp fuera de AppProvider");
  return v;
}
