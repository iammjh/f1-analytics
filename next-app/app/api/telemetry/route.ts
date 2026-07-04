import { NextResponse } from 'next/server';
import { f1Api } from '@/lib/f1-api';
import {
  getTelemetryWindowStart,
  normalizeTelemetryPayload,
  selectPreferredSession,
  selectTelemetryDriver,
} from '@/lib/live-telemetry';

export const dynamic = 'force-dynamic';

function parseSeason(rawSeason: string | null) {
  const fallbackSeason = new Date().getFullYear();
  if (!rawSeason) return fallbackSeason;
  const parsedSeason = Number(rawSeason);
  return Number.isFinite(parsedSeason) && parsedSeason > 0 ? parsedSeason : fallbackSeason;
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const requestedDriver = searchParams.get('driver');
    const requestedSessionKey = searchParams.get('sessionKey');
    const season = parseSeason(searchParams.get('season'));

    let session: any = null;

    if (requestedSessionKey) {
      const sessionResult = await f1Api.sessions({ session_key: requestedSessionKey });
      session = Array.isArray(sessionResult.data) ? sessionResult.data[0] || null : null;
    } else {
      const sessionsResult = await f1Api.sessions({ year: season });
      const sessions = Array.isArray(sessionsResult.data) ? sessionsResult.data : [];
      session = selectPreferredSession(sessions, { preferRace: false, allowScheduledFallback: false });
    }

    if (!session?.session_key) {
      return NextResponse.json(normalizeTelemetryPayload({ session: null }));
    }

    const driversResult = await f1Api.drivers({ session_key: session.session_key });
    const rawDrivers = Array.isArray(driversResult.data) ? driversResult.data : [];
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

    return NextResponse.json(
      normalizeTelemetryPayload({
        session,
        drivers: rawDrivers,
        selectedDriver,
        carData,
        laps,
        positions,
      })
    );
  } catch (error) {
    console.error('Telemetry API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch telemetry data' },
      { status: 500 }
    );
  }
}
