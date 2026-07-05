/**
 * One-time migration: legacy Mongoose `users` + `watchlists` → Prisma `User` collections.
 *
 * Run from next-app (requires MONGODB_URI in .env.local):
 *   npm run db:migrate-legacy-users
 *
 * Safe to re-run — skips emails that already exist in Prisma User.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

function oid(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && '$oid' in value) return value.$oid;
  return String(value);
}

async function findLegacy(collection) {
  const result = await prisma.$runCommandRaw({
    find: collection,
    filter: {},
  });

  return result.cursor?.firstBatch ?? [];
}

async function main() {
  const legacyUsers = await findLegacy('users');
  const legacyWatchlists = await findLegacy('watchlists');

  if (legacyUsers.length === 0) {
    console.log('No legacy users found in `users` collection — nothing to migrate.');
    return;
  }

  console.log(`Found ${legacyUsers.length} legacy user(s). Migrating…`);

  let migrated = 0;
  let skipped = 0;

  for (const legacy of legacyUsers) {
    const email = legacy.email?.toLowerCase().trim();
    if (!email || !legacy.password) {
      console.warn('Skipping user without email/password:', oid(legacy._id));
      skipped += 1;
      continue;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`Skip (already in Prisma): ${email}`);
      skipped += 1;
      continue;
    }

    const userId = oid(legacy._id);
    const userWatchlists = legacyWatchlists.filter(
      (w) => oid(w.userId) === userId,
    );

    await prisma.user.create({
      data: {
        id: userId,
        email,
        name: legacy.username ?? email.split('@')[0],
        password: legacy.password,
        createdAt: legacy.createdAt
          ? new Date(
              typeof legacy.createdAt === 'string'
                ? legacy.createdAt
                : legacy.createdAt.$date,
            )
          : undefined,
        preferences: {
          create: {
            favoriteTeam: legacy.favoriteTeam ?? null,
            favoriteDriver: legacy.favoriteDriver ?? null,
            emailNotifications: legacy.emailNotifications ?? true,
            pushNotifications: legacy.pushNotifications ?? true,
            notifyRaceStart:
              userWatchlists[0]?.notifications?.raceStart ?? true,
            notifyQualifying:
              userWatchlists[0]?.notifications?.qualifyingStart ?? true,
            notifyPractice:
              userWatchlists[0]?.notifications?.practiceStart ?? false,
          },
        },
        watchlists: {
          create: (userWatchlists.length > 0
            ? userWatchlists
            : [{ name: 'My Favorites', drivers: [], teams: [], races: [] }]
          ).map((w) => ({
            name: w.name ?? 'My Favorites',
            drivers: w.drivers ?? [],
            teams: w.teams ?? [],
            races: (w.races ?? []).map(String),
          })),
        },
      },
    });

    console.log(`Migrated: ${email}`);
    migrated += 1;
  }

  console.log(`Done. Migrated ${migrated}, skipped ${skipped}.`);
  console.log(
    'Legacy `users` / `watchlists` collections were left untouched — delete manually after verifying.',
  );
}

main()
  .catch((err) => {
    console.error('[migrate-legacy-users]', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
