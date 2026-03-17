// src/app/api/spaces/[id]/chats/route.ts
// List chats in a space

import db from '@/lib/db';
import { sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/spaces/[id]/chats - List chats in space
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const result = await db.execute(sql`
      SELECT 
        id, 
        title, 
        created_at as createdAt, 
        updated_at as updatedAt,
        is_archived as isArchived
      FROM chats 
      WHERE space_id = ${id}
      ORDER BY updated_at DESC
    `);

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch space chats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch space chats' },
      { status: 500 }
    );
  }
}
