const DEFAULT_TEAM_COLOR = "#E10600";
const DEFAULT_TIMELINE_SAMPLES = 60;

type MaybeNumber = number | null;

export interface OpenF1Session {
  session_key?: number;
  meeting_key?: number;
  session_name?: string;
  session_type?: string;
  meeting_name?: string;
  meeting_official_name?: string;
  circuit_short_name?: string;
  country_name?: string;
  location?: string;
  date_start?: string;
  date_end?: string;
  year?: number;
}

export interface OpenF1Driver {
  driver_number?: number;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  name_acronym?: string;
  team_name?: string;
  team_colour?: string;
  headshot_url?: string;
}

export interface OpenF1Position {
  driver_number?: number;
  position?: number | string;
  date?: string;
}

export interface OpenF1Lap {
  driver_number?: number;
  lap_number?: number | string;
  lap_duration?: number | string | null;
  st_speed?: number | string | null;
  date_start?: string;
}

export interface OpenF1CarData {
  driver_number?: number;
  speed?: number | string | null;
  throttle?: number | string | null;
  brake?: number | string | null;
  drs?: number | string | null;
  n_gear?: number | string | null;
  rpm?: number | string | null;
  date?: string;
}

export interface NormalizedSession {
  sessionKey: number | null;
  meetingKey: number | null;
  meetingName: string;
  sessionName: string;
  circuit: string | null;
  country: string | null;
  startTime: string | null;
  endTime: string | null;
  status: "live" | "scheduled" | "completed";
}

export interface NormalizedDriver {
  driverNumber: number;
  code: string;
  name: string;
  team: string;
  teamColor: string;
  headshotUrl: string | null;
}

export interface NormalizedUpcomingRace {
  round: number | null;
  raceName: string;
  circuitName: string | null;
  country: string | null;
  locality: string | null;
  date: string | null;
  time: string | null;
  startTime: string | null;
}

export interface LiveLeaderboardEntry extends NormalizedDriver {
  position: number | null;
  lastLap: number | null;
  lapCount: number;
}

export interface LiveLapSeriesPoint {
  lap: number;
  [key: string]: number | null;
}

export interface LiveLapSeriesDriver {
  key: string;
  name: string;
  color: string;
}

export interface LiveRacePayload {
  status: "live" | "recent" | "upcoming" | "unavailable";
  session: NormalizedSession | null;
  nextRace: NormalizedUpcomingRace | null;
  leaderboard: LiveLeaderboardEntry[];
  lapSeries: LiveLapSeriesPoint[];
  lapSeriesDrivers: LiveLapSeriesDriver[];
  message: string;
}

export interface TelemetrySample {
  distance: number;
  speed: number;
  throttle: number;
  braking: number;
  fuel: number;
  tireTempF: number;
  tireTempR: number;
  drs: number;
  gear: number;
  rpm: number;
  position: number | null;
  lap: number | null;
  time: string | null;
}

export interface TelemetryPayload {
  session: NormalizedSession | null;
  drivers: NormalizedDriver[];
  selectedDriver: NormalizedDriver | null;
  samples: TelemetrySample[];
  currentMetrics: TelemetrySample | null;
  message: string;
  source: "car-data" | "lap-data" | "none";
  derivedMetricsNotice: string | null;
}

function asDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function asNumber(value: unknown): MaybeNumber {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeTeamColor(color?: string | null) {
  if (!color) return DEFAULT_TEAM_COLOR;
  return color.startsWith("#") ? color : `#${color}`;
}

function sessionLabel(session?: OpenF1Session | null) {
  return session?.session_name || session?.session_type || "Session";
}

function sessionPriority(session: OpenF1Session) {
  const label = sessionLabel(session).toLowerCase();
  if (label.includes("race")) return 500;
  if (label.includes("qualifying")) return 300;
  if (label.includes("sprint")) return 250;
  if (label.includes("practice")) return 100;
  return 0;
}

export function getSessionStatus(
  session?: OpenF1Session | null,
  now = new Date()
): "live" | "scheduled" | "completed" {
  const start = asDate(session?.date_start);
  const end = asDate(session?.date_end);

  if (start && start > now) {
    return "scheduled";
  }

  if (start && end && start <= now && now <= end) {
    return "live";
  }

  if (start && !end) {
    const hoursSinceStart = (now.valueOf() - start.valueOf()) / (1000 * 60 * 60);
    if (hoursSinceStart >= 0 && hoursSinceStart <= 4) {
      return "live";
    }
  }

  return "completed";
}

function sortSessionsNewestFirst(sessions: OpenF1Session[]) {
  return [...sessions].sort((a, b) => {
    const aDate = asDate(a.date_start)?.valueOf() ?? 0;
    const bDate = asDate(b.date_start)?.valueOf() ?? 0;
    if (aDate !== bDate) {
      return bDate - aDate;
    }
    return sessionPriority(b) - sessionPriority(a);
  });
}

export function selectPreferredSession(
  sessions: OpenF1Session[],
  options: { preferRace?: boolean; now?: Date; allowScheduledFallback?: boolean } = {}
) {
  const now = options.now ?? new Date();
  const ordered = sortSessionsNewestFirst(sessions.filter(Boolean));

  if (!ordered.length) {
    return null;
  }

  const liveRace = ordered.find(
    (session) => sessionPriority(session) >= 500 && getSessionStatus(session, now) === "live"
  );
  if (liveRace) {
    return liveRace;
  }

  const liveSession = ordered.find((session) => getSessionStatus(session, now) === "live");
  if (liveSession && !options.preferRace) {
    return liveSession;
  }

  const completedSessions = ordered.filter((session) => getSessionStatus(session, now) === "completed");

  if (options.preferRace) {
    const latestCompletedRace = completedSessions.find((session) => sessionPriority(session) >= 500);
    if (latestCompletedRace) {
      return latestCompletedRace;
    }
  }

  if (completedSessions.length) {
    return completedSessions[0];
  }

  if (options.allowScheduledFallback) {
    const scheduledSessions = ordered
      .filter((session) => getSessionStatus(session, now) === "scheduled")
      .sort((a, b) => {
        const aDate = asDate(a.date_start)?.valueOf() ?? Number.MAX_SAFE_INTEGER;
        const bDate = asDate(b.date_start)?.valueOf() ?? Number.MAX_SAFE_INTEGER;
        return aDate - bDate;
      });

    if (options.preferRace) {
      const nextScheduledRace = scheduledSessions.find((session) => sessionPriority(session) >= 500);
      if (nextScheduledRace) {
        return nextScheduledRace;
      }
    }

    return scheduledSessions[0] || null;
  }

  return null;
}

export function normalizeSession(
  session?: OpenF1Session | null,
  now = new Date()
): NormalizedSession | null {
  if (!session) {
    return null;
  }

  return {
    sessionKey: asNumber(session.session_key),
    meetingKey: asNumber(session.meeting_key),
    meetingName:
      session.meeting_official_name ||
      session.meeting_name ||
      session.country_name ||
      session.location ||
      "Latest session",
    sessionName: sessionLabel(session),
    circuit: session.circuit_short_name || session.location || null,
    country: session.country_name || null,
    startTime: session.date_start || null,
    endTime: session.date_end || null,
    status: getSessionStatus(session, now),
  };
}

export function normalizeUpcomingRace(race: any): NormalizedUpcomingRace | null {
  if (!race) {
    return null;
  }

  const date = race.date || null;
  const time = race.time || null;
  const startTime =
    date && time
      ? new Date(`${date}T${time}`).toISOString()
      : date
        ? new Date(`${date}T13:00:00Z`).toISOString()
        : null;

  return {
    round: asNumber(race.round),
    raceName: race.raceName || race.name || "Upcoming race",
    circuitName: race.Circuit?.circuitName || null,
    country: race.Circuit?.Location?.country || null,
    locality: race.Circuit?.Location?.locality || null,
    date,
    time,
    startTime,
  };
}

export function normalizeDriverList(drivers: OpenF1Driver[]): NormalizedDriver[] {
  return drivers
    .map((driver) => {
      const driverNumber = asNumber(driver.driver_number);
      if (driverNumber === null) {
        return null;
      }

      const firstName = driver.first_name || "";
      const lastName = driver.last_name || "";
      const fullName =
        driver.full_name ||
        `${firstName} ${lastName}`.trim() ||
        driver.name_acronym ||
        `Driver ${driverNumber}`;

      return {
        driverNumber,
        code: (driver.name_acronym || `D${driverNumber}`).toUpperCase(),
        name: fullName,
        team: driver.team_name || "Unknown team",
        teamColor: normalizeTeamColor(driver.team_colour),
        headshotUrl: driver.headshot_url || null,
      };
    })
    .filter((driver): driver is NormalizedDriver => Boolean(driver))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function selectTelemetryDriver(
  drivers: OpenF1Driver[],
  requestedDriver?: string | number | null
) {
  const normalizedDrivers = normalizeDriverList(drivers);
  if (!normalizedDrivers.length) {
    return null;
  }

  if (!requestedDriver) {
    return normalizedDrivers[0];
  }

  const requested = String(requestedDriver).trim().toUpperCase();
  return (
    normalizedDrivers.find(
      (driver) => driver.code === requested || String(driver.driverNumber) === requested
    ) || normalizedDrivers[0]
  );
}

function latestByDriver<T extends { driver_number?: number; date?: string; date_start?: string }>(
  rows: T[],
  getTimeValue: (row: T) => string | undefined
) {
  const latest = new Map<number, T>();

  for (const row of rows) {
    const driverNumber = asNumber(row.driver_number);
    if (driverNumber === null) {
      continue;
    }

    const previous = latest.get(driverNumber);
    const previousTime = previous ? asDate(getTimeValue(previous))?.valueOf() ?? 0 : 0;
    const currentTime = asDate(getTimeValue(row))?.valueOf() ?? 0;

    if (!previous || currentTime >= previousTime) {
      latest.set(driverNumber, row);
    }
  }

  return latest;
}

export function buildLiveLeaderboard(args: {
  drivers: OpenF1Driver[];
  positions: OpenF1Position[];
  laps: OpenF1Lap[];
}) {
  const normalizedDrivers = normalizeDriverList(args.drivers);
  const driversByNumber = new Map(normalizedDrivers.map((driver) => [driver.driverNumber, driver]));
  const latestPositions = latestByDriver(args.positions, (row) => row.date);
  const latestLaps = latestByDriver(args.laps, (row) => row.date_start);

  const driverNumbers = new Set<number>([
    ...driversByNumber.keys(),
    ...latestPositions.keys(),
    ...latestLaps.keys(),
  ]);

  const entries: LiveLeaderboardEntry[] = [];

  for (const driverNumber of driverNumbers) {
    const driver =
      driversByNumber.get(driverNumber) || {
        driverNumber,
        code: `D${driverNumber}`,
        name: `Driver ${driverNumber}`,
        team: "Unknown team",
        teamColor: DEFAULT_TEAM_COLOR,
        headshotUrl: null,
      };

    const position = asNumber(latestPositions.get(driverNumber)?.position);
    const lastLap = asNumber(latestLaps.get(driverNumber)?.lap_duration);
    const lapCount = asNumber(latestLaps.get(driverNumber)?.lap_number) ?? 0;

    entries.push({
      ...driver,
      position,
      lastLap,
      lapCount,
    });
  }

  return entries.sort((a, b) => {
    if (a.position !== null && b.position !== null && a.position !== b.position) {
      return a.position - b.position;
    }
    if (a.position !== null) return -1;
    if (b.position !== null) return 1;
    if (a.lapCount !== b.lapCount) return b.lapCount - a.lapCount;
    return a.name.localeCompare(b.name);
  });
}

export function buildLiveLapSeries(
  laps: OpenF1Lap[],
  featuredDrivers: LiveLeaderboardEntry[],
  maxLaps = 8
) {
  if (!featuredDrivers.length) {
    return [];
  }

  const byLap = new Map<number, LiveLapSeriesPoint>();
  const driverKeys = new Map<number, string>(
    featuredDrivers.map((driver) => [driver.driverNumber, driver.code])
  );

  for (const lap of laps) {
    const driverNumber = asNumber(lap.driver_number);
    const lapNumber = asNumber(lap.lap_number);
    const lapDuration = asNumber(lap.lap_duration);
    if (driverNumber === null || lapNumber === null || lapDuration === null) {
      continue;
    }

    const driverKey = driverKeys.get(driverNumber);
    if (!driverKey) {
      continue;
    }

    const existing = byLap.get(lapNumber) || { lap: lapNumber };
    existing[driverKey] = lapDuration;
    byLap.set(lapNumber, existing);
  }

  return [...byLap.values()]
    .sort((a, b) => a.lap - b.lap)
    .slice(-maxLaps);
}

export function normalizeLiveRacePayload(args: {
  session?: OpenF1Session | null;
  upcomingRace?: any;
  drivers?: OpenF1Driver[];
  positions?: OpenF1Position[];
  laps?: OpenF1Lap[];
  now?: Date;
}): LiveRacePayload {
  const now = args.now ?? new Date();
  const session = normalizeSession(args.session, now);
  const leaderboard = buildLiveLeaderboard({
    drivers: args.drivers || [],
    positions: args.positions || [],
    laps: args.laps || [],
  }).slice(0, 10);
  const lapSeriesDrivers = leaderboard.slice(0, 3).map((driver) => ({
    key: driver.code,
    name: driver.name,
    color: driver.teamColor,
  }));
  const lapSeries = buildLiveLapSeries(args.laps || [], leaderboard.slice(0, 3));
  const nextRace = normalizeUpcomingRace(args.upcomingRace);

  if (session && leaderboard.length) {
    return {
      status: session.status === "live" ? "live" : "recent",
      session,
      nextRace,
      leaderboard,
      lapSeries,
      lapSeriesDrivers,
      message:
        session.status === "live"
          ? `Showing live ${session.sessionName.toLowerCase()} timing from ${session.meetingName}.`
          : `Showing the latest ${session.sessionName.toLowerCase()} timing from ${session.meetingName}.`,
    };
  }

  if (nextRace) {
    return {
      status: "upcoming",
      session,
      nextRace,
      leaderboard,
      lapSeries,
      lapSeriesDrivers,
      message: "No active live timing feed was detected, so the next scheduled race is shown instead.",
    };
  }

  return {
    status: "unavailable",
    session,
    nextRace: null,
    leaderboard,
    lapSeries,
    lapSeriesDrivers,
    message: "Live race data is not available right now.",
  };
}

export function getTelemetryWindowStart(laps: OpenF1Lap[], lookbackLaps = 3) {
  const candidates = [...laps]
    .map((lap) => ({
      lapNumber: asNumber(lap.lap_number),
      dateStart: lap.date_start || null,
    }))
    .filter((lap) => lap.lapNumber !== null && lap.dateStart)
    .sort((a, b) => (a.lapNumber ?? 0) - (b.lapNumber ?? 0));

  const start = candidates[Math.max(0, candidates.length - lookbackLaps)]?.dateStart || null;
  return start;
}

function downsampleSamples<T>(samples: T[], maxSamples = DEFAULT_TIMELINE_SAMPLES) {
  if (samples.length <= maxSamples) {
    return samples;
  }

  const step = Math.ceil(samples.length / maxSamples);
  return samples.filter((_, index) => index % step === 0 || index === samples.length - 1);
}

function estimateFuel(sampleIndex: number, totalSamples: number, lapNumber: number | null, maxLap: number) {
  const sampleProgress = totalSamples > 1 ? sampleIndex / (totalSamples - 1) : 0;
  const lapProgress = maxLap > 0 && lapNumber ? lapNumber / maxLap : sampleProgress;
  return Number((100 - Math.max(sampleProgress, lapProgress) * 72).toFixed(1));
}

function estimateFrontTireTemp(speed: number, throttle: number, braking: number) {
  return Number((72 + speed * 0.04 + throttle * 0.08 + braking * 0.05).toFixed(1));
}

function estimateRearTireTemp(speed: number, throttle: number, braking: number) {
  return Number((70 + speed * 0.035 + throttle * 0.1 + braking * 0.03).toFixed(1));
}

function buildTelemetryFromCarData(args: {
  carData: OpenF1CarData[];
  laps: OpenF1Lap[];
  positions: OpenF1Position[];
}) {
  const orderedCarData = [...args.carData].sort((a, b) => {
    const aTime = asDate(a.date)?.valueOf() ?? 0;
    const bTime = asDate(b.date)?.valueOf() ?? 0;
    return aTime - bTime;
  });
  const orderedLaps = [...args.laps].sort((a, b) => {
    const aTime = asDate(a.date_start)?.valueOf() ?? 0;
    const bTime = asDate(b.date_start)?.valueOf() ?? 0;
    return aTime - bTime;
  });
  const orderedPositions = [...args.positions].sort((a, b) => {
    const aTime = asDate(a.date)?.valueOf() ?? 0;
    const bTime = asDate(b.date)?.valueOf() ?? 0;
    return aTime - bTime;
  });

  const maxLap = Math.max(0, ...orderedLaps.map((lap) => asNumber(lap.lap_number) ?? 0));
  const samples = downsampleSamples(orderedCarData);

  let lapIndex = 0;
  let positionIndex = 0;
  let currentLap = asNumber(orderedLaps[0]?.lap_number);
  let currentPosition = asNumber(orderedPositions[0]?.position);

  return samples.map((sample, index) => {
    const sampleTime = asDate(sample.date);

    while (
      lapIndex + 1 < orderedLaps.length &&
      sampleTime &&
      asDate(orderedLaps[lapIndex + 1]?.date_start) &&
      asDate(orderedLaps[lapIndex + 1]?.date_start)!.valueOf() <= sampleTime.valueOf()
    ) {
      lapIndex += 1;
      currentLap = asNumber(orderedLaps[lapIndex]?.lap_number);
    }

    while (
      positionIndex + 1 < orderedPositions.length &&
      sampleTime &&
      asDate(orderedPositions[positionIndex + 1]?.date) &&
      asDate(orderedPositions[positionIndex + 1]?.date)!.valueOf() <= sampleTime.valueOf()
    ) {
      positionIndex += 1;
      currentPosition = asNumber(orderedPositions[positionIndex]?.position);
    }

    const speed = asNumber(sample.speed) ?? 0;
    const throttle = clamp(asNumber(sample.throttle) ?? 0, 0, 100);
    const braking = clamp(asNumber(sample.brake) ?? 0, 0, 100);
    const gear = clamp(asNumber(sample.n_gear) ?? 0, 0, 8);
    const rpm = asNumber(sample.rpm) ?? 0;
    const drsRaw = asNumber(sample.drs) ?? 0;
    const drs = drsRaw > 0 ? 100 : 0;

    return {
      distance: index * 100,
      speed,
      throttle,
      braking,
      fuel: estimateFuel(index, samples.length, currentLap, maxLap),
      tireTempF: estimateFrontTireTemp(speed, throttle, braking),
      tireTempR: estimateRearTireTemp(speed, throttle, braking),
      drs,
      gear,
      rpm,
      position: currentPosition,
      lap: currentLap,
      time: sample.date || null,
    };
  });
}

function buildTelemetryFromLaps(args: {
  laps: OpenF1Lap[];
  positions: OpenF1Position[];
}) {
  const orderedLaps = [...args.laps]
    .filter((lap) => asNumber(lap.lap_number) !== null)
    .sort((a, b) => (asNumber(a.lap_number) ?? 0) - (asNumber(b.lap_number) ?? 0))
    .slice(-DEFAULT_TIMELINE_SAMPLES);
  const latestPosition =
    latestByDriver(args.positions, (row) => row.date).values().next().value?.position ?? null;
  const maxLap = Math.max(0, ...orderedLaps.map((lap) => asNumber(lap.lap_number) ?? 0));

  return orderedLaps.map((lap, index) => {
    const lapNumber = asNumber(lap.lap_number);
    const speed = asNumber(lap.st_speed) ?? 0;
    const lapDuration = asNumber(lap.lap_duration) ?? 0;
    const throttle = clamp(speed / 3.2, 35, 100);
    const braking = clamp(100 - throttle + (lapDuration > 0 ? 12 : 0), 0, 100);
    const gear = clamp(Math.round(speed / 40), 1, 8);
    const rpm = Math.round(speed * 42);

    return {
      distance: index * 100,
      speed,
      throttle,
      braking,
      fuel: estimateFuel(index, orderedLaps.length, lapNumber, maxLap),
      tireTempF: estimateFrontTireTemp(speed, throttle, braking),
      tireTempR: estimateRearTireTemp(speed, throttle, braking),
      drs: speed >= 285 ? 100 : 0,
      gear,
      rpm,
      position: asNumber(latestPosition),
      lap: lapNumber,
      time: lap.date_start || null,
    };
  });
}

export function normalizeTelemetryPayload(args: {
  session?: OpenF1Session | null;
  drivers?: OpenF1Driver[];
  selectedDriver?: NormalizedDriver | null;
  carData?: OpenF1CarData[];
  laps?: OpenF1Lap[];
  positions?: OpenF1Position[];
  now?: Date;
}): TelemetryPayload {
  const now = args.now ?? new Date();
  const session = normalizeSession(args.session, now);
  const drivers = normalizeDriverList(args.drivers || []);
  const selectedDriver = args.selectedDriver || null;
  const carData = args.carData || [];
  const laps = args.laps || [];
  const positions = args.positions || [];

  const samples =
    carData.length > 0
      ? buildTelemetryFromCarData({ carData, laps, positions })
      : laps.length > 0
        ? buildTelemetryFromLaps({ laps, positions })
        : [];

  const source: TelemetryPayload["source"] =
    carData.length > 0 ? "car-data" : laps.length > 0 ? "lap-data" : "none";

  const currentMetrics = samples[samples.length - 1] || null;
  const driverName = selectedDriver?.name || "the selected driver";
  let message = "Telemetry data is not available right now.";

  if (source === "car-data") {
    message = `Showing OpenF1 telemetry samples for ${driverName}.`;
  } else if (source === "lap-data") {
    message = `Showing lap-derived telemetry estimates for ${driverName} because per-sample car data was unavailable.`;
  }

  return {
    session,
    drivers,
    selectedDriver,
    samples,
    currentMetrics,
    message,
    source,
    derivedMetricsNotice:
      source === "none"
        ? null
        : "Fuel and tire temperature charts are estimated from the available OpenF1 timing feed.",
  };
}
