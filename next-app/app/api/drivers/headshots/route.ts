import { NextResponse } from 'next/server';
import { f1Api } from '@/lib/f1-api';
import { selectPreferredSession } from '@/lib/live-telemetry';

export const dynamic = 'force-dynamic';

function parseSeason(rawSeason: string | null) {
  const fallbackSeason = new Date().getFullYear();
  if (!rawSeason) return fallbackSeason;
  const parsedSeason = Number(rawSeason);
  return Number.isFinite(parsedSeason) && parsedSeason > 0 ? parsedSeason : fallbackSeason;
}

function normalizeDriverHeadshotEntry(driver: any) {
  const firstName = driver?.first_name || '';
  const lastName = driver?.last_name || '';
  const fullName =
    driver?.full_name ||
    [firstName, lastName].filter(Boolean).join(' ') ||
    null;

  return {
    driverNumber:
      driver?.driver_number === undefined || driver?.driver_number === null
        ? null
        : Number(driver.driver_number),
    code: driver?.name_acronym || null,
    firstName: firstName || null,
    lastName: lastName || null,
    fullName,
    teamName: driver?.team_name || null,
    headshotUrl: driver?.headshot_url || null,
  };
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const season = parseSeason(searchParams.get('season'));

    const sessionsResult = await f1Api.sessions({ year: season });
    const sessions = Array.isArray(sessionsResult.data) ? sessionsResult.data : [];

    const session =
      selectPreferredSession(sessions, { preferRace: true, allowScheduledFallback: false }) ||
      selectPreferredSession(sessions, { preferRace: false, allowScheduledFallback: true }) ||
      sessions.at(-1) ||
      null;

    if (!session?.session_key) {
      return NextResponse.json({ season, sessionKey: null, drivers: [] });
    }

    const driversResult = await f1Api.drivers({ session_key: session.session_key });
    const rawDrivers = Array.isArray(driversResult.data) ? driversResult.data : [];

    return NextResponse.json({
      season,
      sessionKey: session.session_key,
      drivers: rawDrivers.map(normalizeDriverHeadshotEntry),
    });
  } catch (error) {
    console.error('Driver headshots API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch driver headshots' },
      { status: 500 }
    );
  }
}
