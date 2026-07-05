import GitHubProvider from 'next-auth/providers/github';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import { ensureUserOnboarding } from '@/lib/user-onboarding';
import bcrypt from 'bcryptjs';
import type { NextAuthOptions } from 'next-auth';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

// ─── Notes on MongoDB + NextAuth ──────────────────────────────────────────────
//
//  • PrismaAdapter works with MongoDB — it stores OAuth accounts, sessions,
//    and verification tokens in the collections defined in schema.prisma.
//
//  • We use strategy: "jwt" so active sessions are NOT stored in the DB
//    (avoids hitting the Atlas free-tier connection limit on every request).
//    The Session collection is only written to by OAuth flows when strategy
//    is "database" — with JWT it stays empty, which is fine.
//
//  • CredentialsProvider cannot create DB sessions (NextAuth restriction).
//    JWT strategy means this works correctly — the token is stored in a
//    cookie and decoded on each request without a DB round-trip.
//
//  • MongoDB ObjectIds are returned by Prisma as 24-char hex strings.
//    NextAuth stores them as-is — no special handling needed.
// ─────────────────────────────────────────────────────────────────────────────

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),

  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID ?? '',
      clientSecret: process.env.GITHUB_SECRET ?? '',
    }),

    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),

    CredentialsProvider({
      name: 'Email',
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
        isSignUp: { label: 'Sign Up',  type: 'text'     },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email and password are required');
        }

        const email = normalizeEmail(credentials.email);
        if (!EMAIL_REGEX.test(email)) {
          throw new Error('Invalid email format');
        }
        if (credentials.password.length > 128) {
          throw new Error('Password must be 128 characters or fewer');
        }

        // ── Sign-up flow ───────────────────────────────────────────────────
        if (credentials.isSignUp === 'true') {
          if (credentials.password.length < 6) {
            throw new Error('Password must be at least 6 characters');
          }

          const existing = await prisma.user.findUnique({ where: { email } });
          if (existing) throw new Error('Email already registered');

          const hash = await bcrypt.hash(credentials.password, 12);
          const user = await prisma.user.create({
            data: {
              email,
              name: email.split('@')[0],
              password: hash,
            },
          });

          await ensureUserOnboarding(user.id);

          return {
            id:    user.id,
            email: user.email,
            name:  user.name,
            image: user.image,
          };
        }

        // ── Sign-in flow ───────────────────────────────────────────────────
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user?.password) {
          // User exists but signed up via OAuth — no password set
          throw new Error('Invalid email or password');
        }

        const passwordMatch = await bcrypt.compare(
          credentials.password,
          user.password,
        );
        if (!passwordMatch) throw new Error('Invalid email or password');

        return {
          id:    user.id,
          email: user.email,
          name:  user.name,
          image: user.image,
        };
      },
    }),
  ],

  // ── Events ─────────────────────────────────────────────────────────────────
  events: {
    // OAuth sign-ups are created by PrismaAdapter — seed defaults here.
    async createUser({ user }) {
      if (user.id) await ensureUserOnboarding(user.id);
    },
  },

  // ── Callbacks ──────────────────────────────────────────────────────────────
  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in `user` is populated; persist the DB id in the token
      if (user) token.id = user.id;
      return token;
    },

    async session({ session, token }) {
      // Expose the DB id to the client session
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },

  // ── Pages ──────────────────────────────────────────────────────────────────
  pages: {
    signIn:  '/auth/signin',
    signOut: '/auth/signout',
    error:   '/auth/error',
  },

  // ── Session ────────────────────────────────────────────────────────────────
  session: {
    strategy: 'jwt',
    maxAge:   30 * 24 * 60 * 60, // 30 days
  },

  // ── Security ───────────────────────────────────────────────────────────────
  secret: process.env.NEXTAUTH_SECRET,

  debug: process.env.NODE_ENV === 'development',
};
