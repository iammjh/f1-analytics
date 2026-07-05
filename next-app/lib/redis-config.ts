/**
 * Redis connection settings.
 *
 * Dev:  REDIS_URL=redis://localhost:6379 (no password, localhost only)
 * Prod: REDIS_URL=redis://:PASSWORD@host:6379  (password required)
 */
export function getRedisUrl(): string {
  const url = process.env.REDIS_URL?.trim() || 'redis://localhost:6379';

  if (process.env.NODE_ENV === 'production') {
    let hasPassword = false;

    try {
      const parsed = new URL(url);
      hasPassword = Boolean(parsed.password);
    } catch {
      throw new Error(
        'REDIS_URL must be a valid URL in production (e.g. redis://:password@host:6379)',
      );
    }

    if (!hasPassword) {
      throw new Error(
        'REDIS_URL must include a password in production. ' +
          'Example: redis://:your-strong-password@your-redis-host:6379',
      );
    }
  }

  return url;
}
