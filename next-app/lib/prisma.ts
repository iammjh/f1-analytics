import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var _prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });
}

/** Lazy singleton — avoids PrismaClient init during Next.js production build. */
export function getPrisma(): PrismaClient {
  if (!globalThis._prisma) {
    globalThis._prisma = createPrismaClient();
  }
  return globalThis._prisma;
}

/** @deprecated Prefer getPrisma() — kept for gradual migration */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma();
    const value = client[prop as keyof PrismaClient];
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
});
