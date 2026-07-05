import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { getAuthOptions } from '@/lib/auth-config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type AuthHandler = ReturnType<typeof NextAuth>;

let handler: AuthHandler | undefined;

function getHandler(): AuthHandler {
  if (!handler) {
    handler = NextAuth(getAuthOptions());
  }
  return handler;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Record<string, string | string[]> },
) {
  return getHandler()(req, ctx);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Record<string, string | string[]> },
) {
  return getHandler()(req, ctx);
}
