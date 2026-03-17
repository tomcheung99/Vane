// src/app/api/spaces/[id]/route.ts
// Individual Space operations

import db from '@/lib/db';
import { sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/spaces/[id] - Get space details
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const result = await db.execute(sql`
      SELECT * FROM spaces WHERE id = ${id}
    `);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Space not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to fetch space:', error);
    return NextResponse.json(
      { error: 'Failed to fetch space' },
      { status: 500 }
    );
  }
}

// PUT /api/spaces/[id] - Update space
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await req.json();
    const { name, notes } = body;

    const updates: string[] = [];
    
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Name cannot be empty' },
          { status: 400 }
        );
      }
      updates.push(`name = '${name.trim()}'`);
    }
    
    if (notes !== undefined) {
      updates.push(`notes = '${notes}'`);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    updates.push(`updated_at = '${new Date().toISOString()}'`);

    const result = await db.execute(sql`
      UPDATE spaces 
      SET ${sql.raw(updates.join(', '))}
      WHERE id = ${id}
      RETURNING *
    `);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Space not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to update space:', error);
    return NextResponse.json(
      { error: 'Failed to update space' },
      { status: 500 }
    );
  }
}

// DELETE /api/spaces/[id] - Delete space (chats → Inbox)
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // Move chats back to Inbox
    await db.execute(sql`
      UPDATE chats SET space_id = NULL WHERE space_id = ${id}
    `);

    // Delete space
    const result = await db.execute(sql`
      DELETE FROM spaces WHERE id = ${id} RETURNING id
    `);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Space not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Failed to delete space:', error);
    return NextResponse.json(
      { error: 'Failed to delete space' },
      { status: 500 }
    );
  }
}
