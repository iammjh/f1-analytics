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
  ]},
  { label:"Live", items:[
    { id:"live",      label:"Match",      icon:"🔴" },
    { id:"watchlist", label:"Watchlist", icon:"⭐" },
  ]},
];
const ALL_NAV = NAV_GROUPS.flatMap(g => g.items);
const DEFAULT_DASHBOARD_PAGE = "standings";
const DASHBOARD_TAB_PARAM = "tab";

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
  const [w,setW] = useState(typeof window!=="undefined"?window.innerWidth:1200);
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
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

  if (/logo|wordmark|emblem/.test(value)) score -= 100;
  if (/map|layout|track|outline|svg|diagram|bare/.test(value)) score += 8;
  if (/circuit|autodromo|autódromo|ring|prix/.test(value)) score += 4;
  if (/\b20\d{2}\b/.test(value)) score += 2;
  if (/moto|rallycross|nascar|original|old|historic|history|evolution/.test(value)) score -= 8;
  if (/\d{4}-\d{4}/.test(value)) score -= 6;
  if (/sky sat|skysat|tower|crowd|pit|grandstand|aerial|formation|amphitheater|jpg/.test(value)) score -= 3;

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
};

// ── Circuit image via Wikipedia ───────────────────────────────────
function CircuitImage({ circuitId, circuitName, wikiUrl, locality="", country="", height=130 }) {
  const title  = extractWikiTitleFromUrl(wikiUrl) || CIRCUIT_WIKI[circuitId];
  const compactName = String(circuitName || "")
    .replace(/\b(Grand Prix Circuit|International Circuit|Street Circuit|Grand Prix|Circuit|Autodrome)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const imageIndex = CIRCUIT_IMAGE_INDEX[circuitId];
  const { img: imgUrl } = useWikiImage({
    title,
    titles: [
      CIRCUIT_WIKI[circuitId],
      circuitName ? circuitName.replace(/ /g, "_") : null,
      compactName ? compactName.replace(/ /g, "_") : null,
    ],
    searchQuery: circuitName,
    searchQueries: [
      `${circuitName} circuit`,
      `${circuitName} track`,
      locality && country ? `${locality} ${country} circuit` : null,
      country ? `${country} Formula 1 circuit` : null,
    ],
    imageIndex,
    preferMediaList: true,
    mediaHint: "circuit-layout",
  });
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [imgUrl, circuitId, circuitName]);

  return (
    <div style={{
      width:"100%", height, background:"#f4f4f5",
      borderRadius:6, overflow:"hidden", position:"relative",
      display:"flex", alignItems:"center", justifyContent:"center",
      border:"1px solid #e5e7eb",
    }}>
      {imgUrl && !imgFailed ? (
        <img src={imgUrl} alt={`${circuitName} layout`}
          style={{ width:"100%", height:"100%", objectFit:"contain", filter:"brightness(1.12) contrast(1.2)" }}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8, padding:"0 16px", textAlign:"center" }}>
          <div style={{ fontSize:24 }}>🏁</div>
          <div style={{ fontSize:12, fontWeight:700, color:"#222" }}>{circuitName}</div>
          <div style={{ fontSize:10, color:"#666" }}>Track layout preview</div>
        </div>
      )}
    </div>
  );
}

function buildSeasonCircuitList(races = []) {
  const byId = new Map();

  races.forEach((race) => {
    const circuit = race?.Circuit;
    const circuitId = circuit?.circuitId;
    if (!circuitId) return;

    if (!byId.has(circuitId)) {
      byId.set(circuitId, {
        ...circuit,
        round: race?.round || null,
        raceName: race?.raceName || null,
      });
    }
  });

  return [...byId.values()].sort((a, b) => Number(a?.round || 0) - Number(b?.round || 0));
}

