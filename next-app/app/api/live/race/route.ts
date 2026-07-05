import { NextResponse } from 'next/server';
import { f1Api } from '@/lib/f1-api';
import { fetchSeasonRaces, findNextUpcomingRace } from '@/lib/jolpica-client';
import { normalizeLiveRacePayload, selectPreferredSession } from '@/lib/live-telemetry';
import { parseSeasonParam } from '@/lib/query-params';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const seasonResult = parseSeasonParam(searchParams.get('season'));
    if (!seasonResult.ok) {
      return NextResponse.json({ error: seasonResult.error }, { status: 400 });
    }
    const season = seasonResult.value;

    const [sessionsResult, racesResult] = await Promise.allSettled([
      f1Api.sessions({ year: season }),
      fetchSeasonRaces(season),
    ]);

    const sessions =
      sessionsResult.status === 'fulfilled' && Array.isArray(sessionsResult.value.data)
        ? sessionsResult.value.data
        : [];
    const races = racesResult.status === 'fulfilled' ? racesResult.value : [];
    const session = selectPreferredSession(sessions, { preferRace: true, allowScheduledFallback: false });

    let drivers: any[] = [];
    let positions: any[] = [];
    let laps: any[] = [];

    if (session?.session_key) {
      const [driversResult, positionsResult, lapsResult] = await Promise.allSettled([
        f1Api.drivers({ session_key: session.session_key }),
        f1Api.positions({ session_key: session.session_key }),
        f1Api.laps({ session_key: session.session_key }),
      ]);

      drivers =
        driversResult.status === 'fulfilled' && Array.isArray(driversResult.value.data)
          ? driversResult.value.data
          : [];
      positions =
        positionsResult.status === 'fulfilled' && Array.isArray(positionsResult.value.data)
          ? positionsResult.value.data
          : [];
      laps =
        lapsResult.status === 'fulfilled' && Array.isArray(lapsResult.value.data)
          ? lapsResult.value.data
          : [];
    }

    return NextResponse.json(
      normalizeLiveRacePayload({
        session,
        upcomingRace: findNextUpcomingRace(races),
        drivers,
        positions,
        laps,
      })
    );
  } catch (error) {
    console.error('Live race API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch live race data' },
      { status: 500 }
    );
  }
}
