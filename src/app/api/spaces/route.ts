import db from '@/lib/db';
import { spaces, chats } from '@/lib/db/schema';
import { desc, eq, sql, count } from 'drizzle-orm';

export const GET = async () => {
  try {
    const spaceRows = await db
      .select({
        id: spaces.id,
        name: spaces.name,
        description: spaces.description,
        emoji: spaces.emoji,
        createdAt: spaces.createdAt,
        updatedAt: spaces.updatedAt,
        chatCount: count(chats.id),
      })
      .from(spaces)
      .leftJoin(chats, eq(chats.spaceId, spaces.id))
      .groupBy(spaces.id)
      .orderBy(desc(spaces.updatedAt));

    return Response.json({ spaces: spaceRows }, { status: 200 });
  } catch (err) {
    console.error('Error listing spaces:', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};

export const POST = async (req: Request) => {
  try {
    const body = await req.json();
    const { name, description, emoji } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return Response.json(
        { message: 'Space name is required.' },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const [space] = await db
      .insert(spaces)
      .values({
        id,
        name: name.trim(),
        description: description?.trim() ?? '',
        emoji: emoji ?? '📁',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return Response.json({ space }, { status: 201 });
  } catch (err) {
    console.error('Error creating space:', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
