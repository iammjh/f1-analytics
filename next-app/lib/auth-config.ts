import GitHubProvider from 'next-auth/providers/github';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { getPrisma } from '@/lib/prisma';
import { ensureUserOnboarding } from '@/lib/user-onboarding';
import bcrypt from 'bcryptjs';
import type { NextAuthOptions } from 'next-auth';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function isNextBuildPhase(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build';
}

function buildAuthOptions(): NextAuthOptions {
  const options: NextAuthOptions = {
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
          const prisma = getPrisma();

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

          const user = await prisma.user.findUnique({ where: { email } });

          if (!user?.password) {
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

    events: {
      async createUser({ user }) {
        if (user.id) await ensureUserOnboarding(user.id);
      },
    },

    callbacks: {
      async jwt({ token, user }) {
        if (user) token.id = user.id;
        return token;
      },

      async session({ session, token }) {
        if (session.user && token.id) {
          session.user.id = token.id as string;
        }
        return session;
      },
    },

    pages: {
      signIn:  '/auth/signin',
      signOut: '/auth/signout',
      error:   '/auth/error',
    },

    session: {
      strategy: 'jwt',
      maxAge:   30 * 24 * 60 * 60,
    },

    secret: process.env.NEXTAUTH_SECRET,
    debug: process.env.NODE_ENV === 'development',
  };

  // Skip Prisma adapter during `next build` — avoids DB init at compile time.
  if (!isNextBuildPhase()) {
    options.adapter = PrismaAdapter(getPrisma());
  }

  return options;
}

let cachedAuthOptions: NextAuthOptions | undefined;

export function getAuthOptions(): NextAuthOptions {
  if (!cachedAuthOptions) {
    cachedAuthOptions = buildAuthOptions();
  }
  return cachedAuthOptions;
}

/** @deprecated Use getAuthOptions() — lazy init safe for Vercel builds */
export const authOptions = new Proxy({} as NextAuthOptions, {
  get(_target, prop) {
    return getAuthOptions()[prop as keyof NextAuthOptions];
  },
});
