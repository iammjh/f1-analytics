import { NextRequest, NextResponse } from 'next/server';
import { getRedis, cacheKey } from '@/lib/redis';
import { f1Api } from '@/lib/f1-api';
import { parseRoundParam, parseSeasonParam } from '@/lib/query-params';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const seasonResult = parseSeasonParam(searchParams.get('season'));
    if (!seasonResult.ok) {
      return NextResponse.json({ error: seasonResult.error }, { status: 400 });
    }
    const season = seasonResult.value;

    const roundResult = parseRoundParam(searchParams.get('round'));
    if (roundResult && !roundResult.ok) {
      return NextResponse.json({ error: roundResult.error }, { status: 400 });
    }
    const round = roundResult?.ok ? String(roundResult.value) : null;

    const redis = await getRedis();
    const cacheKeyStr = round
      ? cacheKey.results(season, Number(round))
      : cacheKey.races(season);
    
    // Check cache
    const cached = await redis.get(cacheKeyStr);
    if (cached) {
      return NextResponse.json(JSON.parse(cached));
    }

    // Fetch from API
    let data;
    if (round) {
      const res = await f1Api.results(Number(season), round);
      data = res.data.MRData.RaceTable.Races[0];
    } else {
      const res = await f1Api.races(Number(season));
      data = res.data.MRData.RaceTable.Races;
    }

    // Cache for 1 hour
    await redis.setEx(cacheKeyStr, 3600, JSON.stringify(data));

    return NextResponse.json(data);
  } catch (error) {
    console.error('Race API error:', error);
    return NextResponse.json({ error: 'Failed to fetch races' }, { status: 500 });
  }
}
