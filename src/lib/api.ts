import type { Extra } from "../../shared/extras.ts";
import type { ClimateMonth } from "../../shared/climate.ts";
import type {
  GeoPlace,
  TripPlan,
  TripPlanRequest,
  TripLeg,
  FlightResult,
  LegResult,
  Place,
  CrossResult,
  EscapeWeekend,
  AlertSettings,
  AlertSub,
  Destination,
  RadarSnapshot,
  ExploreRequest,
  ExploreResponse,
  FlightCalendar,
  FlightQuote,
  Meta,
  MonthPrice,
  Party,
  Profile,
  RealHotel,
  StayOption,
  Style,
  TripPackage,
  SharedTripResponse,
} from "../../shared/types.ts";
import type { CTrip, InvitePreview } from "../../shared/ctrip.ts";
import type { RoutesResponse } from "../../shared/routes.ts";

/** Mensaje para cuando el pedido ni siquiera llega (sin internet, corte, DNS). */
export const OFFLINE_MESSAGE = "Sin conexión. Revisá tu internet y probá de nuevo.";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (err) {
    // Un pedido cancelado a propósito sigue siendo AbortError para quien lo canceló.
    if ((err as Error)?.name === "AbortError") throw err;
    // Chrome dice "Failed to fetch" y Safari "Load failed": mostramos algo entendible.
    throw new Error(OFFLINE_MESSAGE);
  }
  const data = await res.json().catch(() => ({}));
  // Sesión vencida o sin iniciar: avisamos a la app para mostrar el ingreso.
  if (res.status === 401 && (data as { auth?: boolean }).auth) window.dispatchEvent(new Event("fmt:unauthorized"));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();

/** Grupo para las APIs (?adults=2&kids=5,8&bags=cabin): los chicos comparten habitación y pagan otra tarifa. */
export type PartyQuery = Partial<Record<"adults" | "kids" | "bags", string | number>>;

