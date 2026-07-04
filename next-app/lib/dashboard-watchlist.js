export const DASHBOARD_WATCHLIST_NAME = "Dashboard Favorites";
export const DASHBOARD_WATCHLIST_DESCRIPTION = "Favorites synced from the main dashboard";
export const WATCHLIST_BUCKETS = {
  driver: "drivers",
  team: "teams",
  race: "races",
};

function toStringArray(values) {
  if (values instanceof Set) return Array.from(values).map(String);
  if (Array.isArray(values)) return values.map(String);
  return [];
}

export function normalizeDashboardWatchlist(raw = null) {
  return {
    id: raw?.id || null,
    name: raw?.name || DASHBOARD_WATCHLIST_NAME,
    description: raw?.description || DASHBOARD_WATCHLIST_DESCRIPTION,
    drivers: toStringArray(raw?.drivers),
    teams: toStringArray(raw?.teams),
    races: toStringArray(raw?.races),
  };
}

export function createDashboardWatchlistSetState(raw = null) {
  const normalized = normalizeDashboardWatchlist(raw);

  return {
    ...normalized,
    drivers: new Set(normalized.drivers),
    teams: new Set(normalized.teams),
    races: new Set(normalized.races),
  };
}

export function cloneDashboardWatchlistSetState(watchlist) {
  return {
    ...watchlist,
    drivers: new Set(watchlist.drivers),
    teams: new Set(watchlist.teams),
    races: new Set(watchlist.races),
  };
}

export function countDashboardWatchlistItems(watchlist) {
  const sizeOf = (value) => {
    if (typeof value?.size === "number") return value.size;
    if (Array.isArray(value)) return value.length;
    return 0;
  };

  return sizeOf(watchlist?.drivers) + sizeOf(watchlist?.teams) + sizeOf(watchlist?.races);
}

export function toDashboardWatchlistPayload(watchlist) {
  return {
    name: watchlist?.name || DASHBOARD_WATCHLIST_NAME,
    description: watchlist?.description || DASHBOARD_WATCHLIST_DESCRIPTION,
    drivers: toStringArray(watchlist?.drivers),
    teams: toStringArray(watchlist?.teams),
    races: toStringArray(watchlist?.races),
  };
}

export async function fetchUserWatchlists() {
  const res = await fetch("/api/watchlist", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load watchlists (${res.status})`);
  return res.json();
}

export async function ensureDashboardWatchlist() {
  const lists = await fetchUserWatchlists();
  let dashboardList = Array.isArray(lists)
    ? lists.find((list) => list?.name === DASHBOARD_WATCHLIST_NAME)
    : null;

  if (!dashboardList) {
    const createRes = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toDashboardWatchlistPayload()),
    });

    if (!createRes.ok) {
      throw new Error(`Failed to create dashboard watchlist (${createRes.status})`);
    }

    dashboardList = await createRes.json();
  }

  return normalizeDashboardWatchlist(dashboardList);
}

export async function saveDashboardWatchlist(watchlist) {
  if (!watchlist?.id) throw new Error("Cannot save a watchlist without an id");

  const res = await fetch(`/api/watchlist/${watchlist.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toDashboardWatchlistPayload(watchlist)),
  });

  if (!res.ok) {
    throw new Error(`Failed to save watchlist (${res.status})`);
  }

  const updated = await res.json();
  return normalizeDashboardWatchlist(updated);
}
