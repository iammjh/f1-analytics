import Queue from 'bull';
import { getRedis } from '@/lib/redis';
import { f1Api } from '@/lib/f1-api';
import { prisma } from '@/lib/prisma';

// Create job queues
export const raceSyncQueue = new Queue('race-sync', {
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
});

export const telemetrySyncQueue = new Queue('telemetry-sync', {
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
});

// Race sync job processor
raceSyncQueue.process(async (job) => {
  const { season } = job.data;

  try {
    const res = await f1Api.races(season);
    const races = res.data.MRData.RaceTable.Races;

    // Store in database
    for (const race of races) {
      await prisma.race.upsert({
        where: { raceId: parseInt(race.round) },
        create: {
          raceId: parseInt(race.round),
          season,
          round: parseInt(race.round),
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

    // Cache in Redis
    const redis = await getRedis();
    await redis.setEx(`races:${season}`, 3600, JSON.stringify(races));

    return { processed: races.length };
  } catch (error) {
    console.error('Race sync failed:', error);
    throw error;
  }
});

// Telemetry sync job processor
telemetrySyncQueue.process(async (job) => {
  const { sessionId, meetingId } = job.data;

  try {
    const res = await f1Api.sessions(meetingId);
    const session = res.data.find((s: any) => s.session_key === sessionId);

    if (!session) {
      throw new Error('Session not found');
    }

    // Cache session data
    const redis = await getRedis();
    await redis.setEx(
      `telemetry:${sessionId}`,
      300, // 5 minutes
      JSON.stringify(session)
    );

    return { session_key: sessionId, cached: true };
  } catch (error) {
    console.error('Telemetry sync failed:', error);
    throw error;
  }
});

// Schedule recurring jobs
export function scheduleJobs() {
  const season = new Date().getFullYear();

  // Sync races every hour
  raceSyncQueue.add({ season }, { repeat: { every: 60000 * 60 } });

  // Sync telemetry every 5 seconds during race weekends
  telemetrySyncQueue.add(
    { sessionId: 1, meetingId: 1 },
    { repeat: { every: 5000 } }
  );
}
