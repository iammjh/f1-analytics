import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { prisma } from '@/lib/prisma';

type Params = { params: { id: string } };

// ─── PUT /api/watchlist/[id] ───────────────────────────────────────────────────
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Ownership check — prevent users editing other users' watchlists
    const existing = await prisma.watchlist.findUnique({
      where: { id: params.id },
      select: { userId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (existing.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();

    // Same defensive helper as the POST route
    const toArray = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.map(String);
      if (typeof v === 'string') {
        try { return JSON.parse(v); } catch { return []; }
      }
      return [];
    };

    const updated = await prisma.watchlist.update({
      where: { id: params.id },
      data: {
        ...(body.name        !== undefined && { name:        String(body.name) }),
        ...(body.description !== undefined && { description: String(body.description) }),
        ...(body.drivers     !== undefined && { drivers:     toArray(body.drivers) }),
        ...(body.teams       !== undefined && { teams:       toArray(body.teams) }),
        ...(body.races       !== undefined && { races:       toArray(body.races) }),
        ...(body.isPublic    !== undefined && { isPublic:    Boolean(body.isPublic) }),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[watchlist PUT]', error);
    return NextResponse.json(
      { error: 'Failed to update watchlist' },
      { status: 500 },
    );
  }
}

// ─── DELETE /api/watchlist/[id] ───────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Ownership check
    const existing = await prisma.watchlist.findUnique({
      where:  { id: params.id },
      select: { userId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (existing.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.watchlist.delete({ where: { id: params.id } });
    return NextResponse.json({ message: 'Deleted successfully' });
  } catch (error) {
    console.error('[watchlist DELETE]', error);
    return NextResponse.json(
      { error: 'Failed to delete watchlist' },
      { status: 500 },
    );
  }
}
