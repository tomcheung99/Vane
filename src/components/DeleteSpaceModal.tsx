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

interface DeleteSpaceProps {
  spaceId: string;
  spaceName: string;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

const DeleteSpaceModal = ({
  spaceId,
  spaceName,
  open,
  onClose,
  onDeleted,
}: DeleteSpaceProps) => {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        throw new Error('Failed to delete space');
      }

      toast.success('Space deleted');
      onDeleted();
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
                  Delete Space
                </DialogTitle>
                <Description className="text-sm dark:text-white/70 text-black/70 mt-1">
                  Are you sure you want to delete &ldquo;{spaceName}&rdquo;? Chats
                  in this space will be moved back to your library. This cannot be
                  undone.
                </Description>
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
                    onClick={handleDelete}
                    disabled={loading}
                    className="text-red-400 text-sm hover:text-red-500 transition duration-200 disabled:opacity-50"
                  >
                    {loading ? 'Deleting...' : 'Delete'}
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

export default DeleteSpaceModal;
