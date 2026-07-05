import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth-config';
import { getPrisma } from '@/lib/prisma';
import {
  validateWatchlistDescription,
  validateWatchlistName,
} from '@/lib/watchlist-validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: { id: string } };

// ─── PUT /api/watchlist/[id] ───────────────────────────────────────────────────
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const prisma = getPrisma();
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

    let validatedName: string | undefined;
    if (body.name !== undefined) {
      const nameResult = validateWatchlistName(body.name);
      if (!nameResult.ok) {
        return NextResponse.json({ error: nameResult.error }, { status: 400 });
      }
      validatedName = nameResult.value;
    }

    let validatedDescription: string | undefined;
    if (body.description !== undefined) {
      const descriptionResult = validateWatchlistDescription(body.description);
      if (!descriptionResult.ok) {
        return NextResponse.json({ error: descriptionResult.error }, { status: 400 });
      }
      validatedDescription = descriptionResult.value;
    }

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
        ...(validatedName !== undefined && { name: validatedName }),
        ...(body.description !== undefined && { description: validatedDescription }),
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
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const prisma = getPrisma();
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
