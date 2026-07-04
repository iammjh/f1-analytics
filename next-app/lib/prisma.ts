import { PrismaClient } from '@prisma/client';

// ─── Singleton pattern ────────────────────────────────────────────────────────
// Next.js hot-reload in dev creates new module instances on every file change.
// Without this singleton, each reload opens a new connection pool against
// MongoDB and you'll quickly exhaust the Atlas free-tier connection limit.
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var _prisma: PrismaClient | undefined;
}

function createPrismaClient() {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });
}

export const prisma: PrismaClient =
  globalThis._prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis._prisma = prisma;
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// When the process is killed (SIGINT / SIGTERM) close the Prisma connection
// cleanly so MongoDB doesn't keep the socket open.
if (typeof process !== 'undefined') {
  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });
}
