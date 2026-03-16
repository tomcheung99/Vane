import { NextResponse } from 'next/server';
import { ensureMcpConnected, addMemory, searchMemories, listAvailableTools } from '@/lib/mcp';

/**
 * GET /api/memory-debug — list MCP tools and check memory read/write
 * POST /api/memory-debug — test writing a memory fact
 *
 * This is a debug endpoint. Remove or protect in production.
 */

export async function GET() {
  try {
    await ensureMcpConnected();
    const tools = await listAvailableTools();

    const toolNames = tools.map((t) => ({
      server: t.serverName,
      name: t.name,
      description: t.description?.slice(0, 120),
    }));

    // Try a quick search to verify read path
    let searchResult: string | null = null;
    try {
      searchResult = await searchMemories('test');
    } catch (err) {
      searchResult = `ERROR: ${err}`;
    }

    return NextResponse.json({
      connected: tools.length > 0,
      toolCount: tools.length,
      tools: toolNames,
      searchWorking: searchResult !== null && !String(searchResult).startsWith('ERROR'),
      searchSample: typeof searchResult === 'string' ? searchResult.slice(0, 300) : null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const content = body?.content ?? 'Memory debug test: ' + new Date().toISOString();

    console.log(`[memory-debug] Attempting to save: "${content}"`);
    const saved = await addMemory(content, {
      tags: ['debug-test'],
      metadata: { source: 'memory-debug-api', timestamp: new Date().toISOString() },
    });

    // Verify by searching
    let verification: string | null = null;
    if (saved) {
      await new Promise((r) => setTimeout(r, 1000)); // brief delay for indexing
      try {
        verification = await searchMemories(content.slice(0, 50));
      } catch {
        verification = null;
      }
    }

    return NextResponse.json({
      saved,
      content,
      verified: verification !== null && verification.length > 0,
      verificationSample: verification?.slice(0, 300) ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