function Spinner() {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 0",gap:12}}>
      <div style={{width:34,height:34,border:"3px solid #1e1e1e",borderTop:"3px solid #E10600",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
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
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"60px 0",gap:12}}>
      <div style={{fontSize:32}}>{icon}</div>
      <div style={{color:"#444",fontSize:14}}>{msg}</div>
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
    fetchSeasonResults(season, { limit: 1000, fetcher: apiFetch })
      .then(races => { setRaces(races); setLoading(false); })
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
              <td style={{padding:"11px 12px"}}><PosBadge pos={r.round}/></td>
              <td style={{padding:"11px 12px",fontWeight:600,minWidth:120}}>{gpName(r.raceName)}</td>
              <td style={{padding:"11px 12px",color:"#FFD700",fontWeight:500,minWidth:100}}>{r.Circuit?.circuitName||"—"}</td>
              <td style={{padding:"11px 12px",color:"#888",fontSize:11}}>{r.Circuit?.Location?.country} {flagOf(r.Circuit?.Location?.country)}</td>
              <td style={{padding:"11px 12px",...mono,fontSize:11,color:"#666"}}>{r.date}</td>
              <td style={{padding:"11px 12px",fontWeight:600,color:col(r.Results?.[0]?.Constructor?.constructorId),minWidth:80}}>
                {r.Results?.[0]?.Driver?.familyName||"—"}
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

function PointsChartPage({season}) {
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

      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.6fr) minmax(320px,0.95fr)",gap:18,alignItems:"start"}}>
        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:18}}>
          <SecLabel>Round-by-round championship evolution</SecLabel>
          {progression.data.length ? (
            <div style={{height:410}}>
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

        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:18}}>
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

