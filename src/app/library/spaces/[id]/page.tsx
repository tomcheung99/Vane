'use client';

import DeleteChat from '@/components/DeleteChat';
import MoveToSpaceModal from '@/components/MoveToSpaceModal';
import SpaceFormModal from '@/components/SpaceFormModal';
import DeleteSpaceModal from '@/components/DeleteSpaceModal';
import { formatTimeDifference } from '@/lib/utils';
import {
  ArrowLeft,
  ClockIcon,
  FileText,
  FolderInput,
  Globe2Icon,
  LoaderCircle,
  Pencil,
  StickyNote,
  Trash,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

interface Space {
  id: string;
  name: string;
  description: string;
  emoji: string;
  createdAt: string;
  updatedAt: string;
}

interface Chat {
  id: string;
  title: string;
  createdAt: string;
  spaceId?: string | null;
  sources: string[];
  files: { fileId: string; name: string }[];
}

const PAGE_SIZE = 20;

const SpaceDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [space, setSpace] = useState<Space | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [notes, setNotes] = useState('');
  const [savedNotes, setSavedNotes] = useState('');
  const [loadingSpace, setLoadingSpace] = useState(true);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [savingNotes, setSavingNotes] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [showNotesEditor, setShowNotesEditor] = useState(false);

  // Modals
  const [editingSpace, setEditingSpace] = useState(false);
  const [deletingSpace, setDeletingSpace] = useState(false);
  const [movingChatId, setMovingChatId] = useState<string | null>(null);

  const fetchSpace = useCallback(async () => {
    setLoadingSpace(true);
    try {
      const res = await fetch(`/api/spaces/${id}`);
      if (!res.ok) throw new Error('Space not found');
      const data = await res.json();
      setSpace(data.space);
    } catch {
      router.push('/library');
    } finally {
      setLoadingSpace(false);
    }
  }, [id, router]);

  const fetchChats = useCallback(
    async (cursor?: string | null, append = false) => {
      if (!append) setLoadingChats(true);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          spaceId: id,
        });
        if (cursor) params.set('cursor', cursor);

        const res = await fetch(`/api/chats?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch chats');
        const data = await res.json();

        setChats((prev) => (append ? [...prev, ...data.chats] : data.chats));
        setHasMore(Boolean(data.hasMore));
        setNextCursor(data.nextCursor ?? null);
      } catch {
        // ignore
      } finally {
        setLoadingChats(false);
      }
    },
    [id],
  );

  const fetchNotes = useCallback(async () => {
    setLoadingNotes(true);
    try {
      const res = await fetch(`/api/spaces/${id}/notes`);
      if (res.ok) {
        const data = await res.json();
        setNotes(data.note.content ?? '');
        setSavedNotes(data.note.content ?? '');
      }
    } catch {
      // ignore
    } finally {
      setLoadingNotes(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchSpace();
    void fetchChats();
    void fetchNotes();
  }, [fetchSpace, fetchChats, fetchNotes]);

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/spaces/${id}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: notes }),
      });
      if (!res.ok) throw new Error('Failed to save notes');
      setSavedNotes(notes);
      toast.success('Notes saved');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleLoadMore = async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await fetchChats(nextCursor, true);
    } finally {
      setLoadingMore(false);
    }
  };

  const refreshChats = () => {
    void fetchChats();
  };

  const notesChanged = notes !== savedNotes;

  if (loadingSpace) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoaderCircle size={32} className="animate-spin text-black/30 dark:text-white/30" />
      </div>
    );
  }

  if (!space) return null;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col pt-10 border-b border-light-200/20 dark:border-dark-200/20 pb-6 px-2">
        <div className="mb-4">
          <Link
            href="/library"
            className="inline-flex items-center gap-1.5 text-sm text-black/50 dark:text-white/50 hover:text-black/70 dark:hover:text-white/70 transition"
          >
            <ArrowLeft size={16} />
            Back to Library
          </Link>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-5xl">{space.emoji}</span>
            <div>
              <h1
                className="text-4xl lg:text-5xl font-normal"
                style={{ fontFamily: 'PP Editorial, serif' }}
              >
                {space.name}
              </h1>
              {space.description && (
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  {space.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditingSpace(true)}
              className="inline-flex items-center gap-1.5 text-xs text-black/50 dark:text-white/50 hover:text-black/70 dark:hover:text-white/70 border border-light-200 dark:border-dark-200 rounded-full px-3 py-1.5 transition"
            >
              <Pencil size={13} />
              Edit
            </button>
            <button
              onClick={() => setDeletingSpace(true)}
              className="inline-flex items-center gap-1.5 text-xs text-red-400 hover:text-red-500 border border-light-200 dark:border-dark-200 rounded-full px-3 py-1.5 transition"
            >
              <Trash size={13} />
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Space Notes */}
      <div className="pt-6 px-2">
        <button
          onClick={() => setShowNotesEditor(!showNotesEditor)}
          className="flex items-center gap-2 text-sm font-medium text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white transition mb-3"
        >
          <StickyNote size={16} />
          Space Notes
          {notesChanged && (
            <span className="text-xs text-[#24A0ED]">(unsaved)</span>
          )}
        </button>

        {showNotesEditor && (
          <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary p-4 mb-6">
            {loadingNotes ? (
              <p className="text-sm text-black/50 dark:text-white/50">Loading notes...</p>
            ) : (
              <>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add shared context, links, key decisions, or anything relevant to this space..."
                  rows={6}
                  className="w-full bg-transparent text-sm text-black dark:text-white placeholder:text-black/40 dark:placeholder:text-white/40 focus:outline-none resize-y min-h-[100px]"
                />
                <div className="flex justify-end mt-2">
                  <button
                    onClick={handleSaveNotes}
                    disabled={savingNotes || !notesChanged}
                    className="text-sm text-[#24A0ED] hover:text-[#1a8cd8] disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    {savingNotes ? 'Saving...' : 'Save Notes'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Chats in this space */}
      <div className="px-2 pb-28">
        <h2 className="text-sm font-medium text-black/70 dark:text-white/70 mb-3">
          Chats ({chats.length}{hasMore ? '+' : ''})
        </h2>

        {loadingChats ? (
          <div className="flex items-center justify-center py-12">
            <LoaderCircle size={24} className="animate-spin text-black/30 dark:text-white/30" />
          </div>
        ) : chats.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-light-200 dark:border-dark-200 p-8 text-center">
            <p className="text-sm text-black/50 dark:text-white/50">
              No chats in this space yet. Use the{' '}
              <FolderInput size={14} className="inline" /> button in your Library
              to move chats here.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-light-200 dark:border-dark-200 overflow-hidden bg-light-primary dark:bg-dark-primary">
              {chats.map((chat, index) => {
                const sourcesLabel =
                  chat.sources.length === 0
                    ? null
                    : chat.sources.length <= 2
                      ? chat.sources
                          .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
                          .join(', ')
                      : `${chat.sources
                          .slice(0, 2)
                          .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
                          .join(', ')} + ${chat.sources.length - 2}`;

                return (
                  <div
                    key={chat.id}
                    className={
                      'group flex flex-col gap-2 p-4 hover:bg-light-secondary dark:hover:bg-dark-secondary transition-colors duration-200 ' +
                      (index !== chats.length - 1
                        ? 'border-b border-light-200 dark:border-dark-200'
                        : '')
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/c/${chat.id}`}
                          className="text-black dark:text-white text-base lg:text-lg font-medium leading-snug line-clamp-2 group-hover:text-[#24A0ED] transition duration-200"
                          title={chat.title}
                        >
                          {chat.title}
                        </Link>
                      </div>
                      <div className="pt-0.5 shrink-0 flex items-center gap-1">
                        <button
                          onClick={() => setMovingChatId(chat.id)}
                          className="bg-transparent text-black/40 dark:text-white/40 hover:text-[#24A0ED] hover:scale-105 transition duration-200 opacity-0 group-hover:opacity-100"
                          title="Move to different space"
                        >
                          <FolderInput size={17} />
                        </button>
                        <DeleteChat
                          chatId={chat.id}
                          chats={chats}
                          setChats={setChats}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-black/70 dark:text-white/70">
                      <span className="inline-flex items-center gap-1 text-xs">
                        <ClockIcon size={14} />
                        {formatTimeDifference(new Date(), chat.createdAt)} Ago
                      </span>

                      {sourcesLabel && (
                        <span className="inline-flex items-center gap-1 text-xs border border-black/20 dark:border-white/20 rounded-full px-2 py-0.5">
                          <Globe2Icon size={14} />
                          {sourcesLabel}
                        </span>
                      )}
                      {chat.files.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs border border-black/20 dark:border-white/20 rounded-full px-2 py-0.5">
                          <FileText size={14} />
                          {chat.files.length}{' '}
                          {chat.files.length === 1 ? 'file' : 'files'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {hasMore && (
              <div className="flex justify-center pt-6">
                <button
                  type="button"
                  onClick={() => void handleLoadMore()}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 rounded-full border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-4 py-2 text-sm text-black/70 dark:text-white/70 hover:bg-light-secondary dark:hover:bg-dark-secondary disabled:cursor-not-allowed disabled:opacity-70 transition duration-200"
                >
                  {loadingMore && (
                    <LoaderCircle size={16} className="animate-spin" />
                  )}
                  {loadingMore ? 'Loading more...' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {editingSpace && space && (
        <SpaceFormModal
          open={true}
          onClose={() => setEditingSpace(false)}
          onSaved={() => {
            void fetchSpace();
          }}
          initialData={space}
        />
      )}

      {deletingSpace && space && (
        <DeleteSpaceModal
          open={true}
          spaceId={space.id}
          spaceName={space.name}
          onClose={() => setDeletingSpace(false)}
          onDeleted={() => router.push('/library')}
        />
      )}

      {movingChatId && (
        <MoveToSpaceModal
          open={true}
          chatId={movingChatId}
          currentSpaceId={id}
          onClose={() => setMovingChatId(null)}
          onMoved={refreshChats}
        />
      )}
    </div>
  );
};

export default SpaceDetailPage;
