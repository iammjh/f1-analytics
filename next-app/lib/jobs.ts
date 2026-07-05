/**
 * Background job queues (Bull + Redis).
 *
 * Disabled by default. Set BACKGROUND_JOBS_ENABLED=true in next-app/.env.local
 * to start recurring race/telemetry sync on the Next.js server process.
 */
import Queue from 'bull';
import { getRedis } from '@/lib/redis';
import { getRedisUrl } from '@/lib/redis-config';
import { f1Api } from '@/lib/f1-api';
import { prisma } from '@/lib/prisma';
import type { OpenF1Session } from '@/lib/live-telemetry';
import { selectPreferredSession } from '@/lib/live-telemetry';

const redisUrl = getRedisUrl();

export const raceSyncQueue = new Queue('race-sync', { redis: redisUrl });
export const telemetrySyncQueue = new Queue('telemetry-sync', { redis: redisUrl });

const RACE_SYNC_MS = 60 * 60 * 1000;
const TELEMETRY_SYNC_MS = 30_000;

async function resolveTelemetrySession(season: number): Promise<OpenF1Session | null> {
  const res = await f1Api.sessions({ year: season });
  const sessions = Array.isArray(res.data) ? (res.data as OpenF1Session[]) : [];
  return selectPreferredSession(sessions, {
    preferRace: false,
    allowScheduledFallback: true,
  });
}

raceSyncQueue.process(async (job) => {
  const season = Number(job.data.season) || new Date().getFullYear();

  const res = await f1Api.races(season);
  const races = res.data.MRData.RaceTable.Races;

  for (const race of races) {
    await prisma.race.upsert({
      where: { raceId: parseInt(race.round, 10) },
      create: {
        raceId: parseInt(race.round, 10),
        season,
        round: parseInt(race.round, 10),
        name: race.name,
        circuit: race.Circuit.name,
        date: new Date(race.date),
        time: race.time,
        status: 'scheduled',
      },
      update: {
        status: 'scheduled',
      },
    });
  }

  const redis = await getRedis();
  await redis.setEx(`races:${season}`, 3600, JSON.stringify(races));

  return { processed: races.length };
});

telemetrySyncQueue.process(async (job) => {
  const season = Number(job.data.season) || new Date().getFullYear();
  const session = await resolveTelemetrySession(season);

  if (!session?.session_key) {
    return { skipped: true, reason: 'no-active-session' };
  }

  const redis = await getRedis();
  await redis.setEx(
    `telemetry:${session.session_key}`,
    300,
    JSON.stringify(session),
  );

  return { session_key: session.session_key, cached: true };
});

export function scheduleJobs() {
  if (process.env.BACKGROUND_JOBS_ENABLED !== 'true') {
    return false;
  }

  const season = new Date().getFullYear();

  raceSyncQueue.add({ season }, { repeat: { every: RACE_SYNC_MS } });
  telemetrySyncQueue.add({ season }, { repeat: { every: TELEMETRY_SYNC_MS } });

  console.log('[jobs] Background sync enabled (race + telemetry queues scheduled)');
  return true;
}