function SeasonRecordsPage({season}) {
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

      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.2fr) minmax(0,1fr)",gap:18,alignItems:"start"}}>
        <div style={{display:"grid",gap:18}}>
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

        <div style={{display:"grid",gap:18}}>
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
  const [loading,setLoading]=useState(true);
  const { getParams, setParams } = useShareableH2H();

  useEffect(()=>{
    setLoading(true);
    Promise.all([
      fetchDriverStandings(season, { limit: 100, fetcher: apiFetch }),
      fetchSeasonResults(season, { limit: 600, fetcher: apiFetch }),
    ])
      .then(([nextDrivers, nextRaces]) => {
        setDrivers(nextDrivers);
        setRaces(nextRaces);
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
            {[leftMetric, rightMetric].map((driver) => (
              <div key={driver.driverId} style={{background:"#0a0a0a",border:`1px solid ${driver.teamColor}44`,borderRadius:12,overflow:"hidden"}}>
                <div style={{height:4,background:`linear-gradient(90deg,${driver.teamColor},${driver.teamColor}44,transparent)`}}/>
                <div style={{padding:18}}>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                    <DriverPhoto firstName={driver.name.split(" ")[0] || driver.familyName} lastName={driver.familyName} wikiUrl={driver.wikiUrl} teamColor={driver.teamColor}
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
            ))}
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
};

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

  const filtered = circuits.filter(c =>
    !search || c.circuitName.toLowerCase().includes(search.toLowerCase()) ||
    c.Location?.country?.toLowerCase().includes(search.toLowerCase())
  );

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
                  background: isSel ? "#111" : "#0a0a0a",
                  border: `1px solid ${isSel ? "#E10600" : "#1a1a1a"}`,
                  borderRadius:10, padding:"10px 10px 12px",
                  cursor:"pointer", transition:"all 0.18s",
                  position:"relative", overflow:"hidden",
                }}
                onMouseEnter={e => { if (!isSel) { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.background = "#0d0d0d"; e.currentTarget.style.transform = "translateY(-2px)"; }}}
                onMouseLeave={e => { if (!isSel) { e.currentTarget.style.borderColor = "#1a1a1a"; e.currentTarget.style.background = "#0a0a0a"; e.currentTarget.style.transform = "translateY(0)"; }}}
              >
                {/* Round badge */}
                <span style={{ position:"absolute", top:8, right:8, fontFamily:"monospace", fontSize:9, color:isSel?"#E10600":"#2a2a2a", fontWeight:700, zIndex:2 }}>R{c.round || idx+1}</span>

                {/* Wikipedia circuit layout image */}
                <div style={{ borderRadius:6, overflow:"hidden", marginBottom:10, border:`1px solid ${isSel?"#E10600":"#141414"}` }}>
                  <CircuitImage
                    circuitId={c.circuitId}
                    circuitName={c.circuitName}
                    wikiUrl={c.url}
                    locality={c.Location?.locality}
                    country={c.Location?.country}
                    height={isMobile ? 90 : 110}
                  />
                </div>

                <div style={{ fontSize:13, fontWeight:700, color:isSel?"#fff":"#bbb", marginBottom:3, lineHeight:1.2 }}>{c.circuitName}</div>
                <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
                  <span style={{ fontSize:12 }}>{flagOf(c.Location?.country)}</span>
                  <span style={{ fontSize:11, color:"#555" }}>{c.Location?.locality}, {c.Location?.country}</span>
                </div>
                {CIRCUIT_META[c.circuitId] && (
                  <div style={{ fontSize:10, color:"#333", fontFamily:"monospace", marginTop:4 }}>
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
          flexShrink:0, background:"#0a0a0a",
          border:"1px solid #1c1c1c", borderRadius:12,
          overflow:"hidden", alignSelf:"flex-start",
          position: isMobile ? "relative" : "sticky", top:0,
          maxHeight: isMobile ? "none" : "calc(100vh - 140px)",
          display:"flex",
          flexDirection:"column",
          minHeight:0,
        }}>
          {/* Header */}
          <div style={{ padding:"14px 18px", borderBottom:"1px solid #1c1c1c", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontWeight:700, fontSize:14, color:"#fff" }}>Circuit Detail</span>
            <button onClick={() => setSel(null)} style={{ background:"transparent", border:"1px solid #222", color:"#666", width:26, height:26, borderRadius:6, cursor:"pointer", fontSize:13, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>

          <div style={{ padding:"18px", overflowY:"auto", flex:1, minHeight:0, overscrollBehavior:"contain" }}>
            {/* Large Wikipedia circuit layout */}
            <div style={{ background:"#060606", borderRadius:10, overflow:"hidden", marginBottom:16, border:"1px solid #141414" }}>
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
                  <div style={{ fontSize:16, fontWeight:800, color:"#fff", lineHeight:1.1 }}>{sel.circuitName}</div>
                  <div style={{ fontSize:12, color:"#555", marginTop:2 }}>{sel.Location?.locality} · {sel.Location?.country}</div>
                </div>
              </div>
              <a href={sel.url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:"#E10600", textDecoration:"none" }}>
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
                  <div key={l} style={{ background:"#111", borderRadius:7, padding:"10px 12px" }}>
                    <div style={{ fontSize:10, color:"#444", textTransform:"uppercase", letterSpacing:1, marginBottom:3 }}>{l}</div>
                    <div style={{ fontSize:15, fontWeight:700, color:"#fff", fontFamily:"monospace" }}>{v}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent race result */}
            {dl ? <Spinner/> : detail ? (
              <>
                <div style={{ fontSize:10, color:"#555", textTransform:"uppercase", letterSpacing:2, marginBottom:10, fontWeight:600 }}>
                  {season} Race · {detail.date}
                </div>
                <div style={{ fontSize:13, color:"#888", marginBottom:10, fontWeight:500 }}>{detail.raceName}</div>
                {(detail.Results || []).slice(0, 5).map(r => (
                  <div key={r.Driver.driverId} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:"1px solid #111" }}>
                    <div style={{
                      width:24, height:24, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center",
                      background: r.position==="1"?"#FFD700":r.position==="2"?"#C0C0C0":r.position==="3"?"#CD7F32":"transparent",
                      border: ["1","2","3"].includes(r.position)?"none":"1px solid #2a2a2a",
                      fontSize:11, fontWeight:700, color: ["1","2","3"].includes(r.position)?"#000":"#666",
                      fontFamily:"monospace", flexShrink:0,
                    }}>{r.position}</div>
                    <div style={{ width:3, height:18, background:col(r.Constructor?.constructorId), borderRadius:2, flexShrink:0 }}/>
                    <span style={{ flex:1, color:"#ccc", fontSize:13 }}>{r.Driver.givenName[0]}. {r.Driver.familyName}</span>
                    <span style={{ fontFamily:"monospace", fontSize:11, color:"#444" }}>{r.Time?.time || r.status}</span>
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

function LivePage() {
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

  const heading = liveData.session?.meetingName || gpName(liveData.nextRace?.raceName || "Upcoming Race");
  const subtitle = liveData.status === "upcoming"
    ? liveData.nextRace?.circuitName || "Next race schedule"
    : [liveData.session?.sessionName, liveData.session?.circuit].filter(Boolean).join(" · ");

  return (
    <div>
      <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:24,marginBottom:20}}>
        <div style={{display:"inline-flex",padding:"6px 12px",borderRadius:999,border:"1px solid #E1060033",background:"#E1060012",fontSize:10,color:"#E10600",textTransform:"uppercase",letterSpacing:1.6,fontWeight:700,marginBottom:12}}>
          {liveData.status}
        </div>
        <div style={{fontSize:28,fontWeight:700,marginBottom:8,color:"#fff"}}>{heading}</div>
        <div style={{fontSize:13,color:"#888",marginBottom:8}}>{subtitle || "Latest timing summary"}</div>
        <div style={{fontSize:12,color:"#666"}}>{liveData.message}</div>
      </div>

      {!!liveData.nextRace && (
        <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:24,marginBottom:20}}>
          <div style={{fontSize:11,color:"#666",textTransform:"uppercase",letterSpacing:1.4,marginBottom:8,fontWeight:700}}>Next Scheduled Race</div>
          <div style={{fontSize:22,fontWeight:700,color:"#fff",marginBottom:6}}>{gpName(liveData.nextRace.raceName)}</div>
          <div style={{fontSize:12,color:"#888",marginBottom:16}}>
            {[liveData.nextRace.circuitName, liveData.nextRace.country].filter(Boolean).join(" • ")}
          </div>
          {countdown ? (
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
              <div style={{background:"#111",border:"1px solid #222",borderRadius:8,padding:14}}>
                <div style={{fontSize:10,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:6,fontWeight:600}}>Days</div>
                <div style={{fontSize:24,fontWeight:700,color:"#fff",...mono}}>{countdown.d}</div>
              </div>
              <div style={{background:"#111",border:"1px solid #222",borderRadius:8,padding:14}}>
                <div style={{fontSize:10,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:6,fontWeight:600}}>Hours</div>
                <div style={{fontSize:24,fontWeight:700,color:"#fff",...mono}}>{countdown.h}</div>
              </div>
              <div style={{background:"#111",border:"1px solid #222",borderRadius:8,padding:14}}>
                <div style={{fontSize:10,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:6,fontWeight:600}}>Mins</div>
                <div style={{fontSize:24,fontWeight:700,color:"#fff",...mono}}>{countdown.m}</div>
              </div>
              <div style={{background:"#111",border:"1px solid #222",borderRadius:8,padding:14}}>
                <div style={{fontSize:10,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:6,fontWeight:600}}>Secs</div>
                <div style={{fontSize:24,fontWeight:700,color:"#fff",...mono}}>{countdown.s}</div>
              </div>
            </div>
          ) : null}
          <div style={{fontSize:12,color:"#666"}}>
            {liveData.nextRace.startTime
              ? new Date(liveData.nextRace.startTime).toLocaleString("en-US", { weekday:"short", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })
              : "Start time unavailable"}
          </div>
        </div>
      )}

      <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:20,marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:14}}>Session Order</div>
        {liveData.leaderboard?.length ? (
          <div style={{display:"grid",gap:10}}>
            {liveData.leaderboard.slice(0, 6).map((driver) => (
              <div key={`${driver.driverNumber}-${driver.code}`} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",borderRadius:10,background:"#111",border:"1px solid #1e1e1e"}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:22,fontSize:16,fontWeight:700,color:"#FFD700",...mono}}>{driver.position ?? "—"}</div>
                  <div style={{width:4,height:26,borderRadius:999,background:driver.teamColor}}/>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{driver.name}</div>
                    <div style={{fontSize:11,color:"#666"}}>{driver.team} • {driver.code}</div>
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#27F4D2",...mono}}>
                    {driver.lastLap != null ? `${driver.lastLap.toFixed(3)}s` : "No lap yet"}
                  </div>
                  <div style={{fontSize:11,color:"#555"}}>{driver.lapCount} laps</div>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty icon="⏱️" msg="No session timing entries available yet."/>}
      </div>

      <div style={{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:20}}>
        <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:14}}>Lap Time Progression</div>
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
      <div style={{marginBottom:20,padding:"14px 16px",background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:10,display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:36,height:36,background:"#FFD70015",border:"1px solid #FFD70030",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>⭐</div>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{trackedCount} tracked item{trackedCount===1?"":"s"}</div>
          <div style={{fontSize:12,color:"#555",marginTop:2}}>
            {watchlist.drivers.size} driver{watchlist.drivers.size===1?"":"s"} · {watchlist.teams.size} constructor{watchlist.teams.size===1?"":"s"}
          </div>
        </div>
      </div>

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

function TelemetryPage() {
  const [telemetryData,setTelemetryData]=useState([]);
  const [selectedDriver,setSelectedDriver]=useState("VER");
  const [currentMetrics,setCurrentMetrics]=useState(null);
  const [drivers,setDrivers]=useState([]);
  const [payload,setPayload]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);

  useEffect(()=>{
    let active = true;

    const loadTelemetry = async () => {
      try {
        const data = await apiFetch(`/api/telemetry?driver=${encodeURIComponent(selectedDriver)}`, 45000);
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
  },[selectedDriver]);

  if(loading) return <Spinner/>;
  if(error) return <Empty icon="⚠️" msg={error}/>;

  return (
    <div>
      {payload?.session && (
        <div style={{marginBottom:12,fontSize:12,color:"#666"}}>
          {[payload.session.meetingName, payload.session.sessionName].filter(Boolean).join(" • ")}
        </div>
      )}
      {payload?.message && (
        <div style={{marginBottom:8,fontSize:12,color:"#888"}}>{payload.message}</div>
      )}
      {payload?.derivedMetricsNotice && (
        <div style={{marginBottom:20,fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:1.2}}>
          {payload.derivedMetricsNotice}
        </div>
      )}
      <div style={{marginBottom:20}}>
        <div style={{fontSize:12,color:"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:10,fontWeight:600}}>Select Driver</div>
        <select value={selectedDriver} onChange={e=>setSelectedDriver(e.target.value)} style={{background:"#111",border:"1px solid #1e1e1e",color:"#fff",padding:"8px 12px",borderRadius:6,fontSize:13,cursor:"pointer",...mono}}>
          {drivers.map(d=><option key={d.code} value={d.code}>{d.name} ({d.code})</option>)}
        </select>
      </div>

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
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(400px,1fr))",gap:20,marginBottom:24}}>
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
      icon:"🏆",
      title:"Championship Standings",
      subtitle:`${season} Formula 1 World Championship`,
      accent:"#FFD700",
    },
    drivers: {
      icon:"👤",
      title:"Driver Profiles",
      subtitle:`${season} · Driver profiles`,
      accent:"#27F4D2",
    },
    constructors: {
      icon:"🏎️",
      title:"Constructor Standings",
      subtitle:`${season} · Constructors`,
      accent:"#FF8000",
    },
    races: {
      icon:"📋",
      title:"Race Results",
      subtitle:`${season} · Full results · qualifying · pit stops`,
      accent:"#a855f7",
    },
    points: {
      icon:"📈",
      title:"Points Progression",
      subtitle:`${season} · Round-by-round title fight and current gaps`,
      accent:"#27F4D2",
    },
    records: {
      icon:"🥇",
      title:"Season Records",
      subtitle:`${season} · Wins, podiums, consistency and constructor leaders`,
      accent:"#FFD700",
    },
    strategy: {
      icon:"🎯",
      title:"Pit Stop Strategy",
      subtitle:`${season} · Stint visualizer · hover to isolate driver`,
      accent:"#E10600",
    },
    h2h: {
      icon:"⚔️",
      title:"Head to Head",
      subtitle:`${season} · Metric board, recent form and race-by-race duel`,
      accent:"#E10600",
    },
    circuits: {
      icon:"🗺️",
      title:"Circuit Explorer",
      subtitle:`${season} · Wikipedia track maps`,
      accent:"#27F4D2",
    },
    live: {
      icon:"🔴",
      title:"Live & Upcoming",
      subtitle:"Next race countdown · Real-time when a race is live",
      accent:"#E10600",
    },
    watchlist: {
      icon:"⭐",
      title:"Watchlist",
      subtitle:`${trackedCount} tracked item${trackedCount !== 1 ? "s" : ""} · ${season} season`,
      accent:"#FFD700",
    },
    telemetry: {
      icon:"📊",
      title:"Telemetry",
      subtitle:"Real-time style driver telemetry",
      accent:"#7C3AED",
    },
  }[page] || {
    icon:curNav?.icon,
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
                  fontSize:15, flexShrink:0, lineHeight:1,
                  filter: active ? "none" : "grayscale(40%)",
                  transition:"filter 0.15s",
                }}>{item.icon}</span>

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
            width: sidebarOpen ? 230 : 52,
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
            flexShrink:0,             /* ← never shrinks — always visible */
            height:72,
            padding:`0 ${isMobile ? 14 : 24}px`,
            display:"flex",
            alignItems:"center",
            justifyContent:"space-between",
            gap:12,
            background:"#080808",
            /* Scroll shadow — appears only when content has been scrolled down */
            borderBottom: scrolled
              ? "1px solid #1e1e1e"
              : "1px solid #141414",
            boxShadow: scrolled
              ? "0 2px 16px rgba(0,0,0,0.5)"
              : "none",
            transition:"box-shadow 0.2s ease, border-color 0.2s ease",
            zIndex:10,                /* above content, below mobile overlay */
          }}>

            {/* Left: hamburger (mobile) + page-header style title block */}
            <div style={{ display:"flex", alignItems:"center", gap:10, overflow:"hidden", flex:1 }}>
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

              {/* Icon + title + subtitle (same design language as PageHeader) */}
              <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0, overflow:"hidden", position:"relative", paddingBottom:4 }}>
                <div style={{
                  width:44, height:44, borderRadius:12,
                  background:`linear-gradient(135deg, ${topbarHeader.accent}22, ${topbarHeader.accent}08)`,
                  border:`1px solid ${topbarHeader.accent}33`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:22, flexShrink:0,
                }}>
                  {topbarHeader.icon}
                </div>

                <div style={{ minWidth:0, overflow:"hidden" }}>
                  <h2 style={{
                    margin:0, fontSize:isMobile ? 18 : 22, fontWeight:900,
                    letterSpacing:-0.5, color:"#fff",
                    whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                    lineHeight:1.1,
                  }}>
                    {topbarHeader.title}
                  </h2>
                  {!isMobile && (
                    <p style={{
                      margin:"3px 0 0", fontSize:12, color:"#444",
                      whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                    }}>
                      {topbarHeader.subtitle}
                    </p>
                  )}
                </div>

                {!isMobile && (
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

            {/* Right: season selector + signout */}
            <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
              {!isMobile && (
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

              <div style={{ width:1, height:22, background:"#1c1c1c", flexShrink:0 }}/>

              <SignOutButton/>
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
              padding:`${isMobile ? 16 : 22}px ${isMobile ? 14 : 24}px`,
              /* Subtle page-change animation */
              animation:"slideIn 0.18s ease-out",
            }}
            key={page} /* re-mount animation on page change */
          >
            {page === "standings"    && <StandingsPage    season={season}/>}
            {page === "drivers"      && <DriversPage      season={season} watchlist={watchlist} onToggle={toggleWatch} watchlistDisabled={!watchlistLoaded || watchlistSyncing} isMobile={isMobile}/>}
            {page === "constructors" && <ConstructorsPage season={season} watchlist={watchlist} onToggle={toggleWatch} watchlistDisabled={!watchlistLoaded || watchlistSyncing} isMobile={isMobile}/>}
            {page === "races"        && <RaceResultsPage  season={season} isMobile={isMobile}/>}
            {page === "points"       && <PointsChartPage  season={season}/>}
            {page === "records"      && <SeasonRecordsPage season={season}/>}
            {page === "strategy"     && <StrategyPage     season={season}/>}
            {page === "h2h"          && <HeadToHeadPage   season={season} isMobile={isMobile}/>}
            {page === "circuits"     && <CircuitsPage     season={season} isMobile={isMobile}/>}
            {page === "telemetry"    && <TelemetryPage/>}
            {page === "live"         && <LivePage/>}
            {page === "watchlist"    && <WatchlistPage    season={season} watchlist={watchlist} onToggle={toggleWatch} trackedCount={trackedCount} watchlistReady={watchlistLoaded} watchlistDisabled={!watchlistLoaded || watchlistSyncing}/>}
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