export const api = {
  session: () =>
    request<{ authenticated: boolean; user: string | null; role: "owner" | "member" | null; firstAccount: boolean; canRegister: boolean }>(
      "/api/session",
    ),
  register: (user: string, password: string, invite?: string) =>
    request<{ ok: boolean; user: string }>("/api/register", { method: "POST", body: JSON.stringify({ user, password, ...(invite ? { invite } : {}) }) }),
  changePassword: (current: string, password: string) =>
    request<{ ok: boolean }>("/api/account/password", { method: "POST", body: JSON.stringify({ current, password }) }),
  accountSettings: () => request<{ openSignup: boolean }>("/api/account/settings"),
  saveAccountSettings: (s: { openSignup: boolean }) =>
    request<{ openSignup: boolean }>("/api/account/settings", { method: "PUT", body: JSON.stringify(s) }),
  telegramLink: () => request<{ ok: boolean; url?: string; bot?: string; error?: string }>("/api/alerts/telegram/link", { method: "POST" }),
  login: (user: string, password: string) =>
    request<{ ok: boolean; user?: string }>("/api/login", { method: "POST", body: JSON.stringify({ user, password }) }),
  logout: () => request<{ ok: boolean }>("/api/logout", { method: "POST" }),
  userData: () => request<{ profile: unknown; packages: unknown; watchlist: unknown }>("/api/me/data"),
  saveUserData: (key: "profile" | "packages" | "watchlist", value: unknown) =>
    request<{ ok: boolean }>(`/api/me/data/${key}`, { method: "PUT", body: JSON.stringify(value) }),
  meta: () => request<Meta>("/api/meta"),
  destinations: () => request<Destination[]>("/api/destinations"),
  photos: () => request<Record<string, string>>("/api/photos"),
  destination: (id: string, p: { origin: string; nights: number; travelers: number; style: Style } & PartyQuery) =>
    request<{ destination: Destination; baseFlightUSD: number; months: MonthPrice[] }>(
      `/api/destinations/${id}?${qs(p)}`,
    ),
  explore: (body: ExploreRequest) =>
    request<ExploreResponse>("/api/explore", { method: "POST", body: JSON.stringify(body) }),
  calendar: (p: { origin: string; dest: string; month: string; nights: number }) =>
    request<FlightCalendar>(`/api/flights/calendar?${qs(p)}`),
  places: (q: string) => request<Place[]>(`/api/places?${qs({ q })}`),
  searchFlights: (p: { origin: string; dest: string; depart: string; ret?: string; direct?: 1 }) =>
    request<{ results: FlightResult[]; strip: { date: string; price: number }[]; live: boolean; destinationId: string | null }>(
      `/api/search/flights?${qs(p)}`,
    ),
  searchMulti: (legs: { origin: string; destination: string; date: string }[]) =>
    request<LegResult[]>("/api/search/multi", { method: "POST", body: JSON.stringify({ legs }) }),
  searchHotels: (p: { place: string; name: string; checkin: string; checkout: string; travelers: number } & PartyQuery) =>
    request<{
      destinationId: string | null;
      name: string;
      nights: number;
      rooms: number;
      hotels: RealHotel[];
      options: StayOption[];
      links: { label: string; url: string }[];
    }>(`/api/search/hotels?${qs(p)}`),
  geo: (q: string) => request<GeoPlace[]>(`/api/geo?${qs({ q })}`),
  planTrip: (body: TripPlanRequest) => request<TripPlan>("/api/trip/plan", { method: "POST", body: JSON.stringify(body) }),
  /** Vuelve a mirar el precio de un tramo (día exacto, sin caché larga). */
  tripLeg: (body: { from: string; to: string; date: string; returnDate: string | null }) =>
    request<Pick<TripLeg, "from" | "to" | "price" | "priceKind" | "priceDate" | "priceSource" | "airline" | "stops" | "link">>("/api/trip/leg", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  tripHotels: (
    p: { name: string; country: string; lat: number; lon: number; checkin: string; nights: number; travelers: number; rooms?: number; style: string } & PartyQuery,
  ) =>
    request<{
      destinationId: string | null;
      hotels: RealHotel[];
      source: "xotelo" | "google" | null;
      rooms: number;
      estimateNight: number;
      estimateFrom: string | null;
      links: { label: string; url: string }[];
    }>(`/api/trip/hotels?${qs(p)}`),
  // Compartir un viaje por link (solo lectura).
  myShares: () => request<{ shares: Record<string, string> }>("/api/me/shares"),
  share: (pkg: TripPackage) =>
    request<{ id: string; path: string }>("/api/share", { method: "POST", body: JSON.stringify({ package: pkg }) }),
  unshare: (id: string) => request<{ ok: boolean; shares: Record<string, string> }>(`/api/share/${id}`, { method: "DELETE" }),
  sharedTrip: (id: string) => request<SharedTripResponse>(`/api/share/${encodeURIComponent(id)}`),
  // Viajes con otros (editables por todos los integrantes).
  myCTrips: () => request<{ trips: CTrip[] }>("/api/me/ctrips"),
  createCTrip: (pkg: TripPackage) => request<{ trip: CTrip }>("/api/ctrips", { method: "POST", body: JSON.stringify({ package: pkg }) }),
  /** Devuelve el estado HTTP: 409 trae la versión más nueva en `trip`. */
  saveCTrip: async (id: string, version: number, pkg: TripPackage): Promise<{ status: number; trip?: CTrip; error?: string }> => {
    try {
      const res = await fetch(`/api/ctrips/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, package: pkg }),
      });
      const data = (await res.json().catch(() => ({}))) as { trip?: CTrip; error?: string; auth?: boolean };
      if (res.status === 401 && data.auth) window.dispatchEvent(new Event("fmt:unauthorized"));
      return { status: res.status, trip: data.trip, error: data.error };
    } catch {
      return { status: 0 };
    }
  },
  deleteCTrip: (id: string) => request<{ ok: boolean }>(`/api/ctrips/${encodeURIComponent(id)}`, { method: "DELETE" }),
  removeCTripMember: (id: string, user: string) =>
    request<{ trip: CTrip }>(`/api/ctrips/${encodeURIComponent(id)}/members/${encodeURIComponent(user)}`, { method: "DELETE" }),
  inviteCTrip: (id: string) =>
    request<{ id: string; path: string; expiresAt: string }>(`/api/ctrips/${encodeURIComponent(id)}/invite`, { method: "POST" }),
  invite: (id: string) => request<{ invite: InvitePreview }>(`/api/invite/${encodeURIComponent(id)}`),
  joinInvite: (id: string) => request<{ trip: CTrip }>(`/api/invite/${encodeURIComponent(id)}/join`, { method: "POST" }),
  climate: (lat: number, lon: number) => request<{ months: ClimateMonth[] }>(`/api/climate?${qs({ lat, lon })}`),
  extras: (dest: string) => request<{ extras: Extra[]; partner: boolean }>(`/api/extras?dest=${dest}`),
  cross: (p: { origin: string; dest: string; month: string }) => request<CrossResult>(`/api/cross?${qs(p)}`),
  escapes: (origin: string, party?: PartyQuery) => request<EscapeWeekend[]>(`/api/escapes?${qs({ origin, ...party })}`),
  radar: (origin: string) => request<RadarSnapshot>(`/api/radar?origin=${origin}`),
  routes: (origin: string, month: string) => request<RoutesResponse>(`/api/routes?${qs({ origin, month })}`),
  radarRun: (origin: string) => request<RadarSnapshot>(`/api/radar/run?origin=${origin}`, { method: "POST" }),
  radarHistory: (origin: string, dest: string) =>
    request<{ origin: string; dest: string; points: { t: string; p: number }[] }>(`/api/radar/history?${qs({ origin, dest })}`),
  alerts: () => request<{ subs: AlertSub[]; settings: AlertSettings; telegram: boolean }>("/api/alerts"),
  saveAlert: (sub: Omit<AlertSub, "id" | "createdAt" | "lastNotifiedUSD" | "lastNotifiedAt">) =>
    request<{ subs: AlertSub[] }>("/api/alerts/subs", { method: "POST", body: JSON.stringify(sub) }),
  deleteAlert: (id: string) => request<{ subs: AlertSub[] }>(`/api/alerts/subs/${id}`, { method: "DELETE" }),
  alertSettings: (s: Pick<AlertSettings, "radarDeals" | "minDiscount" | "origin">) =>
    request<{ settings: AlertSettings }>("/api/alerts/settings", { method: "PUT", body: JSON.stringify(s) }),
  telegramConnect: () => request<{ ok: boolean; name?: string; error?: string }>("/api/alerts/telegram/connect", { method: "POST" }),
  telegramTest: () => request<{ ok: boolean; error?: string }>("/api/alerts/telegram/test", { method: "POST" }),
  quota: () => request<{ left: number | null; total: number | null }>("/api/quota"),
  flightQuote: (p: { origin: string; dest: string; depart: string; ret: string; cacheOnly?: 1 }) =>
    request<FlightQuote>(`/api/flights/quote?${qs(p)}`),
  stays: (p: { dest: string; checkin: string; nights: number; travelers: number; real?: 1; google?: 1 } & PartyQuery) =>
    request<{ options: StayOption[]; hotels: RealHotel[]; source: "xotelo" | "google" | null; live: boolean }>(`/api/stays?${qs(p)}`),
  buildPackage: (body: {
    destinationId: string;
    origin: string;
    departDate: string;
    nights: number;
    travelers: number;
    party?: Party;
    includeDaily?: boolean;
    style: Style;
    flightPP?: number;
  }) => request<TripPackage>("/api/packages/build", { method: "POST", body: JSON.stringify(body) }),
  agent: (messages: { role: "user" | "assistant"; content: string }[], profile: Profile) =>
    request<{ text: string; packages: TripPackage[] }>("/api/agent", {
      method: "POST",
      body: JSON.stringify({ messages, profile }),
    }),
};
