'use client';

import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { FolderInput, X } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { toast } from 'sonner';

interface Space {
  id: string;
  name: string;
  emoji: string;
}

interface MoveToSpaceModalProps {
  open: boolean;
  onClose: () => void;
  chatId: string;
  currentSpaceId: string | null;
  onMoved: () => void;
}

const MoveToSpaceModal = ({
  open,
  onClose,
  chatId,
  currentSpaceId,
  onMoved,
}: MoveToSpaceModalProps) => {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (!open) return;

    const fetchSpaces = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/spaces');
        if (res.ok) {
          const data = await res.json();
          setSpaces(data.spaces);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };

    void fetchSpaces();
  }, [open]);

  const handleMove = async (spaceId: string | null) => {
    setMoving(true);
    try {
      const res = await fetch(`/api/chats/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId }),
      });

      if (!res.ok) {
        throw new Error('Failed to move chat');
      }

      toast.success(spaceId ? 'Chat moved to space' : 'Chat removed from space');
      onMoved();
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setMoving(false);
    }
  };

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={() => {
          if (!moving) onClose();
        }}
      >
        <DialogBackdrop className="fixed inset-0 bg-black/30" />
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-100"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-sm transform rounded-2xl bg-light-secondary dark:bg-dark-secondary border border-light-200 dark:border-dark-200 p-6 text-left align-middle shadow-xl transition-all">
                <DialogTitle className="text-lg font-medium leading-6 dark:text-white flex items-center gap-2">
                  <FolderInput size={20} />
                  Move to Space
                </DialogTitle>

                <div className="mt-4 space-y-1 max-h-64 overflow-y-auto">
                  {loading ? (
                    <p className="text-sm text-black/50 dark:text-white/50 py-3 text-center">
                      Loading spaces...
                    </p>
                  ) : spaces.length === 0 ? (
                    <p className="text-sm text-black/50 dark:text-white/50 py-3 text-center">
                      No spaces yet. Create one from the Library.
                    </p>
                  ) : (
                    <>
                      {currentSpaceId && (
                        <button
                          onClick={() => void handleMove(null)}
                          disabled={moving}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-light-200 dark:hover:bg-dark-200 transition duration-200 disabled:opacity-50"
                        >
                          <X size={18} />
                          Remove from space
                        </button>
                      )}
                      {spaces
                        .filter((s) => s.id !== currentSpaceId)
                        .map((space) => (
                          <button
                            key={space.id}
                            onClick={() => void handleMove(space.id)}
                            disabled={moving}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-black dark:text-white hover:bg-light-200 dark:hover:bg-dark-200 transition duration-200 disabled:opacity-50"
                          >
                            <span className="text-lg">{space.emoji}</span>
                            {space.name}
                          </button>
                        ))}
                    </>
                  )}
                </div>

                <div className="flex justify-end mt-4">
                  <button
                    onClick={onClose}
                    disabled={moving}
                    className="text-black/50 dark:text-white/50 text-sm hover:text-black/70 hover:dark:text-white/70 transition duration-200"
                  >
                    Cancel
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

export default MoveToSpaceModal;
