// src/app/api/chats/[id]/space/route.ts
// Move chat to/from space

import db from '@/lib/db';
import { sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// PUT /api/chats/[id]/space - Move chat to space (or null for Inbox)
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await req.json();
    const { spaceId } = body;

    // If moving to a space, verify it exists
    if (spaceId) {
      const spaceResult = await db.execute(sql`
        SELECT id FROM spaces WHERE id = ${spaceId}
      `);

      if (spaceResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Space not found' },
          { status: 404 }
        );
      }
    }

    const result = await db.execute(sql`
      UPDATE chats 
      SET space_id = ${spaceId || null}
      WHERE id = ${id}
      RETURNING id, space_id as spaceId
    `);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Chat not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to move chat:', error);
    return NextResponse.json(
      { error: 'Failed to move chat' },
      { status: 500 }
    );
  }
}
