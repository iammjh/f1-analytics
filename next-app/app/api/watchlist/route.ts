import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { prisma } from '@/lib/prisma';

// ─── GET /api/watchlist ────────────────────────────────────────────────────────
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const watchlists = await prisma.watchlist.findMany({
      where:   { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
    });
    // drivers / teams / races are now String[] — no JSON.parse needed
    return NextResponse.json(watchlists);
  } catch (error) {
    console.error('[watchlist GET]', error);
    return NextResponse.json(
      { error: 'Failed to fetch watchlists' },
      { status: 500 },
    );
  }
}

// ─── POST /api/watchlist ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Validate that array fields are actually arrays (guard against legacy
    // JSON-string payloads from clients that haven't been updated yet)
    const toArray = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.map(String);
      if (typeof v === 'string') {
        try { return JSON.parse(v); } catch { return []; }
      }
      return [];
    };

    const watchlist = await prisma.watchlist.create({
      data: {
        userId:      session.user.id,
        name:        typeof body.name === 'string' ? body.name : 'My Watchlist',
        description: typeof body.description === 'string' ? body.description : undefined,
        drivers:     toArray(body.drivers),
        teams:       toArray(body.teams),
        races:       toArray(body.races),
        isPublic:    Boolean(body.isPublic),
      },
    });

    return NextResponse.json(watchlist, { status: 201 });
  } catch (error) {
    console.error('[watchlist POST]', error);
    return NextResponse.json(
      { error: 'Failed to create watchlist' },
      { status: 500 },
    );
  }
}
