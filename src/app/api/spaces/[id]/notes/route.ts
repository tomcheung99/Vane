import db from '@/lib/db';
import { spaces, spaceNotes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;

    const space = await db.query.spaces.findFirst({
      where: eq(spaces.id, id),
    });

    if (!space) {
      return Response.json({ message: 'Space not found' }, { status: 404 });
    }

    const note = await db.query.spaceNotes.findFirst({
      where: eq(spaceNotes.spaceId, id),
    });

    return Response.json(
      { note: note ?? { id: null, spaceId: id, content: '', updatedAt: null } },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error getting space notes:', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};

export const PUT = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const body = await req.json();
    const { content } = body;

    if (content === undefined || typeof content !== 'string') {
      return Response.json(
        { message: 'Content must be a string.' },
        { status: 400 },
      );
    }

    const space = await db.query.spaces.findFirst({
      where: eq(spaces.id, id),
    });

    if (!space) {
      return Response.json({ message: 'Space not found' }, { status: 404 });
    }

    const now = new Date().toISOString();

    const existing = await db.query.spaceNotes.findFirst({
      where: eq(spaceNotes.spaceId, id),
    });

    let note;
    if (existing) {
      [note] = await db
        .update(spaceNotes)
        .set({ content, updatedAt: now })
        .where(eq(spaceNotes.spaceId, id))
        .returning();
    } else {
      [note] = await db
        .insert(spaceNotes)
        .values({
          id: crypto.randomUUID(),
          spaceId: id,
          content,
          updatedAt: now,
        })
        .returning();
    }

    return Response.json({ note }, { status: 200 });
  } catch (err) {
    console.error('Error updating space notes:', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
