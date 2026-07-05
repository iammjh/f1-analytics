import { getPrisma } from '@/lib/prisma';

/** Default watchlist + preferences for new accounts (parity with legacy Express register). */
export async function ensureUserOnboarding(userId: string): Promise<void> {
  const prisma = getPrisma();
  const [preferences, watchlistCount] = await Promise.all([
    prisma.userPreferences.findUnique({ where: { userId } }),
    prisma.watchlist.count({ where: { userId } }),
  ]);

  const tasks: Promise<unknown>[] = [];

  if (!preferences) {
    tasks.push(
      prisma.userPreferences.create({
        data: {
          userId,
          emailNotifications: true,
          pushNotifications: true,
          notifyRaceStart: true,
          notifyQualifying: true,
          notifyPractice: false,
        },
      }),
    );
  }

  if (watchlistCount === 0) {
    tasks.push(
      prisma.watchlist.create({
        data: {
          userId,
          name: 'My Favorites',
          drivers: [],
          teams: [],
          races: [],
        },
      }),
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}
