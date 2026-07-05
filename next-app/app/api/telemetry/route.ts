import { NextResponse } from 'next/server';
import { f1Api } from '@/lib/f1-api';
import {
  getTelemetryWindowStart,
  normalizeTelemetryPayload,
  selectPreferredSession,
  selectTelemetryDriver,
} from '@/lib/live-telemetry';
import { parseSeasonParam } from '@/lib/query-params';

export const dynamic = 'force-dynamic';

interface CacheEntry {
  data: any;
  expiresAt: number;
}
const telemetryCache = new Map<string, CacheEntry>();

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const seasonResult = parseSeasonParam(searchParams.get('season'));
    if (!seasonResult.ok) {
      return NextResponse.json({ error: seasonResult.error }, { status: 400 });
    }
    const season = seasonResult.value;
    const requestedDriver = searchParams.get('driver');
    const requestedSessionKey = searchParams.get('sessionKey');

    let session: any = null;
    let rawDrivers: any[] = [];

    if (requestedSessionKey) {
      // Parallelize session metadata and driver list load
      const [sessionResult, driversResult] = await Promise.all([
        f1Api.sessions({ session_key: requestedSessionKey }),
        f1Api.drivers({ session_key: requestedSessionKey }),
      ]);
      session = Array.isArray(sessionResult.data) ? sessionResult.data[0] || null : null;
      rawDrivers = Array.isArray(driversResult.data) ? driversResult.data : [];
    } else {
      const sessionsResult = await f1Api.sessions({ year: season });
      const sessions = Array.isArray(sessionsResult.data) ? sessionsResult.data : [];
      session = selectPreferredSession(sessions, { preferRace: false, allowScheduledFallback: false });
      if (session?.session_key) {
        const driversResult = await f1Api.drivers({ session_key: session.session_key });
        rawDrivers = Array.isArray(driversResult.data) ? driversResult.data : [];
      }
    }

    if (!session?.session_key) {
      return NextResponse.json(normalizeTelemetryPayload({ session: null }));
    }

    const selectedDriver = selectTelemetryDriver(rawDrivers, requestedDriver);
    if (!selectedDriver) {
      return NextResponse.json(
        normalizeTelemetryPayload({
          session,
          drivers: rawDrivers,
          selectedDriver: null,
        })
      );
    }

    // Cache lookup: instantly return completed static sessions or recently fetched live sessions
    const cacheKey = `${session.session_key}-${selectedDriver.driverNumber}`;
    const cached = telemetryCache.get(cacheKey);
    const nowMs = Date.now();
    if (cached && cached.expiresAt > nowMs) {
      return NextResponse.json(cached.data);
    }

    const [lapsResult, positionsResult] = await Promise.allSettled([
      f1Api.laps({
        session_key: session.session_key,
        driver_number: selectedDriver.driverNumber,
      }),
      f1Api.positions({
        session_key: session.session_key,
        driver_number: selectedDriver.driverNumber,
      }),
    ]);

    const laps =
      lapsResult.status === 'fulfilled' && Array.isArray(lapsResult.value.data)
        ? lapsResult.value.data
        : [];
    const positions =
      positionsResult.status === 'fulfilled' && Array.isArray(positionsResult.value.data)
        ? positionsResult.value.data
        : [];

    let carData: any[] = [];
    const telemetryWindowStart = getTelemetryWindowStart(laps);

    const carDataResult = await Promise.allSettled([
      f1Api.carData({
        session_key: session.session_key,
        driver_number: selectedDriver.driverNumber,
        ...(telemetryWindowStart ? { 'date>=': telemetryWindowStart } : {}),
      }),
    ]);

    if (
      carDataResult[0]?.status === 'fulfilled' &&
      Array.isArray(carDataResult[0].value.data)
    ) {
      carData = carDataResult[0].value.data;
    }

    const payload = normalizeTelemetryPayload({
      session,
      drivers: rawDrivers,
      selectedDriver,
      carData,
      laps,
      positions,
    });

    // Determine cache length: completed sessions are immutable (24 hrs TTL), live sessions expire quickly (15s TTL)
    const isCompleted = session.date_end ? new Date(session.date_end) < new Date() : true;
    const ttlMs = isCompleted ? 24 * 60 * 60 * 1000 : 15 * 1000;
    telemetryCache.set(cacheKey, {
      data: payload,
      expiresAt: Date.now() + ttlMs,
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Telemetry API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch telemetry data' },
      { status: 500 }
    );
  }
}
