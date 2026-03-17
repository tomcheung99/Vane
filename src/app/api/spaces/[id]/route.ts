import db from '@/lib/db';
import { spaces } from '@/lib/db/schema';
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

    return Response.json({ space }, { status: 200 });
  } catch (err) {
    console.error('Error getting space:', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};

export const PATCH = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, description, emoji } = body;

    const existing = await db.query.spaces.findFirst({
      where: eq(spaces.id, id),
    });

    if (!existing) {
      return Response.json({ message: 'Space not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return Response.json(
          { message: 'Space name cannot be empty.' },
          { status: 400 },
        );
      }
      updates.name = name.trim();
    }
    if (description !== undefined) updates.description = description?.trim() ?? '';
    if (emoji !== undefined) updates.emoji = emoji;

    const [updated] = await db
      .update(spaces)
      .set(updates)
      .where(eq(spaces.id, id))
      .returning();

    return Response.json({ space: updated }, { status: 200 });
  } catch (err) {
    console.error('Error updating space:', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;

    const existing = await db.query.spaces.findFirst({
      where: eq(spaces.id, id),
    });

    if (!existing) {
      return Response.json({ message: 'Space not found' }, { status: 404 });
    }

    // Chats get spaceId set to null via ON DELETE SET NULL
    // Space notes get deleted via ON DELETE CASCADE
    await db.delete(spaces).where(eq(spaces.id, id)).execute();

    return Response.json(
      { message: 'Space deleted successfully' },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error deleting space:', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
