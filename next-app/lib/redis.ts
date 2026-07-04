import { createClient } from 'redis';

let redis: ReturnType<typeof createClient> | null = null;

export const getRedis = async () => {
  if (!redis) {
    redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    redis.on('error', (err) => console.log('Redis Client Error', err));
    await redis.connect();
  }
  return redis;
};

export const cacheKey = {
  races: (season: number) => `races:${season}`,
  race: (season: number, round: number) => `race:${season}:${round}`,
  results: (season: number, round: number) => `results:${season}:${round}`,
  telemetry: (raceId: number) => `telemetry:${raceId}`,
  standings: (season: number) => `standings:${season}`,
};
