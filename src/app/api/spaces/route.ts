// src/app/api/spaces/route.ts
// Space CRUD API

import db from '@/lib/db';
import { spaces } from '@/lib/db/schema-spaces';
import { desc, eq, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/spaces - List all spaces with chat counts
export async function GET() {
  try {
    // Get spaces with chat count using raw query
    const result = await db.execute(sql`
      SELECT 
        s.*,
        COUNT(c.id) as chat_count
      FROM spaces s
      LEFT JOIN chats c ON c.space_id = s.id AND c.is_archived = false
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `);

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch spaces:', error);
    return NextResponse.json(
      { error: 'Failed to fetch spaces' },
      { status: 500 }
    );
  }
}

// POST /api/spaces - Create new space
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, notes = '' } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const id = `space_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await db.execute(sql`
      INSERT INTO spaces (id, name, notes, created_at, updated_at)
      VALUES (${id}, ${name.trim()}, ${notes}, ${now}, ${now})
    `);

    return NextResponse.json({
      id,
      name: name.trim(),
      notes,
      createdAt: now,
      updatedAt: now,
      chatCount: 0,
    }, { status: 201 });
  } catch (error) {
    console.error('Failed to create space:', error);
    return NextResponse.json(
      { error: 'Failed to create space' },
      { status: 500 }
    );
  }
}
