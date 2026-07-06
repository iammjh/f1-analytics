import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, Cell, AreaChart, Area, ComposedChart, CartesianGrid } from "recharts";
import SignOutButton from "../components/SignOutButton";
import {
  WATCHLIST_BUCKETS,
  createDashboardWatchlistSetState,
  cloneDashboardWatchlistSetState,
  countDashboardWatchlistItems,
  ensureDashboardWatchlist,
  saveDashboardWatchlist,
} from "./dashboard-watchlist";
import { getConstructorProfileMeta } from "./constructor-profile-data";
import {
  fetchCircuitResults,
  fetchConstructorStandings,
  fetchDriverStandings,
  fetchRoundPitStops,
  fetchRoundResultRace,
  fetchSeasonRaces,
  fetchSeasonResults,
  fetchSeasonStandingsBundle,
  getCompletedRaces,
} from "./jolpica-client";
import { formatGrandPrixName as gpName, getTeamColor as col } from "./f1-display";

// ── Constants ─────────────────────────────────────────────────────
const SEASONS = ["2026","2025","2024","2023","2022","2021","2020","2019","2018","2017","2016","2015"];
const CHART_PAL   = ["#3671C6","#E8002D","#27F4D2","#FF8000","#229971","#FF87BC","#FFD700","#a855f7","#64C4FF","#f97316"];
const STINT_PAL   = ["#E8002D","#FFD700","#d4d4d4","#27F4D2","#FF8000","#a855f7"];
const NAT_FLAGS   = {
  British:"🇬🇧", Dutch:"🇳🇱", Monegasque:"🇲🇨", Spanish:"🇪🇸", Mexican:"🇲🇽",
  Australian:"🇦🇺", German:"🇩🇪", French:"🇫🇷", Finnish:"🇫🇮", Canadian:"🇨🇦",
  Japanese:"🇯🇵", Danish:"🇩🇰", Thai:"🇹🇭", Chinese:"🇨🇳", American:"🇺🇸",
  Italian:"🇮🇹", Austrian:"🇦🇹", Brazilian:"🇧🇷", Argentine:"🇦🇷", Swiss:"🇨🇭",
  "New Zealander":"🇳🇿", Polish:"🇵🇱",
};
const NAV_GROUPS = [
  { label:"Core", items:[
    { id:"standings",    label:"Standings",      icon:"🏆" },
    { id:"drivers",      label:"Drivers",        icon:"👤" },
    { id:"constructors", label:"Constructors",   icon:"🏎️" },
    { id:"races",        label:"Race Results",   icon:"📋" },
    { id:"points",       label:"Points Progression",   icon:"📈" },
  ]},
  { label:"Analytics", items:[
    { id:"records",  label:"Season Records", icon:"🥇" },
    { id:"strategy", label:"Strategy",       icon:"🎯" },
    { id:"h2h",      label:"Head to Head",   icon:"⚔️"  },
    { id:"circuits", label:"Circuits",       icon:"🗺️"  },
    { id:"telemetry",  label:"Telemetry",      icon:"📊" },
    { id:"visualizer", label:"Lap Visualizer", icon:"👁️" },
  ]},
  { label:"Live", items:[
    { id:"live",      label:"Match",      icon:"🔴" },
    { id:"watchlist", label:"Watchlist", icon:"⭐" },
  ]},
];
const ALL_NAV = NAV_GROUPS.flatMap(g => g.items);
const DEFAULT_DASHBOARD_PAGE = "standings";
const DASHBOARD_TAB_PARAM = "tab";
const SEASON_SELECTOR_PAGES = new Set([
  "standings", "drivers", "constructors", "races", "points", "records", "strategy", "h2h",
]);

// ── API Cache (5-min TTL) ─────────────────────────────────────────
const _cache = new Map();
async function apiFetch(url, ttl = 300000) {
  const hit = _cache.get(url);
  if (hit && Date.now() - hit.ts < ttl) return hit.data;
  const data = await fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  _cache.set(url, { data, ts: Date.now() });
  return data;
}

// ── Utils ─────────────────────────────────────────────────────────
const flagOf = (nat) => NAT_FLAGS[nat] || "🌍";
const mono  = { fontFamily:"monospace" };
const pad2  = (n)  => String(n).padStart(2,"0");

function timeToSecs(t) {
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length === 2) return parseFloat(parts[0])*60 + parseFloat(parts[1]);
  return parseFloat(t);
}

function formatCountdown(dateStr, timeStr) {
  const target = new Date(`${dateStr}T${timeStr||"13:00:00"}Z`);
  const diff   = target - Date.now();
  if (diff <= 0) return null;
  return { d:Math.floor(diff/86400000), h:Math.floor((diff%86400000)/3600000), m:Math.floor((diff%3600000)/60000), s:Math.floor((diff%60000)/1000) };
}

function buildStints(stops, totalLaps) {
  const sorted = [...stops].sort((a,b) => Number(a.lap)-Number(b.lap));
  const out = []; let prev = 1;
  sorted.forEach((stop,i) => { const lap=Number(stop.lap); out.push({start:prev,end:lap,i,dur:stop.duration}); prev=lap+1; });
  out.push({start:prev, end:Number(totalLaps)||65, i:sorted.length});
  return out;
}

// ── Hooks ─────────────────────────────────────────────────────────
function useWindowWidth() {
  // Keep initial render deterministic across server and client to avoid hydration mismatch.
  const [w,setW] = useState(1200);
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    fn();
    window.addEventListener("resize",fn);
    return () => window.removeEventListener("resize",fn);
  },[]);
  return w;
}

function useDashboardWatchlist() {
  const { status } = useSession();
  const [watchlist, setWatchlist] = useState(() => createDashboardWatchlistSetState());
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (status === "loading") return undefined;

    if (status !== "authenticated") {
      setWatchlist(createDashboardWatchlistSetState());
      setLoaded(true);
      return undefined;
    }

    setLoaded(false);

    ensureDashboardWatchlist()
      .then(list => {
        if (!cancelled) {
          setWatchlist(createDashboardWatchlistSetState(list));
        }
      })
      .catch(error => {
        if (!cancelled) {
          console.error("Failed to load dashboard watchlist:", error);
          setWatchlist(createDashboardWatchlistSetState());
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [status]);

  const toggle = useCallback(async (type, id) => {
    if (!loaded || syncing || status !== "authenticated") return;

    const bucket = WATCHLIST_BUCKETS[type];
    if (!bucket) return;

    const itemId = String(id);
    let previous;
    let next;

    setWatchlist(prev => {
      previous = prev;
      next = cloneDashboardWatchlistSetState(prev);
      const targetSet = next[bucket];
      if (targetSet.has(itemId)) targetSet.delete(itemId);
      else targetSet.add(itemId);
      return next;
    });

    if (!next?.id) return;

    setSyncing(true);
    try {
      const updated = await saveDashboardWatchlist(next);
      setWatchlist(createDashboardWatchlistSetState(updated));
    } catch (error) {
      console.error("Failed to save dashboard watchlist:", error);
      if (previous) setWatchlist(previous);
    } finally {
      setSyncing(false);
    }
  }, [loaded, status, syncing]);

  return { watchlist, toggle, loaded, syncing, trackedCount: countDashboardWatchlistItems(watchlist) };
}

function useShareableH2H() {
  const getParams = () => {
    try {
      const p = new URLSearchParams(window.location.search);
      return { d1: p.get("d1")||"", d2: p.get("d2")||"" };
    } catch { return {d1:"",d2:""}; }
  };
  const setParams = (d1,d2) => {
    try {
      const url = new URL(window.location);
      url.searchParams.set("d1",d1); url.searchParams.set("d2",d2);
      window.history.replaceState({},"",url);
    } catch {}
  };
  return { getParams, setParams };
}

function getDashboardTabFromUrl() {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD_PAGE;
  try {
    const requestedTab = new URLSearchParams(window.location.search).get(DASHBOARD_TAB_PARAM);
    return ALL_NAV.some(item => item.id === requestedTab) ? requestedTab : DEFAULT_DASHBOARD_PAGE;
  } catch {
    return DEFAULT_DASHBOARD_PAGE;
  }
}

function syncDashboardTabToUrl(tab) {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!tab || tab === DEFAULT_DASHBOARD_PAGE) {
      url.searchParams.delete(DASHBOARD_TAB_PARAM);
    } else {
      url.searchParams.set(DASHBOARD_TAB_PARAM, tab);
    }
    window.history.replaceState({}, "", url);
  } catch {}
}

// ── Shared UI Components ──────────────────────────────────────────
// ── F1 Official Logo PNG ──────────────────────────────────────────
function F1Logo({ width=56, height="auto" }) {
  return (
    <img
      src="/F1-Logo.png"
      alt="Formula 1"
      width={width}
      height={height}
      style={{ display:"block", objectFit:"contain", flexShrink:0 }}
    />
  );
}

function NavIcon({ id, active, size = 16, color }) {
  const strokeColor = color || (active ? "#E10600" : "#555");

  const icons = {
    standings: (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s" }}>
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34" />
        <path d="M12 2a6 6 0 0 1 6 6v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z" />
      </svg>
    ),
    drivers: (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s" }}>
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v-2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    constructors: (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s" }}>
        {/* Front wing & endplates */}
        <path d="M2 17h20" />
        <path d="M2 17v-3h3" />
        <path d="M22 17v-3h-3" />
        {/* Nose cone & Halo cockpit */}
        <path d="M9 17l2-10h2l2 10" />
        <path d="M10 7a2 2 0 0 1 4 0" />
        {/* Tires */}
        <rect x="1" y="11" width="3" height="6" rx="1" />
        <rect x="20" y="11" width="3" height="6" rx="1" />
        {/* Suspension arms */}
        <path d="M4 14h5M15 14h5" />
      </svg>
    ),
    races: (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s" }}>
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
    ),
    points: (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s" }}>
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </svg>
    ),
    records: (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s" }}>
        <circle cx="12" cy="8" r="7" />
        <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
      </svg>
    ),
    strategy: (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s" }}>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
    h2h: (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s" }}>
        <line x1="2" y1="22" x2="22" y2="2" />
        <line x1="22" y1="22" x2="2" y2="2" />
        <line x1="7" y1="13" x2="11" y2="17" />
        <line x1="17" y1="13" x2="13" y2="17" />
      </svg>
    ),
    circuits: (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s" }}>
        <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
        <line x1="9" y1="3" x2="9" y2="18" />
        <line x1="15" y1="6" x2="15" y2="21" />
      </svg>
    ),
    telemetry: (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s" }}>
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    visualizer: (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s" }}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <circle cx="12" cy="11" r="3" />
      </svg>
    ),
    live: (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s" }}>
        <circle cx="12" cy="12" r="2" />
        <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        <path d="M7.76 16.24a6 6 0 0 1 0-8.49" />
        <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
      </svg>
    ),
    watchlist: (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s" }}>
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  };

  return icons[id] || null;
}

// ── Wikipedia image cache + hook ──────────────────────────────────
const _wikiCache = new Map();
const _wikiPending = new Map();

function extractWikiTitleFromUrl(url) {
  if (!url) return null;
  try {
    const match = new URL(url).pathname.match(/\/wiki\/([^?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function buildWikiCacheKey({ title, titles = [], searchQuery, searchQueries = [], imageIndex = 0, preferMediaList = false, mediaHint = "default", forceImageIndex = false }) {
  return JSON.stringify({
    title: title || null,
    titles: titles.filter(Boolean),
    searchQuery: searchQuery || null,
    searchQueries: searchQueries.filter(Boolean),
    imageIndex,
    preferMediaList,
    mediaHint,
    forceImageIndex,
  });
}

async function fetchWikiJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  return response.json();
}

function getWikipediaImageUrl(item) {
  return (
    item?.srcset?.find?.(s => s?.scale === "2x")?.src ||
    item?.srcset?.[0]?.src ||
    item?.original?.source ||
    null
  );
}

function scoreCircuitMediaItem(title = "") {
  const value = String(title).toLowerCase();
  let score = 0;

  // Strongly prefer SVG files (they are always proper circuit layouts)
  if (/\.svg$/.test(value)) score += 12;

  if (/logo|wordmark|emblem/.test(value)) score -= 100;
  if (/map|layout|track|outline|diagram|bare/.test(value)) score += 8;
  if (/circuit|autodromo|autódromo|ring|prix/.test(value)) score += 4;
  if (/\b20\d{2}\b/.test(value)) score += 2;
  if (/moto|rallycross|nascar|original|old|historic|history|evolution/.test(value)) score -= 8;
  if (/\d{4}-\d{4}/.test(value)) score -= 6;
  // Strongly penalise aerial/satellite/crowd/pit photos
  if (/skysat|sky sat|tower|crowd|pit|grandstand|aerial|formation|amphitheater|salut|hairpin|tunnel|wall|start.finish/.test(value)) score -= 15;
  if (/\.jpg$|\.jpeg$|\.png$/.test(value)) score -= 4;

  return score;
}

function pickWikipediaMediaItem(images, imageIndex = 0, mediaHint = "default", forceImageIndex = false) {
  if (!Array.isArray(images) || !images.length) return null;
  if (forceImageIndex && Number.isInteger(imageIndex) && imageIndex >= 0) return images[imageIndex] || null;
  if (Number.isInteger(imageIndex) && imageIndex > 0) return images[imageIndex] || null;

  if (mediaHint === "logo") {
    return images.find((item) => /logo|wordmark|emblem/i.test(item?.title || "")) || images[0] || null;
  }

  if (mediaHint === "circuit-layout") {
    const ranked = images
      .map((item, idx) => ({ item, idx, score: scoreCircuitMediaItem(item?.title || "") }))
      .sort((a, b) => b.score - a.score || a.idx - b.idx);
    return ranked[0]?.item || images[0] || null;
  }

  return images[imageIndex] || images[0] || null;
}

async function loadWikiThumbFromTitle(title, imageIndex = 0, preferMediaList = false, mediaHint = "default", forceImageIndex = false) {
  if (!title) return null;

  let url = null;

  if (preferMediaList || imageIndex > 0) {
    const mediaData = await fetchWikiJson(
      `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title)}`
    );
    const images = Array.isArray(mediaData?.items)
      ? mediaData.items.filter(item => item?.type === "image")
      : [];
    const chosen = pickWikipediaMediaItem(images, imageIndex, mediaHint, forceImageIndex);
    url = getWikipediaImageUrl(chosen);
  }

  if (!url) {
    const summaryData = await fetchWikiJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    );
    const raw = summaryData?.thumbnail?.source || null;
    url = raw ? raw.replace(/\/\d+px-/, "/400px-") : null;
  }

  return url;
}

async function searchWikipediaTitle(searchQuery) {
  if (!searchQuery) return null;
  const queryData = await fetchWikiJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=1&srsearch=${encodeURIComponent(searchQuery)}`
  );
  const title = queryData?.query?.search?.[0]?.title || null;
  return title ? title.replace(/ /g, "_") : null;
}

async function fetchWikiThumb(options) {
  const cacheKey = buildWikiCacheKey(options);
  if (_wikiCache.has(cacheKey)) return _wikiCache.get(cacheKey);
  if (_wikiPending.has(cacheKey)) return _wikiPending.get(cacheKey);

  const { title, titles = [], searchQuery, searchQueries = [], imageIndex = 0, preferMediaList = false, mediaHint = "default", forceImageIndex = false } = options;

  const request = (async () => {
    try {
      const directCandidates = [...new Set([
        title,
        ...titles,
      ].filter(Boolean))];

      for (const candidate of directCandidates) {
        const url = await loadWikiThumbFromTitle(candidate, imageIndex, preferMediaList, mediaHint, forceImageIndex);
        if (url) {
          _wikiCache.set(cacheKey, url);
          return url;
        }
      }

      const queries = [...new Set([
        searchQuery,
        ...searchQueries,
      ].filter(Boolean))];

      if (queries.length) {
        const searchedTitles = (await Promise.all(queries.map(searchWikipediaTitle))).filter(Boolean);
        const searchCandidates = [...new Set(
          searchedTitles.filter((candidate) => !directCandidates.includes(candidate))
        )];

        for (const candidate of searchCandidates) {
          const url = await loadWikiThumbFromTitle(candidate, imageIndex, preferMediaList, mediaHint, forceImageIndex);
          if (url) {
            _wikiCache.set(cacheKey, url);
            return url;
          }
        }
      }

      _wikiCache.set(cacheKey, null);
      return null;
    } catch {
      _wikiCache.set(cacheKey, null);
      return null;
    } finally {
      _wikiPending.delete(cacheKey);
    }
  })();

  _wikiPending.set(cacheKey, request);
  return request;
}

function useWikiImage(options) {
  const cacheKey = buildWikiCacheKey(options);
  const initialResolved = _wikiCache.has(cacheKey);
  const [img, setImg] = useState(initialResolved ? _wikiCache.get(cacheKey) : null);
  const [resolved, setResolved] = useState(initialResolved);

  useEffect(() => {
    let alive = true;
    setResolved(_wikiCache.has(cacheKey));
    setImg(_wikiCache.has(cacheKey) ? _wikiCache.get(cacheKey) : null);
    fetchWikiThumb(options).then((url) => {
      if (alive) {
        setImg(url);
        setResolved(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [cacheKey]);

  return { img, resolved };
}

function getFormula1HeadshotVariant(url, variant = "6col") {
  if (!url || typeof url !== "string") return null;
  if (!/media\.formula1\.com/.test(url) || !/\.transform\/[^/]+\/image\.png/.test(url)) return url;
  return url.replace(/\.transform\/[^/]+\/image\.png$/, `.transform/${variant}/image.png`);
}

// ── Driver image with official/Wikipedia fallback ─────────────────
function DriverPhoto({ firstName="", lastName="", wikiUrl, headshotUrl=null, headshotVariant="6col", teamColor="#E10600", style={} }) {
  const primaryTitle = extractWikiTitleFromUrl(wikiUrl);
  const compactFirstName = firstName.split(" ")[0] || firstName;
  const { img: wikiImgUrl } = useWikiImage({
    title: primaryTitle,
    titles: [
      `${firstName}_${lastName}`,
      `${compactFirstName}_${lastName}`,
    ],
    searchQuery: `${firstName} ${lastName}`.trim(),
    imageIndex: 0,
  });
  const [imgFailed, setImgFailed] = useState(false);
  const initials = `${firstName?.[0] || ""}${lastName?.[0] || ""}` || "F1";
  const imgUrl = getFormula1HeadshotVariant(headshotUrl, headshotVariant) || wikiImgUrl;

  useEffect(() => {
    setImgFailed(false);
  }, [imgUrl, headshotUrl, wikiUrl, firstName, lastName]);

  if (imgUrl && !imgFailed) {
    return (
      <img
        src={imgUrl}
        alt={`${firstName} ${lastName}`.trim()}
        style={{ objectFit:"cover", objectPosition:"center top", ...style }}
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <div style={{
      display:"flex", alignItems:"center", justifyContent:"center",
      background:`linear-gradient(135deg, ${teamColor}22, ${teamColor}08)`,
      border:`1px solid ${teamColor}33`,
      ...style,
    }}>
      <span style={{ fontSize: Math.min((style.height||120)/2.5, 48), fontWeight:800, color:teamColor, opacity:0.6, letterSpacing:-1 }}>
        {initials}
      </span>
    </div>
  );
}

function getConstructorBadgeText(teamName = "") {
  const tokens = String(teamName)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !["f1", "team", "formula", "one", "scuderia"].includes(token.toLowerCase()));

  if (!tokens.length) return "F1";
  return tokens.slice(0, 2).map((token) => token[0]).join("").toUpperCase();
}

function ConstructorLogo({ constructorId, teamName="", meta=null, teamColor="#E10600", height=220, compact=false }) {
  const { img: imgUrl } = useWikiImage({
    title: meta?.visualTitle || null,
    titles: [
      teamName ? teamName.replace(/ /g, "_") : null,
      meta?.visualSearch ? meta.visualSearch.replace(/ /g, "_") : null,
    ],
    searchQuery: `${teamName} logo`,
    searchQueries: [
      `${teamName} F1 logo`,
      `${teamName} Formula 1 logo`,
      `${meta?.visualSearch || teamName} logo`,
    ],
    imageIndex: meta?.logoImageIndex ?? 0,
    preferMediaList: true,
    mediaHint: "logo",
    forceImageIndex: typeof meta?.logoImageIndex === "number",
  });
  const [imgFailed, setImgFailed] = useState(false);
  const badge = getConstructorBadgeText(teamName || constructorId);

  useEffect(() => {
    setImgFailed(false);
  }, [imgUrl, constructorId, teamName]);

  return (
    <div style={{
      position:"relative",
      width:"100%",
      height,
      borderRadius:12,
      overflow:"hidden",
      border:`1px solid ${teamColor}33`,
      background:`linear-gradient(135deg, ${teamColor}12, #060606 72%)`,
      display:"flex",
      alignItems:"center",
      justifyContent:"center",
    }}>
      {imgUrl && !imgFailed ? (
        <>
          <div style={{
            position:"absolute",
            inset: compact ? 10 : 14,
            borderRadius: compact ? 12 : 16,
            background:"linear-gradient(145deg, rgba(255,255,255,0.98), rgba(232,236,241,0.94) 58%, rgba(213,219,226,0.9) 100%)",
            border:"1px solid rgba(255,255,255,0.45)",
            boxShadow:"0 10px 26px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.55)",
          }}/>
          <img
            src={imgUrl}
            alt={`${teamName} logo`}
            style={{
              position:"relative",
              zIndex:1,
              width:"100%",
              height:"100%",
              objectFit:"contain",
              objectPosition:"center center",
              padding: compact ? "16px 18px" : "24px 26px",
              filter:"drop-shadow(0 0 6px rgba(255,255,255,0.18)) drop-shadow(0 10px 16px rgba(0,0,0,0.28))",
            }}
            onError={() => setImgFailed(true)}
          />
        </>
      ) : (
        <div style={{
          width:"100%",
          height:"100%",
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          background:`radial-gradient(circle at top left, ${teamColor}28, transparent 38%), linear-gradient(135deg, ${teamColor}12, #070707 74%)`,
        }}>
          <div style={{ textAlign:"center", padding:"0 24px" }}>
            <div style={{ fontSize: compact ? 34 : 52, fontWeight:900, color:teamColor, letterSpacing:-2, marginBottom:8 }}>{badge}</div>
            <div style={{ fontSize: compact ? 12 : 14, fontWeight:700, color:"#f3f4f6" }}>{teamName}</div>
            <div style={{ fontSize:11, color:"#8b8b8b", marginTop:6 }}>Logo not available</div>
          </div>
        </div>
      )}

      {!compact && (
        <div style={{
          position:"absolute",
          inset:0,
          background:"linear-gradient(180deg, rgba(6,6,6,0.02) 0%, rgba(6,6,6,0.08) 100%)",
          pointerEvents:"none",
        }}/>
      )}
    </div>
  );
}

// ── Circuit Wikipedia page titles ─────────────────────────────────
const CIRCUIT_WIKI = {
  bahrain:       "Bahrain_International_Circuit",
  jeddah:        "Jeddah_Corniche_Circuit",
  albert_park:   "Albert_Park_Circuit",
  suzuka:        "Suzuka_International_Racing_Course",
  shanghai:      "Shanghai_International_Circuit",
  miami:         "Miami_International_Autodrome",
  imola:         "Autodromo_Enzo_e_Dino_Ferrari",
  monaco:        "Circuit_de_Monaco",
  villeneuve:    "Circuit_Gilles_Villeneuve",
  catalunya:     "Circuit_de_Barcelona-Catalunya",
  silverstone:   "Silverstone_Circuit",
  hungaroring:   "Hungaroring",
  spa:           "Circuit_de_Spa-Francorchamps",
  zandvoort:     "Circuit_Zandvoort",
  monza:         "Autodromo_Nazionale_Monza",
  baku:          "Baku_City_Circuit",
  marina_bay:    "Marina_Bay_Street_Circuit",
  americas:      "Circuit_of_the_Americas",
  rodriguez:     "Autodromo_Hermanos_Rodriguez",
  interlagos:    "Autodromo_Jose_Carlos_Pace",
  las_vegas:     "Las_Vegas_Strip_Circuit",
  vegas:         "Las_Vegas_Strip_Circuit",
  madring:       "Madring",
  yas_marina:    "Yas_Marina_Circuit",
  losail:        "Losail_International_Circuit",
  red_bull_ring: "Red_Bull_Ring",
  portimao:      "Algarve_International_Circuit",
  mugello:       "Mugello_Circuit",
  nurburgring:   "Nurburgring",
  istanbul:      "Istanbul_Park",
  sochi:         "Sochi_Autodrom",
};

const CIRCUIT_IMAGE_INDEX = {
  // index 1+ forces preferMediaList + explicit position
  bahrain: 1,
  jeddah: 1,
  miami: 1,
  silverstone: 1,
  spa: 1,
  hungaroring: 1,
  monza: 1,
  red_bull_ring: 1,
  americas: 1,
  rodriguez: 1,
  // index 0 with preferMediaList = use scorer on all images
  albert_park: 0,
  monaco: 0,
  villeneuve: 0,
  suzuka: 0,
  shanghai: 0,
  baku: 0,
  interlagos: 0,
  las_vegas: 0,
  yas_marina: 0,
  losail: 0,
  zandvoort: 0,
  marina_bay: 0,
  madring: 0,
};

// ── Static list of the 25 modern F1 circuits (2024-2026 calendars) ──
const STATIC_CIRCUITS = [
  { circuitId: "bahrain", circuitName: "Bahrain International Circuit", url: "https://en.wikipedia.org/wiki/Bahrain_International_Circuit", Location: { country: "Bahrain", locality: "Sakhir" } },
  { circuitId: "jeddah", circuitName: "Jeddah Corniche Circuit", url: "https://en.wikipedia.org/wiki/Jeddah_Corniche_Circuit", Location: { country: "Saudi Arabia", locality: "Jeddah" } },
  { circuitId: "albert_park", circuitName: "Albert Park Circuit", url: "https://en.wikipedia.org/wiki/Albert_Park_Circuit", Location: { country: "Australia", locality: "Melbourne" } },
  { circuitId: "suzuka", circuitName: "Suzuka International Racing Course", url: "https://en.wikipedia.org/wiki/Suzuka_International_Racing_Course", Location: { country: "Japan", locality: "Suzuka" } },
  { circuitId: "shanghai", circuitName: "Shanghai International Circuit", url: "https://en.wikipedia.org/wiki/Shanghai_International_Circuit", Location: { country: "China", locality: "Shanghai" } },
  { circuitId: "miami", circuitName: "Miami International Autodrome", url: "https://en.wikipedia.org/wiki/Miami_International_Autodrome", Location: { country: "USA", locality: "Miami" } },
  { circuitId: "imola", circuitName: "Autodromo Enzo e Dino Ferrari", url: "https://en.wikipedia.org/wiki/Autodromo_Enzo_e_Dino_Ferrari", Location: { country: "Italy", locality: "Imola" } },
  { circuitId: "monaco", circuitName: "Circuit de Monaco", url: "https://en.wikipedia.org/wiki/Circuit_de_Monaco", Location: { country: "Monaco", locality: "Monte Carlo" } },
  { circuitId: "villeneuve", circuitName: "Circuit Gilles Villeneuve", url: "https://en.wikipedia.org/wiki/Circuit_Gilles_Villeneuve", Location: { country: "Canada", locality: "Montreal" } },
  { circuitId: "catalunya", circuitName: "Circuit de Barcelona-Catalunya", url: "https://en.wikipedia.org/wiki/Circuit_de_Barcelona-Catalunya", Location: { country: "Spain", locality: "Montmeló" } },
  { circuitId: "red_bull_ring", circuitName: "Red Bull Ring", url: "https://en.wikipedia.org/wiki/Red_Bull_Ring", Location: { country: "Austria", locality: "Spielberg" } },
  { circuitId: "silverstone", circuitName: "Silverstone Circuit", url: "https://en.wikipedia.org/wiki/Silverstone_Circuit", Location: { country: "UK", locality: "Silverstone" } },
  { circuitId: "hungaroring", circuitName: "Hungaroring", url: "https://en.wikipedia.org/wiki/Hungaroring", Location: { country: "Hungary", locality: "Budapest" } },
  { circuitId: "spa", circuitName: "Circuit de Spa-Francorchamps", url: "https://en.wikipedia.org/wiki/Circuit_de_Spa-Francorchamps", Location: { country: "Belgium", locality: "Spa" } },
  { circuitId: "zandvoort", circuitName: "Circuit Zandvoort", url: "https://en.wikipedia.org/wiki/Circuit_Zandvoort", Location: { country: "Netherlands", locality: "Zandvoort" } },
  { circuitId: "monza", circuitName: "Autodromo Nazionale Monza", url: "https://en.wikipedia.org/wiki/Autodromo_Nazionale_Monza", Location: { country: "Italy", locality: "Monza" } },
  { circuitId: "madring", circuitName: "Circuit de Madrid", url: "https://en.wikipedia.org/wiki/Madrid_Grand_Prix", Location: { country: "Spain", locality: "Madrid" } },
  { circuitId: "baku", circuitName: "Baku City Circuit", url: "https://en.wikipedia.org/wiki/Baku_City_Circuit", Location: { country: "Azerbaijan", locality: "Baku" } },
  { circuitId: "marina_bay", circuitName: "Marina Bay Street Circuit", url: "https://en.wikipedia.org/wiki/Marina_Bay_Street_Circuit", Location: { country: "Singapore", locality: "Singapore" } },
  { circuitId: "americas", circuitName: "Circuit of the Americas", url: "https://en.wikipedia.org/wiki/Circuit_of_the_Americas", Location: { country: "USA", locality: "Austin" } },
  { circuitId: "rodriguez", circuitName: "Autódromo Hermanos Rodríguez", url: "https://en.wikipedia.org/wiki/Aut%C3%B3dromo_Hermanos_Rodr%C3%ADguez", Location: { country: "Mexico", locality: "Mexico City" } },
  { circuitId: "interlagos", circuitName: "Autódromo José Carlos Pace", url: "https://en.wikipedia.org/wiki/Aut%C3%B3dromo_Jos%C3%A9_Carlos_Pace", Location: { country: "Brazil", locality: "São Paulo" } },
  { circuitId: "vegas", circuitName: "Las Vegas Strip Circuit", url: "https://en.wikipedia.org/wiki/Las_Vegas_Strip_Circuit", Location: { country: "USA", locality: "Las Vegas" } },
  { circuitId: "losail", circuitName: "Lusail International Circuit", url: "https://en.wikipedia.org/wiki/Lusail_International_Circuit", Location: { country: "Qatar", locality: "Al Daayen" } },
  { circuitId: "yas_marina", circuitName: "Yas Marina Circuit", url: "https://en.wikipedia.org/wiki/Yas_Marina_Circuit", Location: { country: "UAE", locality: "Abu Dhabi" } },
];

// ── Circuit image using local TRACK_PATHS data ──────────────────────
function CircuitImage({ circuitId, height = 130 }) {
  const idMap = {
    albert_park:   "melbourne",
    villeneuve:    "montreal",
    catalunya:     "barcelona",
    marina_bay:    "singapore",
    americas:      "austin",
    rodriguez:     "mexico_city",
    losail:        "lusail",
    vegas:         "las_vegas",
    red_bull_ring: "spielberg",
  };
  const pathKey = idMap[circuitId] || circuitId;
  const pathD = TRACK_PATHS[pathKey];

  const pathRef = useRef(null);
  const [viewBox, setViewBox] = useState("-20 -20 540 540");

  useEffect(() => {
    if (pathRef.current) {
      try {
        const bbox = pathRef.current.getBBox();
        const padding = Math.max(bbox.width, bbox.height) * 0.15;
        setViewBox(`${bbox.x - padding} ${bbox.y - padding} ${bbox.width + 2 * padding} ${bbox.height + 2 * padding}`);
      } catch (err) {
        console.warn("getBBox failed", err);
      }
    }
  }, [pathD]);

  if (!pathD) {
    return (
      <div style={{
        width: "100%", height,
        background: "radial-gradient(circle at center, rgba(39, 244, 210, 0.05) 0%, #060606 90%)",
        borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
        border: "1px solid #1c1c1c"
      }}>
        <div style={{ fontSize: 20 }}>🏁</div>
      </div>
    );
  }

  return (
    <div style={{
      width: "100%", height,
      background: "radial-gradient(circle at center, rgba(39, 244, 210, 0.05) 0%, #060606 90%)",
      borderRadius: 6, overflow: "hidden", position: "relative",
      display: "flex", alignItems: "center", justifyContent: "center",
      border: "1px solid #1c1c1c",
    }}>
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "90%", height: "90%" }}
      >
        <path
          ref={pathRef}
          d={pathD}
          fill="none"
          stroke="#27F4D2"
          strokeWidth="16"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            filter: "drop-shadow(0 0 10px rgba(39, 244, 210, 0.75))"
          }}
        />
      </svg>
    </div>
  );
}

function buildSeasonCircuitList(races = []) {
  // Create a map of circuitId -> race/round info from active calendar
  const activeMap = new Map();
  races.forEach((race) => {
    const circuitId = race?.Circuit?.circuitId;
    if (circuitId) {
      activeMap.set(circuitId, {
        round: race?.round || null,
        raceName: race?.raceName || null,
      });
    }
  });

  // Map the static list of all 25 modern circuits, attaching active round info if present
  const list = STATIC_CIRCUITS.map((c) => {
    const active = activeMap.get(c.circuitId) || activeMap.get(c.circuitId === "las_vegas" ? "vegas" : c.circuitId === "lusail" ? "losail" : "");
    return {
      ...c,
      round: active?.round || null,
      raceName: active?.raceName || null,
    };
  });

  // Sort: active season rounds first (by round number), followed by non-calendar circuits alphabetically
  return list.sort((a, b) => {
    if (a.round && b.round) return Number(a.round) - Number(b.round);
    if (a.round) return -1;
    if (b.round) return 1;
    return a.circuitName.localeCompare(b.circuitName);
  });
}

function Spinner() {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 0",gap:16}}>
      {/* Starting Gantry */}
      <div style={{
        background:"#080808",
        border:"1px solid #222",
        borderRadius:12,
        padding:"14px 22px",
        display:"flex",
        gap:14,
        boxShadow:"0 10px 30px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)"
      }}>
        {[1, 2, 3, 4, 5].map(idx => (
          <div key={idx} style={{
            display:"flex",
            flexDirection:"column",
            gap:4,
            background:"#020202",
            padding:"6px",
            borderRadius:6,
            border:"1px solid #151515"
          }}>
            <div className={`f1-light-${idx}`} style={{width:14,height:14,borderRadius:"50%",background:"#1a0202"}}/>
            <div className={`f1-light-${idx}`} style={{width:14,height:14,borderRadius:"50%",background:"#1a0202"}}/>
          </div>
        ))}
      </div>

      <span style={{
        fontSize:10,
        fontWeight:700,
        color:"#888",
        textTransform:"uppercase",
        letterSpacing:2,
        animation:"f1Pulse 1.5s infinite ease-in-out",
        fontFamily:"monospace"
      }}>
        Lights out and away we go...
      </span>

      <style>{`
        @keyframes f1Light1 {
          0%, 10% { background: #1a0202; box-shadow: none; }
          10.1%, 70% { background: #ff0000; box-shadow: 0 0 12px #ff0000, 0 0 20px #ff0000; }
          70.1%, 100% { background: #1a0202; box-shadow: none; }
        }
        @keyframes f1Light2 {
          0%, 22% { background: #1a0202; box-shadow: none; }
          22.1%, 70% { background: #ff0000; box-shadow: 0 0 12px #ff0000, 0 0 20px #ff0000; }
          70.1%, 100% { background: #1a0202; box-shadow: none; }
        }
        @keyframes f1Light3 {
          0%, 34% { background: #1a0202; box-shadow: none; }
          34.1%, 70% { background: #ff0000; box-shadow: 0 0 12px #ff0000, 0 0 20px #ff0000; }
          70.1%, 100% { background: #1a0202; box-shadow: none; }
        }
        @keyframes f1Light4 {
          0%, 46% { background: #1a0202; box-shadow: none; }
          46.1%, 70% { background: #ff0000; box-shadow: 0 0 12px #ff0000, 0 0 20px #ff0000; }
          70.1%, 100% { background: #1a0202; box-shadow: none; }
        }
        @keyframes f1Light5 {
          0%, 58% { background: #1a0202; box-shadow: none; }
          58.1%, 70% { background: #ff0000; box-shadow: 0 0 12px #ff0000, 0 0 20px #ff0000; }
          70.1%, 100% { background: #1a0202; box-shadow: none; }
        }
        @keyframes f1Pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .f1-light-1 { animation: f1Light1 3.5s infinite; }
        .f1-light-2 { animation: f1Light2 3.5s infinite; }
        .f1-light-3 { animation: f1Light3 3.5s infinite; }
        .f1-light-4 { animation: f1Light4 3.5s infinite; }
        .f1-light-5 { animation: f1Light5 3.5s infinite; }
      `}</style>
    </div>
  );
}

function StatCard({label, value, sub, accent, onClick, delay=0}) {
  return (
    <div
      onClick={onClick}
      style={{
        background:"linear-gradient(135deg, #0f0f0f 0%, #0a0a0a 100%)",
        border:`1px solid ${accent ? accent+"33" : "#1e1e1e"}`,
        borderRadius:10, padding:"14px 16px",
        cursor:onClick?"pointer":"default",
        position:"relative", overflow:"hidden",
        animation:`cardIn 0.3s ease-out ${delay}ms both`,
        transition:"transform 0.18s, box-shadow 0.18s",
      }}
      onMouseEnter={e=>{ if(onClick){ e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow=`0 6px 20px ${accent||"#E10600"}22`; }}}
      onMouseLeave={e=>{ if(onClick){ e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow="none"; }}}
    >
      {/* Top accent line */}
      {accent && <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:`linear-gradient(90deg, ${accent}, ${accent}44, transparent)`, borderRadius:"10px 10px 0 0" }}/>}
      <div style={{fontSize:10, color:"#444", textTransform:"uppercase", letterSpacing:1.5, marginBottom:8, fontWeight:600}}>{label}</div>
      <div style={{fontSize:22, fontWeight:800, color:accent||"#fff", fontFamily:"monospace", lineHeight:1}}>{value ?? "—"}</div>
      {sub && <div style={{fontSize:11, color:"#555", marginTop:6}}>{sub}</div>}
    </div>
  );
}

function PosBadge({pos}) {
  const m={"1":"#FFD700","2":"#C0C0C0","3":"#CD7F32"};
  const bg=m[String(pos)]||"transparent", c=m[String(pos)]?"#000":"#666";
  return <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:26,borderRadius:"50%",fontSize:12,fontWeight:700,background:bg,color:c,border:m[String(pos)]?"none":"1px solid #2a2a2a",...mono}}>{pos}</span>;
}

function PtsBar({points,max,color="#E10600"}) {
  const pct = Math.round((points/Math.max(max,1))*100);
  return (
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <div style={{flex:1,height:4,background:"#1a1a1a",borderRadius:2,overflow:"hidden"}}>
        <div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:2,transition:"width 0.8s ease"}}/>
      </div>
      <span style={{...mono,fontSize:13,color:"#fff",minWidth:36,textAlign:"right"}}>{points}</span>
    </div>
  );
}

function Dot({pos,status}) {
  const s=String(pos);
  if(s==="1") return <span style={{width:10,height:10,borderRadius:"50%",background:"#FFD700",display:"inline-block"}}/>;
  if(s==="2") return <span style={{width:10,height:10,borderRadius:"50%",background:"#C0C0C0",display:"inline-block"}}/>;
  if(s==="3") return <span style={{width:10,height:10,borderRadius:"50%",background:"#CD7F32",display:"inline-block"}}/>;
  if(Number(pos)<=10) return <span style={{width:10,height:10,borderRadius:"50%",background:"#27F4D2",opacity:0.6,display:"inline-block"}}/>;
  if(status==="Finished"||status?.startsWith("+")) return <span style={{width:10,height:10,borderRadius:"50%",background:"#333",display:"inline-block"}}/>;
  return <span style={{width:10,height:10,borderRadius:2,background:"#E10600",opacity:0.5,display:"inline-block"}}/>;
}

function Tabs({tabs,active,onSelect,wrap}) {
  return (
    <div style={{display:"flex",gap:4,background:"#0f0f0f",padding:4,borderRadius:8,width:wrap?"100%":"fit-content",marginBottom:20,flexWrap:"wrap"}}>
      {tabs.map(([id,label]) => (
        <button key={id} onClick={()=>onSelect(id)} style={{flex:wrap?"1":"0",padding:"7px 14px",borderRadius:6,border:"none",cursor:"pointer",fontSize:13,fontWeight:500,background:active===id?"#E10600":"transparent",color:active===id?"#fff":"#666",transition:"all 0.15s",whiteSpace:"nowrap"}}>{label}</button>
      ))}
    </div>
  );
}

function SecLabel({children}) {
  return <div style={{fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:2,marginBottom:12,fontWeight:600}}>{children}</div>;
}


function Empty({icon="📭",msg="No data available"}) {
  const size = 32;
  const color = "#3a3a3a"; // Sleek gray for empty state vectors

  const m = {
    "📭": (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2Z" />
        <path d="M6 10h12" />
        <path d="M6 6h12" />
      </svg>
    ),
    "📈": (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </svg>
    ),
    "🟰": (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="9" x2="19" y2="9" />
        <line x1="5" y1="15" x2="19" y2="15" />
      </svg>
    ),
    "🥇": (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="7" />
        <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
      </svg>
    ),
    "🎯": (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
    "🔧": (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    "⚔️": (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <line x1="2" y1="22" x2="22" y2="2" />
        <line x1="22" y1="22" x2="2" y2="2" />
        <line x1="7" y1="13" x2="11" y2="17" />
        <line x1="17" y1="13" x2="13" y2="17" />
      </svg>
    ),
    "🏁": (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
    ),
    "⚠️": (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke="#E10600" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    "⏱️": (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    "⭐": (
      <svg viewBox="0 0 24 24" width={size} height={size} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  };

  const renderedIcon = m[String(icon)] || <span style={{fontSize:32}}>{icon}</span>;

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 0",gap:12}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>{renderedIcon}</div>
      <div style={{color:"#555",fontSize:13,textAlign:"center",padding:"0 16px",lineHeight:1.5}}>{msg}</div>
    </div>
  );
}

function StarBtn({id,watchlist,onToggle,itemType="driver",disabled=false}) {
  const bucket = WATCHLIST_BUCKETS[itemType] || "drivers";
  const on = watchlist?.[bucket]?.has(String(id));

  return (
    <button
      onClick={e => {
        e.stopPropagation();
        if (!disabled) onToggle(itemType, id);
      }}
      disabled={disabled}
      style={{
        background:"transparent",
        border:`1px solid ${on?"#FFD700":"#222"}`,
        borderRadius:6,
        color:on?"#FFD700":"#444",
        padding:"4px 8px",
        cursor:disabled ? "not-allowed" : "pointer",
        fontSize:13,
        transition:"all 0.15s",
        flexShrink:0,
        opacity:disabled ? 0.55 : 1,
      }}
    >
      {on?"★":"☆"}
    </button>
  );
}

function TRow({children,onClick}) {
  return (
    <tr onClick={onClick} style={{borderBottom:"1px solid #141414",cursor:onClick?"pointer":"default"}}
      onMouseEnter={e=>e.currentTarget.style.background="#0d0d0d"}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{children}</tr>
  );
}

function TH({children,right,center}) {
  return <th style={{padding:"9px 12px",textAlign:right?"right":center?"center":"left",color:"#555",fontWeight:500,fontSize:11,letterSpacing:1,textTransform:"uppercase",whiteSpace:"nowrap"}}>{children}</th>;
}

function SlidePanel({children,onClose,width=385,isMobile}) {
  return (
    <div style={{
      position: isMobile ? "fixed" : "absolute",
      top:0, right:0,
      width: isMobile ? "100%" : width,
      height:"100%",
      background:"#0a0a0a",
      borderLeft:"1px solid #1c1c1c",
      overflowY:"auto",
      zIndex: isMobile ? 1000 : 10,
      boxShadow: isMobile ? "-4px 0 20px rgba(0,0,0,0.8)" : "none",
    }}>
      {children}
    </div>
  );
}

function PanelHeader({title,accent,onClose}) {
  return (
    <div style={{padding:"14px 18px",borderBottom:"1px solid #1c1c1c",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"#0a0a0a",zIndex:2}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:4,height:18,background:accent||"#E10600",borderRadius:2}}/>
        <span style={{fontWeight:700,fontSize:14}}>{title}</span>
      </div>
      <button onClick={onClose} style={{background:"transparent",border:"1px solid #222",color:"#666",width:28,height:28,borderRadius:6,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
    </div>
  );
}

function MiniStatGrid({items}) {
  return (
    <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(items.length,4)},1fr)`,gap:8,marginBottom:16}}>
      {items.map(([l,v,accent]) => (
        <div key={l} style={{background:"#111",borderRadius:6,padding:"8px 6px",textAlign:"center"}}>
          <div style={{fontSize:10,color:"#444",textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{l}</div>
          <div style={{fontSize:17,fontWeight:700,color:accent||"#fff",...mono}}>{v??"—"}</div>
        </div>
      ))}
    </div>
  );
}

// All page components below (DriverStandings, RaceResultsPage, etc.) - same as original file
function DriverStandings({season}) {
  const [data,setData]=useState([]);
  const [races,setRaces]=useState([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    setLoading(true);
    Promise.all([
      fetchDriverStandings(season, { limit: 100, fetcher: apiFetch }),
      fetchSeasonResults(season, { limit: 600, fetcher: apiFetch }),
    ])
      .then(([standings, seasonRaces]) => {
        setData(standings);
        setRaces(seasonRaces);
        setLoading(false);
      })
      .catch(()=>setLoading(false));
  },[season]);
  if(loading) return <Spinner/>;
  if(!data.length) return <Empty/>;
  const max=Number(data[0]?.points)||1;
  const leaderPts=Number(data[0]?.points)||0;
  const leader=data[0];
  const tc=col(leader?.Constructors?.[0]?.constructorId);
  const latestRaceContext = buildLatestRaceWinnerContext(races);
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:24}}>
        <StatCard label="Leader"  value={leader?.Driver?.familyName} sub={leader?.Constructors?.[0]?.name} accent={tc} delay={0}/>
        <StatCard label="Points"  value={leader?.points} sub="championship pts" accent="#FFD700" delay={60}/>
        <StatCard label="Season Wins" value={leader?.wins} sub="race victories so far" accent="#E10600" delay={120}/>
        <StatCard label="Latest GP Winner" value={latestRaceContext?.driverFamilyName || "—"} sub={latestRaceContext?.raceName || "No completed race yet"} accent={latestRaceContext?.teamColor} delay={180}/>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:560}}>
          <thead><tr style={{borderBottom:"1px solid #E10600"}}>
            <TH>Pos</TH><TH>Driver</TH><TH>Team</TH><TH right>Wins</TH><TH right>Gap</TH><TH>Points</TH>
          </tr></thead>
          <tbody>
            {data.map(d=>{
              const drv=d.Driver, team=d.Constructors?.[0], tc=col(team?.constructorId);
              const gap = leaderPts - Number(d.points);
              return (
                <TRow key={drv.driverId}>
                  <td style={{padding:"11px 12px"}}><PosBadge pos={d.position}/></td>
                  <td style={{padding:"11px 12px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:3,height:28,borderRadius:2,background:tc,flexShrink:0}}/>
                      <div>
                        <div style={{color:"#fff",fontWeight:600,fontSize:14}}>{drv.givenName} <span style={{color:"#aaa"}}>{drv.familyName}</span></div>
                        <div style={{color:"#444",fontSize:11,...mono}}>#{drv.permanentNumber}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{padding:"11px 12px",color:tc,fontSize:12,fontWeight:500,whiteSpace:"nowrap"}}>{team?.name||"—"}</td>
                  <td style={{padding:"11px 12px",textAlign:"right",...mono,color:"#fff"}}>{d.wins}</td>
                  <td style={{padding:"11px 12px",textAlign:"right",...mono,fontSize:12,color:gap===0?"#FFD700":"#666"}}>
                    {gap===0?"—":`-${gap}`}
                  </td>
                  <td style={{padding:"11px 12px",minWidth:130}}><PtsBar points={Number(d.points)} max={max}/></td>
                </TRow>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConstructorStandings({season}) {
  const [data,setData]=useState([]); const [loading,setLoading]=useState(true);
  useEffect(()=>{
    setLoading(true);
    fetchConstructorStandings(season, { limit: 15, fetcher: apiFetch })
      .then(data => { setData(data); setLoading(false); })
      .catch(()=>setLoading(false));
  },[season]);
  if(loading) return <Spinner/>;
  if(!data.length) return <Empty/>;
  const max=Number(data[0]?.points)||1;
  const leaderPts=Number(data[0]?.points)||0;
  return (
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:400}}>
        <thead><tr style={{borderBottom:"1px solid #E10600"}}>
          <TH>Pos</TH><TH>Constructor</TH><TH right>Wins</TH><TH right>Gap</TH><TH>Points</TH>
        </tr></thead>
        <tbody>
          {data.map(c=>{
            const team=c.Constructor, tc=col(team?.constructorId);
            const gap=leaderPts-Number(c.points);
            return (
              <TRow key={team.constructorId}>
                <td style={{padding:"11px 12px"}}><PosBadge pos={c.position}/></td>
                <td style={{padding:"11px 12px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:14,height:14,borderRadius:"50%",background:tc,flexShrink:0}}/>
                    <span style={{color:"#fff",fontWeight:600}}>{team.name}</span>
                  </div>
                </td>
                <td style={{padding:"11px 12px",textAlign:"right",...mono,color:"#fff"}}>{c.wins}</td>
                <td style={{padding:"11px 12px",textAlign:"right",...mono,fontSize:12,color:gap===0?"#FFD700":"#666"}}>{gap===0?"—":`-${gap}`}</td>
                <td style={{padding:"11px 12px",minWidth:130}}><PtsBar points={Number(c.points)} max={max} color={tc}/></td>
              </TRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StandingsPage({season}) {
  const [tab,setTab]=useState("drivers");
  return (
    <div>
      <Tabs tabs={[["drivers","Driver Championship"],["constructors","Constructor Championship"]]} active={tab} onSelect={setTab}/>
      {tab==="drivers"?<DriverStandings season={season}/>:<ConstructorStandings season={season}/>}
    </div>
  );
}

// Simplified stub for remaining components - just to get the app running
function LapTimesChart({season,round}) { return <Empty msg="Lap Times - Coming Soon"/>; }
function FastestLapLeaderboard({season}) { return <Empty msg="Fastest Lap Data - Coming Soon"/>; }

function RaceResultsPage({season,isMobile}) {
  const [races,setRaces]=useState([]); const [loading,setLoading]=useState(true);
  useEffect(()=>{
    setLoading(true);
    Promise.all([
      fetchSeasonRaces(season, { limit: 40, fetcher: apiFetch }),
      fetchSeasonResults(season, { limit: 1000, fetcher: apiFetch }),
    ])
      .then(([calendar, results]) => {
        const resultsMap = new Map(results.map(r => [r.round, r]));
        const merged = calendar.map(c => {
          if (resultsMap.has(c.round)) {
            return resultsMap.get(c.round);
          }
          return c;
        });
        const todayStr = new Date().toISOString().split('T')[0];
        const filtered = merged.filter(r => {
          if (r.Results && r.Results.length > 0) return true;
          return r.date && r.date <= todayStr;
        });
        setRaces(filtered);
        setLoading(false);
      })
      .catch(()=>setLoading(false));
  },[season]);

  if(loading) return <Spinner/>;
  if(!races.length) return <Empty msg="No races found"/>;
  return (
    <div>
      <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:700}}>
        <thead><tr style={{borderBottom:"1px solid #E10600"}}>
          <TH>Round</TH><TH>Grand Prix</TH><TH>Circuit</TH><TH>Location</TH><TH>Date</TH><TH>Winner</TH>
        </tr></thead>
        <tbody>
          {races.map(r=>(
            <TRow key={r.round}>
              <td style={{padding:"11px 12px"}}>
                <span style={{
                  display:"inline-flex",
                  alignItems:"center",
                  justifyContent:"center",
                  width:26,
                  height:26,
                  borderRadius:"50%",
                  fontSize:11,
                  fontWeight:800,
                  background:"rgba(225, 6, 0, 0.1)",
                  color:"#FF3830",
                  border:"1px solid rgba(225, 6, 0, 0.35)",
                  boxShadow:"0 0 8px rgba(225, 6, 0, 0.1)",
                  ...mono
                }}>
                  {r.round}
                </span>
              </td>
              <td style={{padding:"11px 12px",fontWeight:600,minWidth:120}}>{gpName(r.raceName)}</td>
              <td style={{padding:"11px 12px",color:"#FFD700",fontWeight:500,minWidth:100}}>{r.Circuit?.circuitName||"—"}</td>
              <td style={{padding:"11px 12px",color:"#888",fontSize:11}}>{r.Circuit?.Location?.country} {flagOf(r.Circuit?.Location?.country)}</td>
              <td style={{padding:"11px 12px",...mono,fontSize:11,color:"#666"}}>{r.date}</td>
              <td style={{padding:"11px 12px",fontWeight:600,color:r.Results?.[0]?.Constructor?.constructorId ? col(r.Results[0].Constructor.constructorId) : "#666",minWidth:80}}>
                {r.Results?.[0]?.Driver?.familyName ? (
                  r.Results[0].Driver.familyName
                ) : (
                  (() => {
                    const now = new Date();
                    const raceDate = new Date(`${r.date}T${r.time || "12:00:00Z"}`);
                    if (raceDate > now) {
                      return <span style={{color:"#555",fontSize:11,fontWeight:500,letterSpacing:0.5}}>Upcoming</span>;
                    }
                    return <span style={{color:"#FFD700",fontSize:11,fontWeight:600,letterSpacing:0.5}}>Pending</span>;
                  })()
                )}
              </td>
            </TRow>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function asNum(value, fallback=0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getFinishPosition(result) {
  const parsed = Number(result?.position);
  return Number.isFinite(parsed) ? parsed : null;
}

function isClassifiedFinish(status) {
  const label = String(status || "");
  return label === "Finished" || label.startsWith("+");
}

function isDnfResult(result) {
  const label = String(result?.status || "");
  if (!label) return false;
  return !isClassifiedFinish(label);
}

function getResultTone(result) {
  const position = getFinishPosition(result);
  if (position === 1) return "#FFD700";
  if (position !== null && position <= 3) return "#27F4D2";
  if (position !== null && position <= 10) return "#64C4FF";
  if (isDnfResult(result)) return "#E10600";
  return "#666";
}

function getResultLabel(result) {
  const position = getFinishPosition(result);
  if (position !== null) return `P${position}`;
  if (isDnfResult(result)) return "DNF";
  return result?.status || "—";
}

function buildLatestRaceWinnerContext(races = []) {
  const ordered = [...races].sort((a, b) => asNum(a.round) - asNum(b.round));
  const latestRace = ordered[ordered.length - 1] || null;
  const latestWinner = latestRace?.Results?.[0] || null;

  if (!latestRace || !latestWinner?.Driver?.driverId) {
    return null;
  }

  return {
    round: asNum(latestRace.round),
    raceName: gpName(latestRace.raceName || latestRace.name || "Latest Grand Prix"),
    date: latestRace.date || null,
    driverId: latestWinner.Driver.driverId,
    driverName:
      `${latestWinner.Driver.givenName || ""} ${latestWinner.Driver.familyName || ""}`.trim() ||
      latestWinner.Driver.driverId,
    driverFamilyName: latestWinner.Driver.familyName || latestWinner.Driver.driverId,
    teamName: latestWinner.Constructor?.name || "Unknown team",
    teamColor: col(latestWinner.Constructor?.constructorId),
  };
}

function normalizeDriverLookupValue(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildDriverHeadshotLookup(drivers = []) {
  const byCode = new Map();
  const byNumber = new Map();
  const byName = new Map();

  drivers.forEach((driver) => {
    if (!driver?.headshotUrl) return;

    if (driver.code) byCode.set(normalizeDriverLookupValue(driver.code), driver.headshotUrl);
    if (driver.driverNumber !== null && driver.driverNumber !== undefined) {
      byNumber.set(String(driver.driverNumber), driver.headshotUrl);
    }

    const firstName = normalizeDriverLookupValue(driver.firstName);
    const lastName = normalizeDriverLookupValue(driver.lastName);
    const fullName = normalizeDriverLookupValue(driver.fullName);

    if (fullName) byName.set(fullName, driver.headshotUrl);
    if (firstName && lastName) byName.set(`${firstName}${lastName}`, driver.headshotUrl);
    if (lastName) byName.set(lastName, driver.headshotUrl);
  });

  return { byCode, byNumber, byName };
}

function resolveDriverHeadshotUrl(driver, lookup) {
  if (!driver || !lookup) return null;

  const code = normalizeDriverLookupValue(driver.code);
  if (code && lookup.byCode.has(code)) return lookup.byCode.get(code);

  const number = driver.permanentNumber ? String(driver.permanentNumber) : "";
  if (number && lookup.byNumber.has(number)) return lookup.byNumber.get(number);

  const fullName = normalizeDriverLookupValue(`${driver.givenName || ""}${driver.familyName || ""}`);
  if (fullName && lookup.byName.has(fullName)) return lookup.byName.get(fullName);

  const familyName = normalizeDriverLookupValue(driver.familyName);
  if (familyName && lookup.byName.has(familyName)) return lookup.byName.get(familyName);

  return null;
}

function buildDriverSeasonMetrics(standings = [], races = []) {
  const byId = new Map();

  const ensureMetric = (driver, team, standing) => {
    const driverId = driver?.driverId;
    if (!driverId) return null;

    if (!byId.has(driverId)) {
      byId.set(driverId, {
        driverId,
        code: driver?.code || driver?.driverId?.slice(0, 3)?.toUpperCase() || "DRV",
        number: driver?.permanentNumber || "—",
        name: `${driver?.givenName || ""} ${driver?.familyName || ""}`.trim() || driverId,
        familyName: driver?.familyName || driverId,
        wikiUrl: driver?.url || null,
        teamName: team?.name || "Unknown team",
        teamColor: col(team?.constructorId),
        standingsPosition: 999,
        currentPoints: 0,
        currentWins: 0,
        podiums: 0,
        dnfs: 0,
        top10: 0,
        races: 0,
        finishedRaces: 0,
        finishTotal: 0,
        bestFinish: null,
        totalRacePoints: 0,
        roundResults: [],
      });
    }

    const metric = byId.get(driverId);
    if (driver?.url) metric.wikiUrl = driver.url;
    if (team?.name) metric.teamName = team.name;
    if (team?.constructorId) metric.teamColor = col(team.constructorId);
    if (standing) {
      metric.standingsPosition = asNum(standing.position, metric.standingsPosition);
      metric.currentPoints = asNum(standing.points, metric.currentPoints);
      metric.currentWins = asNum(standing.wins, metric.currentWins);
    }
    return metric;
  };

  standings.forEach((standing) => {
    ensureMetric(standing.Driver, standing.Constructors?.[0], standing);
  });

  [...races]
    .sort((a, b) => asNum(a.round) - asNum(b.round))
    .forEach((race) => {
      const round = asNum(race.round);
      const raceName = gpName(race.raceName || race.name || `Round ${round}`);

      (race.Results || []).forEach((result) => {
        const metric = ensureMetric(result.Driver, result.Constructor, null);
        if (!metric) return;

        const finishPosition = getFinishPosition(result);
        metric.races += 1;
        metric.totalRacePoints += asNum(result.points);

        if (finishPosition !== null) {
          metric.finishedRaces += 1;
          metric.finishTotal += finishPosition;
          metric.bestFinish = metric.bestFinish === null ? finishPosition : Math.min(metric.bestFinish, finishPosition);
          if (finishPosition <= 3) metric.podiums += 1;
          if (finishPosition <= 10) metric.top10 += 1;
        }

        if (isDnfResult(result)) {
          metric.dnfs += 1;
        }

        metric.roundResults.push({
          round,
          raceName,
          points: asNum(result.points),
          finishPosition,
          status: result.status || "—",
          label: getResultLabel(result),
          tone: getResultTone(result),
        });
      });
    });

  return [...byId.values()]
    .map((metric) => ({
      ...metric,
      averageFinish: metric.finishedRaces ? Number((metric.finishTotal / metric.finishedRaces).toFixed(1)) : null,
      finishRate: metric.races ? Number(((metric.finishedRaces / metric.races) * 100).toFixed(0)) : 0,
      top10Rate: metric.races ? Number(((metric.top10 / metric.races) * 100).toFixed(0)) : 0,
      lastResult: metric.roundResults[metric.roundResults.length - 1] || null,
      recentResults: metric.roundResults.slice(-5).reverse(),
    }))
    .sort((a, b) => {
      if (a.standingsPosition !== b.standingsPosition) return a.standingsPosition - b.standingsPosition;
      return b.currentPoints - a.currentPoints;
    });
}

function buildConstructorSeasonMetrics(constructors = [], races = []) {
  const byId = new Map();

  const ensureMetric = (constructor, standing) => {
    const constructorId = constructor?.constructorId;
    if (!constructorId) return null;

    if (!byId.has(constructorId)) {
      byId.set(constructorId, {
        constructorId,
        name: constructor?.name || constructorId,
        color: col(constructorId),
        standingsPosition: 999,
        currentPoints: 0,
        currentWins: 0,
        podiums: 0,
        finishTotal: 0,
        finishedCars: 0,
        entries: 0,
      });
    }

    const metric = byId.get(constructorId);
    if (standing) {
      metric.standingsPosition = asNum(standing.position, metric.standingsPosition);
      metric.currentPoints = asNum(standing.points, metric.currentPoints);
      metric.currentWins = asNum(standing.wins, metric.currentWins);
    }
    return metric;
  };

  constructors.forEach((standing) => ensureMetric(standing.Constructor, standing));

  races.forEach((race) => {
    (race.Results || []).forEach((result) => {
      const metric = ensureMetric(result.Constructor, null);
      if (!metric) return;

      const finishPosition = getFinishPosition(result);
      metric.entries += 1;
      if (finishPosition !== null) {
        metric.finishedCars += 1;
        metric.finishTotal += finishPosition;
        if (finishPosition <= 3) metric.podiums += 1;
      }
    });
  });

  return [...byId.values()]
    .map((metric) => ({
      ...metric,
      averageFinish: metric.finishedCars ? Number((metric.finishTotal / metric.finishedCars).toFixed(1)) : null,
    }))
    .sort((a, b) => {
      if (a.standingsPosition !== b.standingsPosition) return a.standingsPosition - b.standingsPosition;
      return b.currentPoints - a.currentPoints;
    });
}

function buildPointsProgressionData(standings = [], races = [], maxDrivers = 6) {
  const featured = standings.slice(0, maxDrivers).map((standing, index) => ({
    key: standing.Driver?.driverId || `driver-${index}`,
    name: standing.Driver?.familyName || `Driver ${index + 1}`,
    fullName: `${standing.Driver?.givenName || ""} ${standing.Driver?.familyName || ""}`.trim(),
    color: col(standing.Constructors?.[0]?.constructorId),
    currentPoints: asNum(standing.points),
    wins: asNum(standing.wins),
  }));

  if (!featured.length) {
    return { series: [], data: [] };
  }

  const totals = Object.fromEntries(featured.map((driver) => [driver.key, 0]));
  const data = [...races]
    .sort((a, b) => asNum(a.round) - asNum(b.round))
    .map((race) => {
      (race.Results || []).forEach((result) => {
        const driverId = result.Driver?.driverId;
        if (!driverId || totals[driverId] === undefined) return;
        totals[driverId] += asNum(result.points);
      });

      const point = {
        roundLabel: `R${race.round}`,
        round: asNum(race.round),
        raceName: gpName(race.raceName || race.name || `Round ${race.round}`),
      };

      featured.forEach((driver) => {
        point[driver.key] = totals[driver.key];
      });

      return point;
    });

  return { series: featured, data };
}

function getComparisonWinner(left, right, direction = "higher") {
  if (left === right) return "tie";
  if (left === null || left === undefined) return "right";
  if (right === null || right === undefined) return "left";
  if (direction === "lower") return left < right ? "left" : "right";
  return left > right ? "left" : "right";
}

function buildHeadToHeadDuels(leftMetric, rightMetric) {
  if (!leftMetric || !rightMetric) {
    return { leftWins: 0, rightWins: 0, ties: 0, commonRounds: 0, recent: [] };
  }

  const rightByRound = new Map(rightMetric.roundResults.map((result) => [result.round, result]));
  let leftWins = 0;
  let rightWins = 0;
  let ties = 0;

  const recent = leftMetric.roundResults
    .filter((result) => rightByRound.has(result.round))
    .map((leftResult) => {
      const rightResult = rightByRound.get(leftResult.round);
      const leftFinish = leftResult.finishPosition;
      const rightFinish = rightResult.finishPosition;
      let winner = "tie";

      if (leftFinish !== null && rightFinish !== null) {
        winner = leftFinish < rightFinish ? "left" : leftFinish > rightFinish ? "right" : "tie";
      } else if (leftFinish !== null) {
        winner = "left";
      } else if (rightFinish !== null) {
        winner = "right";
      }

      if (winner === "left") leftWins += 1;
      else if (winner === "right") rightWins += 1;
      else ties += 1;

      return {
        round: leftResult.round,
        raceName: leftResult.raceName,
        left: leftResult,
        right: rightResult,
        winner,
      };
    })
    .sort((a, b) => b.round - a.round)
    .slice(0, 6);

  return { leftWins, rightWins, ties, commonRounds: leftWins + rightWins + ties, recent };
}

function PointsChartPage({season, isMobile=false}) {
  const [standings,setStandings]=useState([]);
  const [races,setRaces]=useState([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    setLoading(true);
    Promise.all([
      fetchDriverStandings(season, { limit: 100, fetcher: apiFetch }),
      fetchSeasonResults(season, { limit: 600, fetcher: apiFetch }),
    ])
      .then(([nextStandings, nextRaces]) => {
        setStandings(nextStandings);
        setRaces(nextRaces);
        setLoading(false);
      })
      .catch(()=>setLoading(false));
  },[season]);

  const driverMetrics = useMemo(() => buildDriverSeasonMetrics(standings, races), [standings, races]);
  const progression = useMemo(() => buildPointsProgressionData(standings, races, 6), [standings, races]);
  const featuredMetrics = useMemo(() => {
    const ids = new Set(progression.series.map((item) => item.key));
    return driverMetrics.filter((metric) => ids.has(metric.driverId));
  }, [driverMetrics, progression.series]);
  const leader = featuredMetrics[0];
  const closestGap =
    featuredMetrics.length > 1
      ? Math.abs(asNum(featuredMetrics[0]?.currentPoints) - asNum(featuredMetrics[1]?.currentPoints))
      : 0;

  if(loading) return <Spinner/>;
  if(!standings.length) return <Empty icon="📈" msg="No championship progression data available"/>;

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:22}}>
        <StatCard label="Leader" value={leader?.familyName || "—"} sub={leader ? `${leader.currentPoints} pts` : undefined} accent={leader?.teamColor}/>
        <StatCard label="Closest Gap" value={`${closestGap} pts`} sub={featuredMetrics.length > 1 ? `${featuredMetrics[0]?.familyName} vs ${featuredMetrics[1]?.familyName}` : "Single driver snapshot"} accent="#FFD700"/>
        <StatCard label="Rounds Tracked" value={progression.data.length || 0} sub="Completed grands prix" accent="#27F4D2"/>
        <StatCard label="Featured Drivers" value={progression.series.length} sub="Main chart lines" accent="#a855f7"/>
      </div>

      <div style={{
        display:"grid",
        gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1.6fr) minmax(0,1fr)",
        gap:18,
        alignItems:"start",
      }}>
        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:18,minWidth:0}}>
          <SecLabel>Round-by-round championship evolution</SecLabel>
          {progression.data.length ? (
            <div style={{height: isMobile ? 280 : 410}}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={progression.data} margin={{ top:20, right:24, left:0, bottom:10 }}>
                  <CartesianGrid stroke="#1a1a1a"/>
                  <XAxis dataKey="roundLabel" stroke="#666" tick={{fontSize:11}}/>
                  <YAxis stroke="#666" tick={{fontSize:11}}/>
                  <Tooltip
                    contentStyle={{background:"#111",border:"1px solid #E10600",borderRadius:8}}
                    labelFormatter={(value, payload) => {
                      const raceName = payload?.[0]?.payload?.raceName;
                      return raceName ? `${value} · ${raceName}` : value;
                    }}
                    formatter={(value) => [`${value} pts`, "Points"]}
                  />
                  <Legend wrapperStyle={{color:"#888",fontSize:11,paddingTop:10}}/>
                  {progression.series.map((driver) => (
                    <Line
                      key={driver.key}
                      type="monotone"
                      dataKey={driver.key}
                      name={driver.fullName || driver.name}
                      stroke={driver.color}
                      dot={false}
                      strokeWidth={2.4}
                      activeDot={{ r: 5, stroke: driver.color, fill: "#080808" }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty icon="🟰" msg="No completed rounds yet. Current standings will populate a progression chart once races are run."/>
          )}
        </div>

        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:18,minWidth:0}}>
          <SecLabel>Current order</SecLabel>
          <div style={{display:"grid",gap:10}}>
            {featuredMetrics.map((metric) => {
              const gap = leader ? Math.max(0, asNum(leader.currentPoints) - asNum(metric.currentPoints)) : 0;
              return (
                <div key={metric.driverId} style={{background:"#111",border:"1px solid #1c1c1c",borderRadius:10,padding:"12px 14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                      <PosBadge pos={metric.standingsPosition}/>
                      <div style={{width:4,height:28,borderRadius:999,background:metric.teamColor,flexShrink:0}}/>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{metric.name}</div>
                        <div style={{fontSize:11,color:"#555"}}>{metric.teamName}</div>
                      </div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:18,fontWeight:800,color:"#FFD700",...mono}}>{metric.currentPoints}</div>
                      <div style={{fontSize:10,color:"#555"}}>{gap ? `-${gap} to lead` : "Championship lead"}</div>
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
                    {[
                      ["Wins", metric.currentWins, "#E10600"],
                      ["Podiums", metric.podiums, "#27F4D2"],
                      ["Avg Finish", metric.averageFinish ?? "—", "#a855f7"],
                    ].map(([label, value, accent]) => (
                      <div key={label} style={{background:"#0d0d0d",borderRadius:8,padding:"8px 9px"}}>
                        <div style={{fontSize:9,color:"#444",textTransform:"uppercase",letterSpacing:1.1,marginBottom:4}}>{label}</div>
                        <div style={{fontSize:16,fontWeight:800,color:accent,...mono}}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function SeasonRecordsPage({season, isMobile=false}) {
  const [drivers,setDrivers]=useState([]);
  const [constructors,setConstructors]=useState([]);
  const [races,setRaces]=useState([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    setLoading(true);
    Promise.all([
      fetchDriverStandings(season, { limit: 100, fetcher: apiFetch }),
      fetchConstructorStandings(season, { limit: 15, fetcher: apiFetch }),
      fetchSeasonResults(season, { limit: 600, fetcher: apiFetch }),
    ]).then(([nextDrivers,nextConstructors,nextRaces])=>{
      setDrivers(nextDrivers);
      setConstructors(nextConstructors);
      setRaces(nextRaces);
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[season]);

  const driverMetrics = useMemo(() => buildDriverSeasonMetrics(drivers, races), [drivers, races]);
  const constructorMetrics = useMemo(() => buildConstructorSeasonMetrics(constructors, races), [constructors, races]);
  const uniqueWinners = new Set(races.map((race) => race.Results?.[0]?.Driver?.driverId).filter(Boolean)).size;
  const totalDnfs = driverMetrics.reduce((sum, driver) => sum + driver.dnfs, 0);
  const mostConsistent = [...driverMetrics]
    .filter((driver) => driver.finishedRaces >= 3)
    .sort((a, b) => (a.averageFinish ?? 999) - (b.averageFinish ?? 999))[0];
  const mostPodiums = [...driverMetrics].sort((a, b) => b.podiums - a.podiums)[0];
  const constructorLeader = constructorMetrics[0];

  if(loading) return <Spinner/>;
  if(!driverMetrics.length) return <Empty icon="🥇" msg="No season records available for this year"/>;

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:22}}>
        <StatCard label="Completed Rounds" value={races.length || 0} sub="Results processed" accent="#27F4D2"/>
        <StatCard label="Unique Winners" value={uniqueWinners || "—"} sub="Different race winners" accent="#E10600"/>
        <StatCard label="Most Podiums" value={mostPodiums?.familyName || "—"} sub={mostPodiums ? `${mostPodiums.podiums} podiums` : undefined} accent={mostPodiums?.teamColor}/>
        <StatCard label="Most Consistent" value={mostConsistent?.familyName || "—"} sub={mostConsistent?.averageFinish ? `Avg finish ${mostConsistent.averageFinish}` : "No benchmark yet"} accent="#a855f7"/>
        <StatCard label="Constructor Leader" value={constructorLeader?.name || "—"} sub={constructorLeader ? `${constructorLeader.currentPoints} pts` : undefined} accent={constructorLeader?.color}/>
        <StatCard label="Total DNFs" value={totalDnfs} sub="Across tracked drivers" accent="#FFD700"/>
      </div>

      <div style={{
        display:"grid",
        gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1.2fr) minmax(0,1fr)",
        gap:18,
        alignItems:"start",
      }}>
        <div style={{display:"grid",gap:18,minWidth:0}}>
          <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:18}}>
            <SecLabel>Driver leaders</SecLabel>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:560}}>
                <thead>
                  <tr style={{borderBottom:"1px solid #E10600"}}>
                    <TH>Pos</TH><TH>Driver</TH><TH>Team</TH><TH right>Pts</TH><TH right>Wins</TH><TH right>Podiums</TH>
                  </tr>
                </thead>
                <tbody>
                  {driverMetrics.slice(0, 6).map((driver) => (
                    <TRow key={driver.driverId}>
                      <td style={{padding:"10px 12px"}}><PosBadge pos={driver.standingsPosition}/></td>
                      <td style={{padding:"10px 12px",fontWeight:700,color:"#fff"}}>{driver.name}</td>
                      <td style={{padding:"10px 12px",color:driver.teamColor}}>{driver.teamName}</td>
                      <td style={{padding:"10px 12px",textAlign:"right",...mono,fontWeight:700,color:"#FFD700"}}>{driver.currentPoints}</td>
                      <td style={{padding:"10px 12px",textAlign:"right",...mono,color:"#E10600"}}>{driver.currentWins}</td>
                      <td style={{padding:"10px 12px",textAlign:"right",...mono,color:"#27F4D2"}}>{driver.podiums}</td>
                    </TRow>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:18}}>
            <SecLabel>Consistency and attrition</SecLabel>
            <div style={{display:"grid",gap:10}}>
              {[...driverMetrics]
                .filter((driver) => driver.races > 0)
                .sort((a, b) => {
                  if ((a.averageFinish ?? 999) !== (b.averageFinish ?? 999)) {
                    return (a.averageFinish ?? 999) - (b.averageFinish ?? 999);
                  }
                  return a.dnfs - b.dnfs;
                })
                .slice(0, 5)
                .map((driver) => (
                  <div key={driver.driverId} style={{background:"#111",border:"1px solid #1c1c1c",borderRadius:10,padding:"12px 14px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:4,height:24,borderRadius:999,background:driver.teamColor}}/>
                        <div>
                          <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{driver.name}</div>
                          <div style={{fontSize:11,color:"#555"}}>{driver.teamName}</div>
                        </div>
                      </div>
                      <div style={{fontSize:18,fontWeight:800,color:"#a855f7",...mono}}>{driver.averageFinish ?? "—"}</div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
                      {[
                        ["Finish Rate", `${driver.finishRate}%`, "#27F4D2"],
                        ["Top 10 Rate", `${driver.top10Rate}%`, "#64C4FF"],
                        ["DNFs", driver.dnfs, driver.dnfs ? "#E10600" : "#FFD700"],
                      ].map(([label, value, accent]) => (
                        <div key={label} style={{background:"#0d0d0d",borderRadius:8,padding:"8px 9px"}}>
                          <div style={{fontSize:9,color:"#444",textTransform:"uppercase",letterSpacing:1.1,marginBottom:4}}>{label}</div>
                          <div style={{fontSize:15,fontWeight:800,color:accent,...mono}}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        <div style={{display:"grid",gap:18,minWidth:0}}>
          <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:18}}>
            <SecLabel>Constructor leaderboard</SecLabel>
            <div style={{display:"grid",gap:10}}>
              {constructorMetrics.slice(0, 5).map((team) => (
                <div key={team.constructorId} style={{background:"#111",border:"1px solid #1c1c1c",borderRadius:10,padding:"12px 14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                      <PosBadge pos={team.standingsPosition}/>
                      <div style={{width:4,height:24,borderRadius:999,background:team.color}}/>
                      <div style={{fontSize:14,fontWeight:700,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{team.name}</div>
                    </div>
                    <div style={{fontSize:18,fontWeight:800,color:"#FFD700",...mono}}>{team.currentPoints}</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
                    {[
                      ["Wins", team.currentWins, "#E10600"],
                      ["Podiums", team.podiums, "#27F4D2"],
                      ["Avg Finish", team.averageFinish ?? "—", "#64C4FF"],
                    ].map(([label, value, accent]) => (
                      <div key={label} style={{background:"#0d0d0d",borderRadius:8,padding:"8px 9px"}}>
                        <div style={{fontSize:9,color:"#444",textTransform:"uppercase",letterSpacing:1.1,marginBottom:4}}>{label}</div>
                        <div style={{fontSize:15,fontWeight:800,color:accent,...mono}}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:18}}>
            <SecLabel>Season highlights</SecLabel>
            <div style={{display:"grid",gap:10}}>
              {[
                {
                  label:"Best one-lap to flag consistency",
                  driver: mostConsistent?.name || "—",
                  value: mostConsistent?.averageFinish ? `Avg finish ${mostConsistent.averageFinish}` : "No consistent finisher yet",
                  accent:"#a855f7",
                },
                {
                  label:"Most podium pressure",
                  driver: mostPodiums?.name || "—",
                  value: mostPodiums ? `${mostPodiums.podiums} podiums across ${mostPodiums.races} starts` : "No podium trend yet",
                  accent:"#27F4D2",
                },
                {
                  label:"Toughest reliability story",
                  driver: [...driverMetrics].sort((a, b) => b.dnfs - a.dnfs)[0]?.name || "—",
                  value: `${[...driverMetrics].sort((a, b) => b.dnfs - a.dnfs)[0]?.dnfs || 0} DNFs`,
                  accent:"#E10600",
                },
              ].map((item) => (
                <div key={item.label} style={{background:"#111",border:"1px solid #1c1c1c",borderRadius:10,padding:"12px 14px"}}>
                  <div style={{fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:1.3,marginBottom:6}}>{item.label}</div>
                  <div style={{fontSize:16,fontWeight:800,color:item.accent,marginBottom:4}}>{item.driver}</div>
                  <div style={{fontSize:12,color:"#777"}}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DrvCard({drv, standing, headshotUrl=null, latestRaceContext, watchlist, onToggle, onClick, watchlistDisabled=false}) {
  const team    = standing.Constructors?.[0];
  const teamCol = col(team?.constructorId);
  const medal   = ["1","2","3"].includes(standing.position);
  const isLatestWinner = latestRaceContext?.driverId === drv.driverId;

  return (
    <div
      onClick={onClick}
      style={{
        background:"#0a0a0a", border:`1px solid #1a1a1a`,
        borderRadius:12, overflow:"hidden", cursor:"pointer",
        transition:"all 0.2s ease", position:"relative",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = teamCol;
        e.currentTarget.style.transform   = "translateY(-3px)";
        e.currentTarget.style.boxShadow   = `0 8px 24px ${teamCol}22`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = "#1a1a1a";
        e.currentTarget.style.transform   = "translateY(0)";
        e.currentTarget.style.boxShadow   = "none";
      }}
    >
      {/* Photo area */}
      <div style={{ position:"relative", height:160, overflow:"hidden", background:`radial-gradient(circle at top left, ${teamCol}22, transparent 45%), linear-gradient(135deg, #101010 0%, #0a0a0a 72%)` }}>
        <div style={{ position:"absolute", inset:0, background:`linear-gradient(90deg, ${teamCol}10, transparent 55%)` }}/>
        <div style={{
          position:"absolute",
          left:12,
          top:12,
          fontSize:56,
          fontWeight:900,
          letterSpacing:-3,
          color:teamCol,
          opacity:0.9,
          lineHeight:0.9,
          pointerEvents:"none",
        }}>
          {`${drv.givenName?.[0] || ""}${drv.familyName?.[0] || ""}` || "F1"}
        </div>
        <div style={{
          position:"absolute",
          right:12,
          bottom:0,
          width:106,
          height:148,
          display:"flex",
          alignItems:"flex-end",
          justifyContent:"center",
          pointerEvents:"none",
        }}>
          <DriverPhoto
            firstName={drv.givenName}
            lastName={drv.familyName}
            wikiUrl={drv.url}
            headshotUrl={headshotUrl}
            headshotVariant="6col"
            teamColor={teamCol}
            style={{
              width:"100%",
              height:"100%",
              display:"block",
              objectFit:"contain",
              objectPosition:"center bottom",
              filter:"drop-shadow(0 8px 18px rgba(0,0,0,0.42))",
              background:"transparent",
              border:"none",
            }}
          />
        </div>
        {/* gradient overlay */}
        <div style={{ position:"absolute", inset:0, background:`linear-gradient(to bottom, rgba(0,0,0,0) 45%, rgba(10,10,10,0.94) 100%)` }}/>
        {/* Top-left position badge */}
        <div style={{
          position:"absolute", top:8, left:8,
          background: medal ? (standing.position==="1"?"#FFD700":standing.position==="2"?"#C0C0C0":"#CD7F32") : "rgba(0,0,0,0.7)",
          color: medal ? "#000" : "#fff",
          width:26, height:26, borderRadius:"50%",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:11, fontWeight:800, fontFamily:"monospace",
          border: medal ? "none" : "1px solid #333",
        }}>{standing.position}</div>
        {/* Top-right star */}
        <div style={{ position:"absolute", top:8, right:8 }}>
          <StarBtn id={drv.driverId} watchlist={watchlist} onToggle={onToggle} itemType="driver" disabled={watchlistDisabled}/>
        </div>
        {/* Team color bar at bottom of photo */}
        <div style={{ position:"absolute", bottom:0, left:0, right:0, height:3, background:`linear-gradient(90deg, ${teamCol}, ${teamCol}88)` }}/>
      </div>

      {/* Info */}
      <div style={{ padding:"12px 14px" }}>
        <div style={{ fontSize:12, color:"#555", marginBottom:2 }}>{drv.givenName}</div>
        <div style={{ fontSize:16, fontWeight:800, color:"#fff", letterSpacing:0.3 }}>{drv.familyName}</div>
        <div style={{ fontSize:11, color:teamCol, marginTop:4, fontWeight:600 }}>{team?.name}</div>
        {isLatestWinner && (
          <div style={{
            marginTop:8,
            display:"inline-flex",
            alignItems:"center",
            gap:6,
            padding:"4px 8px",
            borderRadius:999,
            background:"#FFD70014",
            border:"1px solid #FFD70033",
            color:"#FFD700",
            fontSize:10,
            fontWeight:700,
            letterSpacing:0.4,
          }}>
            <span>Latest GP winner</span>
            <span style={{ color:"#888", fontWeight:600 }}>{latestRaceContext.raceName}</span>
          </div>
        )}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:10, paddingTop:10, borderTop:"1px solid #141414" }}>
          <span style={{ fontSize:10, color:"#333", fontFamily:"monospace" }}>#{drv.permanentNumber}</span>
          <span style={{ fontSize:14, fontWeight:800, color:"#FFD700", fontFamily:"monospace" }}>{standing.points} <span style={{ fontSize:10, color:"#555", fontWeight:400 }}>pts</span></span>
        </div>
      </div>
    </div>
  );
}

function DrvPanel({standing, headshotUrl=null, latestRaceContext, onClose, isMobile}) {
  if (!standing) return null;
  const drv     = standing.Driver;
  const team    = standing.Constructors?.[0];
  const teamCol = col(team?.constructorId);
  const medal   = ["1","2","3"].includes(standing.position);
  const isLatestWinner = latestRaceContext?.driverId === drv.driverId;

  return (
    <div
      style={{
        width: isMobile ? "100%" : 360,
        flexShrink: 0,
        background: "#0a0a0a",
        border: "1px solid #1c1c1c",
        borderRadius: 12,
        overflow: "hidden",
        alignSelf: "flex-start",
        position: isMobile ? "relative" : "sticky",
        top: 0,
        maxHeight: isMobile ? "none" : "calc(100vh - 140px)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <PanelHeader title={`${drv.givenName} ${drv.familyName}`} accent={teamCol} onClose={onClose}/>
      <div style={{ overflowY:"auto", flex:1, minHeight:0, overscrollBehavior:"contain" }}>
        {/* Hero photo */}
        <div style={{ position:"relative", height:280, overflow:"hidden" }}>
          <DriverPhoto
            firstName={drv.givenName} lastName={drv.familyName} wikiUrl={drv.url} headshotUrl={headshotUrl} headshotVariant="12col"
            teamColor={teamCol}
            style={{ width:"100%", height:280, display:"block", objectFit:headshotUrl ? "contain" : "cover", objectPosition:headshotUrl ? "center bottom" : "center top", background:headshotUrl ? `radial-gradient(circle at top left, ${teamCol}18, transparent 42%), linear-gradient(135deg, #111, #0a0a0a 78%)` : undefined, border:headshotUrl ? "none" : undefined }}
          />
          <div style={{ position:"absolute", inset:0, background:`linear-gradient(to bottom, transparent 50%, #0a0a0a 100%)` }}/>
          {/* Race number overlay */}
          <div style={{ position:"absolute", bottom:14, left:18, fontFamily:"monospace", fontSize:52, fontWeight:900, color:teamCol, opacity:0.25, lineHeight:1 }}>
            {drv.permanentNumber}
          </div>
          {/* Championship position */}
          <div style={{
            position:"absolute", bottom:14, right:18,
            background: medal ? (standing.position==="1"?"#FFD700":standing.position==="2"?"#C0C0C0":"#CD7F32") : "#111",
            color: medal ? "#000" : "#fff",
            padding:"4px 12px", borderRadius:20,
            fontFamily:"monospace", fontWeight:800, fontSize:13,
            border: medal ? "none" : "1px solid #2a2a2a",
          }}>P{standing.position}</div>
        </div>

        {/* Team color bar */}
        <div style={{ height:3, background:`linear-gradient(90deg, ${teamCol}, ${teamCol}44, transparent)` }}/>

        <div style={{ padding:"16px" }}>
          {/* Season stats */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:18 }}>
            {[
              ["Points", standing.points, "#FFD700"],
              ["Season Wins", standing.wins, "#E10600"],
              ["Podiums",standing.podiums, "#a855f7"],
            ].map(([l,v,ac]) => (
              <div key={l} style={{ background:"#111", borderRadius:8, padding:"10px 8px", textAlign:"center" }}>
                <div style={{ fontSize:9, color:"#444", textTransform:"uppercase", letterSpacing:1.5, marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:22, fontWeight:800, color:ac, fontFamily:"monospace" }}>{v ?? "—"}</div>
              </div>
            ))}
          </div>

          {latestRaceContext && (
            <>
              <SecLabel>Latest Grand Prix Context</SecLabel>
              <div style={{ background:"#0f0f0f", borderRadius:8, padding:12, marginBottom:14, fontSize:13 }}>
                {isLatestWinner && (
                  <div style={{
                    padding:"10px 12px",
                    borderRadius:8,
                    background:"#FFD70014",
                    border:"1px solid #FFD70033",
                    color:"#FFD700",
                    fontWeight:700,
                    marginBottom:10,
                  }}>
                    Won the most recent race: {latestRaceContext.raceName}
                  </div>
                )}
                {[
                  ["Latest GP", latestRaceContext.raceName],
                  ["Race Winner", latestRaceContext.driverName],
                  ["Winning Team", latestRaceContext.teamName],
                  ["Race Date", latestRaceContext.date || "—"],
                ].map(([label, val]) => (
                  <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px solid #141414" }}>
                    <span style={{ color:"#555", fontSize:12 }}>{label}</span>
                    <span style={{ color: label==="Winning Team" ? latestRaceContext.teamColor : "#ccc", fontWeight: label==="Winning Team" ? 600 : 400, fontSize:12, textAlign:"right" }}>{val}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <SecLabel>Driver Info</SecLabel>
          <div style={{ background:"#0f0f0f", borderRadius:8, padding:12, marginBottom:14, fontSize:13 }}>
            {[
              ["Nationality", drv.nationality],
              ["Date of Birth", drv.dob || "—"],
              ["Car Number", `#${drv.permanentNumber}`],
              ["Code", drv.code || "—"],
              ["Team", team?.name || "—"],
            ].map(([label, val]) => (
              <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px solid #141414" }}>
                <span style={{ color:"#555", fontSize:12 }}>{label}</span>
                <span style={{ color: label==="Team" ? teamCol : "#ccc", fontWeight: label==="Team" ? 600 : 400, fontSize:12 }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DriversPage({season,watchlist,onToggle,watchlistDisabled=false,isMobile=false}) {
  const [drivers,setDrivers]=useState([]);
  const [races,setRaces]=useState([]);
  const [headshots,setHeadshots]=useState([]);
  const [loading,setLoading]=useState(true);
  const [selectedDriver,setSelectedDriver]=useState(null);
  useEffect(()=>{
    setLoading(true);
    Promise.all([
      fetchDriverStandings(season, { limit: 100, fetcher: apiFetch }),
      fetchSeasonResults(season, { limit: 600, fetcher: apiFetch }),
      apiFetch(`/api/drivers/headshots?season=${encodeURIComponent(season)}`, 300000),
    ])
      .then(([standings, seasonRaces, headshotPayload]) => {
        setDrivers(standings);
        setRaces(seasonRaces);
        setHeadshots(Array.isArray(headshotPayload?.drivers) ? headshotPayload.drivers : []);
        setLoading(false);
      })
      .catch(()=>setLoading(false));
  },[season]);
  if(loading) return <Spinner/>;
  if(!drivers.length) return <Empty/>;
  const latestRaceContext = buildLatestRaceWinnerContext(races);
  const headshotLookup = buildDriverHeadshotLookup(headshots);
  return (
    <div>
      <div style={{ display:"flex", flexDirection:isMobile ? "column" : "row", gap:20, minHeight:520 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:14}}>
            {drivers.map((d,i)=>(
              <div key={d.Driver.driverId} style={{animation:`cardIn 0.25s ease-out ${i*30}ms both`}}>
                <DrvCard
                  drv={d.Driver}
                  standing={d}
                  headshotUrl={resolveDriverHeadshotUrl(d.Driver, headshotLookup)}
                  latestRaceContext={latestRaceContext}
                  watchlist={watchlist}
                  onToggle={onToggle}
                  onClick={()=>setSelectedDriver(d)}
                  watchlistDisabled={watchlistDisabled}
                />
              </div>
            ))}
          </div>
        </div>
        {selectedDriver && (
          <DrvPanel
            standing={selectedDriver}
            headshotUrl={resolveDriverHeadshotUrl(selectedDriver.Driver, headshotLookup)}
            latestRaceContext={latestRaceContext}
            onClose={()=>setSelectedDriver(null)}
            isMobile={isMobile}
          />
        )}
      </div>
    </div>
  );
}

function ConCard({standing, meta, watchlist, onToggle, onClick, watchlistDisabled=false}) {
  const team = standing.Constructor;
  const tc = col(team?.constructorId);
  return (
    <div
      onClick={onClick}
      style={{
        background:"#0a0a0a", border:`1px solid ${tc}44`,
        borderRadius:12, overflow:"hidden", cursor:"pointer",
        transition:"transform 0.18s, box-shadow 0.18s",
      }}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 8px 28px ${tc}28`;}}
      onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none";}}
    >
      <div style={{height:5, background:`linear-gradient(90deg, ${tc}, ${tc}66, transparent)`}}/>
      <div style={{padding:"16px 18px"}}>
        <div style={{marginBottom:14}}>
          <ConstructorLogo
            constructorId={team?.constructorId}
            teamName={team?.name || "Constructor"}
            meta={meta}
            teamColor={tc}
            height={88}
            compact
          />
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <PosBadge pos={standing.position}/>
          {watchlist && <StarBtn id={team.constructorId} watchlist={watchlist} onToggle={onToggle} itemType="team" disabled={watchlistDisabled}/>}
        </div>
        <div style={{fontSize:18,fontWeight:800,color:"#fff",marginBottom:3,letterSpacing:-0.3}}>{team.name}</div>
        <div style={{fontSize:11,color:"#444",marginBottom:6}}>{team.nationality}</div>
        {!!meta?.principal && <div style={{fontSize:11,color:tc,marginBottom:14,fontWeight:600}}>TP · {meta.principal}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div style={{background:`${tc}11`,border:`1px solid ${tc}22`,borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontSize:9,color:"#444",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Wins</div>
            <div style={{fontSize:22,fontWeight:800,color:tc,fontFamily:"monospace"}}>{standing.wins}</div>
          </div>
          <div style={{background:"#FFD70011",border:"1px solid #FFD70022",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontSize:9,color:"#444",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Points</div>
            <div style={{fontSize:22,fontWeight:800,color:"#FFD700",fontFamily:"monospace"}}>{standing.points}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConPanel({standing, isMobile, onClose}) {
  if (!standing) return null;

  const team = standing.Constructor;
  const tc = col(team?.constructorId);
  const meta = getConstructorProfileMeta(team?.constructorId);

  return (
    <div
      style={{
        width: isMobile ? "100%" : 360,
        flexShrink: 0,
        background: "#0a0a0a",
        border: "1px solid #1c1c1c",
        borderRadius: 12,
        overflow: "hidden",
        alignSelf: "flex-start",
        position: isMobile ? "relative" : "sticky",
        top: 0,
        maxHeight: isMobile ? "none" : "calc(100vh - 140px)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <PanelHeader title={team?.name || "Constructor"} accent={tc} onClose={onClose}/>
      <div style={{ overflowY:"auto", flex:1, minHeight:0, overscrollBehavior:"contain" }}>
        <div style={{padding:"18px"}}>
          <div style={{marginBottom:16}}>
            <ConstructorLogo
              constructorId={team?.constructorId}
              teamName={team?.name || "Constructor"}
              meta={meta}
              teamColor={tc}
              height={230}
            />
          </div>

          <div style={{background:"#111",border:`1px solid ${tc}33`,borderRadius:12,padding:"18px 16px",marginBottom:16,position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:`linear-gradient(90deg, ${tc}, ${tc}44, transparent)`}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:14}}>
              <div>
                <div style={{fontSize:12,color:tc,fontWeight:700,textTransform:"uppercase",letterSpacing:1.2,marginBottom:4}}>{team?.nationality}</div>
                <div style={{fontSize:22,fontWeight:800,color:"#fff",lineHeight:1.1}}>{team?.name}</div>
                {meta?.base && <div style={{fontSize:12,color:"#666",marginTop:6}}>{meta.base}</div>}
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:30,fontWeight:900,color:tc,lineHeight:1}}>P{standing.position}</div>
                <div style={{fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:1}}>championship</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {[
                ["Points", standing.points, "#FFD700"],
                ["Wins", standing.wins, tc],
                ["Titles", meta?.constructorsTitles || "0", "#a855f7"],
              ].map(([label, value, accent]) => (
                <div key={label} style={{background:"#0c0c0c",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#444",textTransform:"uppercase",letterSpacing:1.2,marginBottom:4}}>{label}</div>
                  <div style={{fontSize:18,fontWeight:800,color:accent,fontFamily:"monospace"}}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          <SecLabel>Team Structure</SecLabel>
          <div style={{ background:"#0f0f0f", borderRadius:8, padding:12, marginBottom:14, fontSize:13 }}>
            {[
              ["Team Principal", meta?.principal || "Not available"],
              ["Technical Chief", meta?.technicalChief || "Not available"],
              ["Founder / Origin", meta?.founder || "Not available"],
              ["Base", meta?.base || "Not available"],
            ].map(([label, val]) => (
              <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px solid #141414", gap:10 }}>
                <span style={{ color:"#555", fontSize:12 }}>{label}</span>
                <span style={{ color:"#ccc", fontWeight:500, fontSize:12, textAlign:"right", wordBreak:"break-word" }}>{val}</span>
              </div>
            ))}
          </div>

          <SecLabel>Technical Package</SecLabel>
          <div style={{ background:"#0f0f0f", borderRadius:8, padding:12, marginBottom:14, fontSize:13 }}>
            {[
              ["Power Unit", meta?.powerUnit || "Not available"],
              ["Chassis", meta?.chassis || "Not available"],
              ["Debut Year", meta?.debutYear || "Not available"],
            ].map(([label, val]) => (
              <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px solid #141414", gap:10 }}>
                <span style={{ color:"#555", fontSize:12 }}>{label}</span>
                <span style={{ color:"#ccc", fontWeight:500, fontSize:12, textAlign:"right", wordBreak:"break-word" }}>{val}</span>
              </div>
            ))}
          </div>

          <SecLabel>Race Engineers</SecLabel>
          <div style={{display:"grid",gap:10,marginBottom:14}}>
            {(meta?.raceEngineers?.length ? meta.raceEngineers : ["Not available"]).map((entry) => (
              <div key={entry} style={{background:"#111",border:"1px solid #1c1c1c",borderRadius:8,padding:"10px 12px"}}>
                <div style={{fontSize:12,color:"#ddd",fontWeight:600}}>{entry}</div>
              </div>
            ))}
          </div>

          <SecLabel>Championship Heritage</SecLabel>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10,marginBottom:14}}>
            <div style={{background:"#111",border:"1px solid #1c1c1c",borderRadius:8,padding:"12px 10px",textAlign:"center"}}>
              <div style={{fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:1.2,marginBottom:6}}>Constructors' Titles</div>
              <div style={{fontSize:22,fontWeight:800,color:tc,fontFamily:"monospace"}}>{meta?.constructorsTitles || "0"}</div>
            </div>
            <div style={{background:"#111",border:"1px solid #1c1c1c",borderRadius:8,padding:"12px 10px",textAlign:"center"}}>
              <div style={{fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:1.2,marginBottom:6}}>Drivers' Titles</div>
              <div style={{fontSize:22,fontWeight:800,color:"#FFD700",fontFamily:"monospace"}}>{meta?.driversTitles || "0"}</div>
            </div>
          </div>

          <SecLabel>Constructor Info</SecLabel>
          <div style={{ background:"#0f0f0f", borderRadius:8, padding:12, marginBottom:14, fontSize:13 }}>
            {[
              ["Championship Position", `P${standing.position}`],
              ["Constructor", team?.name || "—"],
              ["Nationality", team?.nationality || "—"],
              ["Wikipedia", team?.url || "—"],
            ].map(([label, val]) => (
              <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px solid #141414", gap:10 }}>
                <span style={{ color:"#555", fontSize:12 }}>{label}</span>
                <span style={{ color:"#ccc", fontWeight:500, fontSize:12, textAlign:"right", wordBreak:"break-word" }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConstructorsPage({season,watchlist,onToggle,watchlistDisabled=false,isMobile=false}) {
  const [teams,setTeams]=useState([]);
  const [loading,setLoading]=useState(true);
  const [selectedTeam,setSelectedTeam]=useState(null);
  useEffect(()=>{
    setLoading(true);
    fetchConstructorStandings(season, { limit: 15, fetcher: apiFetch })
      .then(teams => { setTeams(teams); setLoading(false); })
      .catch(()=>setLoading(false));
  },[season]);
  if(loading) return <Spinner/>;
  if(!teams.length) return <Empty/>;
  return (
    <div>
      <div style={{ display:"flex", flexDirection:isMobile ? "column" : "row", gap:20, minHeight:520 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:14}}>
            {teams.map((t,i)=>{
              const team = t.Constructor;
              const meta = getConstructorProfileMeta(team?.constructorId);
              return (
                <div key={team.constructorId} style={{animation:`cardIn 0.25s ease-out ${i*40}ms both`}}>
                  <ConCard
                    standing={t}
                    meta={meta}
                    watchlist={watchlist}
                    onToggle={onToggle}
                    onClick={() => setSelectedTeam(t)}
                    watchlistDisabled={watchlistDisabled}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {selectedTeam && (
          <ConPanel standing={selectedTeam} isMobile={isMobile} onClose={()=>setSelectedTeam(null)}/>
        )}
      </div>
    </div>
  );
}

// ── Strategy helpers ──────────────────────────────────────────────
function buildStintsFromPits(stops, totalLaps) {
  const sorted = [...stops].sort((a,b) => Number(a.lap) - Number(b.lap));
  const out = []; let prev = 1;
  sorted.forEach((stop, i) => {
    const lap = Number(stop.lap);
    out.push({ start:prev, end:lap, i, dur:stop.duration });
    prev = lap + 1;
  });
  out.push({ start:prev, end:Number(totalLaps)||65, i:sorted.length });
  return out;
}

function StrategyPage({season}) {
  const [races, setRaces]       = useState([]);
  const [round, setRound]       = useState(null);
  const [stintData, setStintData] = useState([]);
  const [totalLaps, setTotalLaps] = useState(60);
  const [selRace, setSelRace]   = useState(null);
  const [hovered, setHovered]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [dl, setDl]             = useState(false);

  // Load completed races for the season
  useEffect(() => {
    setLoading(true);
    fetchSeasonRaces(season, { limit: 30, fetcher: apiFetch })
      .then(all => {
        const done = getCompletedRaces(all);
        setRaces(done);
        if (done.length) {
          const last = done[done.length - 1];
          setRound(last.round);
          setSelRace(last);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [season]);

  // Load pit stops + results whenever round changes
  useEffect(() => {
    if (!round) return;
    setDl(true); setStintData([]);
    Promise.all([
      fetchRoundResultRace(season, round, { limit: 25, fetcher: apiFetch }),
      fetchRoundPitStops(season, round, { limit: 200, fetcher: apiFetch }),
    ]).then(([race, pitstops]) => {
      const results  = race?.Results || [];
      if (!results.length) { setDl(false); return; }
      const laps = Number(results[0]?.laps) || 60;
      setTotalLaps(laps);
      // Group pit stops by driverId
      const byDrv = {};
      pitstops.forEach(p => {
        if (!byDrv[p.driverId]) byDrv[p.driverId] = [];
        byDrv[p.driverId].push(p);
      });
      const rows = results.slice(0, 20).map(r => ({
        id:     r.Driver.driverId,
        name:   `${r.Driver.givenName[0]}. ${r.Driver.familyName}`,
        pos:    r.position,
        tc:     col(r.Constructor?.constructorId),
        team:   r.Constructor?.name,
        stints: buildStintsFromPits(byDrv[r.Driver.driverId] || [], r.laps || laps),
        stops:  (byDrv[r.Driver.driverId] || []).length,
      }));
      setStintData(rows);
      setDl(false);
    }).catch(() => setDl(false));
  }, [round, season]);

  if (loading) return <Spinner/>;
  if (!races.length) return <Empty icon="🎯" msg="No completed races found for this season"/>;

  const avgStop = stintData.length
    ? stintData.reduce((a, d) => a + d.stops, 0) / stintData.length
    : 0;

  return (
    <div>
      {/* Race selector */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20, flexWrap:"wrap" }}>
        <select
          value={round || ""}
          onChange={e => {
            const r = races.find(x => x.round === e.target.value);
            setRound(e.target.value);
            setSelRace(r || null);
          }}
          style={{ background:"#111", border:"1px solid #1e1e1e", color:"#fff", padding:"9px 14px", borderRadius:8, fontSize:13, cursor:"pointer", minWidth:240 }}
        >
          {races.map(r => (
            <option key={r.round} value={r.round}>R{r.round} — {gpName(r.raceName)}</option>
          ))}
        </select>
        {selRace && (
          <span style={{ fontSize:12, color:"#444" }}>
            {selRace.Circuit?.circuitName} · {selRace.date}
          </span>
        )}
      </div>

      {dl ? <Spinner/> : !stintData.length ? (
        <Empty icon="🔧" msg="No pit stop data for this race"/>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))", gap:10, marginBottom:22 }}>
            {[
              ["Race",       gpName(selRace?.raceName), undefined],
              ["Laps",       totalLaps,                 undefined],
              ["Most Stops", Math.max(...stintData.map(d => d.stops)), "#E10600"],
              ["Avg Stops",  avgStop.toFixed(1),         undefined],
              ["1-Stoppers", stintData.filter(d => d.stops === 1).length, "#27F4D2"],
            ].map(([label, val, accent]) => (
              <div key={label} style={{ background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:8, padding:"12px 14px" }}>
                <div style={{ fontSize:10, color:"#555", textTransform:"uppercase", letterSpacing:1.2, marginBottom:6 }}>{label}</div>
                <div style={{ fontSize:20, fontWeight:700, color:accent || "#fff", fontFamily:"monospace" }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Stint legend */}
          <div style={{ display:"flex", gap:14, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
            {STINT_PAL.slice(0, 4).map((c, i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:18, height:10, borderRadius:2, background:c }}/>
                <span style={{ fontSize:11, color:"#555" }}>Stint {i+1}</span>
              </div>
            ))}
            <span style={{ fontSize:11, color:"#2a2a2a", marginLeft:"auto" }}>Hover a row to isolate · bar width = laps in stint</span>
          </div>

          {/* Stint chart */}
          <div style={{ background:"#0a0a0a", border:"1px solid #1a1a1a", borderRadius:10, padding:"16px 16px 10px", overflowX:"auto" }}>
            <div style={{ minWidth:480 }}>
              {/* Lap ruler */}
              <div style={{ display:"flex", paddingLeft:162, marginBottom:10 }}>
                <div style={{ position:"relative", flex:1, height:16 }}>
                  {[0,10,20,30,40,50,60,70].filter(l => l <= totalLaps).map(l => (
                    <div key={l} style={{ position:"absolute", left:`${(l/totalLaps)*100}%`, fontSize:9, color:"#2a2a2a", transform:"translateX(-50%)" }}>{l}</div>
                  ))}
                </div>
              </div>

              {stintData.map(driver => (
                <div
                  key={driver.id}
                  onMouseEnter={() => setHovered(driver.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ display:"flex", alignItems:"center", gap:10, marginBottom:7, opacity: hovered && hovered !== driver.id ? 0.2 : 1, transition:"opacity 0.18s" }}
                >
                  {/* Driver label */}
                  <div style={{ width:155, flexShrink:0, display:"flex", alignItems:"center", gap:7 }}>
                    <div style={{ width:3, height:22, background:driver.tc, borderRadius:2, flexShrink:0 }}/>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:12, color:"#ccc", fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{driver.name}</div>
                      <div style={{ fontSize:10, color:"#3a3a3a", fontFamily:"monospace" }}>P{driver.pos} · {driver.stops} stop{driver.stops !== 1 ? "s":""}</div>
                    </div>
                  </div>

                  {/* Stint bars */}
                  <div style={{ flex:1, height:26, position:"relative", borderRadius:4, overflow:"hidden", background:"#111" }}>
                    {driver.stints.map((st, idx) => {
                      const startPct = ((st.start - 1) / totalLaps) * 100;
                      const widthPct = ((st.end - st.start + 1) / totalLaps) * 100;
                      const color    = STINT_PAL[Math.min(st.i, STINT_PAL.length - 1)];
                      const lapCount = st.end - st.start + 1;
                      return (
                        <div
                          key={idx}
                          title={`Stint ${st.i+1}: L${st.start}–L${st.end} (${lapCount} laps)${st.dur ? ` · ${st.dur}s stop` : ""}`}
                          style={{
                            position:"absolute", left:`${startPct}%`, width:`${widthPct}%`,
                            height:"100%", background:color, opacity:0.88,
                            borderRight: idx < driver.stints.length - 1 ? "2px solid #0a0a0a" : "none",
                            display:"flex", alignItems:"center", justifyContent:"center",
                            boxSizing:"border-box",
                          }}
                        >
                          {widthPct > 7 && (
                            <span style={{ fontSize:9, fontWeight:700, color:"rgba(0,0,0,0.7)", userSelect:"none" }}>
                              {lapCount}L
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {/* Pit stop markers */}
                    {driver.stints.slice(0, -1).map((st, idx) => (
                      <div
                        key={`pit-${idx}`}
                        style={{ position:"absolute", left:`${(st.end / totalLaps) * 100}%`, top:0, width:2, height:"100%", background:"#0a0a0a", zIndex:2 }}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ fontSize:9, color:"#1e1e1e", textAlign:"center", marginTop:10 }}>← Lap number →</div>
            </div>
          </div>

          {/* Raw pit stop table */}
          <div style={{ marginTop:24 }}>
            <div style={{ fontSize:10, color:"#333", textTransform:"uppercase", letterSpacing:2, marginBottom:12, fontWeight:600 }}>All Pit Stops — Sorted by Lap</div>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead>
                  <tr style={{ borderBottom:"1px solid #E10600" }}>
                    {["Driver","Stop","Lap","Time of Day","Duration"].map(h => (
                      <th key={h} style={{ padding:"8px 12px", textAlign:"left", color:"#555", fontWeight:500, fontSize:11, letterSpacing:1, textTransform:"uppercase", whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stintData
                    .flatMap(d => (d.stints.slice(0, -1).map((st, i) => ({ driverId:d.id, name:d.name, tc:d.tc, stop:i+1, lap:st.end, dur:st.dur }))))
                    .sort((a, b) => a.lap - b.lap)
                    .map((p, i) => (
                      <tr key={i} style={{ borderBottom:"1px solid #141414" }}
                        onMouseEnter={e => e.currentTarget.style.background = "#0d0d0d"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <td style={{ padding:"8px 12px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <div style={{ width:3, height:18, background:p.tc, borderRadius:2, flexShrink:0 }}/>
                            <span style={{ color:"#ccc", fontWeight:500 }}>{p.name}</span>
                          </div>
                        </td>
                        <td style={{ padding:"8px 12px", fontFamily:"monospace", color:"#555" }}>#{p.stop}</td>
                        <td style={{ padding:"8px 12px", fontFamily:"monospace", color:"#888" }}>L{p.lap}</td>
                        <td style={{ padding:"8px 12px", fontFamily:"monospace", color:"#555", fontSize:12 }}>—</td>
                        <td style={{ padding:"8px 12px" }}>
                          <span style={{ fontFamily:"monospace", fontSize:13, fontWeight:600,
                            color: p.dur && parseFloat(p.dur) < 23 ? "#27F4D2" : p.dur && parseFloat(p.dur) < 28 ? "#FFD700" : "#888" }}>
                            {p.dur ? `${p.dur}s` : "—"}
                          </span>
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HeadToHeadPage({season,isMobile}) {
  const [d1,setD1]=useState("");
  const [d2,setD2]=useState("");
  const [drivers,setDrivers]=useState([]);
  const [races,setRaces]=useState([]);
  const [headshots,setHeadshots]=useState([]);
  const [loading,setLoading]=useState(true);
  const { getParams, setParams } = useShareableH2H();

  useEffect(()=>{
    setLoading(true);
    Promise.all([
      fetchDriverStandings(season, { limit: 100, fetcher: apiFetch }),
      fetchSeasonResults(season, { limit: 600, fetcher: apiFetch }),
      apiFetch(`/api/drivers/headshots?season=${encodeURIComponent(season)}`, 300000),
    ])
      .then(([nextDrivers, nextRaces, headshotPayload]) => {
        setDrivers(nextDrivers);
        setRaces(nextRaces);
        setHeadshots(Array.isArray(headshotPayload?.drivers) ? headshotPayload.drivers : []);
        setLoading(false);
      })
      .catch(()=>setLoading(false));
  },[season]);

  useEffect(() => {
    if (!drivers.length) return;
    const params = getParams();
    const ids = new Set(drivers.map((driver) => driver.Driver.driverId));

    if (params.d1 && ids.has(params.d1)) setD1(params.d1);
    else if (!d1) setD1(drivers[0]?.Driver?.driverId || "");

    if (params.d2 && ids.has(params.d2) && params.d2 !== params.d1) setD2(params.d2);
    else if (!d2) setD2(drivers[1]?.Driver?.driverId || "");
  }, [drivers]);

  useEffect(() => {
    if (!d1 && !d2) return;
    setParams(d1 || "", d2 || "");
  }, [d1, d2]);

  const driverMetrics = useMemo(() => buildDriverSeasonMetrics(drivers, races), [drivers, races]);
  const metricsById = useMemo(() => new Map(driverMetrics.map((driver) => [driver.driverId, driver])), [driverMetrics]);
  const leftMetric = metricsById.get(d1);
  const rightMetric = metricsById.get(d2);
  const duel = useMemo(() => buildHeadToHeadDuels(leftMetric, rightMetric), [leftMetric, rightMetric]);
  const headshotLookup = useMemo(() => buildDriverHeadshotLookup(headshots), [headshots]);

  if(loading) return <Spinner/>;
  if(!driverMetrics.length) return <Empty icon="⚔️" msg="No head-to-head comparison data available"/>;

  const comparisonRows = leftMetric && rightMetric ? [
    { label:"Championship Rank", left:leftMetric.standingsPosition, right:rightMetric.standingsPosition, direction:"lower" },
    { label:"Points", left:leftMetric.currentPoints, right:rightMetric.currentPoints, direction:"higher" },
    { label:"Wins", left:leftMetric.currentWins, right:rightMetric.currentWins, direction:"higher" },
    { label:"Podiums", left:leftMetric.podiums, right:rightMetric.podiums, direction:"higher" },
    { label:"Average Finish", left:leftMetric.averageFinish, right:rightMetric.averageFinish, direction:"lower" },
    { label:"Best Finish", left:leftMetric.bestFinish, right:rightMetric.bestFinish, direction:"lower" },
    { label:"Top 10 Rate", left:leftMetric.top10Rate, right:rightMetric.top10Rate, direction:"higher", suffix:"%" },
    { label:"DNFs", left:leftMetric.dnfs, right:rightMetric.dnfs, direction:"lower" },
  ] : [];

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:16,marginBottom:24}}>
        <div>
          <label style={{display:"block",fontSize:12,color:"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:600}}>Driver 1</label>
          <select value={d1} onChange={e=>setD1(e.target.value)} style={{width:"100%",padding:10,background:"#111",border:"1px solid #1e1e1e",color:"#fff",borderRadius:6,fontSize:13}}>
            <option value="">Select driver...</option>
            {driverMetrics.map(driver=><option key={driver.driverId} value={driver.driverId}>{driver.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{display:"block",fontSize:12,color:"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:600}}>Driver 2</label>
          <select value={d2} onChange={e=>setD2(e.target.value)} style={{width:"100%",padding:10,background:"#111",border:"1px solid #1e1e1e",color:"#fff",borderRadius:6,fontSize:13}}>
            <option value="">Select driver...</option>
            {driverMetrics.map(driver=><option key={driver.driverId} value={driver.driverId}>{driver.name}</option>)}
          </select>
        </div>
      </div>

      {(leftMetric && rightMetric) ? (
        <div style={{display:"grid",gap:18}}>
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:16}}>
            {[leftMetric, rightMetric].map((driver) => {
              const headshotUrl = resolveDriverHeadshotUrl({
                code: driver.code,
                permanentNumber: driver.number,
                familyName: driver.familyName,
                givenName: driver.name.split(" ")[0]
              }, headshotLookup);

              return (
                <div key={driver.driverId} style={{background:"#0a0a0a",border:`1px solid ${driver.teamColor}44`,borderRadius:12,overflow:"hidden"}}>
                  <div style={{height:4,background:`linear-gradient(90deg,${driver.teamColor},${driver.teamColor}44,transparent)`}}/>
                  <div style={{padding:18}}>
                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                      <DriverPhoto firstName={driver.name.split(" ")[0] || driver.familyName} lastName={driver.familyName} wikiUrl={driver.wikiUrl} headshotUrl={headshotUrl} teamColor={driver.teamColor}
                        style={{width:68,height:68,borderRadius:10,display:"block",flexShrink:0}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:11,color:driver.teamColor,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{driver.teamName}</div>
                        <div style={{fontSize:18,fontWeight:800,color:"#fff",letterSpacing:-0.3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{driver.name}</div>
                        <div style={{fontSize:11,color:"#444",fontFamily:"monospace",marginTop:3}}>#{driver.number} · {driver.code}</div>
                      </div>
                      <div style={{textAlign:"center",flexShrink:0}}>
                        <div style={{fontSize:34,fontWeight:900,color:driver.teamColor,lineHeight:1}}>P{driver.standingsPosition}</div>
                        <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:1}}>rank</div>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:8}}>
                      {[
                        ["Points", driver.currentPoints, "#FFD700"],
                        ["Wins", driver.currentWins, "#E10600"],
                        ["Podiums", driver.podiums, "#27F4D2"],
                        ["Avg", driver.averageFinish ?? "—", "#a855f7"],
                      ].map(([label,val,accent])=>(
                        <div key={label} style={{background:"#111",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
                          <div style={{fontSize:9,color:"#444",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{label}</div>
                          <div style={{fontSize:18,fontWeight:800,color:accent,fontFamily:"monospace"}}>{val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>
            <StatCard
              label="Points Gap"
              value={`${Math.abs(leftMetric.currentPoints - rightMetric.currentPoints)} pts`}
              sub={leftMetric.currentPoints === rightMetric.currentPoints ? "Even on points" : `${leftMetric.currentPoints > rightMetric.currentPoints ? leftMetric.familyName : rightMetric.familyName} leads`}
              accent="#FFD700"
            />
            <StatCard
              label="Race Duel"
              value={`${duel.leftWins}-${duel.rightWins}`}
              sub={duel.commonRounds ? `${duel.commonRounds} shared race classifications` : "No shared classified races"}
              accent="#27F4D2"
            />
            <StatCard
              label="Podium Edge"
              value={Math.abs(leftMetric.podiums - rightMetric.podiums)}
              sub={leftMetric.podiums === rightMetric.podiums ? "Level on podiums" : `${leftMetric.podiums > rightMetric.podiums ? leftMetric.familyName : rightMetric.familyName} ahead`}
              accent="#a855f7"
            />
            <StatCard
              label="Reliability Edge"
              value={`${Math.min(leftMetric.dnfs, rightMetric.dnfs)} DNFs`}
              sub={leftMetric.dnfs === rightMetric.dnfs ? "Equal reliability" : `${leftMetric.dnfs < rightMetric.dnfs ? leftMetric.familyName : rightMetric.familyName} more reliable`}
              accent="#E10600"
            />
          </div>

          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"minmax(0,1.1fr) minmax(0,0.95fr)",gap:18,alignItems:"start"}}>
            <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:18}}>
              <SecLabel>Metric board</SecLabel>
              <div style={{display:"grid",gap:10}}>
                {comparisonRows.map((row) => {
                  const winner = getComparisonWinner(row.left, row.right, row.direction);
                  const formatValue = (value) => value === null || value === undefined ? "—" : `${value}${row.suffix || ""}`;
                  return (
                    <div key={row.label} style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:12,background:"#111",border:"1px solid #1c1c1c",borderRadius:10,padding:"12px 14px"}}>
                      <div style={{textAlign:"left",fontSize:18,fontWeight:800,color:winner === "left" ? leftMetric.teamColor : "#bbb",fontFamily:"monospace"}}>{formatValue(row.left)}</div>
                      <div style={{fontSize:11,color:"#666",textTransform:"uppercase",letterSpacing:1.4,fontWeight:700}}>{row.label}</div>
                      <div style={{textAlign:"right",fontSize:18,fontWeight:800,color:winner === "right" ? rightMetric.teamColor : "#bbb",fontFamily:"monospace"}}>{formatValue(row.right)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{display:"grid",gap:18}}>
              <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:18}}>
                <SecLabel>Recent form</SecLabel>
                {[leftMetric, rightMetric].map((driver) => (
                  <div key={driver.driverId} style={{marginBottom:driver.driverId === rightMetric.driverId ? 0 : 16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{driver.name}</div>
                      <div style={{fontSize:11,color:driver.teamColor}}>{driver.teamName}</div>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {driver.recentResults.length ? driver.recentResults.map((result) => (
                        <div key={`${driver.driverId}-${result.round}`} style={{padding:"8px 10px",borderRadius:8,background:`${result.tone}16`,border:`1px solid ${result.tone}33`,minWidth:68}}>
                          <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>R{result.round}</div>
                          <div style={{fontSize:14,fontWeight:800,color:result.tone,fontFamily:"monospace"}}>{result.label}</div>
                        </div>
                      )) : <div style={{fontSize:12,color:"#555"}}>No recent race form available.</div>}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:18}}>
                <SecLabel>Race-by-race duel</SecLabel>
                {duel.recent.length ? (
                  <div style={{display:"grid",gap:10}}>
                    {duel.recent.map((entry) => (
                      <div key={entry.round} style={{background:"#111",border:"1px solid #1c1c1c",borderRadius:10,padding:"12px 14px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:8}}>
                          <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{entry.raceName}</div>
                          <div style={{fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:1.2}}>Round {entry.round}</div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:10,alignItems:"center"}}>
                          <div style={{textAlign:"left",fontSize:15,fontWeight:800,color:entry.winner === "left" ? leftMetric.teamColor : "#ccc",fontFamily:"monospace"}}>{entry.left.label}</div>
                          <div style={{fontSize:10,color:"#444",textTransform:"uppercase",letterSpacing:1.3}}>{entry.winner === "tie" ? "Even" : `${entry.winner === "left" ? leftMetric.familyName : rightMetric.familyName} edge`}</div>
                          <div style={{textAlign:"right",fontSize:15,fontWeight:800,color:entry.winner === "right" ? rightMetric.teamColor : "#ccc",fontFamily:"monospace"}}>{entry.right.label}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty icon="🏁" msg="No shared race results yet for this comparison."/>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{textAlign:"center",padding:"60px 0",color:"#333",fontSize:14}}>
          Select both drivers above to unlock the full comparison board
        </div>
      )}
    </div>
  );
}

// ── SVG track outlines keyed by Jolpica/Ergast circuitId ─────────
// Each path is a simplified outline of the real circuit layout,
// normalised to fit within a ~200×140 viewBox.
// Circuit metadata (lap length, turns, DRS zones, inaugural year)
const CIRCUIT_META = {
  bahrain:       { lap:"5.412 km", turns:15, drs:3, est:2004 },
  jeddah:        { lap:"6.174 km", turns:27, drs:3, est:2021 },
  albert_park:   { lap:"5.278 km", turns:16, drs:4, est:1996 },
  suzuka:        { lap:"5.807 km", turns:18, drs:1, est:1987 },
  shanghai:      { lap:"5.451 km", turns:16, drs:2, est:2004 },
  miami:         { lap:"5.412 km", turns:19, drs:3, est:2022 },
  imola:         { lap:"4.909 km", turns:19, drs:2, est:1980 },
  monaco:        { lap:"3.337 km", turns:19, drs:1, est:1950 },
  villeneuve:    { lap:"4.361 km", turns:14, drs:3, est:1978 },
  catalunya:     { lap:"4.657 km", turns:16, drs:2, est:1991 },
  silverstone:   { lap:"5.891 km", turns:18, drs:2, est:1950 },
  hungaroring:   { lap:"4.381 km", turns:14, drs:1, est:1986 },
  spa:           { lap:"7.004 km", turns:19, drs:2, est:1950 },
  zandvoort:     { lap:"4.259 km", turns:14, drs:2, est:1985 },
  monza:         { lap:"5.793 km", turns:11, drs:2, est:1950 },
  baku:          { lap:"6.003 km", turns:20, drs:2, est:2016 },
  marina_bay:    { lap:"5.063 km", turns:23, drs:3, est:2008 },
  americas:      { lap:"5.513 km", turns:20, drs:2, est:2012 },
  rodriguez:     { lap:"4.304 km", turns:17, drs:3, est:1963 },
  interlagos:    { lap:"4.309 km", turns:15, drs:2, est:1973 },
  las_vegas:     { lap:"6.201 km", turns:17, drs:2, est:2023 },
  vegas:         { lap:"6.201 km", turns:17, drs:2, est:2023 },
  yas_marina:    { lap:"5.281 km", turns:16, drs:2, est:2009 },
  losail:        { lap:"5.380 km", turns:16, drs:2, est:2021 },
  red_bull_ring: { lap:"4.318 km", turns:10, drs:3, est:1970 },
  madring:       { lap:"5.400 km", turns:21, drs:3, est:2026 },
  portimao:      { lap:"4.653 km", turns:15, drs:2, est:2020 },
  istanbul:      { lap:"5.338 km", turns:14, drs:3, est:2005 },
};

// ── Human-readable display name overrides (API sometimes uses raw IDs) ─────
const CIRCUIT_DISPLAY_NAMES = {
  madring:    "Circuit de Madrid",
  villeneuve: "Circuit Gilles Villeneuve",
  americas:   "Circuit of the Americas",
  rodriguez:  "Autódromo Hermanos Rodríguez",
  interlagos: "Autódromo José Carlos Pace",
  losail:     "Lusail International Circuit",
  portimao:   "Algarve International Circuit",
  albert_park:"Albert Park Circuit",
  marina_bay: "Marina Bay Street Circuit",
  red_bull_ring: "Red Bull Ring",
  yas_marina: "Yas Marina Circuit",
};

function getCircuitDisplayName(c) {
  return CIRCUIT_DISPLAY_NAMES[c?.circuitId] || c?.circuitName || "Unknown Circuit";
}

// ── LAP VISUALIZER PAGE ───────────────────────────────────────────
const VISUALIZER_SEASONS = {
  "2026": [
    { country: "Bahrain", circuit: "Sakhir International Circuit", trackType: "bahrain" },
    { country: "Saudi Arabia", circuit: "Jeddah Corniche Circuit", trackType: "jeddah" },
    { country: "Australia", circuit: "Albert Park Circuit", trackType: "melbourne" },
    { country: "Japan", circuit: "Suzuka International Racing Course", trackType: "suzuka" },
    { country: "China", circuit: "Shanghai International Circuit", trackType: "shanghai" },
    { country: "Miami", circuit: "Miami International Autodrome", trackType: "miami" },
    { country: "Monaco", circuit: "Circuit de Monaco", trackType: "monaco" },
    { country: "Canada", circuit: "Circuit Gilles Villeneuve", trackType: "montreal" },
    { country: "Spain", circuit: "Circuit de Barcelona-Catalunya", trackType: "barcelona" },
    { country: "Austria", circuit: "Red Bull Ring", trackType: "spielberg" },
    { country: "United Kingdom", circuit: "Silverstone Circuit", trackType: "silverstone" },
    { country: "Hungary", circuit: "Hungaroring", trackType: "hungaroring" },
    { country: "Belgium", circuit: "Circuit de Spa-Francorchamps", trackType: "spa" },
    { country: "Netherlands", circuit: "Circuit Zandvoort", trackType: "zandvoort" },
    { country: "Italy", circuit: "Autodromo Nazionale Monza", trackType: "monza" },
    { country: "Azerbaijan", circuit: "Baku City Circuit", trackType: "baku" },
    { country: "Singapore", circuit: "Marina Bay Street Circuit", trackType: "singapore" },
    { country: "United States", circuit: "Circuit of the Americas", trackType: "austin" },
    { country: "Mexico", circuit: "Autódromo Hermanos Rodríguez", trackType: "mexico_city" },
    { country: "Brazil", circuit: "Autódromo José Carlos Pace (Interlagos)", trackType: "interlagos" },
    { country: "Las Vegas", circuit: "Las Vegas Strip Circuit", trackType: "las_vegas" },
    { country: "Qatar", circuit: "Lusail International Circuit", trackType: "lusail" },
    { country: "Abu Dhabi", circuit: "Yas Marina Circuit", trackType: "yas_marina" }
  ],
  "2025": [
    { country: "Australia", circuit: "Albert Park Circuit", trackType: "melbourne" },
    { country: "China", circuit: "Shanghai International Circuit", trackType: "shanghai" },
    { country: "Japan", circuit: "Suzuka International Racing Course", trackType: "suzuka" },
    { country: "Bahrain", circuit: "Sakhir International Circuit", trackType: "bahrain" },
    { country: "Saudi Arabia", circuit: "Jeddah Corniche Circuit", trackType: "jeddah" },
    { country: "Miami", circuit: "Miami International Autodrome", trackType: "miami" },
    { country: "Monaco", circuit: "Circuit de Monaco", trackType: "monaco" },
    { country: "Spain", circuit: "Circuit de Barcelona-Catalunya", trackType: "barcelona" },
    { country: "Canada", circuit: "Circuit Gilles Villeneuve", trackType: "montreal" },
    { country: "Austria", circuit: "Red Bull Ring", trackType: "spielberg" },
    { country: "United Kingdom", circuit: "Silverstone Circuit", trackType: "silverstone" },
    { country: "Belgium", circuit: "Circuit de Spa-Francorchamps", trackType: "spa" },
    { country: "Hungary", circuit: "Hungaroring", trackType: "hungaroring" },
    { country: "Netherlands", circuit: "Circuit Zandvoort", trackType: "zandvoort" },
    { country: "Italy", circuit: "Autodromo Nazionale Monza", trackType: "monza" },
    { country: "Azerbaijan", circuit: "Baku City Circuit", trackType: "baku" },
    { country: "Singapore", circuit: "Marina Bay Street Circuit", trackType: "singapore" },
    { country: "United States", circuit: "Circuit of the Americas", trackType: "austin" },
    { country: "Mexico", circuit: "Autódromo Hermanos Rodríguez", trackType: "mexico_city" },
    { country: "Brazil", circuit: "Autódromo José Carlos Pace (Interlagos)", trackType: "interlagos" },
    { country: "Las Vegas", circuit: "Las Vegas Strip Circuit", trackType: "las_vegas" },
    { country: "Qatar", circuit: "Lusail International Circuit", trackType: "lusail" },
    { country: "Abu Dhabi", circuit: "Yas Marina Circuit", trackType: "yas_marina" }
  ],
  "2024": [
    { country: "Bahrain", circuit: "Sakhir International Circuit", trackType: "bahrain" },
    { country: "Saudi Arabia", circuit: "Jeddah Corniche Circuit", trackType: "jeddah" },
    { country: "Australia", circuit: "Albert Park Circuit", trackType: "melbourne" },
    { country: "Japan", circuit: "Suzuka International Racing Course", trackType: "suzuka" },
    { country: "China", circuit: "Shanghai International Circuit", trackType: "shanghai" },
    { country: "Miami", circuit: "Miami International Autodrome", trackType: "miami" },
    { country: "Monaco", circuit: "Circuit de Monaco", trackType: "monaco" },
    { country: "Canada", circuit: "Circuit Gilles Villeneuve", trackType: "montreal" },
    { country: "Spain", circuit: "Circuit de Barcelona-Catalunya", trackType: "barcelona" },
    { country: "Austria", circuit: "Red Bull Ring", trackType: "spielberg" },
    { country: "United Kingdom", circuit: "Silverstone Circuit", trackType: "silverstone" },
    { country: "Hungary", circuit: "Hungaroring", trackType: "hungaroring" },
    { country: "Belgium", circuit: "Circuit de Spa-Francorchamps", trackType: "spa" },
    { country: "Netherlands", circuit: "Circuit Zandvoort", trackType: "zandvoort" },
    { country: "Italy", circuit: "Autodromo Nazionale Monza", trackType: "monza" },
    { country: "Azerbaijan", circuit: "Baku City Circuit", trackType: "baku" },
    { country: "Singapore", circuit: "Marina Bay Street Circuit", trackType: "singapore" },
    { country: "United States", circuit: "Circuit of the Americas", trackType: "austin" },
    { country: "Mexico", circuit: "Autódromo Hermanos Rodríguez", trackType: "mexico_city" },
    { country: "Brazil", circuit: "Autódromo José Carlos Pace (Interlagos)", trackType: "interlagos" },
    { country: "Las Vegas", circuit: "Las Vegas Strip Circuit", trackType: "las_vegas" },
    { country: "Qatar", circuit: "Lusail International Circuit", trackType: "lusail" },
    { country: "Abu Dhabi", circuit: "Yas Marina Circuit", trackType: "yas_marina" }
  ]
};

const VISUALIZER_DRIVERS = [
  { code: "VER", name: "Max Verstappen", team: "Red Bull", color: "#3671C6" },
  { code: "HAM", name: "Lewis Hamilton", team: "Ferrari", color: "#E8002D" },
  { code: "LEC", name: "Charles Leclerc", team: "Ferrari", color: "#E8002D" },
  { code: "NOR", name: "Lando Norris", team: "McLaren", color: "#FF8000" },
  { code: "PIA", name: "Oscar Piastri", team: "McLaren", color: "#FF8000" },
  { code: "RUS", name: "George Russell", team: "Mercedes", color: "#27F4D2" },
  { code: "ALO", name: "Fernando Alonso", team: "Aston Martin", color: "#229971" },
  { code: "STR", name: "Lance Stroll", team: "Aston Martin", color: "#229971" },
  { code: "SAI", name: "Carlos Sainz", team: "Williams", color: "#64C4FF" },
  { code: "ALB", name: "Alex Albon", team: "Williams", color: "#64C4FF" },
  { code: "GAS", name: "Pierre Gasly", team: "Alpine", color: "#FF87BC" },
  { code: "OCO", name: "Esteban Ocon", team: "Haas", color: "#B6BABD" },
  { code: "HUL", name: "Nico Hulkenberg", team: "Sauber", color: "#52E252" },
  { code: "BOT", name: "Valtteri Bottas", team: "Sauber", color: "#52E252" },
  { code: "TSU", name: "Yuki Tsunoda", team: "RB", color: "#6692FF" },
  { code: "LAW", name: "Liam Lawson", team: "RB", color: "#6692FF" },
  { code: "PER", name: "Sergio Perez", team: "Red Bull", color: "#3671C6" },
];

const TRACK_PATHS = {
  madring: "M363.317 107.733h26.417l.114.009a7 7 0 0 1 .483.026c.422.031 1.02.093 1.678.199 1.472.233 2.697.6 3.321.987l.009.01c2.328 1.463 5.79 4.946 8.214 8.517 1.445 2.116 3.378 4.607 5.605 6.803 2.17 2.134 4.942 4.312 8.109 5.313 5.587 1.763 13.239.983 18.571-1.543 1.946-.917 6.795-2.893 11.509-4.744a563 563 0 0 1 6.33-2.434c.878-.33 1.625-.604 2.196-.811l.694-.243.241-.075c1.656-.463 3.404-1.203 8.219-1.172 8.508.053 20.074 7.332 19.973 22.675-.115 17.084-15.093 26.933-26.408 27.052-11.72.128-21.651-5.162-32.997-13.164l-2.873-2.042a158 158 0 0 1-14.79-11.86 255 255 0 0 0-14.143-11.64c-9.005-6.908-17.342-11.85-19.846-13.2a19 19 0 0 0-3.602-1.6 11.4 11.4 0 0 0-3.057-.458h-1.028c-2.587.08-4.761 1.278-6.281 2.403a22 22 0 0 0-3.835 3.756v.009c-.58.723-4.854 6.543-9.005 12.173a2299 2299 0 0 1-5.908 7.98c-.834 1.129-1.559 2.09-2.108 2.822l-.676.895-.207.273-.07.08-.018.026c-1.168 1.393-4.094 4.453-7.032 6.07l-.593.3c-1.88.905-3.457 1.363-6.325 1.363-.572 0-2.478-.03-5.188-.062q-4.766-.052-9.532-.061c-3.452 0-6.984.026-9.945.105-2.793.071-5.508.203-7.01.499-10.279 2.028-19.516 8.99-23.961 14.792-4.085 5.343-7.222 10.47-7.78 18.177-.158 2.16-.29 9.678-.386 16.415-.048 3.42-.092 6.706-.119 9.144l-.026 2.936-.018.811v.569q.034 1.017.145 2.028c.14 1.217.43 2.954 1.055 4.682l.667 1.632c.765 1.697 1.766 3.527 2.574 4.955a145 145 0 0 0 1.467 2.513c.194.318.365.578.475.759l.132.207.022.061.017.018v.01l.035.043.145.256c.11.194.25.44.387.705l-.255.22-.206.142-.036.026-.096.062-.01.01-.056.034-.207.146-.817.55a457 457 0 0 1-12.387 8.06c-7.845 4.903-15.993 9.559-17.614 10.55a70 70 0 0 1-4.823 2.54l-3.061 1.526-3.08 1.591c-7.44 4.021-9.949 11.878-9.795 19.664.097 4.969.562 7.416 1.3 10.81.655 3.008.967 5.662.9 10.776-.074 6.102-.76 10.625-3.232 14.461-3.106 4.832-6.989 7.244-10.542 8.073-1.463.34-3.29.692-4.78.965-.737.133-1.379.238-1.835.318l-.54.097-.137.026h-.053l-62.295 10.04h-.035l-.017.008a1 1 0 0 0-.102.01l-.307.057a26 26 0 0 0-4.155 1.199 13.2 13.2 0 0 0-3.809 2.195c-1.247 1.072-2.692 2.91-2.692 5.53 0 2.15.782 3.879 1.625 5.175.773 1.182 1.8 2.284 2.42 2.998.914 1.032 1.494 2.315 1.59 3.395.207 2.249 2.201 15.713 2.36 16.961.083.657.201 1.958.219 3.382q.02 1.13-.075 2.257c-2.697.904-9.237 3.227-18.95 5.63l-5.2 1.217c-3.264.723-6.61 1.358-9.945 1.953l-9.883 1.737c-5.535 1.01-10.472 1.896-14.034 2.544l-4.213.763-1.133.207-.299.053-.079.018h-.026l-.066.017-.351.053c-.308.044-.743.12-1.261.19-.531.07-1.142.132-1.757.198l-1.876.146a6.1 6.1 0 0 1-2.143-.287 3 3 0 0 1-.55-.229 14.1 14.1 0 0 1-1.726-4.144l-.057-.283-.008-.026-23.197-139.55a4 4 0 0 0-.106-.468l-1.124-7.618a1 1 0 0 0-.018-.168 9 9 0 0 0-.092-.445 11 11 0 0 0-.387-1.353 9.7 9.7 0 0 0-2.446-3.797l-.37-.317a7.9 7.9 0 0 0-2.424-1.292c-.722-.23-1.463-.4-2.214-.502a18 18 0 0 0-1.612-.133 7 7 0 0 0-.51-.013h-.245l-4.977.07h-.215a2 2 0 0 1-.172-.017c-.044-.132-.105-.278-.145-.432a9 9 0 0 1-.175-.732l-.031-.207-.009-.044-1.458-10.899a3 3 0 0 0-.044-.234l-.026-.18a18 18 0 0 1-.093-.86 27 27 0 0 1-.035-3.369 25.65 25.65 0 0 1 2.811-10.47c1.713-3.29 4.217-6.028 6.387-7.98a35 35 0 0 1 3.646-2.867l.026-.013 65.555-40.05.074-.044.07-.044.207-.137.821-.516a555 555 0 0 1 13.41-8.165c8.246-4.859 18.12-10.352 25.232-13.315 10.542-4.387 18.053-6.675 24.743-7.892 6.694-1.221 12.747-1.41 20.522-1.441 12.101-.045 30.071 5.797 30.695 6.07 3.514 1.526 6.18 3.052 7.946 4.171q1.234.778 2.398 1.654l.08.057.017.018.119.097.369.29c.307.234.746.547 1.251.87.497.317 1.142.696 1.863 1 .646.273 1.744.67 3.03.626l.027-.009c2.332-.088 4.243-.97 5.526-2.451a6.4 6.4 0 0 0 1.146-1.94q.061-.177.106-.335l.72.49.668.466.197.137.062.044.009.01h.009l.11.079.017.013h.018v.009l.145.088q.604.377 1.26.653c.782.352 1.89.758 3.229.992h.009c2.126.365 4.12.176 5.482-.062a18 18 0 0 0 2.24-.534l.171-.048.018-.01 15.431-4.55q.132-.039.26-.087h.008l.026-.004.07-.027.256-.097q.324-.123.882-.353a73 73 0 0 0 2.917-1.23c2.174-.978 5.179-2.455 7.31-4.166l2.108-1.631c1.985-1.446 3.645-2.399 5.49-3.03 4.2-1.432 8.153-2.177 11.93-2.816 3.624-.609 7.481-1.169 10.784-2.249l1.665-.582c3.852-1.455 7.507-3.47 9.488-5.004l.461-.344c.615.948 2.144 3.095 4.305 5.167 2.31 2.205 6.07 5.04 10.7 5.251 5.868.27 10.775-3.064 12.681-4.13l.01-.01a320 320 0 0 1 8.82-4.806c.966-.48 2.912-1.37 5.284-1.56a98 98 0 0 1 3.698-.216l1.01-.022z",
  monaco: "M118.34 246.687c-5.14.774-6.994 2.392-9.853 7.317-4.586 7.898-9.192 18.211-11.413 27.357-2.486 10.243-2.829 25.557-1.95 39.458.445 7.034 2.23 10.04 8.243 12.045 7.17 2.387 8.339 2.488 9.949 9.801 1.61 7.319 6.389 33.36 8.047 42.434 1.188 6.495 2.042 8.91-3.805 11.704-6.436 3.07-7.9 3.95-6.729 9.07 1.17 5.12 6.805 23.714 11.023 30.435 11.51 18.336 19.262 23.945 27.311 26.726 5.165 1.784 11.935 2.284 13.315 7.946 1.317 5.416 1.181 7.937-2.341 9.074-13.167 4.244-26.043 5.56-38.334 5.268-4.24-.102-4.829-.294-4.245-5.56.442-3.967.44-9.514-3.803-14.047-3.322-3.553-10.24-13.756-16.093-28.531-9.486-23.955-16.97-48.602-19.168-60.132-2.924-15.363-5.422-36.152-6.435-49.746-1.903-25.458-.928-45.988 3.217-55.89 5.267-12.585 6.437-17.12 5.999-21.07-.878-7.9-.355-10.97 4.242-12.437 14.192-4.535 27.36-4.242 37.456-5.852 10.094-1.609 27.134-4.495 33.651-6.439 8.34-2.486 23.423-7.227 36.577-9.363 11.704-1.903 21.801-3.073 32.774-8.34 6.195-2.974 21.8-11.119 28.384-13.169 6.585-2.046 18.713-4.606 25.75-6.143 8.048-1.759 17.221-3.118 23.994-4.534 9.32-1.953 25.118-13.113 27.46-27.898 2.535-15.996-2.563-24.582-12.876-33.749-7.022-6.243-11.658-11.657-12.68-15.461-1.987-7.38.472-12.368 3.803-16.97 4.974-6.877 50.625-68.034 53.99-72.277 3.366-4.244 6.436-3.658 9.95-.88 3.509 2.783 7.415 5.432 7.023 10.39-.438 5.56-.515 9.95 1.757 13.607 2.632 4.244 3.365 5.121 6.585 9.51 2.136 2.914 3.949 5.707 5.121 9.51 1.097 3.565 6.103 5.143 8.922 2.633 2.632-2.341 3.073-6.585-.876-9.51-1.636-1.211-3.58-2.506-5.269-5.12-2.926-4.537-5.415-7.9-7.168-10.681-1.389-2.204-3.13-11.026 2.778-12.73 8.632-2.487 19.607-5.853 25.31-7.608 2.719-.835 11.123-.146 11.123 8.34 0 8.485-.294 17.848-1.17 25.896-.394 3.597-3.482 47.7-22.192 77.593-23.132 36.952-62.28 63.471-70.912 68.28-19.604 10.923-39.682 17.952-46.525 19.703-12.584 3.218-28.287 4.485-42.725 6.437-3.529.476-5.299 3.87-5.074 5.463.586 4.098-.946 5.21-4.484 5.852-8.585 1.563-10.73 2.731-12.486-.388-1.8-3.2-3.085-2.424-7.805-1.759-15.215 2.147-86.663 12.827-97.344 14.435z",
  monza: "M218.372 50.51c17.128-1.458 28.349-2.045 40.274-3.238 9.544-.954 18.648-.863 32.116-1.38 3.542-.136 3.729-.748 5.353-5.354 1.036-2.935 1.478-4.501 4.144-4.835 5.525-.69 9.921-1.651 11.443-2.091 14.149-4.09 33.715-10.744 48.213-17.291 6.233-2.814 20.461 2.978 21.497 16.187s3.53 38.46 4.015 45.973c.518 8.029.022 9.197-4.533 11.655-9.842 5.31-36.237 19.593-46.102 25.511-14.892 8.936-29.224 17.864-38.59 26.03-10.102 8.806-73.808 64.464-80.377 70.318-3.39 3.023-6.907 6.216-12.087 10.705-3.24 2.809-2.08 5.871-1.38 10.878 1.035 7.425-.519 16.403-8.289 21.756-5.758 3.967-6.446 5.425-7.248 12.962-4.732 44.498-20.042 187.268-21.674 201.017-1.813 15.28-17.22 18.9-29.267 11.784-24.993-14.763-21.878-47.89-20.85-65.527.408-6.966 12.017-143.36 19.435-230.17.309-3.611.466-5.692 5.3-5.347 5.184.37 5.612-1.727 3.54-7.77-3.737-10.9-5.649-24.2-5.06-31.068 1.369-15.987 2.231-26.008 2.297-26.732 1.804-19.481 7.9-39.11 33.93-52.707 14.168-7.4 25.64-9.712 43.9-11.266z",
  silverstone: "M187.132 258.577c2.83-3.815 6.413-9.565 13.577-10.593 13.554-1.944 21.828 1.404 35.111 3.348 16.012 2.344 24.823-.431 33.316-6.912 16.091-12.281 27.87-21.819 38.54-30.677 7.154-5.938 13.066-1.296 14.154 3.024 1.523 6.05 2.831 11.45 6.969 24.844 1.656 5.362 9.362 7.346 12.628.432 5.003-10.589 6.313-15.666 7.839-21.819 5.617-22.642-.695-28.128-2.83-30.029-29.832-26.571-120.874-108.733-128.253-115.577-10.017-9.29-28.416-4.536-29.233 4.861-.816 9.398-.899 12.315-1.306 17.985-.25 3.466-7.266 17.717-20.74 12.8-14.209-5.185-7.879-20.646-7.325-21.701 7.29-13.886 15.623-29.211 20.505-37.048 9.58-15.378 25.704-25.296 39.407-26.584 18.917-1.78 76.237-6.805 105.634-9.258 2.916-.243 5.556-.498 7.862-.65 7.843-.516 21.345 4.846 24.827 16.658 8.166 27.706 12.928 43.496 14.332 67.407 1.269 21.603 2.421 42.276 2.653 49.736.278 8.92 1.882 13.375 9.635 24.627.68.984 1.46 2.099 2.315 3.333 2.182 3.148 3.236 7.36-.247 16.434-3.793 9.88-9.554 20.467-9.145 29.812.546 12.475 4.325 13.683 9.363 19.66 10.017 11.882 7.186 25.707-4.62 32.755-4.323 2.58-8.564 4.969-12.364 7.211-9.437 5.57-13.513 9.501-18.29 19.28-12.957 26.518-83.893 152.682-99.075 173.203-12.588 17.013-38.433 10.532-43.659-6.643-1.42-4.666-16.26-30.392-20.577-34.403-10.234-9.505-16.766-16.417-20.25-21.17-3.42-4.668-7.676-9.398-13.882-17.337-2.815-3.6-6.621-5.117-10.615-.81-3.291 3.549-5.422 5.822-7.408 7.183-2.547 1.745-8.378 1.89-11.644-1.998-1.713-2.04-10.749-12.65-14.154-22.035-3.919-10.802-5.688-12.142 5.771-27.113 10.997-14.365 52.26-67.725 59.227-76.475 2.784-3.497 7.22-9.384 11.952-15.761z",
  interlagos: "M216.38 19.757c-17.923 4.414-27.502 8.15-29.356 9.005-18.27 8.424-32.89 17.454-41.726 25.47-11.632 10.552-16.108 21.908-19.57 36.02-4.061 16.556-16.797 66.138-24.74 100.06-3.879 16.555-4.247 36.566-.185 54.032 3.524 15.153 37.757 148.06 49.417 194.762 1.78 7.131 2.858 12.295 3.572 14.637 8.863 29.109 24.428 39.214 37.388 24.74 8.308-9.274 18.861-24.656 28.248-16.462 19.385 16.917 45.557 20.194 66.374 12.915 21.845-7.637 33.093-22.602 38.726-34.564 4.023-8.55 6.926-21.201 8.912-28.198 6.46-22.788 58.489-213.536 68.181-249.148 2.697-9.903-6.611-23.196-20.735-26.199-14.069-2.988-16.616-3.274-33.787-6.003-33.892-5.386-48.923 19.7-55.18 27.97-17.862 23.606-59.473 79.48-73.875 99.81-7.299 10.304-12.254 15.556-18.693 19.171-6.871 3.86-11.492 4.98-18.693 5.457-15.733 1.045-43.48-8.05-47.171-28.154-.778-4.232-1.627-8.452-2.374-12.605-2.733-15.174-4.86-29.288-6.119-37.97-2.03-14.008 11.078-22.014 29.17-6.55 13.644 11.663 27.325 9.64 34.34-3.458 5.474-10.222 3.693-17.099-3.325-24.377-9.62-9.98-22.155-22.559-26.586-27.473-3.537-3.923-7.569-10.732-9.232-16.737-1.486-5.368-5.17-19.466-7.568-29.835-1.978-8.542 12.737-17.465 20.677-7.46 9.464 11.93 18.92 22.85 29.54 32.567 20.68 18.92 52.023 22.238 74.591-13.463 21.538-34.077 30.701-48.147 36.584-58.697 2.926-5.25.988-16.44-7.043-19.441-17.76-6.638-20.77-7.914-36.555-12.28-16.496-4.56-24.376-2.182-43.207 2.458z",
  suzuka: "M214.902 264.546c-4.263.328-5.803-.797-6.964-6.36-1.16-5.565-10.35-52.063-12.284-61.7-1.12-5.576-.962-14.257 1.644-19.872 2.999-6.458 5.822-12.607 7.255-15.698 1.836-3.975.773-6.955-2.322-8.247-2.978-1.244-5.03-.101-7.35 4.074-2.322 4.173-12.672 21.262-15.283 25.733-2.153 3.687-8.92 17.507-26.309 19.871-10.163 1.38-19.687 1.207-28.146-.199-7.964-1.324-15.005-3.757-20.119-6.358-17.369-8.84-26.889-12.917-38.592-41.034-6.216-14.93-8.706-20.865-9.866-24.045s-6.259-10.384-16.25-9.637c-5.32.397-8.334.725-13.348 1.987-9.865 2.484-14.279 11.485-11.026 20.368 3.675 10.035 7.145 12.684 21.666 23.845 27.276 20.965 40.187 27.009 54.455 33.086 18.664 7.949 100.496 37.755 115.585 42.823 8.293 2.785 13.156 3.078 23.89-1.69 14.312-6.358 24.468-14.207 34.047-24.242 9.108-9.546 20.215-18.976 30.565-27.522 3.32-2.742 4.453-1.049 5.706.199 3 2.98 3.77 3.676 5.32 4.967 1.752 1.463 2.812 1.8 4.836.1 2.128-1.789 6.544-5.557 7.643-6.258 8.992-5.762 12.435-7.209 19.143-5.619q2.56.607 5.23 1.446c13.93 4.372 17.894 8.247 32.694 25.634 8.66 10.175 94.452 116.714 100.98 124.992 7.834 9.934 7.94 13.91 6.482 23.744-1.546 10.433-6.74 21.182-17.704 19.971-8.994-.993-11.294-7.23-14.509-12.32-3.577-5.663-9.067-15.082-13.154-21.461-5.028-7.85-5.807-13.238-19.345-13.91-14.025-.695-19.964-2.105-23.407-17.685-.967-4.372-1.38-5.691-3.289-12.32-2.513-8.744-8.513-14.227-18.764-13.811-14.702.596-23.273-2.344-27.661-12.519-3.772-8.743-.236-15.137 1.933-20.765 1.837-4.77 6.382-16.195 2.71-23.35-3.676-7.153-7.966-9.22-12.866-11.524-5.707-2.683-17.812-8.054-30.855-6.757-14.994 1.49-27.083 9.837-35.207 20.17-6.979 8.877-17.12 21.656-19.442 24.839-2.321 3.181-3.96 3.926-6.287 4.173-6.577.693-23.699 2.285-31.435 2.881z",
  spa: "M167.75 20.858c-3.075-5.364-.283-7.034 3.387-5.065 3.669 1.97 49.393 30.95 55.603 35.171 6.21 4.22 10.613 8.816 14.395 13.224 6.116 7.128 29.072 34.701 33.87 40.235 2.327 2.682 4.765 5.265 8.892 6.504.742.223 1.542.375 2.398.53 3.105.563 9.733 2.517 14.112 9.848 4.987 8.348 5.552 11.818 4.705 22.04-.49 5.916.164 11.615 2.258 14.631 5.08 7.316 15.721 22.54 22.956 32.545 8.75 12.099 16.935 28.98 20.322 40.235s41.49 144.622 43.467 152.5c1.975 7.878 4.009 9.705-5.504 15.334-4.516 2.673-8.435 6.431-6.774 13.787 1.27 5.628 9.744 26.446.846 32.639-2.08 1.447-48.41 32.702-57.014 38.265-5.222 3.377-12.385.885-15.242-4.08-2.856-4.964-3.503-11.631 4.093-15.897 5.927-3.329 9.314-5.205 25.685-14.96 3.995-2.38 6.181-7.751 3.198-14.442-2.634-5.909-7.55-20.755-9.972-27.574-5.645-15.897-10.43-48.422-14.254-69.216-1.552-8.44-7.338-16.882-19.193-18.007-2.61-.248-11.29-.844-18.77-.563-7.303.275-20.816 4.787-27.66 22.79-5.08 13.366-15.524 40.095-23.992 62.464-6.59 17.407-22.297 12.661-24.696 10.832-5.53-4.215-19.68-14.49-31.19 1.688-5.503 7.738-16.934 26.59-23.567 36.86-7.403 11.462-15.806 3.657-38.81-13.506-9.759-7.282-7.215-21.806-5.786-27.293 6.586-25.285 18.77-40.094 31.189-50.786s29.919-23.353 50.805-30.669c20.887-7.315 27.2-13.496 33.023-24.197 16.23-29.825 24.133-42.908 22.44-57.54-1.694-14.63-19.053-43.752-22.722-56.413-2.69-9.285-4.774-32.872-5.249-52.615-.083-3.47-.676-7.138 6.096-6.19 10.725 1.5 7.765-7.127 6.21-9.379-7.904-11.442-11.323-16.99-17.782-28.324-7.057-12.38-39.515-71.467-41.773-75.406z",
  bahrain: "M462.85 365.784 329.224 131.432c-4.038-7.082-11.039-11.307-18.724-11.307-7.65 0-14.626 4.201-18.66 11.24-9.299 16.238-17.16 32.823-23.356 49.293-5.14 13.655-5.658 25.341-1.594 35.727 7.746 19.786 30.936 29.875 53.367 39.633l4.14 1.806c16.661 7.291 23.048 25.67 25.473 39.799.724 4.218-.317 8.525-2.847 11.823-2.535 3.297-6.256 5.19-10.22 5.19H143.68c-2.374 0-4.767-.129-7.111-.385l-31.072-3.39 5.256-9.353c5.08-9.04 15.179-13.982 24.85-12.089 14.027 2.747 34.175 6.298 50.485 7.621 14.248 1.16 34.693 2.699 51.662 3.956q.505.038.995.038h.005c5.95 0 11.14-4.174 12.916-10.381 1.8-6.287-.282-12.757-5.3-16.485l-49.515-36.75c-7.077-5.252-11.07-14.267-10.421-23.53l.739-10.54c1.111-15.893-7.328-30.547-20.997-36.47l-11.045-4.781c-2.881-1.25-5.512-3.205-7.62-5.658l-43.734-50.881c-3.697-4.302-8.681-6.671-14.037-6.671-9.551 0-17.588 7.382-19.112 17.548L43.822 295.397c-2.137 14.267-.11 28.647 5.865 41.58l5.3 11.493c2.415 5.22 1.504 11.534-2.273 15.705l-14.47 16c-3.208 3.553-4.134 8.81-2.353 13.393 1.775 4.583 5.894 7.545 10.486 7.545H414.29c10.748 0 21.596-2.565 31.373-7.414l10.894-5.41c3.777-1.874 6.634-5.416 7.836-9.718s.639-8.964-1.544-12.787z",
  melbourne: "M294.629 449.112c-17.004-16.153-135.384-136.209-146.616-147.395-1.524-1.517-1.706-3.53.325-6.806 3.149-5.077 4.704-10.311 4.992-19.451.338-10.696-5.247-17.614-9.32-20.938a543.275 540.954 0 0 1-3.051-2.51c-7.815-6.483-24.853-22.693-36.79-37.604-7.19-8.982-18.233-21.829-21.922-27.231S61.41 152.598 58.59 145.682c-.14-.345-.313-.741-.486-1.193-2.526-6.507 1.79-7.721 4.882-8.288 3.321-.61 15.573-2.62 24.47-4.568 6.013-1.313 7.515-6.538 7.381-10.805-.272-8.617-1.166-38.604-1.248-43.628-.044-2.674-1.14-6.564 2.014-9.31.177-.155.36-.297.536-.442 7.596-6.268 24.309-19.02 31.472-22.26s19.75-8.645 25.394-10.59c.27-.093 8.895-3.4 9.197-3.512 6.839-2.512 16.371-9.01 25.802-14.913 2.85-1.783 5.222-1.533 7.408.73 4.11 4.254 8.482 8.26 13.591 10.778 5.11 2.519 10.96 3.55 16.713 4.107l.869.086c6.576.667 18.943 2.276 24.961 6.615 6.599 4.758 18.448 15.344 22.356 27.446 2.667 8.264 8.547 39.081 9.113 44.954.043.417.075.832.111 1.243.316 3.362.451 7.204-.38 12.615-.785 5.117-3.03 9.761-4.865 12.36-2.135 3.025-2.99 4.04-5.601 7.349-2.022 2.563-3.632 5.219-5.412 8.814-1.298 2.622-2.098 5.678-3.25 9.515-.6 1.996-.984 4.224-1.438 6.672-2.298 12.381-6.64 33.93-6.511 48.195.217 24.638 9.137 41.707 17.797 53.812 10.2 14.265 18.231 19.882 28.868 28.745 2.75 2.292 5.48 4.553 8.392 6.78 3.169 2.426 7.437 5.332 12.714 6.133 7.49 1.135 15.377.162 23.93.162 6.755 0 8.091.737 11.068 3.078 11.64 9.16 39.977 33.269 40.484 33.778 8.615 8.626 17.154 17.81 21.049 30.465 4.124 13.4 9.334 31.769 11.72 40.414s9.142 31.943 9.55 34.796c.65 4.539 2.668 10.58-1.123 10.859-5.127.378-11.708 1.435-20.695 5.01-11.669 4.64-25.258 9.853-29.403 11.147-11.07 3.458-18.45 3.889-24.962-7.997-4.378-7.99-14.84-26.34-22.345-39.148-3.658-6.242-7.146-4.698-8.583-3.104-4.776 5.294-9.984 10.914-17.255 18.587-4.469 4.71-15.194 4.643-22.246-2.057z",
  jeddah: "M441.899 135.118a56957 56957 0 0 1-32.942 21.303c-9.373 6.056-12.405 8-15.927 10.544-3.522 2.54-7.533 5.676-21.403 17.137a11706.519 11992.905 0 0 0-49.791 41.468c-12.193 10.215-12.85 10.854-13.327 11.411a5.23 5.359 0 0 0-.971 1.471 2.93 3 0 0 0 .06 2.428 4.535 4.646 0 0 0 .9 1.2c.442.465 1.043 1.007 1.53 1.503.492.5.862.948 1.12 1.324a2.865 2.935 0 0 1 .453.987 2.358 2.416 0 0 1 .026.988 4.89 5.01 0 0 1-1.134 2.54 3.893 3.988 0 0 1-1.031.87 8.882 9.1 0 0 1-1.777.79 19.994 20.483 0 0 1-2.608.62c-.956.167-1.954.295-2.808.387a28.917 29.624 0 0 1-2.611.17c-1.036.024-2.393.009-3.855.04-1.463.023-3.032.092-4.165.205a14.6 14.6 0 0 0-2.518.464c-.699.194-1.402.407-2.316.748a48 48 0 0 0-3.213 1.332 60 60 0 0 0-3.647 1.82 79 79 0 0 0-3.984 2.284c-1.42.875-2.967 1.874-4.448 2.788-1.486.914-2.91 1.738-4.294 2.555-1.39.813-2.744 1.626-4.01 2.385-1.266.755-2.445 1.46-3.564 2.11-1.115.651-2.173 1.251-3.258 1.867a330 330 0 0 0-3.288 1.885c-1.088.643-2.162 1.294-3.243 1.898a81 81 0 0 1-3.239 1.68 87.344 89.48 0 0 1-2.91 1.382c-.816.364-1.41.597-1.852.806a7.056 7.229 0 0 0-1.028.608 7 7 0 0 0-.812.62 2.808 2.877 0 0 0-.62.758c-.129.256-.152.5-.144 1.007.011.503.053 1.278.072 2.06a38.619 39.564 0 0 1-.212 5.018 16 16 0 0 1-.37 2.09 8.806 9.022 0 0 1-.544 1.503 14.192 14.54 0 0 1-.87 1.68 27.212 27.878 0 0 1-2.04 2.866 25.413 26.035 0 0 1-5.14 4.251 16.509 16.913 0 0 1-4.476 2.025 17.594 18.024 0 0 1-5.597.647 17.45 17.877 0 0 1-2.355-.194 20.863 21.373 0 0 1-2.162-.515c-.725-.205-1.474-.426-2.192-.612a25.954 26.589 0 0 0-2.184-.476 19.487 19.964 0 0 0-2.294-.26 12.193 12.49 0 0 0-2.162.09 16.1 16.495 0 0 0-2.181.453c-.695.193-1.334.426-1.988.697a20.477 20.978 0 0 0-3.916 2.09c-.661.453-1.353.968-2.124 1.51-.767.543-1.61 1.12-2.343 1.673a17.083 17.501 0 0 0-1.958 1.685 14.944 15.31 0 0 0-2.865 4.12 11.6 11.6 0 0 0-.718 2.013 29.688 30.414 0 0 0-.476 2.207c-.144.774-.28 1.58-.416 2.242a16 16 0 0 1-.408 1.634 5.941 6.087 0 0 1-.499 1.211c-.2.349-.453.659-.775 1.034-.328.372-.729.813-1.235 1.224a10.715 10.977 0 0 1-1.867 1.173c-.749.387-1.63.767-2.548 1.15a128.39 131.53 0 0 1-3.817 1.495 621 621 0 0 1-6.603 2.462c-1.765.65-2.389.867-2.963 1.003a8.704 8.917 0 0 1-1.776.209 36.994 37.899 0 0 1-4.158-.155 5.56 5.696 0 0 1-1.236-.31 13.901 14.241 0 0 1-4.308-2.54 14.721 15.081 0 0 1-1.387-1.463c-.443-.511-.881-1.046-1.316-1.56a29.37 30.089 0 0 0-1.285-1.445 17.027 17.443 0 0 0-2.419-2.071 13.961 14.303 0 0 0-1.387-.852 10.292 10.543 0 0 0-1.368-.585 8.315 8.518 0 0 0-1.376-.364 12.658 12.967 0 0 0-1.59-.147 8.825 9.041 0 0 0-1.562.078c-.559.077-1.21.232-1.908.41-.696.178-1.444.387-2.105.577-.666.19-1.248.356-1.883.53a35.338 36.203 0 0 1-2.222.53 40.667 41.662 0 0 1-3.088.504 32 32 0 0 1-3.583.248c-1.387.027-3.069 0-4.8-.008a141.73 145.198 0 0 0-4.701.046c-1.18.04-1.747.109-2.518.213a49.511 50.723 0 0 0-2.781.446 55.672 57.034 0 0 0-3.349.774 79 79 0 0 0-3.715 1.077 115 115 0 0 0-4.282 1.44c-1.467.526-2.922 1.084-4.407 1.645-1.486.566-2.997 1.139-4.55 1.758-1.55.62-3.138 1.29-8.694 3.717-5.555 2.428-15.068 6.614-22.805 10.006-7.74 3.391-13.697 5.986-16.788 7.352-3.088 1.363-3.304 1.499-3.595 1.704a11.754 12.042 0 0 0-1.035.844 16.6 17.006 0 0 0-2.268 2.556 9.63 9.866 0 0 0-1.538 3.175c-.136.48-.19.832-.22 1.521-.026.69-.026 1.716.11 2.64.136.93.408 1.751.692 2.448a9.585 9.82 0 0 0 2.23 3.38c.491.492 1.035.953 1.644 1.37a16 16 0 0 0 1.84 1.077c.556.271.99.453 1.709.558.718.108 1.72.15 2.66.15s1.822-.038 2.703-.154a22.254 22.798 0 0 0 5.064-1.278 19 19 0 0 0 2.54-1.239 24 24 0 0 0 2.434-1.591c.71-.53 1.259-1.026 1.822-1.572a32 32 0 0 0 1.757-1.843 40.297 41.283 0 0 0 3.515-4.627c.48-.705.9-1.336 1.35-1.975.453-.643.93-1.293 1.473-1.936.548-.639 1.16-1.27 1.701-1.843.537-.573 1.002-1.092 1.607-1.704a41.367 42.379 0 0 1 4.856-4.181 38.022 38.952 0 0 1 6.803-4.093 52.686 53.975 0 0 1 4.505-1.905 39 39 0 0 1 4.196-1.25 55.581 56.94 0 0 1 6.973-1.182c.903-.08 1.606-.096 2.645-.1 1.047-.008 2.427-.008 3.425.015.994.02 1.602.058 2.286.14.68.077 1.444.205 2.306.333.858.127 1.821.263 2.668.38.847.115 1.576.208 2.389.255a47.648 48.814 0 0 0 8.806-.504 21.052 21.567 0 0 0 2.653-.592c.801-.236 1.557-.519 2.521-.864.96-.348 2.124-.75 3.073-1.045.945-.286 1.682-.465 2.29-.558a6.7 6.7 0 0 1 1.66-.061 9.4 9.4 0 0 1 1.674.29c.472.136.782.298 1.247.589.472.29 1.096.712 1.648 1.215.555.504 1.043 1.1 1.493 1.677.453.58.861 1.142 1.254 1.66.393.516.768.984 1.18 1.434a12.17 12.468 0 0 0 3.046 2.462c.605.356 1.247.69 1.791.96.545.268.994.465 1.474.6.48.136.983.202 1.67.26.681.058 1.55.104 2.352.128.805.023 1.55.023 2.38-.043a22.072 22.612 0 0 0 2.794-.426 40.44 41.43 0 0 0 3.447-.902 70.839 72.572 0 0 0 7.861-2.904 78 78 0 0 0 3.515-1.626 52.335 53.615 0 0 0 6.266-3.69 35.452 36.319 0 0 0 2.593-1.975 62 62 0 0 0 2.695-2.42 173 173 0 0 0 3.371-3.283c1.127-1.123 2.155-2.176 3.334-3.38 1.179-1.2 2.506-2.556 3.832-3.826 1.323-1.27 2.657-2.459 3.89-3.554 1.231-1.096 2.369-2.095 3.355-2.893.99-.797 1.83-1.394 2.835-2.067 1.002-.678 2.166-1.433 3.1-1.975a24.264 24.858 0 0 1 2.426-1.216 78.995 80.928 0 0 1 6.028-2.431 97 97 0 0 1 4.225-1.406c1.474-.465 2.967-.89 4.43-1.42a41 41 0 0 0 4.263-1.825 65.404 67.004 0 0 0 7.257-4.247 70 70 0 0 0 3.643-2.734 68 68 0 0 0 3.288-2.772 39 39 0 0 0 2.91-2.896 54 54 0 0 0 2.926-3.543c.884-1.17 1.599-2.234 2.305-3.28.715-1.045 1.418-2.075 2.162-3.059a76.554 78.426 0 0 1 5.552-6.408 47.236 48.392 0 0 1 5.866-5.083 78 78 0 0 1 3.428-2.42 64.63 66.21 0 0 1 4.252-2.595 97 97 0 0 1 5.458-2.826 81.032 83.015 0 0 1 5.506-2.405 64 64 0 0 1 5.061-1.746 79 79 0 0 1 5.356-1.405 116.597 119.45 0 0 1 5.926-1.185 81 81 0 0 1 4.913-.697c1.33-.143 2.306-.202 3.077-.271.763-.066 1.323-.14 1.852-.302.54-.163 1.058-.415 1.512-.643.464-.232.869-.438 1.28-.763.413-.325.832-.766 1.3-1.32.473-.554.984-1.224 1.41-1.862a11.527 11.81 0 0 0 .983-1.809 10 10 0 0 0 .54-1.626c.144-.573.277-1.22.44-1.858.162-.643.355-1.278.604-2.014a23.13 23.696 0 0 1 .918-2.362 14.5 14.5 0 0 1 1.285-2.215 18 18 0 0 1 1.626-1.974 14 14 0 0 1 1.784-1.58c.687-.515 1.53-1.072 3.197-2.18l5.67-3.775c1.511-1.007 2.051-1.347 2.788-1.704.737-.348 1.679-.712 2.442-1.01.767-.295 1.36-.527 2.215-.658.85-.136 1.965-.175 3.197-.144 1.236.027 2.597.124 4.66.368 2.068.248 4.838.643 7.484.987a512 512 0 0 0 7.725.941c2.563.298 5.163.597 7.491.76 2.332.162 4.384.189 6.15.173a43.69 44.76 0 0 0 4.822-.255 46 46 0 0 0 4.985-.906 55 55 0 0 0 4.747-1.36c1.523-.506 3-1.06 4.471-1.668a52.61 53.898 0 0 0 4.46-2.075c1.534-.806 3.13-1.75 4.92-2.912 1.789-1.162 3.765-2.544 5.776-3.961a498.175 510.362 0 0 0 5.892-4.22 167 167 0 0 0 5.004-3.768 116.979 119.84 0 0 0 8.277-7.179 77 77 0 0 0 3.874-3.949 101.328 103.807 0 0 0 8.18-10.272 140 140 0 0 0 3.639-5.537 74 74 0 0 0 2.732-4.724 93.206 95.486 0 0 0 5.095-11.356 92 92 0 0 0 1.897-5.506c.632-2.045 1.323-4.492 2.011-6.977a991 991 0 0 0 1.965-7.187c.598-2.18 1.089-4.011 1.58-5.835.492-1.82.983-3.632 1.304-4.956.325-1.328.491-2.168.53-2.981.037-.806-.039-1.592-.352-2.455a10.643 10.903 0 0 0-1.384-2.54 6.973 7.144 0 0 0-1.625-1.665 5.643 5.78 0 0 0-2.044-.93 8.164 8.363 0 0 0-2.669-.135c-.88.105-1.663.376-2.846 1.107-1.175.728-2.747 1.921-3.534 2.517-.786.593-.786.593-8.643 5.673z",
  austin: "M463.201 42.551c-3.095-4.166-9.585-4.959-13.542-1.491-105.774 92.51-189.942 140.467-271.342 186.844l-1.43.818a8.79 8.79 0 0 0-4.448 7.319 8.87 8.87 0 0 0 3.861 7.726c10.004 6.86 18.037 11.893 24.491 15.937 9.44 5.913 15.39 9.643 19.06 13.81l-12.113 5.437c-1.335.598-2.524.903-3.537.903-1.238 0-2.939-.402-5.131-3.54l-4.563-6.535a13.1 13.1 0 0 0-5.448-4.483l-11.76-5.206a13.07 13.07 0 0 0-9.396-.459l-11.38 3.769c-3.1 1.023-5.339 3.555-5.99 6.772a9.12 9.12 0 0 0 2.897 8.64c6.81 5.996 14.065 10.876 21.083 15.595 7.814 5.256 15.205 10.224 20.324 15.78 1.003 1.77 5.673 10.775 4.745 22.995a9.66 9.66 0 0 1-2.139 5.317c-3.422 4.198-9.976 11.888-15.405 16.219a9.1 9.1 0 0 1-3.476 1.72c-2.734.69-8.336 1.847-15.156 1.847a58 58 0 0 1-9.102-.709c-.999-.161-2.029-.56-3.066-1.183l-47.373-28.484c-5.617-3.377-13.355-2.265-17.802 2.544l-48.214 52.06a10.69 10.69 0 0 0-2.47 10.18c1 3.624 3.746 6.404 7.344 7.44l211.465 60.794c.8.23 1.623.349 2.44.349h.004c3.202 0 6.146-1.782 7.68-4.652 1.537-2.871 1.379-6.22-.42-8.954-4.86-7.388-12.923-18.609-23.722-30.107-15.686-16.704-17.69-29.534-6.913-44.286 8.675-11.876 21.268-28.367 28.003-37.141a19.36 19.36 0 0 0 4.016-11.282l.466-15.142a19.58 19.58 0 0 1 6.562-14.018l.715-.63c7.37-6.527 10.504-16.54 8.18-26.134l-3.371-13.905c-.474-1.951-.171-4.007.844-5.789 2.62-4.578 8.053-13.095 15.02-18.7 1.572-1.26 3.69-1.957 5.968-1.957l26.805 1.295.957.022c8.28 0 15.724-5.263 18.53-13.093l8.343-23.295c1.584-4.427 5.797-7.398 10.481-7.398 1.941 0 3.789.498 5.5 1.482l7.665 4.404c3.18 1.826 7.308 1.64 10.303-.463l40.179-28.161a14.04 14.04 0 0 0 5.38-7.511L464.63 50.736c.84-2.853.317-5.836-1.428-8.185z",
  zandvoort: "M21.069 357.833c1.298-3.172 2.643-6.403 4.005-9.703 39.95-96.747 102.157-247.306 119.655-289.933 3.898-9.5 13.163-13.63 23.395-9.5 7.133 2.878 10.938 7.388 12.269 15.545 1.314 8.052-2.023 13.112-5.136 22.264-4.375 12.858-8.062 21.928-13.314 34.737-4.565 11.131-8.748 22.264-9.13 36.082-.372 13.554-.299 18.144-.57 23.607-.57 11.515-4.946 18.903-18.07 23.797-11.036 4.116-19.445 6.953-26.765 9.625-1.385.507-21.738 7.073-16.317 23.482 6.249 18.915 23.516 12.476 24.897 12.061 15.203-4.553 47.601-15.05 61.552-19.45 10.043-3.166 34.618-2.687 52.782 1.92 11.556 2.929 31.293 9.03 49.644 9.5 18.735.48 49.833-20.823 58.678-27.156 8.845-6.334 25.772-12.533 39.469-11.994 21.969.863 51.066 3.037 60.96 3.742 13.506.96 37.51 9.447 43.938 33.01 5.706 20.919-1.52 36.273-8.178 46.158-8.541 12.678-20.542 29.076-26.249 40.016-3.437 6.589-12.174 24.375-19.503 39.417-4.837 9.93-9.028 16.623-32.613 14.32-11.761-1.15-36.85-4.875-62.578-28.019-8.75-7.87-7.989-18.233-4.755-22.07 6.896-8.183 14.836-12.283 23.396-13.434 21.706-2.92 24.918-2.303 53.638-13.243 13.996-5.329 17.746-17.038 15.788-27.636-2.093-11.325-9.892-17.658-23.777-19.577-42.12-5.824-79.576-3.528-110.13 2.304-42.225 8.06-79.517 23.968-116.977 43.373-14.076 7.294-15.977-1.727-20.16-10.364-3.746-7.729-11.831-9.875-19.213-7.87-9.89 2.688-12.487 9.57-11.601 15.162 2.853 18.04 16.166 95.962 20.16 117.456 3.164 17.024-2.852 36.465-27.77 37.234-15.79.488-29.415.122-50.785-2.879-15.026-2.11-34.119-17.863-40.896-34.546-4.754-11.709-10.841-30.324.26-57.438Z",
  hungaroring: "M43.944 288.61c-5.643-4.367-2.351-17.312 7.839-17.312 8.15 0 8.783.006 21.318.468 16.93.623 38.458 9.681 48.909 17.156 10.032 7.173 47.654 36.805 68.034 52.713 7.332 5.725 18.811 4.99 24.14-.623 7.314-7.703 9.092-14.349 3.762-24.33-3.685-6.903-13.482-24.953-18.497-34.934-2.575-5.122-2.821-10.916.627-18.091 5.205-10.83 38.563-79.069 52.044-107.608 3.4-7.196 9.965-16.649 13.168-20.899 4.233-5.614 10.502-13.568 15.205-19.495 3.072-3.87 3.8-7.379 2.352-12.632-2.666-9.67-13.19-46.313-15.676-54.74-3.448-11.697-1.698-22.81 8.151-29.163 8.465-5.459 18.34-4.678 24.14-1.403 7.576 4.278 7.995 4.523 12.698 7.33s11.815 8.669 15.36 12.32c8.936 9.202 31.666 33.218 40.445 42.888 3.863 4.256 3.608 6.55.158 10.293s-7.303 6.797-5.331 14.504c2.195 8.576 11.134 42.886 13.327 49.748 2.194 6.863 7.532 11.755 15.99 12.477 10.972.936 18.807 1.737 24.14 2.34 13.794 1.559 20.064 12.426 18.497 23.08-1.881 12.788-5.745 39.62-6.896 47.254-1.881 12.477.156 20.118 6.113 29.163s14.42 21.367 20.692 30.411c5.34 7.703 7.064 22.91-.628 31.815-8.621 9.98-80.887 91.856-90.92 102.93-5.197 5.736-11.286 5.614-18.496-1.872-5.37-5.575-17.444-18.67-21.32-22.614-6.74-6.861-8.785-9.283-12.228-11.852-5.643-4.211-9.876-7.486-16.93-12.477-4.548-3.22-14.422-3.43-19.437 2.184s-5.183 17.245 1.096 22.145c7.995 6.237 33.31 26.142 40.914 32.282 10.817 8.734 11.98 23.507 4.703 32.75-7.366 9.358-20.222 16.22-37.936 2.34-10.049-7.873-228.782-180.232-239.527-188.547Z",
  singapore: "M461.432 325.308c3.546.215 6.228-.46 8.285-3.467 2.658-3.883 10.644-15.694 13.506-20.689 2.248-3.924 1.906-8.228 1.362-12.25-.547-4.022-21.779-162.674-22.394-167.042-.55-3.905-2.982-6.455-8.02-5.625-5.037.832-10.535.682-15.509-2.08-5.826-3.236-7.566-5.548-9.382-9.324-2.012-4.185-5.031-6.738-7.791-6.78-4.919-.079-7.416 3.389-7.87 6.78-.944 7.05-1.516 14.7-1.89 19.263-.454 5.547.59 16.212 1.816 20.65s6.726 21.596 9.38 32.207c2.657 10.608 5.068 21.644 6.355 28.2 1.816 9.246-5.447 26.66-19.82 25.58-16.56-1.243-96.96-6.878-104.994-7.571-7.76-.67-17.023-1.387-24.511-4.784-9.874-4.479-92.876-54.296-99.618-58.388-4.267-2.589-5.307-2.724-7.762 1.528-11.374 19.692-20.682 35.827-31.12 56.305-1.838 3.606-3.541 4.266-6.334 1.284-4.19-4.477-26.419-27.808-32.683-34.534-5.78-6.204-20.57-6.21-25.67 4.612-6.504 13.799-56.755 104.28-59.206 108.974-1.382 2.644-2.983 6.481-2.427 10.392.47 3.318 2.756 6.781 5.287 8.641 3.575 2.63 8.469 6.402 12.552 9.457 2.35 1.759 5.615 2.859 10.003 3.783 3.281.692 4.549 2.145 4.69 10.942.077 4.74.304 10.324.304 14.178 0 5.64 3.442 6.28 6.278 8.59 8.916 7.264 16.457 13.176 21.79 17.106 1.07.79 6.672 4.662 8.285 7.396 3.404 5.78 5.447 8.784 7.15 11.096 2.722 3.694 7.75 2.688 8.625-2.08 1.93-10.519 14.526-87.49 17.477-105.29.646-3.9 2.514-10.388 3.065-11.788.098-.25 17.789-43.744 18.355-45.218.646-1.68 1.17-2.659 1.277-2.918 1.153-2.766 3.802-3.986 7.49-.75 5.372 4.713 45.155 39.55 51.182 44.959 5.529 4.963 13.647 8.282 20.848 8.815 2.986.222 39.063 1.437 74.063 3.358 33.248 1.827 65.538 4.368 67.03 4.47 3.065.208 6.169 2.43 6.129 6.819-.115 12.367 4.653 19.533 14.98 20.457 5.903.526 74.874 4.459 79.437 4.736z",
  baku: "M461.985 52.498 427.394 15.65c-3.674-3.909-10.434-4.21-14.453-.63l-98.434 87.727a83 83 0 0 0-3.262 3.058l-55.24 54.7a9.213 9.213 0 0 0-.242 12.906l15.572 16.582-18.27 16.566c-1.063.881-26.136 21.765-34.667 38.79-1.974 3.93-1.146 8.64 2.045 11.714a45 45 0 0 0 3.35 2.958l-47.098 75.377-25.425-30.368c-2.763-3.263-7.588-4.394-11.524-2.719l-1.804.803c-2.22 1.013-2.73 1.288-4.08.951-2.582-.609-5.4-.148-7.242.28-.68.16-1.322.31-1.7.31-.625 0-1.793-1.194-2.133-1.56l-5.74-6.115c-3.477-3.693-9.843-4.013-13.653-.684-17.545 15.244-59.138 52.416-66.486 68.325-.838 1.81-1.326 3.803-1.441 5.926-.165 2.864-.658 12.69-.324 18.97.104 1.86.143 4.261.192 6.916.137 7.976.312 17.902 2.127 24.071 2.254 7.65 4.863 14.312 8.728 22.269 2.402 4.961 6.448 14.454 9.42 21.538.674 1.617.992 3.316.943 5.054l-.066 2.435c-.137 4.865 3.625 8.98 8.57 9.368l83.663 6.508.89.034c5.8 0 10.735-4.45 11.223-10.126.844-9.697 2.604-27.435 4.88-37.27a16 16 0 0 1 1.37-3.752l21.86-42.87c4.546-8.921 8.845-17.35 6.41-28.585l-.164-.776c-1.294-5.958-.203-12.09 3.07-17.266l45.974-72.76a11 11 0 0 1 1.848-2.208L461.399 68.564c4.633-4.27 4.896-11.48.586-16.066z",
  miami: "M253.178 217.953s37.841 21.485 43.997 24.88c6.096 3.396 9.778 7.26 9.597 9.835-.182 2.518-2.777 5.913-5.613 7.61-2.777 1.698-7.665 4.04-9.596 6.616-1.932 2.517-3.501 4.566-3.682 11.006s-.181 11.532-1.57 15.396c-1.146 3.161-5.25 10.479-19.312 15.22-13.64 4.567-17.925 3.513-29.211 3.22-10.441-.292-20.762-5.912-20.762-5.912s-53.774-29.622-58.965-32.49c-5.25-2.87-13.64-4.391-20.4-2.87-7 1.523-8.81 2.928-12.734 5.738-3.259 2.342-8.027 5.913-12.553 6.44-4.527.526-10.2.234-14.666-1.698-4.044-1.756-9.415-7.142-12.01-9.835s-8.148-6.264-16.054-6.44c-6.458-.175-20.64 1.347-28.789 10.713-3.38 3.864-5.854 6.85-5.854 14.284 0 5.503 5.19 12.88 10.2 12.938 10.2.176 7.725-1.288 15.51-1.522 9.597-.293 13.64.702 19.012 2.693 5.371 1.99 20.218 5.503 28.124 5.561 10.502.117 73.692-1.17 77.856-1.17 10.38-.06 18.83 2.048 25.107 4.741s19.192 8.606 24.443 10.128c5.25 1.522 14.666 5.093 28.97 4.917 14.303-.175 39.953-1.697 54.438-6.79 14.485-5.094 60.051-20.139 72.967-25.583s39.29-18.03 44.661-21.485c3.38-2.166 5.432-3.395 5.613-6.44.181-3.043-4.888-6.439-7.484-7.61-2.595-1.17-4.466-1.931-7.664-4.566-3.5-2.868-5.13-6.146-5.13-9.717 0-6.616 4.526-11.475 10.018-11.65 3.5-.117 14.183.175 17.14-.351 2.958-.527 7.303-2.05 9.597-5.562s4.949-8.722 5.794-10.01c1.448-2.166 1.026-3.396-1.57-4.567-2.595-1.17-4.043-3.044-2.776-6.615 1.268-3.57 3.742-13.347 4.225-15.923.422-2.4-.181-5.561-3.863-5.561-4.707 0-118.654-4.215-132.777-4.567-14.364-.234-209.968-7.61-232.963-8.898-7.242-.41-8.932 3.805-8.45 5.971.906 4.04 11.166 10.655 17.443 14.226 6.276 3.57 8.57 4.39 16.054 4.742 7.483.35 11.89-1.698 16.054-4.215s12.734-7.26 22.873-9.484c7.182-1.58 20.4-1.288 25.47-.527 7.181 1.112 14.303 4.04 20.76 7.61 6.459 3.572 48.525 27.573 48.525 27.573z",
  las_vegas: "M44.554 308.699c5.621 2.881 52.896 30.75 61.836 35.774 7.261 4.082 18.085 9.124 31.856 14.165 21.976 8.045 37.495 12.32 56.449 15.126 21.08 3.122 32.091 4.52 44.738 5.282 7.963.48 26.891.171 58.557.96 57.855 1.441 148.06 2.882 150.61 2.882 1.873 0 3.123-.801 3.279-4.322.19-4.316 1.534-7.813 4.216-10.564 2.681-2.75 7.964-8.563 7.964-11.284 0-8.248.702-133.012.937-151.02.148-11.395-2.811-30.251-16.865-41.536-7.364-5.914-39.35-33.613-46.612-40.575-3.316-3.18-9.106-1.364-11.711 2.64-4.685 7.203-4.758 15.367 6.324 27.131 6.559 6.963 12.184 12.623 7.73 23.53-4.216 10.323-13.351 20.648-37.711 20.648-13.743 0-151.305.48-159.745.48-3.747 0-9.135-5.509-9.135-9.364 0-4.162-.234-19.048-.234-31.212 0-13.605-11.009-40.096-35.368-40.096-4.222 0-9.37-1.2-9.135 4.562.331 8.16-5.856 9.844-11.712 7.203-4.23-1.908-8.891-4.78-11.946-6.723-6.075-3.864-10.956 2.726-11.243 12.965-.61 21.762-2.012 52.195-2.576 64.345-1.171 25.21-10.557 39.821-32.09 44.658-24.09 5.41-34.476 14.223-40.025 26.134-4.714 10.12-6.23 20.945-7.742 29.763-1.655 9.648 7.227 7.357 9.354 8.448z",
  lusail: "M236.125 403.485c-49.465.116-97.022-1.042-143.961-1.175-27.707-.08-30.999-30.373-15.683-38.579 17.206-9.218 33.39-17.045 50.186-26.716 12.614-7.262 13.608-27.13-1.947-34.945-16.459-8.268-26.63-13.663-42.507-22.548-3.873-2.168-8.985-7.91-10.491-12.076-12.827-35.478-23.44-68.035-35.585-103.98-3.702-10.956 1.518-21.052 13.844-25.22 9.487-3.208 13.703-4.766 23.904-8.015 9.142-2.911 20.726 4.671 24.552 14.427 8 20.4 13.693 40.66 20.334 60.806 1.516 4.598 7.909 10.341 11.79 10.26 3.072-.065 8.963-2.794 9.518-6.52 4.844-32.513 9.567-65.009 13.736-97.46.85-6.612 7.809-11.83 12.655-13.893 4.528-1.927 11.25-.997 15.575 1.07 4.327 2.066 8.537 6.56 10.383 11.327 2.624 6.775 2.43 14.55 5.192 21.373 3.583 8.851 7.929 17.972 14.601 25.006 4.586 4.834 12.624 9.915 17.721 15.764 3.11 3.568 9.362 10.18 6.94 18.433-2.863 9.753-9.637 28.902-13.953 49.158-1.074 5.04 1.888 11.502 5.84 14.106 4.7 3.096 13.672 2.909 19.686 1.175 11.291-3.253 22.9-7.598 33.097-14.213 8.694-5.639 15.922-12.71 22.93-20.304 5.4-5.851 10.208-12.61 13.628-19.877 9.992-21.23 17.942-43.035 26.824-64.974 2.655-6.558 7.221-14.892 12.979-18.274 3.493-2.051 10.342-5.11 14.277-5.13 15.977-.074 24.919-.183 41.1.108 4.17.075 11.806 4.707 13.737 8.335 8.55 16.064 16.042 28.883 25.093 44.242 2.441 4.142 2.662 13.613-1.19 18.06-19.19 22.164-33.343 39.55-53.214 61.448-5.667 6.244-9.242 17.372-4.76 24.151 23.111 34.955 42.192 67.636 68.574 103.125 8.857 11.914-.043 29.737-14.818 29.815-71.385.376-138.336 1.54-210.587 1.71z",
  yas_marina: "M191.25 155.874c16.09-47.466 35.643-104.64 45.341-132.916 2.862-8.345 16.92-14.272 19.337 4.301.344 2.64 2.21 16.484 2.667 19.807.833 6.081 4.058 31.57 5.334 42.735 1.334 11.67 1.167 23.34-.5 33.86-1.667 10.518-9.31 24.94-7.835 36.817.834 6.709 4.324 14.567 10.169 20.217 8.502 8.218 20.67 11.012 32.006 13.807 6.968 1.717 10.335 6.448 12.669 15.121 2.167 8.054 9.755 36.794 11.668 44.05 2.168 8.219-2.5 13.314-11.502 14.793-6.325 1.04-117.854 16.437-135.857 18.902-6.412.879-10.94 7.925-6.168 16.765 5.5 10.191 16.503 29.915 19.837 35.997 2.768 5.05 5.146 7.249 14.169 6.081 10.168-1.315 40.34-4.767 49.342-6.081s17.17-.33 22.004.821c4.349 1.035 3.334 3.945 3.334 7.232s-.167 14.136-.333 20.71c-.135 5.27-1.175 6.879-6.001 7.397-7.668.822-16.17 1.644-23.005 2.137-3.155.227-5.5 1.479-4.167 6.739s5.668 23.01 6.334 25.97c.667 2.958 4.041 7.168 6.668 8.875 7.335 4.767 19.17 12.492 25.672 16.437 2.539 1.54 7.005 2.056 12.502 2.22 11.169.328 28.622 1.242 43.008 2.136 19.837 1.234 25.422 12.903 24.17 27.696-.498 5.906-6.167 12.82-9.39 15.232-1.86 1.392-10.629 1.589-13.453.32-14.756-6.629-45.618-20.811-56.67-25.96-5.264-2.453-23.389-13.853-30.34-19.177-11.946-9.151-49.07-39.375-59.844-48.16-8.668-7.067-13.909-12.658-20.337-24.326-7.334-13.313-11.335-26.627-14.002-39.94-.85-4.244-2.487-4.304-5.168-4.11-4.5.33-7.324.795-10.835.987-3 .164-5.461-.586-3.834-5.425 4.914-14.624 28.362-89.355 53.01-162.067z",
  imola: "M222.355 140.412c-10.948 0-50.08 3.335-75.832 10.418-2.436.674-9.327 1.044-9.527 8.755-.281 10.657-7.589 13.34-11.151 15.004-4.183 1.954-10.747 5.211-17.234 8.129-4.246 1.91-7.608 8.735-8.924 12.086-3.695 9.436-22.022 57.214-35.707 92.935-2.363 6.17-1.906 8.558-.559 12.752.836 2.597 1.51 5.115 2.282 8.05 1.293 4.923.838 6.956-2.509 10.002-8.105 7.385-18.655 16.727-23.113 20.686-7.98 7.085-16.22 13.753-21.492 18.34-5.947 5.17-4.867 18.757 7.705 17.296 12.57-1.462 72.181-9.795 77.451-10.42 5.27-.624 10.866-.711 20.884.627 10.95 1.46 23.317 4.169 34.468 6.668 8.014 1.798 14.193-1.878 17.64-8.752 3.032-6.052 8.312-17.925 9.933-23.134 1.291-4.142 2.635-12.713-.202-25.216-1.344-5.922-6.466-26.652-8.438-36.44-.194-.957-1.947-7.41.43-11.075 4.258-6.565 9.12-13.805 12.47-18.913 1.572-2.396 4.439-2.881 7.451-1.408 2.13 1.044 3.65 1.878 6.387 3.282 1.948 1.002 4.546 1.696 8.667 1.77 5.527.106 10.535.054 12.976.054 24.441 0 59.398-.146 90.833-.805 3.055-.063 5.474.805 6.286 4.765.806 3.936 5.255 2.598 7.908 1.458 17.436-7.503 36.03-15.708 38.162-16.793 18.874-9.618 28.825-19.343 35.033-25.722 8.713-8.96 14.801-14.796 31.021-31.26 3.677-3.735 6.967-6.701 11.757-8.962 12.37-5.833 17.232-7.919 30.21-13.337 7.191-3.003 8.9-6.12 6.285-12.503-1.623-3.96-3.713-8.819-7.502-17.09-3.245-7.087-8.947-7.242-11.99-5.994-1.042.431-2.674 1.009-5.49 2.123-15.168 6.009-52.048 20.27-67.272 25.545-1.925.666-8.925 1.874-14.977 1.874h-31.048c-3.374 0-27.118.235-33.276.235-5.191 0-10.675-1.138-13.812-1.838-13.23-2.956-28.412-6.349-38.677-8.819-9.057-2.175-22.702-4.373-37.507-4.373z",
  spielberg: "m460.715 363.195-2.743-3.298a30.76 30.76 0 0 0-12.787-9.099c-28.347-10.668-144.043-54.216-165.073-62.172-13.48-5.1-22.998-7.179-32.852-7.179-5.879 0-11.594.738-18.21 1.596l-2.824.363c-8.696 1.11-20.316 6.554-34.534 16.184-8.62 5.83-20.474 5.84-29.11.021a29.4 29.4 0 0 1-12.78-20.936l-7.272-61.646c-1.018-8.633 2.157-17.355 8.487-23.334l1.86-1.755c8.862-8.359 22.983-10.006 33.548-3.884 19.288 11.183 45.635 26.677 61.63 36.976 8.58 5.526 18.928 8.327 30.755 8.327 15.27 0 30.606-4.538 42.93-8.186l4.69-1.375c4.92-1.426 10.12-3.745 15.456-6.902 7.347-4.344 11.499-12.308 10.835-20.784s-6.007-15.705-13.948-18.86c-23.266-9.244-52.174-22.847-67.334-30.133a141 141 0 0 1-18.173-10.464C231.21 121.637 175.9 87.962 144.892 69.226a249.5 249.5 0 0 0-42.344-20.384C85.92 42.69 66.59 36.02 53.302 31.505c-6-2.038-12.657.313-16.084 5.56-2.551 3.899-2.942 8.787-1.045 13.07l29.974 67.736a185.7 185.7 0 0 1 15.662 64.962c.59 10.464 1.068 21.278 1.45 31.462a620 620 0 0 0 12.985 104.718l21.938 103.591c2.045 9.648 10.025 16.85 19.858 17.92l259.13 28.244c1.606.175 3.22.303 4.833.359a185 185 0 0 0 6.026.102c18.269 0 30.411-2.982 37.379-5.485 7.615-2.736 12.981-9.75 13.67-17.87l5.856-69.273a18.42 18.42 0 0 0-4.22-13.406z",
  shanghai: "M457.499 211.881c-5.788-8.465-14.832-13.126-25.467-13.126-10.565 0-22.335 4.768-28.618 11.593-2.966 3.22-4.412 6.674-4.192 9.985.385 5.707 4.117 12.018 11.09 18.76.58.558.56 1.21.496 1.55a1.62 1.62 0 0 1-1 1.235l-140.705 57.863c-3.676 1.504-8.039.824-11.115-1.713-4.917-4.05-10.074-8.995-15.331-14.696-1.851-2.015-1.47-4.279-1.22-5.16.254-.895 1.135-3.054 3.816-3.772 1.58-.422 3.201-.827 4.852-1.244 8.74-2.195 18.644-4.684 29.538-10.987 22.33-12.915 15.017-35.707 12.47-43.641-2.565-8.031-8.343-11.919-20.999-20.44l-6.193-4.156c-12.215-8.138-20.289-13.514-23.636-30.018-3.506-17.247 4.767-35.443 19.25-42.328 6.662-3.166 15.551-6.414 25.846-10.175 14.561-5.315 31.059-11.342 48.502-19.655 19.148-9.13 26.922-20.15 30.073-27.79a10.34 10.34 0 0 0-.9-9.615c-2.066-3.143-5.663-4.876-9.414-4.455-16.252 1.816-51.748 7.028-71.462 9.974a58.3 58.3 0 0 0-21.005 7.422c-20.09 11.804-62.168 38.651-79.331 49.643-3.812 2.446-8.639 2.984-12.89 1.413-4.633-1.708-8.56-3.524-11.661-5.395-3.042-1.84-4.912-4.103-5.412-6.544-.44-2.156.19-4.564 1.77-6.777.956-1.343 1.741-1.454 2.402-1.454 2.13 0 4.972 1.74 6.193 2.484l.6.376c2.736 1.712 7.823 4.9 13.641 4.897 4.152 0 9.95-1.642 14.011-9.46 3.332-6.412 3.271-14.022-.16-20.878-4.662-9.314-14.606-15.945-26.607-17.741-11.655-1.741-24.816 3.435-33.865 13.268-6.828 7.414-10.415 16.494-9.85 24.905l18.634 276.007a1.82 1.82 0 0 1-1.02 1.758l-85.62 40.82-1.245.837c-4.492 4.09-9.61 10.604-15.212 19.359-1.99 3.103-2.15 6.881-.425 10.109 1.731 3.235 5.022 5.245 8.584 5.245 1.336 0 2.651-.28 3.912-.83 61.903-27.052 371.598-162.394 389.161-170.146 11.926-5.263 21.7-16.983 25.512-30.587 3.62-12.923 1.56-25.963-5.798-36.72z",
  barcelona: "M436.09 105.316c-11.496 18.032-213.437 339.032-220.733 350.704-6.656 10.65-17.427 12.344-24.445 7.624-6.155-4.14-7.935-5.411-11.658-7.585-3.59-2.097-14.448-4.739-24.849 2.904-10.811 7.948-17.856 13.285-28.116 20.533-15.249 10.77-45.437 5.85-57.241-10.287-15.49-21.177-16.04-55.243.243-81.808 9.197-15.004 45.986-73.94 51.553-82.048 6.839-9.961 17.184-12.223 29.044-6.455 16.679 8.111 18.514 37.238 11.375 48.81-7.988 12.948-36.407 59.453-39.815 65.348-8.956 15.49 5.28 27.61 18.998 21.178 7.745-3.632 43.566-20.937 50.1-24.204 12.586-6.292 19.247-13.666 26.464-21.096 5.486-5.647 22.675-32.663 27.148-39.531 3.388-5.204 2.783-15.49-5.084-20.574-5.388-3.482-9.197-5.687-12.061-7.664-2.637-1.82-7.983-5.663-12.264-15.45-3.388-7.745-25.17-59.177-28.316-67.406-3.98-10.41-1.676-24.194 7.503-34.127 1.917-2.074 7.728-6.638 17.105-11.296 23.397-11.617 72.137-36.55 78.499-39.774 10.155-5.149 61.318-32.028 86.434-45.203 3.296-1.728 6.809-4.904 8.925-8.711 1.8-3.243 1.889-10.257-3.74-15.182-12.322-10.782-26.568-9.388-36.378-6.747-7.628 2.054-11.725 4.671-16.092 8.181-3.904 3.139-7.62 6.124-12.647 10.18-4.182 3.374-21.542 4.84-28.924-5.325-7.752-10.674-7.48-23.381 2.54-31.829 9.238-7.785 38.362-32.07 46.713-38.846 3.286-2.667 16.224-6.485 24.993-4.126 8.917 2.647 16.077 6.158 24.31 11.174 11.264 8.52 6.556 4.618 17.915 11.996 9.637 6.263 18.666 12.172 23.827 15.606 11.941 7.955 23.257 28.164 8.674 51.036z",
  montreal: "M223.071 47.18c-2.536-11.336-4.35-19.461-5.519-25.208-.965-4.748 1.315-6.378 3.73-6.861 2.237-.448 4.69 1.63 5.07 6.115.597 7.01 1.045 10.441 1.641 16.11.352 3.346 1.416 7.836 4.624 14.468 2.238 4.624 6.862 13.871 12.679 28.638 2.265 5.75 12.827 32.666 15.512 39.676 1.843 4.812 4.475 14.32 5.52 20.137 1.043 5.817 24.312 118.88 31.173 151.843 1.025 4.926-1.742 6.349-2.983 7.01-2.237 1.194-3.729 2.686-2.834 7.757s18.197 84.722 19.39 90.39 3.282 16.259 2.835 27.744c-.355 9.096-1.936 29.235-2.387 33.411-.596 5.52-.596 7.16 2.387 8.353s4.039 1.614 6.861 2.834c11.038 4.773 2.983 17.004-4.773 15.065-8.494-2.123-13.458-3.632-23.269-7.16-13.275-4.772-33.56-23.865-41.764-31.92-3.538-3.473-2.834-7.606-1.044-10.888s1.26-5.254-1.343-9.397c-3.281-5.22-12.411-17.275-15.512-20.136-3.878-3.58-7.56-5.592-11.187-7.906-7.01-4.475-12.53-14.02-12.53-23.268 0-7.017.597-31.622.746-36.544.15-4.923-1.496-8.826-6.264-9.1-5.22-.297-10.143 3.58-14.916.3-4.773-3.282-7.866-5.35-9.696-15.662-3.281-18.496-5.518-40.273-5.37-52.206.127-10.143 1.776-35.995 4.923-50.416 1.79-8.203 8.502-34.455 10.143-39.527 1.133-3.505 3.878-4.624 7.458-4.325 5.37.447 10.292-2.983 12.827-11.635 2.974-10.145 9.546-34.754 10.441-41.167.924-6.623 5.074-31.195 5.221-40.72.15-9.696-.1-18.247-1.79-25.805z",
  mexico_city: "M68.115 74.569c20.465 2.901 314.544 46.249 376.858 55.798 3.924.6 15.237 2.752 23.971 4.728 2.288.518 3.041 4.923 2.867 8.43-.259 5.27-.8 13.839-1.432 22.789-.391 5.532-.13 5.927 4.303 7.245 1.817.539 3.416.948 5.867 1.58 3.11.803 4.726 2.649 4.434 5.533-.652 6.454-1.302 9.35-2.085 12.514-.653 2.634-4.638 9.707-5.115 10.52-14.661 24.978-76.417 129.197-82.64 138.987-5.007 7.877-7.396 11.41-11.93 18.376-4.89 7.507-5.282 16.202 2.542 18.772 7.059 2.316 8.243 2.674 11.344 3.753 6.26 2.174 7.353 3.848 7.236 8.102-.19 6.925-2.15 7.506-8.018 11.261-3.145 2.013-17.624 10.48-35.597 21.538-3.6 2.213-7.043 2.173-10.173-2.172-1.702-2.363-1.732-7.806-.979-12.054 5.477-30.824 15.062-81.406 18.973-100.175 2.626-12.597-6.455-18.574-21.711-21.143-8.476-1.428-15.164-7.935-17.798-15.412-4.106-11.657-9.395-18.187-21.515-18.771-8.215-.396-18.571-1.037-29.73-1.384-12.714-.396-21.32-6.125-22.297-17.19-.292-3.298-1.019-12.145-1.37-15.806-.586-6.127-.59-7.897-8.606-11.46-9.78-4.347-25.232-10.275-43.42-16.796-4.432-1.588-6.016-2.568-17.621-4.201-27.061-3.808-73.36-10.324-102.563-14.599-5.872-.859-4.278-1.88-4.278-6.755 0-3.28.13-26.213.391-37.014.1-4.126.193-7.575.064-11.329-.194-5.73-9.658-5.764-11.539-2.174-1.76 3.36-3.47 6.48-4.5 7.707-4.302 5.137-8.017 4.742-15.255.989-8.029-4.165-14.003-3.877-17.798-4.149-3.119-.225-6.454-.198-9.78-.395-3.385-.202-4.553-2.229-4.108-5.73 2.735-21.49 22.76-44.2 53.008-39.913z"
};

const TRACK_CORNERS = {
  silverstone: [
    { name: "Abbey", id: "01", percent: 0.06 },
    { name: "Farm", id: "02", percent: 0.11 },
    { name: "Village", id: "03", percent: 0.16 },
    { name: "Brooklands", id: "06", percent: 0.31 },
    { name: "Copse", id: "09", percent: 0.52 },
    { name: "Maggots", id: "10", percent: 0.58 },
    { name: "Becketts", id: "11", percent: 0.62 },
    { name: "Stowe", id: "13", percent: 0.79 },
    { name: "Club", id: "15", percent: 0.88 },
  ],
  monza: [
    { name: "Prima Var", id: "01", percent: 0.08 },
    { name: "Variante Roggia", id: "04", percent: 0.35 },
    { name: "Lesmo 1", id: "06", percent: 0.48 },
    { name: "Lesmo 2", id: "07", percent: 0.54 },
    { name: "Variante Ascari", id: "09", percent: 0.75 },
    { name: "Parabolica", id: "11", percent: 0.90 },
  ],
  monaco: [
    { name: "Sainte Devote", id: "01", percent: 0.07 },
    { name: "Casino", id: "04", percent: 0.28 },
    { name: "Hairpin", id: "06", percent: 0.42 },
    { name: "Tunnel", id: "10", percent: 0.60 },
    { name: "Tabac", id: "15", percent: 0.78 },
    { name: "Rascasse", id: "19", percent: 0.92 },
  ],
  spa: [
    { name: "La Source", id: "01", percent: 0.05 },
    { name: "Eau Rouge", id: "03", percent: 0.15 },
    { name: "Les Combes", id: "05", percent: 0.30 },
    { name: "Malmedy", id: "07", percent: 0.44 },
    { name: "Stavelot", id: "10", percent: 0.60 },
    { name: "Blanchimont", id: "14", percent: 0.78 },
    { name: "Bus Stop", id: "17", percent: 0.92 },
  ],
  bahrain: [
    { name: "Turn 1", id: "01", percent: 0.10 },
    { name: "Turn 4", id: "04", percent: 0.25 },
    { name: "Turn 8", id: "08", percent: 0.50 },
    { name: "Turn 11", id: "11", percent: 0.66 },
    { name: "Turn 14", id: "14", percent: 0.82 },
  ],
  melbourne: [
    { name: "Turn 1", id: "01", percent: 0.08 },
    { name: "Turn 3", id: "03", percent: 0.20 },
    { name: "Turn 6", id: "06", percent: 0.38 },
    { name: "Turn 9", id: "09", percent: 0.55 },
    { name: "Turn 13", id: "13", percent: 0.75 },
  ],
  suzuka: [
    { name: "Turn 1", id: "01", percent: 0.05 },
    { name: "Esses", id: "03", percent: 0.18 },
    { name: "Hairpin", id: "07", percent: 0.40 },
    { name: "130R", id: "13", percent: 0.72 },
    { name: "Chicane", id: "16", percent: 0.88 },
  ],
  singapore: [
    { name: "Turn 1", id: "01", percent: 0.06 },
    { name: "Turn 5", id: "05", percent: 0.22 },
    { name: "Rasberry", id: "10", percent: 0.44 },
    { name: "Turn 16", id: "16", percent: 0.65 },
    { name: "Turn 20", id: "20", percent: 0.85 },
  ],
  baku: [
    { name: "Turn 1", id: "01", percent: 0.05 },
    { name: "Turn 3", id: "03", percent: 0.18 },
    { name: "Castle", id: "08", percent: 0.42 },
    { name: "Turn 15", id: "15", percent: 0.70 },
    { name: "Turn 20", id: "20", percent: 0.90 },
  ],
  jeddah: [
    { name: "Turn 1", id: "01", percent: 0.06 },
    { name: "Turn 7", id: "07", percent: 0.25 },
    { name: "Turn 13", id: "13", percent: 0.50 },
    { name: "Turn 20", id: "20", percent: 0.75 },
    { name: "Turn 27", id: "27", percent: 0.92 },
  ],
  austin: [
    { name: "Turn 1", id: "01", percent: 0.06 },
    { name: "Turn 3", id: "03", percent: 0.18 },
    { name: "Turn 8", id: "08", percent: 0.38 },
    { name: "Turn 12", id: "12", percent: 0.60 },
    { name: "Turn 16", id: "16", percent: 0.80 },
  ],
  interlagos: [
    { name: "Senna S", id: "01", percent: 0.06 },
    { name: "Curva 1", id: "03", percent: 0.22 },
    { name: "Ferradura", id: "07", percent: 0.46 },
    { name: "Pinheirinho", id: "11", percent: 0.68 },
    { name: "Bico de Pato", id: "14", percent: 0.88 },
  ],
  hungaroring: [
    { name: "Turn 1", id: "01", percent: 0.05 },
    { name: "Turn 3", id: "03", percent: 0.20 },
    { name: "Turn 6", id: "06", percent: 0.40 },
    { name: "Turn 10", id: "10", percent: 0.65 },
    { name: "Turn 14", id: "14", percent: 0.88 },
  ],
  zandvoort: [
    { name: "Tarzan", id: "01", percent: 0.06 },
    { name: "Hugenholtzbocht", id: "03", percent: 0.28 },
    { name: "Scheivlak", id: "07", percent: 0.50 },
    { name: "Panoramabocht", id: "10", percent: 0.72 },
    { name: "Arie Luyendyk", id: "13", percent: 0.90 },
  ],
  miami: [
    { name: "Turn 1", id: "01", percent: 0.05 },
    { name: "Turn 4", id: "04", percent: 0.22 },
    { name: "Turn 8", id: "08", percent: 0.44 },
    { name: "Turn 13", id: "13", percent: 0.66 },
    { name: "Turn 17", id: "17", percent: 0.85 },
  ],
  las_vegas: [
    { name: "Turn 1", id: "01", percent: 0.06 },
    { name: "Turn 4", id: "04", percent: 0.28 },
    { name: "Turn 9", id: "09", percent: 0.54 },
    { name: "Turn 13", id: "13", percent: 0.78 },
  ],
  lusail: [
    { name: "Turn 1", id: "01", percent: 0.06 },
    { name: "Turn 4", id: "04", percent: 0.22 },
    { name: "Turn 8", id: "08", percent: 0.45 },
    { name: "Turn 12", id: "12", percent: 0.68 },
    { name: "Turn 16", id: "16", percent: 0.88 },
  ],
  yas_marina: [
    { name: "Turn 1", id: "01", percent: 0.06 },
    { name: "Turn 5", id: "05", percent: 0.25 },
    { name: "Turn 9", id: "09", percent: 0.50 },
    { name: "Turn 12", id: "12", percent: 0.70 },
    { name: "Turn 16", id: "16", percent: 0.90 },
  ],
  imola: [
    { name: "Tamburello", id: "01", percent: 0.06 },
    { name: "Villeneuve", id: "03", percent: 0.22 },
    { name: "Tosa", id: "05", percent: 0.38 },
    { name: "Acque Minerali", id: "07", percent: 0.55 },
    { name: "Rivazza", id: "15", percent: 0.85 },
  ],
  spielberg: [
    { name: "Turn 1", id: "01", percent: 0.06 },
    { name: "Turn 3", id: "03", percent: 0.22 },
    { name: "Turn 5", id: "05", percent: 0.42 },
    { name: "Turn 7", id: "07", percent: 0.62 },
    { name: "Turn 10", id: "10", percent: 0.85 },
  ],
  shanghai: [
    { name: "Turn 1", id: "01", percent: 0.06 },
    { name: "Turn 3", id: "03", percent: 0.22 },
    { name: "Turn 6", id: "06", percent: 0.42 },
    { name: "Turn 11", id: "11", percent: 0.65 },
    { name: "Turn 14", id: "14", percent: 0.85 },
  ],
  barcelona: [
    { name: "Turn 1", id: "01", percent: 0.06 },
    { name: "Turn 3", id: "03", percent: 0.20 },
    { name: "Turn 5", id: "05", percent: 0.38 },
    { name: "Turn 10", id: "10", percent: 0.65 },
    { name: "Turn 14", id: "14", percent: 0.88 },
  ],
  montreal: [
    { name: "Turn 1", id: "01", percent: 0.06 },
    { name: "Turn 3", id: "03", percent: 0.22 },
    { name: "Hairpin", id: "06", percent: 0.42 },
    { name: "Turn 10", id: "10", percent: 0.65 },
    { name: "Chicane", id: "13", percent: 0.88 },
  ],
  mexico_city: [
    { name: "Turn 1", id: "01", percent: 0.06 },
    { name: "Turn 4", id: "04", percent: 0.22 },
    { name: "Peraltada", id: "13", percent: 0.62 },
    { name: "Turn 16", id: "16", percent: 0.82 },
  ],
};

const TRACK_LAPS = {
  silverstone: 52,
  monza: 53,
  monaco: 78,
  spa: 44,
  bahrain: 57,
  melbourne: 58,
  suzuka: 53,
  singapore: 61,
  baku: 51,
  jeddah: 50,
  austin: 56,
  interlagos: 71,
  hungaroring: 70,
  zandvoort: 72,
  miami: 57,
  las_vegas: 50,
  lusail: 57,
  yas_marina: 58,
  imola: 63,
  spielberg: 71,
  shanghai: 56,
  barcelona: 66,
  montreal: 70,
  mexico_city: 71,
};

function isDrsActiveAtPercent(percent, trackType) {
  const drsZones = {
    silverstone:  [[0.26, 0.32], [0.70, 0.77]],
    monza:        [[0.00, 0.05], [0.14, 0.22], [0.92, 1.00]],
    monaco:       [[0.95, 1.00], [0.00, 0.04]],
    spa:          [[0.02, 0.18], [0.62, 0.72]],
    bahrain:      [[0.03, 0.13], [0.40, 0.50], [0.62, 0.70]],
    melbourne:    [[0.05, 0.15], [0.56, 0.64], [0.72, 0.80], [0.90, 0.97]],
    suzuka:       [[0.88, 1.00], [0.00, 0.05]],
    singapore:    [[0.02, 0.12], [0.42, 0.50], [0.80, 0.90]],
    baku:         [[0.02, 0.16], [0.60, 0.72]],
    jeddah:       [[0.00, 0.08], [0.42, 0.52], [0.74, 0.84]],
    austin:       [[0.04, 0.14], [0.58, 0.68]],
    interlagos:   [[0.03, 0.13], [0.68, 0.78]],
    hungaroring:  [[0.04, 0.14]],
    zandvoort:    [[0.03, 0.13], [0.58, 0.66]],
    miami:        [[0.05, 0.15], [0.42, 0.52], [0.72, 0.80]],
    las_vegas:    [[0.05, 0.20], [0.62, 0.78]],
    lusail:       [[0.04, 0.14], [0.60, 0.70]],
    yas_marina:   [[0.05, 0.15], [0.58, 0.68]],
    imola:        [[0.04, 0.14], [0.72, 0.82]],
    spielberg:    [[0.04, 0.15], [0.52, 0.60], [0.82, 0.92]],
    shanghai:     [[0.05, 0.15], [0.60, 0.72]],
    barcelona:    [[0.03, 0.13], [0.66, 0.74]],
    montreal:     [[0.04, 0.16], [0.56, 0.64], [0.82, 0.92]],
    mexico_city:  [[0.04, 0.16], [0.52, 0.62], [0.78, 0.88]],
  };
  const zones = drsZones[trackType] || [];
  return zones.some(([start, end]) => percent >= start && percent <= end);
}

function getTelemetryAtPercent(percent, driverCode, trackType) {
  const corners = TRACK_CORNERS[trackType] || [];
  let minDist = 1.0;
  for (const corner of corners) {
    let dist = Math.abs(percent - corner.percent);
    if (dist > 0.5) dist = 1.0 - dist;
    if (dist < minDist) {
      minDist = dist;
    }
  }

  const isCorner = minDist < 0.06;
  const cornerFactor = isCorner ? (0.06 - minDist) / 0.06 : 0;

  const hash = driverCode.charCodeAt(0) + (driverCode.charCodeAt(1) || 0);
  const driverSpeedOffset = (hash % 12) - 6;
  const driverBrakeOffset = (hash % 4) * 6;

  const isDrs = isDrsActiveAtPercent(percent, trackType);

  let speed, throttle, braking, gear, rpm;

  if (isCorner) {
    speed = 85 + (1 - cornerFactor) * 115 + driverSpeedOffset;
    throttle = (1 - cornerFactor) * 25;
    braking = cornerFactor * 90 + driverBrakeOffset * 0.4;
    gear = Math.max(2, Math.floor(6 - cornerFactor * 4));
    rpm = 9300 + (1 - cornerFactor) * 2200;
  } else {
    const straightProgress = (minDist - 0.06) / (0.5 - 0.06);
    speed = 200 + straightProgress * 125 + driverSpeedOffset;
    if (isDrs) {
      speed += 14;
    }
    throttle = 75 + straightProgress * 25;
    braking = 0;
    gear = Math.min(8, Math.floor(5 + straightProgress * 3.5));
    rpm = 11400 + straightProgress * 1100;
  }

  return {
    speed: Math.round(speed),
    throttle: Math.round(Math.min(100, Math.max(0, throttle))),
    braking: Math.round(Math.min(100, Math.max(0, braking))),
    gear: Math.max(1, Math.min(8, gear)),
    rpm: Math.round(rpm),
    drs: isDrs
  };
}

function getDriverAverageStats(driverCode, trackType) {
  const hash = driverCode.charCodeAt(0) + (driverCode.charCodeAt(1) || 0);
  
  let baseSpeed, baseThrottle, baseBrakingTime, baseDrsTime, baseGear;
  if (trackType === 'monaco') {
    baseSpeed = 138.4;
    baseThrottle = 37.1;
    baseBrakingTime = 33.8;
    baseDrsTime = 8.5;
    baseGear = 3.4;
  } else if (trackType === 'monza') {
    baseSpeed = 238.6;
    baseThrottle = 69.4;
    baseBrakingTime = 16.2;
    baseDrsTime = 18.2;
    baseGear = 5.9;
  } else {
    baseSpeed = 212.5;
    baseThrottle = 60.2;
    baseBrakingTime = 22.8;
    baseDrsTime = 14.5;
    baseGear = 5.2;
  }

  const speedOffset = (hash % 8) - 4;
  const throttleOffset = ((hash % 6) - 3) * 0.8;
  const brakeOffset = ((hash % 5) - 2) * 0.5;
  const drsOffset = ((hash % 3) - 1) * 0.4;
  const gearOffset = ((hash % 5) - 2) * 0.05;

  return {
    avgSpeed: (baseSpeed + speedOffset).toFixed(2),
    avgThrottle: (baseThrottle + throttleOffset).toFixed(2),
    pctBraking: (baseBrakingTime + brakeOffset).toFixed(2),
    pctDrs: (baseDrsTime + drsOffset).toFixed(2),
    avgGear: (baseGear + gearOffset).toFixed(2)
  };
}

function MetricComparisonCard({ title, live1, live2, avg1, avg2, unit = "", isPercent = false, highlightThreshold = null }) {
  const avgLabel = title === "Brake" || title === "DRS" ? "% TIME" : "AVG";

  const getHighlightColor = (val) => {
    if (highlightThreshold === "throttle") {
      return val > 80 ? "#27F4D2" : "#fff";
    }
    if (highlightThreshold === "brake") {
      return val === "BRAKE" ? "#FF6B6B" : "#888";
    }
    if (highlightThreshold === "drs") {
      return val === "DRS" ? "#27F4D2" : "#888";
    }
    return "#fff";
  };

  return (
    <div style={{ background: "#080808", border: "1px solid #1a1a1a", borderRadius: 8, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1f1f1f", paddingBottom: 4, marginBottom: 2 }}>
        <span style={{ fontSize: 9, fontWeight: "900", textTransform: "uppercase", color: "#888", letterSpacing: 1.2 }}>
          {title} {unit ? `(${unit})` : ""}
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, fontFamily: "monospace" }}>
        <span style={{ fontWeight: "bold", color: getHighlightColor(live1) }}>
          {live1}{isPercent && typeof live1 === 'number' ? '%' : ''}
        </span>
        <span style={{ fontSize: 8, color: "#444", fontWeight: "900", letterSpacing: 0.8 }}>LIVE</span>
        <span style={{ fontWeight: "bold", color: getHighlightColor(live2) }}>
          {live2}{isPercent && typeof live2 === 'number' ? '%' : ''}
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, fontFamily: "monospace" }}>
        <span style={{ color: "#888" }}>
          {avg1}{isPercent ? '%' : ''}
        </span>
        <span style={{ fontSize: 8, color: "#444", fontWeight: "900", letterSpacing: 0.8 }}>{avgLabel}</span>
        <span style={{ color: "#888" }}>
          {avg2}{isPercent ? '%' : ''}
        </span>
      </div>
    </div>
  );
}

function LapVisualizerPage({ season = "2026", isMobile = false }) {
  const [selSeason, setSelSeason] = useState(season);
  const [countries, setCountries] = useState(VISUALIZER_SEASONS[season] || VISUALIZER_SEASONS["2026"]);
  const [selCountryIndex, setSelCountryIndex] = useState(0);
  const [driver1, setDriver1] = useState("VER");
  const [driver2, setDriver2] = useState("HAM");
  const [lapPercent, setLapPercent] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(1.0);
  const [selectedLap, setSelectedLap] = useState(1);

  const pathRef = useRef(null);
  const [totalLength, setTotalLength] = useState(0);
  const [cornerPositions, setCornerPositions] = useState([]);
  const [extraLabels, setExtraLabels] = useState({ drs: { x: 0, y: 0 }, trap: { x: 0, y: 0 } });
  const [car1Pos, setCar1Pos] = useState({ x: 0, y: 0 });
  const [car2Pos, setCar2Pos] = useState({ x: 0, y: 0 });

  const selectedCountry = countries[selCountryIndex] || countries[0];
  const maxLaps = TRACK_LAPS[selectedCountry.trackType] || 55;

  useEffect(() => {
    const list = VISUALIZER_SEASONS[selSeason] || VISUALIZER_SEASONS["2026"];
    setCountries(list);
    setSelCountryIndex(0);
    setSelectedLap(1);
  }, [selSeason]);

  useEffect(() => {
    if (pathRef.current) {
      const len = pathRef.current.getTotalLength();
      setTotalLength(len);
    }
    setSelectedLap(1);
  }, [selectedCountry]);

  useEffect(() => {
    if (pathRef.current && totalLength) {
      const corners = TRACK_CORNERS[selectedCountry.trackType] || [];
      const positions = corners.map(c => {
        const pt = pathRef.current.getPointAtLength(c.percent * totalLength);
        return { ...c, x: pt.x, y: pt.y };
      });
      setCornerPositions(positions);

      const type = selectedCountry.trackType;
      const drsLabelPcts = {
        silverstone: 0.29, monza: 0.17, monaco: 0.97, spa: 0.10,
        bahrain: 0.08, melbourne: 0.10, suzuka: 0.92, singapore: 0.07,
        baku: 0.09, jeddah: 0.04, austin: 0.09, interlagos: 0.08,
        hungaroring: 0.09, zandvoort: 0.08, miami: 0.10, las_vegas: 0.12,
        lusail: 0.09, yas_marina: 0.10, imola: 0.09, spielberg: 0.09,
        shanghai: 0.10, barcelona: 0.08, montreal: 0.10, mexico_city: 0.10,
      };
      const trapLabelPcts = {
        silverstone: 0.48, monza: 0.65, monaco: 0.62, spa: 0.68,
        bahrain: 0.58, melbourne: 0.76, suzuka: 0.55, singapore: 0.85,
        baku: 0.66, jeddah: 0.78, austin: 0.63, interlagos: 0.73,
        hungaroring: 0.55, zandvoort: 0.62, miami: 0.76, las_vegas: 0.70,
        lusail: 0.65, yas_marina: 0.63, imola: 0.77, spielberg: 0.57,
        shanghai: 0.65, barcelona: 0.70, montreal: 0.60, mexico_city: 0.57,
      };
      const drsPct = drsLabelPcts[type] ?? 0.09;
      const trapPct = trapLabelPcts[type] ?? 0.62;

      const drsPt = pathRef.current.getPointAtLength(drsPct * totalLength);
      const trapPt = pathRef.current.getPointAtLength(trapPct * totalLength);

      setExtraLabels({
        drs: { x: drsPt.x, y: drsPt.y },
        trap: { x: trapPt.x, y: trapPt.y }
      });
    }
  }, [selectedCountry, totalLength]);

  useEffect(() => {
    if (pathRef.current && totalLength) {
      const p1 = pathRef.current.getPointAtLength(lapPercent * totalLength);
      setCar1Pos({ x: p1.x, y: p1.y });

      const nextPercent = (lapPercent + 0.005) % 1;
      const p2 = pathRef.current.getPointAtLength(nextPercent * totalLength);
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      setCar2Pos({ x: p1.x + nx * 8, y: p1.y + ny * 8 });
    }
  }, [lapPercent, totalLength, selectedCountry]);

  useEffect(() => {
    let animId;
    if (isPlaying) {
      const tick = () => {
        setLapPercent(prev => {
          const next = prev + 0.0025 * speedMultiplier;
          if (next >= 1) return 0;
          return next;
        });
        animId = requestAnimationFrame(tick);
      };
      animId = requestAnimationFrame(tick);
    }
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, speedMultiplier]);

  const d1 = VISUALIZER_DRIVERS.find(d => d.code === driver1) || VISUALIZER_DRIVERS[0];
  const d2 = VISUALIZER_DRIVERS.find(d => d.code === driver2) || VISUALIZER_DRIVERS[1];

  const lapVariation = (selectedLap * 0.003);
  const t1 = getTelemetryAtPercent((lapPercent + lapVariation) % 1, driver1, selectedCountry.trackType);
  const t2 = getTelemetryAtPercent(lapPercent, driver2, selectedCountry.trackType);

  const avg1 = getDriverAverageStats(driver1, selectedCountry.trackType);
  const avg2 = getDriverAverageStats(driver2, selectedCountry.trackType);

  const d1Time = lapPercent * 85.2 + Math.sin(lapPercent * Math.PI * 4) * 0.12 + (selectedLap * 0.01);
  const d2Time = lapPercent * 85.2 + Math.cos(lapPercent * Math.PI * 4) * 0.15 + 0.05;
  const delta = (d1Time - d2Time).toFixed(3);

  const handleSvgMouseMove = (e) => {
    if (!pathRef.current || !totalLength) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * 540 - 20;
    const svgY = ((e.clientY - rect.top) / rect.height) * 540 - 20;

    let minD = Infinity;
    let bestPct = 0;
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const pct = i / steps;
      const pt = pathRef.current.getPointAtLength(pct * totalLength);
      const dist = Math.pow(pt.x - svgX, 2) + Math.pow(pt.y - svgY, 2);
      if (dist < minD) {
        minD = dist;
        bestPct = pct;
      }
    }

    if (Math.sqrt(minD) < 70) {
      setLapPercent(bestPct);
    }
  };

  const pathD = TRACK_PATHS[selectedCountry.trackType] || TRACK_PATHS.silverstone;

  return (
    <div style={{ color: "#fff", display: "flex", flexDirection: "column", gap: 24, minHeight: "80vh" }}>
      <div style={{ background: "#0b0b0b", border: "1px solid #1a1a1a", borderRadius: 12, padding: 18, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "end" }}>
        <div style={{ flex: "1 1 120px" }}>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 6 }}>Season</label>
          <select
            value={selSeason}
            onChange={(e) => setSelSeason(e.target.value)}
            style={{ width: "100%", background: "#0c0c0c", border: "1px solid #1a1a1a", borderRadius: 6, padding: "8px 12px", color: "#fff", outline: "none", fontSize: 13 }}
          >
            <option value="2026">2026 Season</option>
            <option value="2025">2025 Season</option>
            <option value="2024">2024 Season</option>
          </select>
        </div>

        <div style={{ flex: "1 1 200px" }}>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 6 }}>Circuit (Country)</label>
          <select
            value={selCountryIndex}
            onChange={(e) => setSelCountryIndex(Number(e.target.value))}
            style={{ width: "100%", background: "#0c0c0c", border: "1px solid #1a1a1a", borderRadius: 6, padding: "8px 12px", color: "#fff", outline: "none", fontSize: 13 }}
          >
            {countries.map((c, i) => (
              <option key={i} value={i}>{c.country} ({c.circuit.split(" ")[0]})</option>
            ))}
          </select>
        </div>

        <div style={{ flex: "1 1 100px" }}>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 6 }}>Lap Selector</label>
          <select
            value={selectedLap}
            onChange={(e) => setSelectedLap(Number(e.target.value))}
            style={{ width: "100%", background: "#0c0c0c", border: "1px solid #1a1a1a", borderRadius: 6, padding: "8px 12px", color: "#fff", outline: "none", fontSize: 13 }}
          >
            {[...Array(maxLaps)].map((_, i) => (
              <option key={i + 1} value={i + 1}>Lap {i + 1}</option>
            ))}
          </select>
        </div>

        <div style={{ flex: "1 1 180px" }}>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 6 }}>Driver 1</label>
          <select
            value={driver1}
            onChange={(e) => setDriver1(e.target.value)}
            style={{ width: "100%", background: "#0c0c0c", border: "1px solid #1a1a1a", borderRadius: 6, padding: "8px 12px", color: "#fff", outline: "none", fontSize: 13 }}
          >
            {VISUALIZER_DRIVERS.map(d => (
              <option key={d.code} value={d.code} disabled={d.code === driver2}>{d.name} ({d.code}) - {d.team}</option>
            ))}
          </select>
        </div>

        <div style={{ flex: "1 1 180px" }}>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 6 }}>Driver 2</label>
          <select
            value={driver2}
            onChange={(e) => setDriver2(e.target.value)}
            style={{ width: "100%", background: "#0c0c0c", border: "1px solid #1a1a1a", borderRadius: 6, padding: "8px 12px", color: "#fff", outline: "none", fontSize: 13 }}
          >
            {VISUALIZER_DRIVERS.map(d => (
              <option key={d.code} value={d.code} disabled={d.code === driver1}>{d.name} ({d.code}) - {d.team}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 24 }}>
        <div style={{ flex: 1, background: "#0b0b0b", border: "1px solid #1a1a1a", borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 900, textTransform: "uppercase" }}>{selectedCountry.circuit}</h2>
              <p style={{ fontSize: 11, color: "#666" }}>{selectedCountry.country} • Interactive Snapping & Trail Visuals</p>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#666" }}>PLAYBACK:</span>
              <div style={{ display: "flex", gap: 4, background: "#000", border: "1px solid #222", padding: 2, borderRadius: 6 }}>
                {[0.5, 1.0, 2.0].map(s => (
                  <button
                    key={s}
                    onClick={() => setSpeedMultiplier(s)}
                    style={{
                      background: speedMultiplier === s ? "#E10600" : "transparent",
                      color: "#fff",
                      border: "none",
                      borderRadius: 4,
                      padding: "4px 8px",
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ position: "relative", width: "100%", minHeight: 350, background: "#080808", border: "1px solid #1a1a1a", borderRadius: 8, display: "flex", justifyContent: "center", alignItems: "center", overflow: "hidden" }}>
            <svg
              viewBox="-20 -20 540 540"
              preserveAspectRatio="xMidYMid meet"
              style={{ width: "100%", height: "auto", maxHeight: 520, cursor: "crosshair" }}
              onMouseMove={handleSvgMouseMove}
            >
              <path
                id="lap-trace-base"
                ref={pathRef}
                d={pathD}
                fill="none"
                stroke="transparent"
                strokeWidth="1"
              />

              <path
                d={pathD}
                fill="none"
                stroke="#181818"
                strokeWidth="16"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              
              <path
                d={pathD}
                fill="none"
                stroke="#2a2a2a"
                strokeWidth="12"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {totalLength > 0 && (
                <path
                  d={pathD}
                  fill="none"
                  stroke={d1.color}
                  strokeWidth="5"
                  strokeLinecap="round"
                  opacity="0.4"
                  strokeDasharray={`${totalLength * lapPercent} ${totalLength}`}
                  strokeDashoffset={0}
                  style={{ filter: `drop-shadow(0 0 4px ${d1.color})` }}
                />
              )}

              {totalLength > 0 && (
                <path
                  d={pathD}
                  fill="none"
                  stroke={d2.color}
                  strokeWidth="5"
                  strokeLinecap="round"
                  opacity="0.4"
                  strokeDasharray={`${totalLength * lapPercent} ${totalLength}`}
                  strokeDashoffset={0}
                  style={{ filter: `drop-shadow(0 0 4px ${d2.color})` }}
                  transform="translate(2, 2)"
                />
              )}

              {extraLabels.trap.x > 0 && (
                <g>
                  <circle cx={extraLabels.trap.x} cy={extraLabels.trap.y} r="5" fill="#FFD700" />
                  <line x1={extraLabels.trap.x} y1={extraLabels.trap.y} x2={extraLabels.trap.x - 30} y2={extraLabels.trap.y + 40} stroke="#FFD700" strokeWidth="1" opacity="0.6" />
                  <rect x={extraLabels.trap.x - 75} y={extraLabels.trap.y + 40} width="90" height="20" rx="3" fill="#000" stroke="#FFD700" strokeWidth="1" />
                  <text x={extraLabels.trap.x - 30} y={extraLabels.trap.y + 53} fill="#FFD700" fontSize="8" fontWeight="bold" textAnchor="middle" fontFamily="monospace">SPEED TRAP</text>
                </g>
              )}

              {extraLabels.drs.x > 0 && (
                <g>
                  <circle cx={extraLabels.drs.x} cy={extraLabels.drs.y} r="5" fill="#27F4D2" />
                  <line x1={extraLabels.drs.x} y1={extraLabels.drs.y} x2={extraLabels.drs.x + 35} y2={extraLabels.drs.y + 40} stroke="#27F4D2" strokeWidth="1" opacity="0.6" />
                  <rect x={extraLabels.drs.x} y={extraLabels.drs.y + 40} width="105" height="20" rx="3" fill="#000" stroke="#27F4D2" strokeWidth="1" />
                  <text x={extraLabels.drs.x + 52} y={extraLabels.drs.y + 53} fill="#27F4D2" fontSize="8" fontWeight="bold" textAnchor="middle" fontFamily="monospace">DRS DETECTION 1</text>
                </g>
              )}

              {totalLength > 0 && (() => {
                const pt = pathRef.current.getPointAtLength(0);
                return (
                  <g transform={`translate(${pt.x - 10}, ${pt.y - 12})`}>
                    <rect width="18" height="6" fill="#fff" />
                    <rect width="3" height="3" fill="#000" />
                    <rect x="6" width="3" height="3" fill="#000" />
                    <rect x="12" width="3" height="3" fill="#000" />
                    <rect x="3" y="3" width="3" height="3" fill="#000" />
                    <rect x="9" y="3" width="3" height="3" fill="#000" />
                    <rect x="15" y="3" width="3" height="3" fill="#000" />
                  </g>
                );
              })()}

              {cornerPositions.map((c, i) => (
                <g key={i}>
                  <circle cx={c.x} cy={c.y} r="10" fill="#000" stroke="#fff" strokeWidth="1.5" />
                  <text x={c.x} y={c.y + 3} fill="#fff" fontSize="8" fontWeight="900" fontFamily="sans-serif" textAnchor="middle">{c.id}</text>
                </g>
              ))}

              {car1Pos.x > 0 && (
                <g>
                  <circle cx={car1Pos.x} cy={car1Pos.y} r="8" fill={d1.color} stroke="#fff" strokeWidth="1.5" style={{ filter: `drop-shadow(0 0 5px ${d1.color})` }} />
                  <text x={car1Pos.x} y={car1Pos.y - 12} fill="#fff" fontSize="10" fontWeight="900" fontFamily="monospace" textAnchor="middle">{d1.code}</text>
                </g>
              )}

              {car2Pos.x > 0 && (
                <g>
                  <circle cx={car2Pos.x} cy={car2Pos.y} r="8" fill={d2.color} stroke="#fff" strokeWidth="1.5" style={{ filter: `drop-shadow(0 0 5px ${d2.color})` }} />
                  <text x={car2Pos.x} y={car2Pos.y + 20} fill="#fff" fontSize="10" fontWeight="900" fontFamily="monospace" textAnchor="middle">{d2.code}</text>
                </g>
              )}
            </svg>
          </div>

          <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 8 }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              style={{ background: "#E10600", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontWeight: "900", cursor: "pointer", fontSize: 12 }}
            >
              {isPlaying ? "⏸️ PAUSE" : "▶️ PLAY LAP"}
            </button>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={lapPercent}
                onChange={(e) => {
                  setIsPlaying(false);
                  setLapPercent(Number(e.target.value));
                }}
                style={{ flex: 1, accentColor: "#E10600", cursor: "pointer" }}
              />
              <span style={{ fontSize: 12, fontFamily: "monospace", color: "#888", minWidth: 40 }}>
                {Math.round(lapPercent * 100)}%
              </span>
            </div>
          </div>
        </div>

        <div style={{ 
          flex: isMobile ? "1 1 auto" : "0 0 360px", 
          minWidth: isMobile ? "auto" : "360px", 
          maxWidth: isMobile ? "none" : "360px", 
          width: isMobile ? "100%" : "360px",
          display: "flex", 
          flexDirection: "column", 
          gap: 16 
        }}>
          <div style={{ background: "#0b0b0b", border: "1px solid #1a1a1a", borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1a1a1a", paddingBottom: 12 }}>
              <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1.5, color: "#888", fontWeight: 700, margin: 0 }}>Telemetry HUD</h3>
              <div style={{ fontSize: 11, fontFamily: "monospace", color: "#666" }}>
                DELTA: <span style={{ color: Number(delta) > 0 ? d1.color : d2.color, fontWeight: "bold" }}>{Number(delta) > 0 ? `-${Math.abs(Number(delta)).toFixed(3)}s` : `+${Math.abs(Number(delta)).toFixed(3)}s`}</span>
              </div>
            </div>

            {/* Redesigned Drivers header block */}
            <div style={{ display: "flex", gap: 12, padding: "8px 12px", background: "#080808", border: "1px solid #1a1a1a", borderRadius: 8, marginTop: 4 }}>
              <div style={{ flex: 1, textAlign: "left", fontSize: 11, fontWeight: "bold", color: d1.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <span style={{ fontSize: 8, color: "#444", display: "block", fontWeight: "900", letterSpacing: 0.8 }}>DRIVER 1</span>
                {d1.name} ({d1.code})
              </div>
              <div style={{ flex: 1, textAlign: "right", fontSize: 11, fontWeight: "bold", color: d2.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <span style={{ fontSize: 8, color: "#444", display: "block", fontWeight: "900", letterSpacing: 0.8 }}>DRIVER 2</span>
                {d2.name} ({d2.code})
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <MetricComparisonCard 
                title="Speed" 
                unit="kmh" 
                live1={t1.speed} 
                live2={t2.speed} 
                avg1={avg1.avgSpeed} 
                avg2={avg2.avgSpeed} 
              />
              <MetricComparisonCard 
                title="Throttle" 
                unit="%" 
                live1={t1.throttle} 
                live2={t2.throttle} 
                avg1={avg1.avgThrottle} 
                avg2={avg2.avgThrottle} 
                isPercent={true}
                highlightThreshold="throttle"
              />
              <MetricComparisonCard 
                title="Brake" 
                live1={t1.braking > 10 ? "BRAKE" : "OFF"} 
                live2={t2.braking > 10 ? "BRAKE" : "OFF"} 
                avg1={avg1.pctBraking} 
                avg2={avg2.pctBraking} 
                isPercent={true}
                highlightThreshold="brake"
              />
              <MetricComparisonCard 
                title="DRS" 
                live1={t1.drs ? "DRS" : "OFF"} 
                live2={t2.drs ? "DRS" : "OFF"} 
                avg1={avg1.pctDrs} 
                avg2={avg2.pctDrs} 
                isPercent={true}
                highlightThreshold="drs"
              />
              <MetricComparisonCard 
                title="Gear" 
                live1={t1.gear} 
                live2={t2.gear} 
                avg1={avg1.avgGear} 
                avg2={avg2.avgGear} 
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}


function CircuitsPage({ season, isMobile }) {
  const [circuits, setCircuits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel]         = useState(null);
  const [detail, setDetail]   = useState(null);
  const [dl, setDl]           = useState(false);
  const [raceResults, setRaceResults] = useState([]);
  const [search, setSearch]   = useState("");

  useEffect(() => {
    setLoading(true); setSel(null);
    fetchSeasonRaces(season, { limit: 40, fetcher: apiFetch })
      .then((races) => {
        setCircuits(buildSeasonCircuitList(races));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [season]);

  useEffect(() => {
    if (!sel) return;
    setDl(true); setDetail(null); setRaceResults([]);
    Promise.all([
      fetchCircuitResults(sel.circuitId, { season, limit: 5, fetcher: apiFetch }),
      fetchCircuitResults(sel.circuitId, { limit: 3, fetcher: apiFetch }),
    ]).then(([recent, allTime]) => {
      setDetail(recent[0] || null);
      setRaceResults(allTime || []);
      setDl(false);
    }).catch(() => setDl(false));
  }, [sel, season]);

  if (loading) return <Spinner/>;
  if (!circuits.length) return <Empty/>;

  const filtered = circuits.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    const displayName = getCircuitDisplayName(c).toLowerCase();
    return displayName.includes(q) ||
      c.circuitName?.toLowerCase().includes(q) ||
      c.Location?.country?.toLowerCase().includes(q) ||
      c.Location?.locality?.toLowerCase().includes(q);
  });

  const meta = sel ? CIRCUIT_META[sel.circuitId] : null;

  return (
    <div>
      <div style={{ display:"flex", flexDirection: isMobile ? "column" : "row", gap:20, minHeight:500 }}>

      {/* ── Circuit grid ──────────────────────────────────────── */}
      <div style={{ flex:1, minWidth:0 }}>
        {/* Search */}
        <div style={{ position:"relative", marginBottom:16 }}>
          <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"#444", fontSize:13, pointerEvents:"none" }}>🔍</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search circuits or countries…"
            style={{ width:"100%", background:"#0f0f0f", border:"1px solid #1e1e1e", color:"#fff", padding:"9px 12px 9px 32px", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }}
          />
        </div>

        <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fill,minmax(190px,1fr))", gap:10 }}>
          {filtered.map((c, idx) => {
            const isSel = sel?.circuitId === c.circuitId;
            return (
              <div
                key={c.circuitId}
                onClick={() => setSel(isSel ? null : c)}
                style={{
                  background: isSel ? "linear-gradient(180deg, #141414 0%, #080808 100%)" : "#060606",
                  border: `1px solid ${isSel ? "#27F4D2" : "#1a1a1a"}`,
                  borderRadius:10, padding:"10px 10px 12px",
                  cursor:"pointer", transition:"all 0.22s ease",
                  position:"relative", overflow:"hidden",
                  boxShadow: isSel ? "0 0 16px rgba(39, 244, 210, 0.25)" : "none",
                }}
                onMouseEnter={e => { if (!isSel) { e.currentTarget.style.borderColor = "#27F4D2"; e.currentTarget.style.background = "#0e0e0e"; e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(39, 244, 210, 0.15)"; }}}
                onMouseLeave={e => { if (!isSel) { e.currentTarget.style.borderColor = "#1a1a1a"; e.currentTarget.style.background = "#060606"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}}
              >
                {/* Round badge */}
                {c.round && <span style={{ position:"absolute", top:8, right:8, fontFamily:"monospace", fontSize:9, color:isSel?"#27F4D2":"#444", fontWeight:700, zIndex:2 }}>R{c.round}</span>}

                {/* Wikipedia circuit layout image */}
                <div style={{ borderRadius:6, overflow:"hidden", marginBottom:10, border:`1px solid ${isSel?"rgba(39, 244, 210, 0.3)":"#121212"}` }}>
                  <CircuitImage
                    circuitId={c.circuitId}
                    circuitName={c.circuitName}
                    wikiUrl={c.url}
                    locality={c.Location?.locality}
                    country={c.Location?.country}
                    height={isMobile ? 90 : 110}
                  />
                </div>

                <div style={{ fontSize:13, fontWeight:700, color:isSel?"#fff":"#bbb", marginBottom:3, lineHeight:1.2 }}>{getCircuitDisplayName(c)}</div>
                <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
                  <span style={{ fontSize:12 }}>{flagOf(c.Location?.country)}</span>
                  <span style={{ fontSize:11, color:"#666" }}>{c.Location?.locality}, {c.Location?.country}</span>
                </div>
                {CIRCUIT_META[c.circuitId] && (
                  <div style={{
                    fontSize:9,
                    fontWeight:600,
                    color:"#27F4D2",
                    background:"rgba(39, 244, 210, 0.06)",
                    border:"1px solid rgba(39, 244, 210, 0.12)",
                    padding:"2px 6px",
                    borderRadius:4,
                    display:"inline-block",
                    fontFamily:"monospace",
                    marginTop:6
                  }}>
                    {CIRCUIT_META[c.circuitId].lap} · {CIRCUIT_META[c.circuitId].turns} turns
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Detail panel ──────────────────────────────────────── */}
      {sel && (
        <div style={{
          width: isMobile ? "100%" : 340,
          flexShrink:0, background:"#080808",
          border:"1px solid #1a1a1a", borderRadius:12,
          overflow:"hidden", alignSelf:"flex-start",
          position: isMobile ? "relative" : "sticky", top:0,
          maxHeight: isMobile ? "none" : "calc(100vh - 140px)",
          display:"flex",
          flexDirection:"column",
          minHeight:0,
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
        }}>
          {/* Header */}
          <div style={{ padding:"14px 18px", borderBottom:"1px solid #141414", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontWeight:700, fontSize:14, color:"#fff" }}>Circuit Detail</span>
            <button
              onClick={() => setSel(null)}
              style={{
                background:"transparent", border:"1px solid #222", color:"#999",
                width:26, height:26, borderRadius:6, cursor:"pointer",
                fontSize:13, display:"flex", alignItems:"center", justifyContent:"center",
                transition: "all 0.15s ease"
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#27F4D2"; e.currentTarget.style.color = "#27F4D2"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#222"; e.currentTarget.style.color = "#666"; }}
            >
              ✕
            </button>
          </div>

          <div style={{ padding:"18px", overflowY:"auto", flex:1, minHeight:0, overscrollBehavior:"contain" }}>
            {/* Large Wikipedia circuit layout */}
            <div style={{ background:"#060606", borderRadius:10, overflow:"hidden", marginBottom:16, border:"1px solid rgba(39, 244, 210, 0.2)" }}>
              <CircuitImage
                circuitId={sel.circuitId}
                circuitName={sel.circuitName}
                wikiUrl={sel.url}
                locality={sel.Location?.locality}
                country={sel.Location?.country}
                height={200}
              />
            </div>

            {/* Name + location */}
            <div style={{ marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <span style={{ fontSize:22 }}>{flagOf(sel.Location?.country)}</span>
                <div>
                  <div style={{ fontSize:16, fontWeight:800, color:"#fff", lineHeight:1.1 }}>{getCircuitDisplayName(sel)}</div>
                  <div style={{ fontSize:12, color:"#666", marginTop:2 }}>{sel.Location?.locality} · {sel.Location?.country}</div>
                </div>
              </div>
              <a href={sel.url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:"#27F4D2", textDecoration:"none", fontWeight:600 }}>
                Wikipedia →
              </a>
            </div>

            {/* Stats grid */}
            {meta && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
                {[
                  ["Lap Length", meta.lap],
                  ["Turns",      meta.turns],
                  ["DRS Zones",  meta.drs],
                  ["First GP",   meta.est],
                ].map(([l, v]) => (
                  <div key={l} style={{ background:"linear-gradient(135deg, #111 0%, #0c0c0c 100%)", border:"1px solid #1a1a1a", borderRadius:7, padding:"10px 12px" }}>
                    <div style={{ fontSize:10, color:"#27F4D2", opacity:0.8, textTransform:"uppercase", letterSpacing:1, marginBottom:3 }}>{l}</div>
                    <div style={{ fontSize:15, fontWeight:700, color:"#fff", fontFamily:"monospace" }}>{v}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent race result */}
            {dl ? <Spinner/> : detail ? (
              <>
                <div style={{ fontSize:10, color:"#27F4D2", opacity:0.9, textTransform:"uppercase", letterSpacing:2, marginBottom:10, fontWeight:600 }}>
                  {season} Race · {detail.date}
                </div>
                <div style={{ fontSize:13, color:"#888", marginBottom:10, fontWeight:500 }}>{detail.raceName}</div>
                {(detail.Results || []).slice(0, 5).map(r => (
                  <div key={r.Driver.driverId} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:"1px solid #141414" }}>
                    <div style={{
                      width:24, height:24, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center",
                      background: r.position==="1"?"#FFD700":r.position==="2"?"#C0C0C0":r.position==="3"?"#CD7F32":"transparent",
                      border: ["1","2","3"].includes(r.position)?"none":"1px solid #222",
                      fontSize:11, fontWeight:700, color: ["1","2","3"].includes(r.position)?"#000":"#888",
                      fontFamily:"monospace", flexShrink:0,
                    }}>{r.position}</div>
                    <div style={{ width:3, height:18, background:col(r.Constructor?.constructorId), borderRadius:2, flexShrink:0 }}/>
                    <span style={{ flex:1, color:"#ccc", fontSize:13 }}>{r.Driver.givenName[0]}. {r.Driver.familyName}</span>
                    <span style={{ fontFamily:"monospace", fontSize:11, color:"#888" }}>{r.Time?.time || r.status}</span>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

const F1_TV_URL = "https://f1tv.formula1.com/";
const F1_TV_INFO_URL = "https://www.formula1.com/en-us/subscribe-to-f1-tv";
const F1_BROADCAST_INFO_URL = "https://www.formula1.com/en/information/f1-broadcast-information.45y3LNsT1D6VoK0ZmX8ciJ";

function splitDriverName(fullName = "") {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName:"", lastName:"" };
  if (parts.length === 1) return { firstName:parts[0], lastName:"" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function formatEventDateTime(value) {
  if (!value) return "Start time unavailable";
  try {
    return new Date(value).toLocaleString("en-US", {
      weekday:"short",
      month:"short",
      day:"numeric",
      hour:"2-digit",
      minute:"2-digit",
    });
  } catch {
    return "Start time unavailable";
  }
}

function getLiveStatusMeta(status) {
  if (status === "live") {
    return {
      label:"Live Now",
      accent:"#E10600",
      chipBg:"#E1060014",
      chipBorder:"#E1060033",
      summary:"Official watch links and current timing snapshot",
    };
  }

  if (status === "recent") {
    return {
      label:"Recent Session",
      accent:"#FFD700",
      chipBg:"#FFD70014",
      chipBorder:"#FFD70033",
      summary:"Latest completed session with official replay/watch options",
    };
  }

  if (status === "upcoming") {
    return {
      label:"Upcoming Race",
      accent:"#27F4D2",
      chipBg:"#27F4D214",
      chipBorder:"#27F4D233",
      summary:"Countdown, official watch options, and next race planning",
    };
  }

  return {
    label:"Unavailable",
    accent:"#888",
    chipBg:"#88888814",
    chipBorder:"#88888833",
    summary:"Official links are available even when live timing is offline",
  };
}

function ActionLinkCard({href, eyebrow, title, body, accent}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        background:"#111",
        border:`1px solid ${accent}22`,
        borderRadius:10,
        padding:"14px 16px",
        textDecoration:"none",
        display:"block",
        transition:"transform 0.18s, box-shadow 0.18s, border-color 0.18s",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = `0 8px 24px ${accent}18`;
        e.currentTarget.style.borderColor = `${accent}55`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.borderColor = `${accent}22`;
      }}
    >
      <div style={{fontSize:10,color:accent,textTransform:"uppercase",letterSpacing:1.3,fontWeight:700,marginBottom:8}}>{eyebrow}</div>
      <div style={{fontSize:16,fontWeight:800,color:"#fff",marginBottom:6}}>{title}</div>
      <div style={{fontSize:12,color:"#777",lineHeight:1.5}}>{body}</div>
    </a>
  );
}

function CountdownBlocks({countdown, accent = "#27F4D2"}) {
  if (!countdown) return null;

  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(4, minmax(0, 1fr))",gap:8}}>
      {[
        ["Days", countdown.d],
        ["Hours", countdown.h],
        ["Mins", countdown.m],
        ["Secs", countdown.s],
      ].map(([label, value]) => (
        <div key={label} style={{background:"#111",border:`1px solid ${accent}22`,borderRadius:10,padding:"10px 6px",textAlign:"center",minWidth:0}}>
          <div style={{fontSize:10,color:"#666",textTransform:"uppercase",letterSpacing:1.1,marginBottom:4,fontWeight:600}}>{label}</div>
          <div style={{fontSize:"clamp(18px, 4vw, 22px)",fontWeight:800,color:"#fff",...mono}}>{pad2(value)}</div>
        </div>
      ))}
    </div>
  );
}

function WatchCoverageStrip({compact = false}) {
  const links = [
    { href: F1_TV_URL, label: "F1 TV", accent: "#E10600" },
    { href: F1_BROADCAST_INFO_URL, label: "Find Broadcaster", accent: "#27F4D2" },
    { href: F1_TV_INFO_URL, label: "F1 TV Plans", accent: "#FFD700" },
  ];

  return (
    <div style={{
      display:"flex",
      flexWrap:"wrap",
      gap: compact ? 8 : 10,
      alignItems:"center",
    }}>
      {links.map((link) => {
        const isPrimary = link.accent === "#E10600";
        return (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          style={{
            display:"inline-flex",
            alignItems:"center",
            gap:8,
            padding: compact ? "9px 12px" : "10px 14px",
            borderRadius:10,
            border:`1px solid ${link.accent}33`,
            background: isPrimary ? "#E10600" : "#111",
            color: isPrimary ? "#fff" : "#ddd",
            textDecoration:"none",
            fontSize:12,
            fontWeight:700,
            flex:"1 1 160px",
            justifyContent:"center",
            transition:"transform 0.18s, box-shadow 0.18s, border-color 0.18s, background 0.18s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = `0 8px 24px ${link.accent}22`;
            e.currentTarget.style.borderColor = `${link.accent}66`;
            if (!isPrimary) {
              e.currentTarget.style.background = "#161616";
              e.currentTarget.style.color = "#fff";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.borderColor = `${link.accent}33`;
            if (!isPrimary) {
              e.currentTarget.style.background = "#111";
              e.currentTarget.style.color = "#ddd";
            }
          }}
        >
          {link.label}
        </a>
        );
      })}
    </div>
  );
}

function SessionContextContent({liveData, statusMeta, heading, subtitle, sessionLabel, locationLabel, leader}) {
  const isUpcoming = liveData.status === "upcoming";

  return (
    <>
      <div style={{display:"inline-flex",padding:"6px 12px",borderRadius:999,border:`1px solid ${statusMeta.chipBorder}`,background:statusMeta.chipBg,fontSize:10,color:statusMeta.accent,textTransform:"uppercase",letterSpacing:1.6,fontWeight:700,marginBottom:14}}>
        {statusMeta.label}
      </div>
      <div style={{fontSize:"clamp(22px, 5vw, 30px)",fontWeight:800,marginBottom:8,color:"#fff",lineHeight:1.05}}>{heading}</div>
      <div style={{fontSize:13,color:"#aaa",marginBottom:8}}>{subtitle || "Latest timing summary"}</div>
      <div style={{fontSize:12,color:"#666",marginBottom:18,lineHeight:1.6}}>{liveData.message}</div>

      {!isUpcoming ? (
        <div style={{display:"grid",gap:10}}>
          <div style={{fontSize:11,color:"#666",textTransform:"uppercase",letterSpacing:1.2,fontWeight:600}}>
            {liveData.status === "live" ? "Live Session" : "Latest Session"}
          </div>
          <div style={{fontSize:12,color:"#777",marginBottom:4,lineHeight:1.5}}>
            {[locationLabel, formatEventDateTime(liveData.session?.startTime)].filter(Boolean).join(" • ")}
          </div>
          {[
            ["Status", statusMeta.label],
            ["Session", sessionLabel],
            ["Leading Driver", leader?.name || "No timing leader"],
            ["Latest Lap", leader?.lastLap != null ? `${leader.lastLap.toFixed(3)}s` : "No lap yet"],
          ].map(([label, value]) => (
            <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:10,background:"#111",border:"1px solid #1d1d1d"}}>
              <span style={{fontSize:11,color:"#666",textTransform:"uppercase",letterSpacing:1.1}}>{label}</span>
              <span style={{fontSize:12,color:"#fff",fontWeight:700,textAlign:"right"}}>{value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{fontSize:12,color:"#777",lineHeight:1.6}}>
          Countdown and start time are shown in the next race panel below.
        </div>
      )}
    </>
  );
}

function NextRaceHubCard({race, countdown, prominent = false, embedded = false}) {
  if (!race) return null;

  const raceName = gpName(race.raceName || "Upcoming Race");
  const location = [race.locality, race.country].filter(Boolean).join(" · ");
  const startLabel = formatEventDateTime(race.startTime);

  return (
    <div style={{
      background: embedded ? "transparent" : "linear-gradient(135deg, #121212 0%, #0d0d0d 100%)",
      border: embedded ? "none" : "1px solid #27F4D233",
      borderRadius: embedded ? 0 : 14,
      padding: embedded ? 0 : (prominent ? 20 : 16),
      position:"relative",
      overflow:"hidden",
    }}>
      {!embedded ? (
        <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg, #27F4D2, #27F4D255, transparent)"}}/>
      ) : null}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:12,flexWrap:"wrap"}}>
        <div style={{minWidth:0}}>
          <div style={{fontSize:10,color:"#27F4D2",textTransform:"uppercase",letterSpacing:1.3,fontWeight:700,marginBottom:4}}>Next Grand Prix</div>
          <div style={{fontSize:prominent ? 24 : 20,fontWeight:800,color:"#fff",lineHeight:1.1,marginBottom:2}}>{raceName}</div>
          <div style={{fontSize:12,color:"#888"}}>{race.circuitName || "Circuit TBA"}</div>
        </div>
        {race.round ? (
          <div style={{padding:"6px 10px",borderRadius:999,background:"#27F4D214",border:"1px solid #27F4D233",fontSize:11,fontWeight:800,color:"#27F4D2",...mono,flexShrink:0}}>
            R{race.round}
          </div>
        ) : null}
      </div>

      {countdown ? (
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,color:"#666",textTransform:"uppercase",letterSpacing:1.1,marginBottom:6,fontWeight:600}}>Race starts in</div>
          <CountdownBlocks countdown={countdown}/>
        </div>
      ) : (
        <div style={{marginBottom:12,padding:"10px 12px",borderRadius:10,background:"#111",border:"1px solid #1d1d1d",fontSize:12,color:"#888"}}>
          Start time will appear once the schedule is confirmed.
        </div>
      )}

      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        <div style={{flex:"1 1 140px",background:"#111",border:"1px solid #1d1d1d",borderRadius:10,padding:"8px 10px"}}>
          <div style={{fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:1.1,marginBottom:2}}>Location</div>
          <div style={{fontSize:12,color:"#fff",fontWeight:700,lineHeight:1.35}}>{location || "TBA"}</div>
        </div>
        <div style={{flex:"1 1 140px",background:"#111",border:"1px solid #1d1d1d",borderRadius:10,padding:"8px 10px"}}>
          <div style={{fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:1.1,marginBottom:2}}>Race Start</div>
          <div style={{fontSize:12,color:"#fff",fontWeight:700,lineHeight:1.35}}>{startLabel}</div>
        </div>
      </div>
    </div>
  );
}

function CompactLeaderboardSnippet({leaderboard = []}) {
  if (!leaderboard.length) return null;

  return (
    <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid #1d1d1d"}}>
      <div style={{fontSize:10,color:"#666",textTransform:"uppercase",letterSpacing:1.2,fontWeight:700,marginBottom:8}}>Quick Timing</div>
      <div style={{display:"grid",gap:8}}>
        {leaderboard.slice(0, 3).map((driver) => (
          <div key={`${driver.driverNumber}-${driver.code}`} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:8,background:"#111",border:"1px solid #1d1d1d"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
              <PosBadge pos={driver.position ?? "—"}/>
              <span style={{fontSize:12,color:"#fff",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{driver.code}</span>
            </div>
            <span style={{fontSize:11,color:driver.teamColor,fontWeight:700,...mono,flexShrink:0}}>
              {driver.lastLap != null ? `${driver.lastLap.toFixed(3)}s` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveWeekendHub({
  liveData,
  statusMeta,
  heading,
  subtitle,
  sessionLabel,
  locationLabel,
  leader,
  countdown,
  showSessionPanel,
  isMobile = false,
}) {
  const hasNextRace = Boolean(liveData.nextRace);

  const cardShell = {
    background: "#0f0f0f",
    border: "1px solid #1e1e1e",
    borderRadius: 14,
    overflow: "hidden",
    padding: 20,
    position: "relative",
    minWidth: 0,
  };

  return (
    <div style={{marginBottom:20}}>
      <div style={{
        display:"grid",
        gridTemplateColumns: showSessionPanel && hasNextRace && !isMobile ? "repeat(2, minmax(0, 1fr))" : "1fr",
        gap:18,
        alignItems:"stretch",
      }}>
        {showSessionPanel ? (
          <div style={cardShell}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg, ${statusMeta.accent}, ${statusMeta.accent}55, transparent)`}}/>
            <SessionContextContent
              liveData={liveData}
              statusMeta={statusMeta}
              heading={heading}
              subtitle={subtitle}
              sessionLabel={sessionLabel}
              locationLabel={locationLabel}
              leader={leader}
            />
          </div>
        ) : null}

        {hasNextRace ? (
          <div style={{
            ...cardShell,
            display:"flex",
            flexDirection:"column",
            minHeight:"100%",
          }}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg, #27F4D2, #27F4D255, transparent)"}}/>
            {!showSessionPanel ? (
              <div style={{marginBottom:14}}>
                <div style={{display:"inline-flex",padding:"6px 12px",borderRadius:999,border:`1px solid ${statusMeta.chipBorder}`,background:statusMeta.chipBg,fontSize:10,color:statusMeta.accent,textTransform:"uppercase",letterSpacing:1.6,fontWeight:700,marginBottom:10}}>
                  {statusMeta.label}
                </div>
                <div style={{fontSize:12,color:"#666",lineHeight:1.6}}>{liveData.message}</div>
              </div>
            ) : null}
            <NextRaceHubCard
              race={liveData.nextRace}
              countdown={countdown}
              prominent={!showSessionPanel}
              embedded
            />
            {showSessionPanel ? (
              <CompactLeaderboardSnippet leaderboard={liveData.leaderboard}/>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={{
        marginTop:18,
        padding:"16px 20px",
        background:"#0f0f0f",
        border:"1px solid #1e1e1e",
        borderRadius:14,
      }}>
        <div style={{fontSize:10,color:"#666",textTransform:"uppercase",letterSpacing:1.3,fontWeight:700,marginBottom:10}}>Watch & Coverage</div>
        <WatchCoverageStrip compact/>
        <div style={{fontSize:11,color:"#555",lineHeight:1.5,marginTop:10}}>
          Official links only. Availability varies by territory.
        </div>
      </div>
    </div>
  );
}

function LivePage({ isMobile = false }) {
  const [liveData,setLiveData]=useState(null); 
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);
  const [countdown,setCountdown]=useState(null);
  
  useEffect(()=>{
    let active = true;

    const loadLiveRace=async()=>{
      try {
        const data = await apiFetch("/api/live/race", 60000);
        if (!active) return;
        setLiveData(data);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (!active) return;
        setError(err?.message || "Failed to load live race data");
        setLoading(false);
      }
    };

    loadLiveRace();
    const poller = setInterval(loadLiveRace, 60000);
    return () => {
      active = false;
      clearInterval(poller);
    };
  },[]);
  
  useEffect(()=>{
    const target = liveData?.nextRace?.startTime;
    if(!target) {
      setCountdown(null);
      return;
    }

    const updateCountdown = () => {
      try {
        const raceDate = new Date(target);
        const now = new Date();
        const diff = raceDate - now;

        if(diff > 0) {
          setCountdown({
            d: Math.floor(diff / (1000 * 60 * 60 * 24)),
            h: Math.floor((diff / (1000 * 60 * 60)) % 24),
            m: Math.floor((diff / (1000 * 60)) % 60),
            s: Math.floor((diff / 1000) % 60),
          });
        } else {
          setCountdown(null);
        }
      } catch {
        setCountdown(null);
      }
    };
    
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [liveData?.nextRace?.startTime]);

  if(loading) return <Spinner/>;
  if(error) return <Empty icon="⚠️" msg={error}/>;
  if(!liveData) return <Empty msg="No live race data available"/>;

  const statusMeta = getLiveStatusMeta(liveData.status);
  const heading = liveData.session?.meetingName || gpName(liveData.nextRace?.raceName || "Upcoming Race");
  const subtitle = liveData.status === "upcoming"
    ? liveData.nextRace?.circuitName || "Next race schedule"
    : [liveData.session?.sessionName, liveData.session?.circuit].filter(Boolean).join(" · ");
  const sessionLabel = liveData.session?.sessionName || "No live session";
  const locationLabel =
    liveData.status === "upcoming"
      ? [liveData.nextRace?.locality, liveData.nextRace?.country].filter(Boolean).join(" · ")
      : [liveData.session?.circuit, liveData.session?.country].filter(Boolean).join(" · ");
  const leader = liveData.leaderboard?.[0] || null;
  const isUpcoming = liveData.status === "upcoming";
  const showSessionPanel = !isUpcoming;

  return (
    <div>
      <LiveWeekendHub
        liveData={liveData}
        statusMeta={statusMeta}
        heading={heading}
        subtitle={subtitle}
        sessionLabel={sessionLabel}
        locationLabel={locationLabel}
        leader={leader}
        countdown={countdown}
        showSessionPanel={showSessionPanel}
        isMobile={isMobile}
      />

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:18,alignItems:"start",marginBottom:20}}>
        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:20}}>
          <SecLabel>{liveData.leaderboard?.length ? "Live Leaderboard" : "Timing Snapshot"}</SecLabel>
          {liveData.leaderboard?.length ? (
            <div style={{display:"grid",gap:10}}>
              {liveData.leaderboard.slice(0, 6).map((driver) => {
                const { firstName, lastName } = splitDriverName(driver.name);
                return (
                  <div key={`${driver.driverNumber}-${driver.code}`} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",borderRadius:10,background:"#111",border:"1px solid #1e1e1e",gap:12}}>
                    <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>
                      <PosBadge pos={driver.position ?? "—"}/>
                      <DriverPhoto
                        firstName={firstName}
                        lastName={lastName}
                        headshotUrl={driver.headshotUrl}
                        teamColor={driver.teamColor}
                        headshotVariant="2col"
                        style={{width:44,height:52,display:"block",objectFit:"contain",objectPosition:"center bottom",background:"transparent",border:"none",flexShrink:0}}
                      />
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{driver.name}</div>
                        <div style={{fontSize:11,color:"#666"}}>{driver.team} • {driver.code}</div>
                      </div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:12,fontWeight:700,color:driver.teamColor,...mono}}>
                        {driver.lastLap != null ? `${driver.lastLap.toFixed(3)}s` : "No lap yet"}
                      </div>
                      <div style={{fontSize:11,color:"#555"}}>{driver.lapCount} laps</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <Empty icon="⏱️" msg="No session timing entries available yet."/>}
        </div>

        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:14,flexWrap:"wrap"}}>
            <div>
              <SecLabel>Lap Time Progression</SecLabel>
              <div style={{fontSize:11,color:"#666"}}>Top timing trend from the current or latest official timing snapshot</div>
            </div>
            {leader ? (
              <div style={{fontSize:11,color:"#666"}}>
                Leader: <span style={{color:leader.teamColor,fontWeight:700}}>{leader.name}</span>
              </div>
            ) : null}
          </div>
          {liveData.lapSeries?.length && liveData.lapSeriesDrivers?.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={liveData.lapSeries}>
                <CartesianGrid stroke="#1a1a1a"/>
                <XAxis dataKey="lap" stroke="#666" tick={{fontSize:11}}/>
                <YAxis stroke="#666" tick={{fontSize:11}}/>
                <Tooltip
                  contentStyle={{background:"#0c0c0c",border:"1px solid #E10600",borderRadius:4,color:"#fff"}}
                  formatter={(value) => typeof value === "number" ? `${value.toFixed(3)}s` : value}
                />
                {liveData.lapSeriesDrivers.map((driver) => (
                  <Line key={driver.key} type="monotone" dataKey={driver.key} stroke={driver.color} dot={false} strokeWidth={2}/>
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty icon="📈" msg="Lap history is not available for this session yet."/>
          )}
        </div>
      </div>
    </div>
  );
}

function WatchlistPage({season,watchlist,onToggle,trackedCount,watchlistReady,watchlistDisabled=false}) {
  const [drivers,setDrivers]=useState([]);
  const [teams,setTeams]=useState([]);
  const [races,setRaces]=useState([]);
  const [headshots,setHeadshots]=useState([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let active = true;
    setLoading(true);
    Promise.all([
      fetchSeasonStandingsBundle(season, {
        driverLimit: 100,
        constructorLimit: 15,
        fetcher: apiFetch,
      }),
      fetchSeasonResults(season, { limit: 600, fetcher: apiFetch }),
      apiFetch(`/api/drivers/headshots?season=${encodeURIComponent(season)}`, 300000),
    ])
      .then(([standingsBundle, seasonRaces, headshotPayload]) => {
        if (!active) return;
        setDrivers(standingsBundle.drivers || []);
        setTeams(standingsBundle.constructors || []);
        setRaces(seasonRaces || []);
        setHeadshots(Array.isArray(headshotPayload?.drivers) ? headshotPayload.drivers : []);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  },[season]);

  const watchedDrivers = useMemo(
    () => drivers.filter(d => watchlist.drivers.has(d.Driver.driverId)),
    [drivers, watchlist]
  );
  const watchedTeams = useMemo(
    () => teams.filter(t => watchlist.teams.has(t.Constructor?.constructorId)),
    [teams, watchlist]
  );
  const latestRaceContext = useMemo(() => buildLatestRaceWinnerContext(races), [races]);
  const headshotLookup = useMemo(() => buildDriverHeadshotLookup(headshots), [headshots]);
  const totalDriverPoints = watchedDrivers.reduce((sum, entry) => sum + asNum(entry.points), 0);
  const totalConstructorPoints = watchedTeams.reduce((sum, entry) => sum + asNum(entry.points), 0);
  const totalWins = watchedDrivers.reduce((sum, entry) => sum + asNum(entry.wins), 0)
    + watchedTeams.reduce((sum, entry) => sum + asNum(entry.wins), 0);
  const topDriver = watchedDrivers[0] || null;
  const topTeam = watchedTeams[0] || null;
  const latestWatchedDriver = latestRaceContext
    ? watchedDrivers.find((entry) => entry.Driver?.driverId === latestRaceContext.driverId) || null
    : null;
  const latestWatchedTeam = latestRaceContext
    ? watchedTeams.find((entry) => entry.Constructor?.name === latestRaceContext.teamName) || null
    : null;

  if(loading || !watchlistReady) return <Spinner/>;
  if(!watchedDrivers.length && !watchedTeams.length) {
    return <Empty icon="⭐" msg="No favorites yet. Star drivers or constructors to track them here!"/>;
  }

  return (
    <div>


      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:24}}>
        <StatCard label="Tracked Drivers" value={watchedDrivers.length} sub="Favorite drivers" accent="#27F4D2"/>
        <StatCard label="Tracked Constructors" value={watchedTeams.length} sub="Favorite teams" accent="#64C4FF"/>
        <StatCard label="Driver Points" value={totalDriverPoints} sub="Combined favorite drivers" accent="#FFD700"/>
        <StatCard label="Constructor Points" value={totalConstructorPoints} sub="Combined favorite teams" accent="#a855f7"/>
        <StatCard label="Top Driver" value={topDriver?.Driver?.familyName || "—"} sub={topDriver ? `P${topDriver.position} · ${topDriver.points} pts` : "No driver tracked"} accent={col(topDriver?.Constructors?.[0]?.constructorId)}/>
        <StatCard label="Top Team" value={topTeam?.Constructor?.name || "—"} sub={topTeam ? `P${topTeam.position} · ${topTeam.points} pts` : "No constructor tracked"} accent={col(topTeam?.Constructor?.constructorId)}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14,marginBottom:24}}>
        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:16}}>
          <SecLabel>Latest GP Watchlist Hit</SecLabel>
          <div style={{fontSize:18,fontWeight:800,color:"#fff",marginBottom:8}}>
            {latestWatchedDriver
              ? `${latestWatchedDriver.Driver.familyName} won`
              : latestWatchedTeam
                ? `${latestWatchedTeam.Constructor.name} won`
                : "No tracked winner"}
          </div>
          <div style={{fontSize:12,color:"#777",lineHeight:1.5}}>
            {latestRaceContext
              ? latestWatchedDriver || latestWatchedTeam
                ? `${latestRaceContext.raceName} was won by one of your favorites.`
                : `${latestRaceContext.raceName} was won by ${latestRaceContext.driverName}.`
              : "No completed grand prix yet for this season."}
          </div>
        </div>

        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:16}}>
          <SecLabel>Driver Spotlight</SecLabel>
          <div style={{fontSize:18,fontWeight:800,color:"#fff",marginBottom:8}}>
            {topDriver ? `${topDriver.Driver.givenName} ${topDriver.Driver.familyName}` : "No driver tracked"}
          </div>
          <div style={{fontSize:12,color:topDriver ? col(topDriver.Constructors?.[0]?.constructorId) : "#777",fontWeight:700,marginBottom:10}}>
            {topDriver?.Constructors?.[0]?.name || "Track a driver to surface insights"}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
            {[
              ["Pos", topDriver ? `P${topDriver.position}` : "—", "#fff"],
              ["Points", topDriver?.points || "—", "#FFD700"],
              ["Wins", topDriver?.wins || "—", "#E10600"],
            ].map(([label, value, accent]) => (
              <div key={label} style={{background:"#111",borderRadius:8,padding:"8px 10px"}}>
                <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:1.1,marginBottom:4}}>{label}</div>
                <div style={{fontSize:15,fontWeight:800,color:accent,...mono}}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:16}}>
          <SecLabel>Constructor Spotlight</SecLabel>
          <div style={{fontSize:18,fontWeight:800,color:"#fff",marginBottom:8}}>
            {topTeam?.Constructor?.name || "No constructor tracked"}
          </div>
          <div style={{fontSize:12,color:"#777",lineHeight:1.5,marginBottom:10}}>
            {topTeam
              ? `${getConstructorProfileMeta(topTeam.Constructor?.constructorId)?.principal || "Team principal unavailable"} · ${topTeam.wins} win${asNum(topTeam.wins) === 1 ? "" : "s"}`
              : "Track a constructor to see season snapshot highlights."}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
            {[
              ["Pos", topTeam ? `P${topTeam.position}` : "—", "#fff"],
              ["Points", topTeam?.points || "—", "#FFD700"],
              ["Combined Wins", totalWins, "#27F4D2"],
            ].map(([label, value, accent]) => (
              <div key={label} style={{background:"#111",borderRadius:8,padding:"8px 10px"}}>
                <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:1.1,marginBottom:4}}>{label}</div>
                <div style={{fontSize:15,fontWeight:800,color:accent,...mono}}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!!watchedDrivers.length && (
        <div style={{marginBottom:24}}>
          <SecLabel>Tracked Drivers</SecLabel>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14}}>
            {watchedDrivers.map((entry) => {
              const drv = entry.Driver;
              const team = entry.Constructors?.[0];
              const teamCol = col(team?.constructorId);
              const headshotUrl = resolveDriverHeadshotUrl(drv, headshotLookup);
              const isLatestWinner = latestRaceContext?.driverId === drv.driverId;
              return (
                <div key={drv.driverId} style={{background:"#0f0f0f",border:`1px solid ${teamCol}33`,borderRadius:12,overflow:"hidden"}}>
                  <div style={{height:4,background:`linear-gradient(90deg, ${teamCol}, ${teamCol}44, transparent)`}}/>
                  <div style={{padding:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:14}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <PosBadge pos={entry.position}/>
                        <div>
                          <div style={{fontSize:18,fontWeight:800,color:"#fff",lineHeight:1.1}}>{drv.givenName} {drv.familyName}</div>
                          <div style={{fontSize:12,color:teamCol,fontWeight:700,marginTop:4}}>{team?.name || "Unknown team"}</div>
                        </div>
                      </div>
                      <StarBtn id={drv.driverId} watchlist={watchlist} onToggle={onToggle} itemType="driver" disabled={watchlistDisabled}/>
                    </div>

                    <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 96px",gap:12,alignItems:"end",marginBottom:14}}>
                      <div>
                        <div style={{fontSize:12,color:"#666",marginBottom:8}}>{drv.nationality || "Unknown nationality"} · #{drv.permanentNumber || "—"}</div>
                        {isLatestWinner ? (
                          <div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 9px",borderRadius:999,background:"#FFD70014",border:"1px solid #FFD70033",color:"#FFD700",fontSize:10,fontWeight:700,letterSpacing:0.4}}>
                            Latest GP winner · {latestRaceContext.raceName}
                          </div>
                        ) : (
                          <div style={{fontSize:11,color:"#555"}}>{asNum(entry.wins)} season win{asNum(entry.wins) === 1 ? "" : "s"}</div>
                        )}
                      </div>
                      <DriverPhoto
                        firstName={drv.givenName}
                        lastName={drv.familyName}
                        wikiUrl={drv.url}
                        headshotUrl={headshotUrl}
                        headshotVariant="6col"
                        teamColor={teamCol}
                        style={{width:96,height:116,display:"block",objectFit:"contain",objectPosition:"center bottom",background:"transparent",border:"none",filter:"drop-shadow(0 6px 16px rgba(0,0,0,0.38))"}}
                      />
                    </div>

                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
                      {[
                        ["Position", `P${entry.position}`, "#fff"],
                        ["Points", entry.points, "#FFD700"],
                        ["Wins", entry.wins, "#E10600"],
                      ].map(([label, value, accent]) => (
                        <div key={label} style={{background:"#111",borderRadius:8,padding:"9px 10px"}}>
                          <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:1.1,marginBottom:4}}>{label}</div>
                          <div style={{fontSize:15,fontWeight:800,color:accent,...mono}}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!!watchedTeams.length && (
        <div>
          <SecLabel>Tracked Constructors</SecLabel>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14}}>
            {watchedTeams.map((entry) => {
              const team = entry.Constructor;
              const teamCol = col(team?.constructorId);
              const meta = getConstructorProfileMeta(team?.constructorId);
              const isLatestWinner = latestRaceContext?.teamName === team?.name;
              return (
                <div key={team.constructorId} style={{background:"#0f0f0f",border:`1px solid ${teamCol}33`,borderRadius:12,overflow:"hidden"}}>
                  <div style={{height:4,background:`linear-gradient(90deg, ${teamCol}, ${teamCol}44, transparent)`}}/>
                  <div style={{padding:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:14}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <PosBadge pos={entry.position}/>
                        <div>
                          <div style={{fontSize:18,fontWeight:800,color:"#fff",lineHeight:1.1}}>{team?.name}</div>
                          <div style={{fontSize:12,color:"#777",marginTop:4}}>{team?.nationality || "Unknown nationality"}</div>
                        </div>
                      </div>
                      <StarBtn id={team.constructorId} watchlist={watchlist} onToggle={onToggle} itemType="team" disabled={watchlistDisabled}/>
                    </div>

                    <div style={{marginBottom:14}}>
                      <ConstructorLogo
                        constructorId={team?.constructorId}
                        teamName={team?.name || "Constructor"}
                        meta={meta}
                        teamColor={teamCol}
                        height={88}
                        compact
                      />
                    </div>

                    <div style={{fontSize:12,color:teamCol,fontWeight:700,marginBottom:6}}>TP · {meta?.principal || "Not available"}</div>
                    <div style={{fontSize:11,color:"#666",marginBottom:10}}>
                      {meta?.powerUnit || "Power unit unknown"} · {meta?.base || "Base unknown"}
                    </div>
                    {isLatestWinner && (
                      <div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 9px",borderRadius:999,background:"#FFD70014",border:"1px solid #FFD70033",color:"#FFD700",fontSize:10,fontWeight:700,letterSpacing:0.4,marginBottom:12}}>
                        Latest GP winning team · {latestRaceContext.raceName}
                      </div>
                    )}

                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
                      {[
                        ["Position", `P${entry.position}`, "#fff"],
                        ["Points", entry.points, "#FFD700"],
                        ["Wins", entry.wins, teamCol],
                      ].map(([label, value, accent]) => (
                        <div key={label} style={{background:"#111",borderRadius:8,padding:"9px 10px"}}>
                          <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:1.1,marginBottom:4}}>{label}</div>
                          <div style={{fontSize:15,fontWeight:800,color:accent,...mono}}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TelemetryMetricCard({label, value, unit, color}) {
  return (
    <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:8,padding:"12px 10px",textAlign:"center"}}>
      <p style={{fontSize:10,color:"#555",textTransform:"uppercase",marginBottom:8,letterSpacing:1}}>{label}</p>
      <p style={{fontSize:18,fontWeight:700,color:color||"#fff",...mono}}>{value}</p>
      <p style={{fontSize:10,color:"#444",marginTop:4}}>{unit}</p>
    </div>
  );
}

function TelemetryPage({ season = "2026", isMobile = false }) {
  const [telemetryData,setTelemetryData]=useState([]);
  const [selectedDriver,setSelectedDriver]=useState("VER");
  const [currentMetrics,setCurrentMetrics]=useState(null);
  const [drivers,setDrivers]=useState([]);
  const [payload,setPayload]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);

  const [availableSessions, setAvailableSessions] = useState([]);
  const [selectedSessionKey, setSelectedSessionKey] = useState("");

  // Load available sessions for the season
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setSelectedSessionKey("");

    const loadSessions = async () => {
      try {
        const res = await fetch(`https://api.openf1.org/v1/sessions?year=${season}`);
        if (!res.ok) throw new Error("Failed to load session list");
        const list = await res.json();
        if (!active) return;

        const now = new Date();
        const sorted = (Array.isArray(list) ? list : [])
          .filter(s => s.session_key && s.location && s.date_start && new Date(s.date_start) <= now)
          .sort((a, b) => new Date(b.date_start || 0) - new Date(a.date_start || 0));

        setAvailableSessions(sorted);

        // Default to the first session (latest completed/active one)
        if (sorted.length > 0) {
          setSelectedSessionKey(String(sorted[0].session_key));
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load session list from OpenF1", err);
        if (active) {
          setAvailableSessions([]);
          setSelectedSessionKey("");
          setLoading(false);
        }
      }
    };

    loadSessions();
    return () => { active = false; };
  }, [season]);

  // Load telemetry when selectedSessionKey or selectedDriver changes
  useEffect(() => {
    if (availableSessions.length > 0 && !selectedSessionKey) return;

    let active = true;
    setLoading(true);

    const loadTelemetry = async () => {
      try {
        const keyQuery = selectedSessionKey ? `&sessionKey=${selectedSessionKey}` : "";
        const data = await apiFetch(`/api/telemetry?driver=${encodeURIComponent(selectedDriver)}${keyQuery}`, 45000);
        if (!active) return;
        setPayload(data);
        setDrivers(data.drivers || []);
        setTelemetryData(data.samples || []);
        setCurrentMetrics(data.currentMetrics || null);
        setError(null);
        setLoading(false);

        if (data.selectedDriver?.code && data.selectedDriver.code !== selectedDriver) {
          setSelectedDriver(data.selectedDriver.code);
        }
      } catch (err) {
        if (!active) return;
        setError(err?.message || "Failed to load telemetry data");
        setLoading(false);
      }
    };

    loadTelemetry();
    const poller = setInterval(loadTelemetry, 45000);
    return () => {
      active = false;
      clearInterval(poller);
    };
  }, [selectedDriver, selectedSessionKey]);

  if(loading) return <Spinner/>;
  if(error) return <Empty icon="⚠️" msg={error}/>;

  const sessionContext = payload?.session || null;
  const usingEstimatedTelemetry = payload?.source === "lap-data";
  const sourceLabel =
    payload?.source === "car-data"
      ? "Official car data"
      : payload?.source === "lap-data"
        ? "Lap-derived estimate"
        : "Unavailable";
  const selectedDriverLabel = payload?.selectedDriver?.name || selectedDriver;
  const telemetryContextRows = [
    ["Session", sessionContext?.sessionName || "—"],
    ["Circuit", sessionContext?.circuit || "—"],
    ["Country", sessionContext?.country || "—"],
    ["Session Start", formatEventDateTime(sessionContext?.startTime)],
    ["Data Source", sourceLabel],
  ];

  return (
    <div>
      <div style={{ display:"flex", flexDirection:isMobile?"column":"row", gap:16, marginBottom:20 }}>
        {availableSessions.length > 0 && (
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{fontSize:12,color:"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:10,fontWeight:600}}>Select GP & Session</div>
            <select
              value={selectedSessionKey}
              onChange={e => {
                setSelectedSessionKey(e.target.value);
                setLoading(true);
              }}
              style={{background:"#111",border:"1px solid #1e1e1e",color:"#fff",padding:"8px 12px",borderRadius:6,fontSize:13,cursor:"pointer",width:"100%"}}
            >
              {availableSessions.map(s => {
                const dateStr = s.date_start ? new Date(s.date_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : "";
                return (
                  <option key={s.session_key} value={s.session_key}>
                    {s.location} GP ({s.session_name}){dateStr ? ` · ${dateStr}` : ""}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{fontSize:12,color:"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:10,fontWeight:600}}>Select Driver</div>
          <select value={selectedDriver} onChange={e=>setSelectedDriver(e.target.value)} style={{background:"#111",border:"1px solid #1e1e1e",color:"#fff",padding:"8px 12px",borderRadius:6,fontSize:13,cursor:"pointer",...mono,width:"100%"}}>
            {drivers.map(d=><option key={d.code} value={d.code}>{d.name} ({d.code})</option>)}
          </select>
        </div>
      </div>

      <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:18,marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:10,color:"#666",textTransform:"uppercase",letterSpacing:1.4,fontWeight:700,marginBottom:8}}>Telemetry Session</div>
            <div style={{fontSize:22,fontWeight:800,color:"#fff",lineHeight:1.1,marginBottom:6}}>
              {sessionContext?.meetingName || sessionContext?.circuit || "Telemetry Feed"}
            </div>
            <div style={{fontSize:12,color:"#777"}}>
              {[sessionContext?.sessionName, sessionContext?.circuit, sessionContext?.country].filter(Boolean).join(" • ")}
            </div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <div style={{
              display:"inline-flex",
              padding:"6px 10px",
              borderRadius:999,
              border:`1px solid ${usingEstimatedTelemetry ? "#FFD70033" : "#27F4D233"}`,
              background:usingEstimatedTelemetry ? "#FFD70014" : "#27F4D214",
              color:usingEstimatedTelemetry ? "#FFD700" : "#27F4D2",
              fontSize:10,
              fontWeight:700,
              textTransform:"uppercase",
              letterSpacing:1.1,
            }}>
              {sourceLabel}
            </div>
            <div style={{
              display:"inline-flex",
              padding:"6px 10px",
              borderRadius:999,
              border:"1px solid #1f1f1f",
              background:"#111",
              color:"#aaa",
              fontSize:10,
              fontWeight:700,
              textTransform:"uppercase",
              letterSpacing:1.1,
            }}>
              Driver · {payload?.selectedDriver?.code || selectedDriver}
            </div>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginTop:16}}>
          {telemetryContextRows.map(([label, value]) => (
            <div key={label} style={{background:"#111",border:"1px solid #1d1d1d",borderRadius:10,padding:"10px 12px"}}>
              <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:1.1,marginBottom:5}}>{label}</div>
              <div style={{fontSize:13,color:"#fff",fontWeight:700,wordBreak:"break-word"}}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {usingEstimatedTelemetry && payload?.derivedMetricsNotice && (
        <div style={{marginBottom:20,padding:"10px 12px",borderRadius:10,background:"#FFD70010",border:"1px solid #FFD70022",fontSize:11,color:"#C9B46B",lineHeight:1.5}}>
          <strong style={{color:"#FFD700"}}>Estimated telemetry:</strong> {payload.derivedMetricsNotice.toLowerCase()}
        </div>
      )}

      {currentMetrics&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:24}}>
          <TelemetryMetricCard label="Speed" value={currentMetrics.speed.toFixed(0)} unit="km/h" color="#E10600"/>
          <TelemetryMetricCard label="Throttle" value={currentMetrics.throttle.toFixed(0)} unit="%" color="#27F4D2"/>
          <TelemetryMetricCard label="Brake" value={currentMetrics.braking.toFixed(0)} unit="%" color="#FF6B6B"/>
          <TelemetryMetricCard label="Gear" value={currentMetrics.gear} unit="" color="#FFD700"/>
          <TelemetryMetricCard label="RPM" value={Math.round(currentMetrics.rpm/100)} unit="x100" color="#4AFF00"/>
          <TelemetryMetricCard label="Fuel" value={currentMetrics.fuel.toFixed(1)} unit="L" color="#FF9500"/>
          <TelemetryMetricCard label="Position" value={currentMetrics.position ?? "—"} unit="" color="#64C4FF"/>
          <TelemetryMetricCard label="Lap" value={currentMetrics.lap ?? "—"} unit="" color="#a855f7"/>
        </div>
      )}

      {/* Charts Grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:20,marginBottom:24}}>
        {/* Speed Chart */}
        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:8,padding:16}}>
          <h3 style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:12}}>Speed Profile</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={telemetryData}>
              <CartesianGrid stroke="#1a1a1a"/>
              <XAxis dataKey="distance" stroke="#666" tick={{fontSize:11}}/>
              <YAxis stroke="#666" tick={{fontSize:11}}/>
              <Tooltip contentStyle={{background:"#0c0c0c",border:"1px solid #E10600",borderRadius:4,color:"#fff"}}/>
              <Line type="monotone" dataKey="speed" stroke="#E10600" dot={false} strokeWidth={2}/>
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Throttle & Brake */}
        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:8,padding:16}}>
          <h3 style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:12}}>Throttle & Brake</h3>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={telemetryData}>
              <CartesianGrid stroke="#1a1a1a"/>
              <XAxis dataKey="distance" stroke="#666" tick={{fontSize:11}}/>
              <YAxis stroke="#666" tick={{fontSize:11}}/>
              <Tooltip contentStyle={{background:"#0c0c0c",border:"1px solid #E10600",borderRadius:4,color:"#fff"}}/>
              <Line type="monotone" dataKey="throttle" stroke="#27F4D2" dot={false} strokeWidth={2}/>
              <Line type="monotone" dataKey="braking" stroke="#FF6B6B" dot={false} strokeWidth={2}/>
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Fuel Consumption */}
        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:8,padding:16}}>
          <h3 style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:12}}>Fuel Consumption</h3>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={telemetryData}>
              <CartesianGrid stroke="#1a1a1a"/>
              <XAxis dataKey="distance" stroke="#666" tick={{fontSize:11}}/>
              <YAxis stroke="#666" tick={{fontSize:11}}/>
              <Tooltip contentStyle={{background:"#0c0c0c",border:"1px solid #E10600",borderRadius:4,color:"#fff"}}/>
              <Area type="monotone" dataKey="fuel" fill="#FF9500" stroke="#FF9500" dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Tire Temperature */}
        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:8,padding:16}}>
          <h3 style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:12}}>Tire Temperature</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={telemetryData}>
              <CartesianGrid stroke="#1a1a1a"/>
              <XAxis dataKey="distance" stroke="#666" tick={{fontSize:11}}/>
              <YAxis stroke="#666" tick={{fontSize:11}}/>
              <Tooltip contentStyle={{background:"#0c0c0c",border:"1px solid #E10600",borderRadius:4,color:"#fff"}}/>
              <Line type="monotone" dataKey="tireTempF" stroke="#FF1493" dot={false} strokeWidth={2} name="Front"/>
              <Line type="monotone" dataKey="tireTempR" stroke="#00FFFF" dot={false} strokeWidth={2} name="Rear"/>
              <Legend wrapperStyle={{color:"#666",fontSize:11}}/>
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Gear Selection */}
        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:8,padding:16}}>
          <h3 style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:12}}>Gear Selection</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={telemetryData}>
              <CartesianGrid stroke="#1a1a1a"/>
              <XAxis dataKey="distance" stroke="#666" tick={{fontSize:11}}/>
              <YAxis stroke="#666" tick={{fontSize:11}}/>
              <Tooltip contentStyle={{background:"#0c0c0c",border:"1px solid #E10600",borderRadius:4,color:"#fff"}}/>
              <Bar dataKey="gear" fill="#27F4D2"/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* RPM Curve */}
        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:8,padding:16}}>
          <h3 style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:12}}>Engine RPM</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={telemetryData}>
              <CartesianGrid stroke="#1a1a1a"/>
              <XAxis dataKey="distance" stroke="#666" tick={{fontSize:11}}/>
              <YAxis stroke="#666" tick={{fontSize:11}}/>
              <Tooltip contentStyle={{background:"#0c0c0c",border:"1px solid #E10600",borderRadius:4,color:"#fff"}}/>
              <Line type="monotone" dataKey="rpm" stroke="#7C3AED" dot={false} strokeWidth={2}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* DRS Status */}
      <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:8,padding:16}}>
        <h3 style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:12}}>DRS Status</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={telemetryData}>
            <CartesianGrid stroke="#1a1a1a"/>
            <XAxis dataKey="distance" stroke="#666" tick={{fontSize:11}}/>
            <YAxis stroke="#666" tick={{fontSize:11}} domain={[0,100]}/>
            <Tooltip contentStyle={{background:"#0c0c0c",border:"1px solid #E10600",borderRadius:4,color:"#fff"}} formatter={v=>v>0?"OPEN":"CLOSED"}/>
            <Bar dataKey="drs" fill="#4AFF00"/>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ──  Main App ──────────────────────────────────────────────────────
export default function F1AnalyticsHub() {
  const [page, setPage]             = useState(DEFAULT_DASHBOARD_PAGE);
  const [season, setSeason]         = useState("2026");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [scrolled, setScrolled]     = useState(false);
  const [tabReady, setTabReady]     = useState(false);
  const {
    watchlist,
    toggle: toggleWatch,
    loaded: watchlistLoaded,
    syncing: watchlistSyncing,
    trackedCount,
  } = useDashboardWatchlist();
  const width    = useWindowWidth();
  const isMobile = width < 768;
  const isTablet = width >= 768 && width < 1100;
  const showSeasonSelector = SEASON_SELECTOR_PAGES.has(page);
  const contentRef = useRef(null);

  // Track scroll position of the CONTENT div (not window) for topbar shadow
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 4);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Reset scroll to top whenever page changes
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
    setScrolled(false);
  }, [page]);

  useEffect(() => {
    setPage(getDashboardTabFromUrl());
    setTabReady(true);

    const onPopState = () => setPage(getDashboardTabFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!tabReady) return;
    syncDashboardTabToUrl(page);
  }, [page, tabReady]);

  const curNav = ALL_NAV.find(n => n.id === page);
  const curGroupLabel = NAV_GROUPS.find(g => g.items.some(i => i.id === page))?.label;
  const goHome = () => {
    window.location.href = "/home";
  };
  const topbarHeader = {
    standings: {
      icon: <NavIcon id="standings" active={true} size={18} color="#FFD700" />,
      title:"Championship Standings",
      subtitle:`${season} Formula 1 World Championship`,
      accent:"#FFD700",
    },
    drivers: {
      icon: <NavIcon id="drivers" active={true} size={18} color="#27F4D2" />,
      title:"Driver Profiles",
      subtitle:`${season} · Driver profiles`,
      accent:"#27F4D2",
    },
    constructors: {
      icon: <NavIcon id="constructors" active={true} size={18} color="#FF8000" />,
      title:"Constructor Standings",
      subtitle:`${season} · Constructors`,
      accent:"#FF8000",
    },
    races: {
      icon: <NavIcon id="races" active={true} size={18} color="#a855f7" />,
      title:"Race Results",
      subtitle:`${season} · Full results · qualifying · pit stops`,
      accent:"#a855f7",
    },
    points: {
      icon: <NavIcon id="points" active={true} size={18} color="#27F4D2" />,
      title:"Points Progression",
      subtitle:`${season} · Round-by-round title fight and current gaps`,
      accent:"#27F4D2",
    },
    records: {
      icon: <NavIcon id="records" active={true} size={18} color="#FFD700" />,
      title:"Season Records",
      subtitle:`${season} · Wins, podiums, consistency and constructor leaders`,
      accent:"#FFD700",
    },
    strategy: {
      icon: <NavIcon id="strategy" active={true} size={18} color="#E10600" />,
      title:"Pit Stop Strategy",
      subtitle:`${season} · Stint visualizer · hover to isolate driver`,
      accent:"#E10600",
    },
    h2h: {
      icon: <NavIcon id="h2h" active={true} size={18} color="#E10600" />,
      title:"Head to Head",
      subtitle:`${season} · Metric board, recent form and race-by-race duel`,
      accent:"#E10600",
    },
    circuits: {
      icon: <NavIcon id="circuits" active={true} size={18} color="#27F4D2" />,
      title:"Circuit Explorer",
      subtitle:`${season} · Wikipedia track maps`,
      accent:"#27F4D2",
    },
    live: {
      icon: <NavIcon id="live" active={true} size={18} color="#E10600" />,
      title:"Live & Upcoming",
      subtitle:"Next race countdown · Real-time when a race is live",
      accent:"#E10600",
    },
    watchlist: {
      icon: <NavIcon id="watchlist" active={true} size={18} color="#FFD700" />,
      title:"Watchlist",
      subtitle:`${trackedCount} tracked item${trackedCount !== 1 ? "s" : ""} · ${season} season`,
      accent:"#FFD700",
    },
    telemetry: {
      icon: <NavIcon id="telemetry" active={true} size={18} color="#7C3AED" />,
      title:"Telemetry",
      subtitle:"Real-time style driver telemetry",
      accent:"#7C3AED",
    },
    visualizer: {
      icon: <NavIcon id="visualizer" active={true} size={18} color="#FF9500" />,
      title:"Lap Visualizer",
      subtitle:`${season} · Dynamic telemetry lap trace and circuit visualization`,
      accent:"#FF9500",
    },
  }[page] || {
    icon: <NavIcon id={curNav?.id} active={true} size={18} color="#E10600" />,
    title:curNav?.label,
    subtitle:curGroupLabel,
    accent:"#E10600",
  };

  // ── Sidebar nav items ────────────────────────────────────────────
  const navContent = (
    <nav style={{ flex:1, padding:"8px 6px", overflowY:"hidden", overflowX:"hidden" }}>
      {NAV_GROUPS.map(group => (
        <div key={group.label}>
          {(sidebarOpen || isMobile) && (
            <div style={{
              fontSize:9, color:"#333", textTransform:"uppercase",
              letterSpacing:2, padding:"14px 12px 5px", fontWeight:700,
              display:"flex", alignItems:"center", gap:6,
            }}>
              <div style={{ flex:1, height:"0.5px", background:"#1e1e1e" }}/>
              <span>{group.label}</span>
              <div style={{ flex:1, height:"0.5px", background:"#1e1e1e" }}/>
            </div>
          )}
          {group.items.map(item => {
            const active = page === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setPage(item.id); if (isMobile) setMobileNavOpen(false); }}
                title={!sidebarOpen && !isMobile ? item.label : undefined}
                style={{
                  display:"flex", alignItems:"center", gap:9,
                  width:"100%", padding: sidebarOpen || isMobile ? "9px 12px" : "9px 0",
                  justifyContent: sidebarOpen || isMobile ? "flex-start" : "center",
                  background: active ? "linear-gradient(90deg, rgba(225,6,0,0.12) 0%, rgba(225,6,0,0.04) 100%)" : "transparent",
                  border:"none",
                  borderLeft: active ? "2px solid #E10600" : "2px solid transparent",
                  borderRadius:"0 6px 6px 0",
                  cursor:"pointer",
                  color: active ? "#fff" : "#4a4a4a",
                  transition:"all 0.15s ease",
                  marginBottom:2, fontSize:13,
                  fontWeight: active ? 600 : 400,
                  textAlign:"left", whiteSpace:"nowrap",
                  position:"relative",
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.color = "#888"; e.currentTarget.style.background = active ? "linear-gradient(90deg, rgba(225,6,0,0.12) 0%, rgba(225,6,0,0.04) 100%)" : "rgba(255,255,255,0.03)"; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.color = "#4a4a4a"; e.currentTarget.style.background = active ? "linear-gradient(90deg, rgba(225,6,0,0.12) 0%, rgba(225,6,0,0.04) 100%)" : "transparent"; }}
              >
                <span style={{
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  width:16,
                  height:16,
                  flexShrink:0,
                }}>
                  <NavIcon id={item.id} active={active} />
                </span>

                {(sidebarOpen || isMobile) && (
                  <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis" }}>{item.label}</span>
                )}

                {item.id === "watchlist" && trackedCount > 0 && (sidebarOpen || isMobile) && (
                  <span style={{
                    background:"#E10600", color:"#fff", fontSize:9, fontWeight:800,
                    minWidth:16, height:16, borderRadius:8, display:"flex",
                    alignItems:"center", justifyContent:"center",
                    padding:"0 4px", flexShrink:0,
                  }}>{trackedCount}</span>
                )}

                {item.id === "live" && (
                  <span style={{
                    width:6, height:6, borderRadius:"50%", background:"#E10600",
                    flexShrink:0, animation:"livePulse 1.5s ease-in-out infinite",
                    ...((!sidebarOpen && !isMobile) ? { position:"absolute", top:6, right:6 } : {}),
                  }}/>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  // ── Sidebar header ───────────────────────────────────────────────
  const sidebarHeader = (
    <div style={{
      padding:"0 14px", borderBottom:"1px solid #141414",
      display:"flex", alignItems:"center",
      gap:10, height:58, flexShrink:0,
      overflow:"hidden",
    }}>
      <button
        onClick={goHome}
        title="Go to Home"
        style={{
          background:"transparent",
          border:"none",
          padding:0,
          margin:0,
          display:"flex",
          alignItems:"center",
          gap:10,
          minWidth:0,
          cursor:"pointer",
          color:"inherit",
          textAlign:"left",
        }}
      >
        <div style={{ flexShrink:0, display:"flex", alignItems:"center" }}>
          <F1Logo width={sidebarOpen ? 52 : 38}/>
        </div>
        {sidebarOpen && (
          <div style={{ overflow:"hidden", lineHeight:1 }}>
            <div style={{ fontWeight:800, fontSize:13, letterSpacing:0.3, color:"#fff", whiteSpace:"nowrap" }}>F1 Analytics</div>
            <div style={{ color:"#333", fontSize:9, letterSpacing:2, marginTop:2, textTransform:"uppercase" }}>Hub · {season}</div>
          </div>
        )}
      </button>
    </div>
  );

  // ── Sidebar footer (collapse button) ────────────────────────────
  const sidebarFooter = (
    <div style={{ padding:"10px 8px", borderTop:"1px solid #141414", flexShrink:0 }}>
      <button
        onClick={() => setSidebarOpen(v => !v)}
        title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        style={{
          width:"100%", padding:"8px", background:"transparent",
          border:"1px solid #1c1c1c", borderRadius:6, color:"#333",
          cursor:"pointer", fontSize:12, display:"flex",
          alignItems:"center", justifyContent: sidebarOpen ? "space-between" : "center",
          gap:6, transition:"all 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "#E10600"; e.currentTarget.style.color = "#fff"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "#1c1c1c"; e.currentTarget.style.color = "#333"; }}
      >
        {sidebarOpen && <span style={{ fontSize:11 }}>Collapse</span>}
        <span style={{ fontSize:11, transition:"transform 0.25s", display:"inline-block", transform: sidebarOpen ? "rotate(0deg)" : "rotate(180deg)" }}>◀</span>
      </button>
    </div>
  );

  if (!tabReady) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#080808",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontFamily: "'SF Pro Display','Segoe UI',sans-serif",
      }}>
        <Spinner />
      </div>
    );
  }

  return (
    <>
      {/* ── Global keyframes ─────────────────────────────────────── */}
      <style>{`
        @keyframes spin       { to { transform: rotate(360deg); } }
        @keyframes livePulse  { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:0.4;transform:scale(0.8);} }
        @keyframes slideIn    { from{opacity:0;transform:translateY(8px);} to{opacity:1;transform:translateY(0);} }
        @keyframes fadeIn     { from{opacity:0;} to{opacity:1;} }
        @keyframes cardIn     { from{opacity:0;transform:translateY(12px) scale(0.98);} to{opacity:1;transform:translateY(0) scale(1);} }
        @keyframes shimmer    { 0%{background-position:-400px 0;} 100%{background-position:400px 0;} }
        @keyframes borderPulse{ 0%,100%{box-shadow:0 0 0 0 rgba(225,6,0,0);} 50%{box-shadow:0 0 0 4px rgba(225,6,0,0.15);} }
        * { scrollbar-width:thin; scrollbar-color:#2a2a2a #0a0a0a; }
        *::-webkit-scrollbar        { width:5px; height:5px; }
        *::-webkit-scrollbar-track  { background:#0a0a0a; }
        *::-webkit-scrollbar-thumb  { background:#2a2a2a; border-radius:3px; }
        *::-webkit-scrollbar-thumb:hover { background:#E10600; }
        .f1-card-enter { animation: cardIn 0.22s ease-out both; }
        select option   { background:#111; color:#fff; }
      `}</style>

      {/*
        ── SHELL LAYOUT ───────────────────────────────────────────────
        THE KEY FIX:
        • Outer wrapper: height:100vh + overflow:hidden  → clips everything to viewport
        • Sidebar:       height:100vh + flexShrink:0     → never grows beyond viewport
        • Main column:   flex:1 + overflow:hidden         → clips main column too
        • Topbar:        IN FLOW (not position:fixed)     → no left-offset hacks needed,
                         never scrolls because its parent has overflow:hidden
        • Content div:   flex:1 + overflowY:auto          → THE ONLY THING THAT SCROLLS
        • Footer:        flexShrink:0                     → stays pinned at bottom
      */}
      <div style={{
        display:"flex",
        height:"100vh",       /* ← was minHeight which let page grow past viewport */
        overflow:"hidden",    /* ← clips the entire shell to exactly the viewport */
        background:"#080808",
        fontFamily:"'SF Pro Display','Segoe UI',sans-serif",
        color:"#fff",
      }}>

        {/* ── Mobile overlay nav ─────────────────────────────────── */}
        {isMobile && mobileNavOpen && (
          <div style={{ position:"fixed", inset:0, zIndex:999, display:"flex" }}>
            <div style={{
              width:272, background:"#0a0a0a",
              borderRight:"1px solid #141414",
              display:"flex", flexDirection:"column",
              height:"100%",
              boxShadow:"4px 0 24px rgba(0,0,0,0.6)",
            }}>
              <div style={{
                padding:"0 14px", borderBottom:"1px solid #141414",
                display:"flex", alignItems:"center",
                justifyContent:"space-between", height:58, flexShrink:0,
              }}>
                <button
                  onClick={goHome}
                  title="Go to Home"
                  style={{
                    background:"transparent",
                    border:"none",
                    padding:0,
                    margin:0,
                    display:"flex",
                    alignItems:"center",
                    gap:10,
                    cursor:"pointer",
                    color:"inherit",
                    textAlign:"left",
                  }}
                >
                  <F1Logo width={50}/>
                  <span style={{ fontWeight:800, fontSize:14 }}>F1 Analytics</span>
                </button>
                <button onClick={() => setMobileNavOpen(false)} style={{ background:"transparent", border:"1px solid #222", color:"#888", width:28, height:28, borderRadius:6, cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
              </div>
              {navContent}
            </div>
            <div style={{ flex:1, background:"rgba(0,0,0,0.65)", backdropFilter:"blur(2px)" }} onClick={() => setMobileNavOpen(false)}/>
          </div>
        )}

        {/* ── Desktop sidebar ────────────────────────────────────── */}
        {!isMobile && (
          <div style={{
            width: sidebarOpen ? (isTablet ? 206 : 230) : 52,
            flexShrink:0,
            height:"100vh",           /* ← CRITICAL: sidebar is always exactly viewport height */
            background:"#0a0a0a",
            borderRight:"1px solid #141414",
            display:"flex",
            flexDirection:"column",
            transition:"width 0.22s cubic-bezier(0.4,0,0.2,1)",
            overflow:"hidden",
          }}>
            {sidebarHeader}
            {navContent}
            {sidebarFooter}
          </div>
        )}

        {/* ── Main column ────────────────────────────────────────── */}
        <div style={{
          flex:1,
          display:"flex",
          flexDirection:"column",
          height:"100vh",             /* ← CRITICAL: main column is always exactly viewport height */
          overflow:"hidden",          /* ← CRITICAL: clips main column so only content div scrolls */
          minWidth:0,
        }}>

          {/* ── Topbar — IN FLOW, NOT position:fixed ─────────────
              Because the parent has overflow:hidden and is exactly 100vh tall,
              this topbar cannot scroll. No position:fixed, no left offset math. */}
          <div style={{
            flexShrink:0,
            height: isMobile ? "auto" : (isTablet ? 66 : 72),
            minHeight: isMobile ? 58 : undefined,
            padding:`${isMobile ? 10 : 0}px ${isMobile ? 14 : isTablet ? 16 : 24}px ${isMobile ? 10 : 0}`,
            display:"flex",
            alignItems:"center",
            justifyContent:"space-between",
            gap:12,
            background:"#080808",
            borderBottom: scrolled
              ? "1px solid #1e1e1e"
              : "1px solid #141414",
            boxShadow: scrolled
              ? "0 2px 16px rgba(0,0,0,0.5)"
              : "none",
            transition:"box-shadow 0.2s ease, border-color 0.2s ease",
            zIndex:10,
          }}>

            {/* Nav toggle, title (+ season on mobile), sign out */}
            <div style={{
              display:"flex",
              alignItems:"center",
              justifyContent:"space-between",
              gap:10,
              width:"100%",
              minHeight: isMobile ? 44 : undefined,
            }}>
              <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 8 : 10, flex:1, minWidth:0 }}>
                {isMobile && (
                  <button
                    onClick={() => setMobileNavOpen(true)}
                    style={{
                      background:"transparent", border:"1px solid #1e1e1e",
                      color:"#888", width:34, height:34, borderRadius:7,
                      cursor:"pointer", fontSize:16, flexShrink:0,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      transition:"all 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#E10600"; e.currentTarget.style.color = "#fff"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e1e1e"; e.currentTarget.style.color = "#888"; }}
                  >☰</button>
                )}

                <div style={{
                  display:"flex",
                  alignItems: isMobile ? "flex-start" : "center",
                  gap: isMobile ? 8 : 12,
                  minWidth:0,
                  flex:1,
                  overflow: isMobile ? "visible" : "hidden",
                  position:"relative",
                  paddingBottom: isMobile ? 0 : 4,
                }}>
                  <div style={{
                    width: isMobile ? 32 : 44,
                    height: isMobile ? 32 : 44,
                    borderRadius: isMobile ? 9 : 12,
                    background:`linear-gradient(135deg, ${topbarHeader.accent}22, ${topbarHeader.accent}08)`,
                    border:`1px solid ${topbarHeader.accent}33`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize: isMobile ? 16 : 22,
                    flexShrink:0,
                    marginTop: isMobile ? 1 : 0,
                  }}>
                    {topbarHeader.icon}
                  </div>

                  <div style={{ minWidth:0, flex:1, overflow: isMobile ? "visible" : "hidden" }}>
                    <h2 style={{
                      margin:0,
                      fontSize: isMobile ? 15 : isTablet ? 20 : 22,
                      fontWeight:900,
                      letterSpacing:-0.5,
                      color:"#fff",
                      lineHeight: isMobile ? 1.25 : 1.1,
                      ...(isMobile
                        ? { whiteSpace:"normal", overflow:"visible", textOverflow:"unset" }
                        : { whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }),
                    }}>
                      {topbarHeader.title}
                    </h2>
                    {isMobile && showSeasonSelector && (
                      <select
                        value={season}
                        onChange={e => setSeason(e.target.value)}
                        aria-label="Season"
                        style={{
                          marginTop:6,
                          background:"#111",
                          border:`1px solid ${topbarHeader.accent}44`,
                          color:topbarHeader.accent,
                          padding:"4px 8px",
                          borderRadius:6,
                          fontSize:11,
                          fontWeight:700,
                          cursor:"pointer",
                          fontFamily:"monospace",
                          outline:"none",
                          width:"auto",
                          maxWidth:"100%",
                        }}
                      >
                        {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    {!isMobile && !isTablet && (
                      <p style={{
                        margin:"3px 0 0", fontSize:12, color:"#444",
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                      }}>
                        {topbarHeader.subtitle}
                      </p>
                    )}
                  </div>

                  {!isMobile && !isTablet && (
                    <div style={{
                      position:"absolute",
                      left:56,
                      bottom:0,
                      width:60,
                      height:2,
                      background:`linear-gradient(90deg, ${topbarHeader.accent}, transparent)`,
                      borderRadius:1,
                    }}/>
                  )}
                </div>
              </div>

              <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                {showSeasonSelector && !isMobile && (
                  <>
                    {!isTablet && (
                      <span style={{ color:"#333", fontSize:10, textTransform:"uppercase", letterSpacing:1 }}>Season</span>
                    )}
                    <select
                      value={season}
                      onChange={e => setSeason(e.target.value)}
                      style={{
                        background:"#111", border:"1px solid #222",
                        color:"#fff", padding:"6px 10px", borderRadius:7,
                        fontSize:13, cursor:"pointer", fontFamily:"monospace",
                        outline:"none",
                      }}
                    >
                      {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </>
                )}

                {!isTablet && !isMobile && <div style={{ width:1, height:22, background:"#1c1c1c", flexShrink:0 }}/>}

                <SignOutButton/>
              </div>
            </div>
          </div>

          {/* ── Scrollable content area ─────────────────────────────
              This is THE ONLY element that scrolls.
              flex:1 makes it fill the remaining height (viewport - 58px topbar - footer).
              overflowY:auto adds a scrollbar only when content overflows. */}
          <div
            ref={contentRef}
            style={{
              flex:1,                  /* fills remaining vertical space */
              overflowY:"auto",        /* ← ONLY THIS SCROLLS — topbar above and footer below stay put */
              overflowX:"hidden",
              padding:`${isMobile ? 16 : isTablet ? 18 : 22}px ${isMobile ? 14 : isTablet ? 16 : 24}px`,
              /* Subtle page-change animation */
              animation:"slideIn 0.18s ease-out",
            }}
            key={page} /* re-mount animation on page change */
          >
            {tabReady ? (
              <>
                {page === "standings"    && <StandingsPage    season={season}/>}
                {page === "drivers"      && <DriversPage      season={season} watchlist={watchlist} onToggle={toggleWatch} watchlistDisabled={!watchlistLoaded || watchlistSyncing} isMobile={isMobile}/>}
                {page === "constructors" && <ConstructorsPage season={season} watchlist={watchlist} onToggle={toggleWatch} watchlistDisabled={!watchlistLoaded || watchlistSyncing} isMobile={isMobile}/>}
                {page === "races"        && <RaceResultsPage  season={season} isMobile={isMobile}/>}
                {page === "points"       && <PointsChartPage  season={season} isMobile={isMobile}/>}
                {page === "records"      && <SeasonRecordsPage season={season} isMobile={isMobile}/>}
                {page === "strategy"     && <StrategyPage     season={season}/>}
                {page === "h2h"          && <HeadToHeadPage   season={season} isMobile={isMobile}/>}
                {page === "circuits"     && <CircuitsPage     season={season} isMobile={isMobile}/>}
                {page === "telemetry"    && <TelemetryPage season={season} isMobile={isMobile}/>}
                {page === "visualizer"   && <LapVisualizerPage season={season} isMobile={isMobile}/>}
                {page === "live"         && <LivePage isMobile={isMobile}/>}
                {page === "watchlist"    && <WatchlistPage    season={season} watchlist={watchlist} onToggle={toggleWatch} trackedCount={trackedCount} watchlistReady={watchlistLoaded} watchlistDisabled={!watchlistLoaded || watchlistSyncing}/>}
              </>
            ) : (
              <Spinner />
            )}
          </div>

          {/* ── Footer — stays pinned at very bottom ────────────── */}
          <div style={{
            flexShrink:0,
            padding:`8px ${isMobile ? 14 : 24}px`,
            borderTop:"1px solid #101010",
            display:"flex",
            justifyContent:"space-between",
            alignItems:"center",
          }}>
            <span style={{ color:"#1e1e1e", fontSize:10, fontFamily:"monospace" }}>
              JOLPICA · ERGAST · OPENF1
            </span>
            <span style={{ color:"#1e1e1e", fontSize:10, fontFamily:"monospace" }}>
              F1 ANALYTICS HUB · v2.0
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
