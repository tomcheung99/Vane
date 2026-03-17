'use client';

import {
  Description,
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';

const EMOJI_OPTIONS = ['📁', '🚀', '💡', '🎯', '📚', '🔬', '🎨', '💻', '🌍', '📝', '⚡', '🔧'];

interface SpaceFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initialData?: {
    id: string;
    name: string;
    description: string;
    emoji: string;
  };
}

const SpaceFormModal = ({ open, onClose, onSaved, initialData }: SpaceFormProps) => {
  const isEditing = Boolean(initialData);
  const [name, setName] = useState(initialData?.name ?? '');
  const [description, setDescription] = useState(initialData?.description ?? '');
  const [emoji, setEmoji] = useState(initialData?.emoji ?? '📁');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Space name is required');
      return;
    }

    setLoading(true);
    try {
      const url = isEditing ? `/api/spaces/${initialData!.id}` : '/api/spaces';
      const method = isEditing ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), emoji }),
      });

      if (!res.ok) {
        throw new Error(`Failed to ${isEditing ? 'update' : 'create'} space`);
      }

      toast.success(`Space ${isEditing ? 'updated' : 'created'}`);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={() => {
          if (!loading) onClose();
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
              <DialogPanel className="w-full max-w-md transform rounded-2xl bg-light-secondary dark:bg-dark-secondary border border-light-200 dark:border-dark-200 p-6 text-left align-middle shadow-xl transition-all">
                <DialogTitle className="text-lg font-medium leading-6 dark:text-white">
                  {isEditing ? 'Edit Space' : 'New Space'}
                </DialogTitle>
                <Description className="text-sm dark:text-white/70 text-black/70 mt-1">
                  {isEditing
                    ? 'Update space details.'
                    : 'Create a container for related chats.'}
                </Description>

                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm text-black/70 dark:text-white/70 mb-1">
                      Emoji
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {EMOJI_OPTIONS.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => setEmoji(e)}
                          className={`text-xl w-9 h-9 rounded-lg flex items-center justify-center transition duration-200 ${
                            emoji === e
                              ? 'bg-light-200 dark:bg-dark-200 ring-2 ring-[#24A0ED]'
                              : 'hover:bg-light-200 dark:hover:bg-dark-200'
                          }`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm text-black/70 dark:text-white/70 mb-1">
                      Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Project Alpha"
                      maxLength={80}
                      className="w-full rounded-xl border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-3 py-2 text-sm text-black dark:text-white placeholder:text-black/50 dark:placeholder:text-white/50 focus:outline-none focus:border-light-300 dark:focus:border-dark-300"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-black/70 dark:text-white/70 mb-1">
                      Description (optional)
                    </label>
                    <input
                      type="text"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Brief description..."
                      maxLength={200}
                      className="w-full rounded-xl border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-3 py-2 text-sm text-black dark:text-white placeholder:text-black/50 dark:placeholder:text-white/50 focus:outline-none focus:border-light-300 dark:focus:border-dark-300"
                    />
                  </div>
                </div>

                <div className="flex flex-row items-end justify-end space-x-4 mt-6">
                  <button
                    onClick={() => {
                      if (!loading) onClose();
                    }}
                    className="text-black/50 dark:text-white/50 text-sm hover:text-black/70 hover:dark:text-white/70 transition duration-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={loading}
                    className="text-[#24A0ED] text-sm hover:text-[#1a8cd8] transition duration-200 disabled:opacity-50"
                  >
                    {loading
                      ? isEditing
                        ? 'Saving...'
                        : 'Creating...'
                      : isEditing
                        ? 'Save'
                        : 'Create'}
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

export default SpaceFormModal;
