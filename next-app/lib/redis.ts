import { createClient } from 'redis';
import { getRedisUrl } from '@/lib/redis-config';

let redis: ReturnType<typeof createClient> | null = null;

export const getRedis = async () => {
  if (!redis) {
    redis = createClient({
      url: getRedisUrl(),
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
