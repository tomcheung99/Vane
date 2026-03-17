import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { Block } from '@/lib/types';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type Cursor = {
  createdAt: string;
  id: string;
};

const parseLimit = (rawLimit: string | null) => {
  const parsed = Number.parseInt(rawLimit ?? '', 10);

  if (Number.isNaN(parsed)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
};

const decodeCursor = (cursor: string | null): Cursor | null => {
  if (!cursor) {
    return null;
  }

  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as Cursor;

    if (!parsed.createdAt || !parsed.id) {
      return null;
    }

    return parsed;
  } catch (err) {
    console.warn('Invalid chats cursor received:', err);
    return null;
  }
};

const encodeCursor = (chat: { createdAt: string; id: string }) => {
  return Buffer.from(
    JSON.stringify({
      createdAt: chat.createdAt,
      id: chat.id,
    }),
    'utf8',
  ).toString('base64url');
};

const normalizeSearchQuery = (query: string | null) => {
  const normalized = query?.trim() ?? '';
  return normalized.length >= 2 ? normalized : '';
};

const normalizePreview = (text: string | null, maxLength = 160) => {
  if (!text) {
    return null;
  }

  const normalized = text.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return null;
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
};

const getResponsePreview = (responseBlocks: Block[] | null) => {
  if (!responseBlocks?.length) {
    return null;
  }

  const text = responseBlocks
    .filter((block): block is Block & { type: 'text' } => block.type === 'text')
    .map((block) => block.data)
    .join('\n');

  return normalizePreview(text);
};

export const GET = async (req: Request) => {
  try {
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const searchQuery = normalizeSearchQuery(url.searchParams.get('q'));
    const spaceIdParam = url.searchParams.get('spaceId');
    const likePattern = `%${searchQuery}%`;

    const filters = [];

    // Filter by space: "none" = unassigned chats, otherwise filter by spaceId
    if (spaceIdParam === 'none') {
      filters.push(isNull(chats.spaceId));
    } else if (spaceIdParam) {
      filters.push(eq(chats.spaceId, spaceIdParam));
    }

    if (searchQuery) {
      const messageMatches = exists(
        db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.chatId, chats.id),
              or(
                ilike(messages.query, likePattern),
                sql<boolean>`
                  to_tsvector('simple', COALESCE(${messages.query}, ''))
                  @@ plainto_tsquery('simple', ${searchQuery})
                `,
                sql<boolean>`
                  COALESCE(${messages.responseBlocks}::text, '')
                  ILIKE ${likePattern}
                `,
                sql<boolean>`
                  to_tsvector('simple', COALESCE(${messages.responseBlocks}::text, ''))
                  @@ plainto_tsquery('simple', ${searchQuery})
                `,
              ),
            ),
          ),
      );

      filters.push(
        or(
          ilike(chats.title, likePattern),
          sql<boolean>`
            to_tsvector('simple', COALESCE(${chats.title}, ''))
            @@ plainto_tsquery('simple', ${searchQuery})
          `,
          messageMatches,
        ),
      );
    }

    if (cursor) {
      filters.push(
        or(
          lt(chats.createdAt, cursor.createdAt),
          and(eq(chats.createdAt, cursor.createdAt), lt(chats.id, cursor.id)),
        ),
      );
    }

    const chatRows = await db
      .select({
        id: chats.id,
        title: chats.title,
        createdAt: chats.createdAt,
        spaceId: chats.spaceId,
        sources: chats.sources,
        files: chats.files,
      })
      .from(chats)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(chats.createdAt), desc(chats.id))
      .limit(limit + 1);

    const hasMore = chatRows.length > limit;
    const pageChats = chatRows.slice(0, limit);

    const previewByChatId = new Map<string, string | null>();

    if (searchQuery && pageChats.length > 0) {
      const matchingMessages = await db
        .select({
          chatId: messages.chatId,
          query: messages.query,
          responseBlocks: messages.responseBlocks,
        })
        .from(messages)
        .where(
          and(
            inArray(
              messages.chatId,
              pageChats.map((chat) => chat.id),
            ),
            or(
              ilike(messages.query, likePattern),
              sql<boolean>`
                to_tsvector('simple', COALESCE(${messages.query}, ''))
                @@ plainto_tsquery('simple', ${searchQuery})
              `,
              sql<boolean>`
                COALESCE(${messages.responseBlocks}::text, '')
                ILIKE ${likePattern}
              `,
              sql<boolean>`
                to_tsvector('simple', COALESCE(${messages.responseBlocks}::text, ''))
                @@ plainto_tsquery('simple', ${searchQuery})
              `,
            ),
          ),
        )
        .orderBy(asc(messages.chatId), asc(messages.id));

      for (const message of matchingMessages) {
        if (previewByChatId.has(message.chatId)) {
          continue;
        }

        const queryPreview = normalizePreview(message.query);
        const responsePreview = getResponsePreview(message.responseBlocks);

        previewByChatId.set(message.chatId, queryPreview ?? responsePreview);
      }
    }

    const chatsWithPreview = pageChats.map((chat) => {
      const titleMatches =
        searchQuery &&
        chat.title.toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase());

      return {
        ...chat,
        matchPreview:
          searchQuery.length > 0
            ? normalizePreview(
                titleMatches ? chat.title : previewByChatId.get(chat.id) ?? null,
              )
            : null,
      };
    });

    const nextCursor = hasMore
      ? encodeCursor(pageChats[pageChats.length - 1])
      : null;

    return Response.json(
      {
        chats: chatsWithPreview,
        hasMore,
        nextCursor,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in getting chats: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
