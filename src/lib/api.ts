import type {
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
  Profile,
  RealHotel,
  StayOption,
  Style,
  TripPackage,
} from "../../shared/types.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

const qs = (params: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  meta: () => request<Meta>("/api/meta"),
  destinations: () => request<Destination[]>("/api/destinations"),
  photos: () => request<Record<string, string>>("/api/photos"),
  destination: (id: string, p: { origin: string; nights: number; travelers: number; style: Style }) =>
    request<{ destination: Destination; baseFlightUSD: number; months: MonthPrice[] }>(
      `/api/destinations/${id}?${qs(p)}`,
    ),
  explore: (body: ExploreRequest) =>
    request<ExploreResponse>("/api/explore", { method: "POST", body: JSON.stringify(body) }),
  calendar: (p: { origin: string; dest: string; month: string; nights: number }) =>
    request<FlightCalendar>(`/api/flights/calendar?${qs(p)}`),
  radar: (origin: string) => request<RadarSnapshot>(`/api/radar?origin=${origin}`),
  radarRun: (origin: string) => request<RadarSnapshot>(`/api/radar/run?origin=${origin}`, { method: "POST" }),
  alerts: () => request<{ subs: AlertSub[]; settings: AlertSettings; telegram: boolean }>("/api/alerts"),
  saveAlert: (sub: Omit<AlertSub, "id" | "createdAt" | "lastNotifiedUSD" | "lastNotifiedAt">) =>
    request<{ subs: AlertSub[] }>("/api/alerts/subs", { method: "POST", body: JSON.stringify(sub) }),
  deleteAlert: (id: string) => request<{ subs: AlertSub[] }>(`/api/alerts/subs/${id}`, { method: "DELETE" }),
  alertSettings: (s: Pick<AlertSettings, "radarDeals" | "minDiscount">) =>
    request<{ settings: AlertSettings }>("/api/alerts/settings", { method: "PUT", body: JSON.stringify(s) }),
  telegramConnect: () => request<{ ok: boolean; name?: string; error?: string }>("/api/alerts/telegram/connect", { method: "POST" }),
  telegramTest: () => request<{ ok: boolean; error?: string }>("/api/alerts/telegram/test", { method: "POST" }),
  quota: () => request<{ left: number | null; total: number | null }>("/api/quota"),
  flightQuote: (p: { origin: string; dest: string; depart: string; ret: string; cacheOnly?: 1 }) =>
    request<FlightQuote>(`/api/flights/quote?${qs(p)}`),
  stays: (p: { dest: string; checkin: string; nights: number; travelers: number; real?: 1 }) =>
    request<{ options: StayOption[]; hotels: RealHotel[]; live: boolean }>(`/api/stays?${qs(p)}`),
  buildPackage: (body: {
    destinationId: string;
    origin: string;
    departDate: string;
    nights: number;
    travelers: number;
    style: Style;
    flightPP?: number;
  }) => request<TripPackage>("/api/packages/build", { method: "POST", body: JSON.stringify(body) }),
  agent: (messages: { role: "user" | "assistant"; content: string }[], profile: Profile) =>
    request<{ text: string; packages: TripPackage[] }>("/api/agent", {
      method: "POST",
      body: JSON.stringify({ messages, profile }),
    }),
};
