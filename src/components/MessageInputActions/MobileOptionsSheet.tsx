'use client';

import { Dialog, DialogPanel, Switch } from '@headlessui/react';
import {
  Cpu,
  GlobeIcon,
  Loader2,
  Paperclip,
  Search,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useChat } from '@/lib/hooks/useChat';
import { MinimalProvider } from '@/lib/models/types';
import {
  GlobeIcon as GlobePhosphor,
  GraduationCapIcon,
  NetworkIcon,
} from '@phosphor-icons/react';

const sourcesList = [
  {
    name: 'Web',
    key: 'web',
    icon: <GlobePhosphor className="h-[16px] w-auto" />,
  },
  {
    name: 'Academic',
    key: 'academic',
    icon: <GraduationCapIcon className="h-[16px] w-auto" />,
  },
  {
    name: 'Social',
    key: 'discussions',
    icon: <NetworkIcon className="h-[16px] w-auto" />,
  },
];

interface MobileOptionsSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

const MobileOptionsSheet = ({ isOpen, onClose }: MobileOptionsSheetProps) => {
  const {
    sources,
    setSources,
    files,
    setFiles,
    setFileIds,
    fileIds,
    setChatModelProvider,
    chatModelProvider,
  } = useChat();

  const [providers, setProviders] = useState<MinimalProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    'main' | 'chatModel'
  >('main');
  const [searchQuery, setSearchQuery] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setActiveTab('main');
      setSearchQuery('');
      return;
    }

    const loadProviders = async () => {
      try {
        setIsLoading(true);
        const res = await fetch('/api/providers');
        if (!res.ok) throw new Error('Failed to fetch providers');
        const data: { providers: MinimalProvider[] } = await res.json();
        setProviders(data.providers);
      } catch (error) {
        console.error('Error loading providers:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadProviders();
  }, [isOpen]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setFileLoading(true);
    const data = new FormData();

    for (let i = 0; i < e.target.files.length; i++) {
      data.append('files', e.target.files[i]);
    }

    try {
      const res = await fetch('/api/uploads', { method: 'POST', body: data });
      const resData = await res.json();
      setFiles([...files, ...resData.files]);
      setFileIds([
        ...fileIds,
        ...resData.files.map((file: any) => file.fileId),
      ]);
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setFileLoading(false);
    }
  };

  const handleChatModelSelect = (providerId: string, modelKey: string) => {
    setChatModelProvider({ providerId, key: modelKey });
    localStorage.setItem('chatModelProviderId', providerId);
    localStorage.setItem('chatModelKey', modelKey);
    setActiveTab('main');
  };

  const filteredChatProviders = useMemo(() => {
    return providers
      .map((provider) => ({
        ...provider,
        chatModels: provider.chatModels.filter(
          (model) =>
            model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            provider.name.toLowerCase().includes(searchQuery.toLowerCase()),
        ),
      }))
      .filter((provider) => provider.chatModels.length > 0);
  }, [providers, searchQuery]);

  const currentChatModelName = useMemo(() => {
    if (!chatModelProvider?.providerId) return 'Select Model';
    const provider = providers.find(
      (p) => p.id === chatModelProvider.providerId,
    );
    const model = provider?.chatModels.find(
      (m) => m.key === chatModelProvider.key,
    );
    return model?.name ?? 'Select Model';
  }, [providers, chatModelProvider]);

  return (
    <AnimatePresence>
      {isOpen && (
        <Dialog open={isOpen} onClose={onClose} className="relative z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
          />
          <div className="fixed inset-0 flex items-end justify-center">
            <DialogPanel className="w-full">
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className="w-full max-h-[85vh] bg-light-primary dark:bg-dark-primary rounded-t-2xl overflow-hidden flex flex-col"
              >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-light-200 dark:bg-dark-200" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 pb-3">
                <h2 className="text-lg font-semibold text-black dark:text-white">
                  {activeTab === 'main'
                    ? 'Options'
                    : 'Chat Model'}
                </h2>
                <button
                  onClick={
                    activeTab === 'main'
                      ? onClose
                      : () => {
                          setActiveTab('main');
                          setSearchQuery('');
                        }
                  }
                  className="p-1.5 rounded-lg hover:bg-light-200 dark:hover:bg-dark-200 text-black/60 dark:text-white/60 transition"
                >
                  <X size={20} />
                </button>
              </div>

              {activeTab === 'main' && (
                <div className="flex-1 overflow-y-auto px-5 pb-8">
                  {/* Quick action grid */}
                  <div className="flex flex-row gap-3 mb-5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center justify-center flex-1 h-20 rounded-xl bg-light-secondary dark:bg-dark-secondary border border-light-200 dark:border-dark-200 active:scale-95 transition"
                    >
                      {fileLoading ? (
                        <Loader2
                          size={22}
                          className="animate-spin text-sky-500"
                        />
                      ) : (
                        <Paperclip
                          size={22}
                          className="text-black/60 dark:text-white/60"
                        />
                      )}
                      <span className="text-xs text-black/60 dark:text-white/60 mt-1.5">
                        Files
                      </span>
                    </button>
                    <input
                      type="file"
                      onChange={handleFileChange}
                      ref={fileInputRef}
                      accept=".pdf,.docx,.txt"
                      multiple
                      hidden
                    />

                    {sourcesList.map((source) => (
                      <button
                        key={source.key}
                        type="button"
                        onClick={() => {
                          if (!sources.includes(source.key)) {
                            setSources([...sources, source.key]);
                          } else {
                            setSources(
                              sources.filter((s) => s !== source.key),
                            );
                          }
                        }}
                        className={cn(
                          'flex flex-col items-center justify-center flex-1 h-20 rounded-xl border active:scale-95 transition',
                          sources.includes(source.key)
                            ? 'bg-sky-500/10 border-sky-500/40 dark:bg-sky-500/10 dark:border-sky-500/40'
                            : 'bg-light-secondary dark:bg-dark-secondary border-light-200 dark:border-dark-200',
                        )}
                      >
                        <span
                          className={cn(
                            sources.includes(source.key)
                              ? 'text-sky-500'
                              : 'text-black/60 dark:text-white/60',
                          )}
                        >
                          {source.icon}
                        </span>
                        <span
                          className={cn(
                            'text-xs mt-1.5',
                            sources.includes(source.key)
                              ? 'text-sky-500 font-medium'
                              : 'text-black/60 dark:text-white/60',
                          )}
                        >
                          {source.name}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Attached files */}
                  {files.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs text-black/50 dark:text-white/50 mb-2">
                        {files.length} file(s) attached
                      </p>
                    </div>
                  )}

                  {/* Chat Model */}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('chatModel');
                      setSearchQuery('');
                    }}
                    className="flex items-center w-full p-3.5 rounded-xl bg-light-secondary dark:bg-dark-secondary border border-light-200 dark:border-dark-200 mb-3 active:scale-[0.98] transition"
                  >
                    <Cpu size={18} className="text-sky-500 shrink-0" />
                    <div className="flex flex-col items-start ml-3 min-w-0 flex-1">
                      <span className="text-sm font-medium text-black dark:text-white">
                        Chat Model
                      </span>
                      <span className="text-xs text-black/50 dark:text-white/50 truncate w-full text-left">
                        {currentChatModelName}
                      </span>
                    </div>
                    <ChevronRight className="text-black/30 dark:text-white/30 shrink-0" />
                  </button>
                </div>
              )}

              {/* Chat Model selector view */}
              {activeTab === 'chatModel' && (
                <div className="flex-1 overflow-hidden flex flex-col">
                  <div className="px-5 pb-3">
                    <div className="relative">
                      <Search
                        size={16}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40 dark:text-white/40"
                      />
                      <input
                        type="text"
                        placeholder="Search models..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2.5 bg-light-secondary dark:bg-dark-secondary rounded-xl text-sm text-black dark:text-white placeholder:text-black/40 dark:placeholder:text-white/40 focus:outline-none border border-light-200 dark:border-dark-200"
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto px-5 pb-8">
                    {isLoading ? (
                      <div className="flex items-center justify-center py-16">
                        <Loader2
                          className="animate-spin text-black/40 dark:text-white/40"
                          size={24}
                        />
                      </div>
                    ) : filteredChatProviders.length === 0 ? (
                      <div className="text-center py-16 text-black/60 dark:text-white/60 text-sm">
                        {searchQuery
                          ? 'No models found'
                          : 'No chat models configured'}
                      </div>
                    ) : (
                      filteredChatProviders.map((provider) => (
                        <div key={provider.id} className="mb-3">
                          <p className="text-xs text-black/50 dark:text-white/50 uppercase tracking-wider px-1 py-2">
                            {provider.name}
                          </p>
                          <div className="flex flex-col space-y-1">
                            {provider.chatModels.map((model) => (
                              <button
                                key={model.key}
                                type="button"
                                onClick={() =>
                                  handleChatModelSelect(provider.id, model.key)
                                }
                                className={cn(
                                  'px-3 py-3 flex items-center rounded-xl transition active:scale-[0.98]',
                                  chatModelProvider?.providerId ===
                                    provider.id &&
                                    chatModelProvider?.key === model.key
                                    ? 'bg-sky-500/10 border border-sky-500/30'
                                    : 'bg-light-secondary dark:bg-dark-secondary border border-transparent',
                                )}
                              >
                                <Cpu
                                  size={15}
                                  className={cn(
                                    'shrink-0',
                                    chatModelProvider?.providerId ===
                                      provider.id &&
                                      chatModelProvider?.key === model.key
                                      ? 'text-sky-500'
                                      : 'text-black/50 dark:text-white/50',
                                  )}
                                />
                                <p
                                  className={cn(
                                    'text-sm ml-2.5 truncate',
                                    chatModelProvider?.providerId ===
                                      provider.id &&
                                      chatModelProvider?.key === model.key
                                      ? 'text-sky-500 font-medium'
                                      : 'text-black/70 dark:text-white/70',
                                  )}
                                >
                                  {model.name}
                                </p>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              </motion.div>
            </DialogPanel>
          </div>
        </Dialog>
      )}
    </AnimatePresence>
  );
};

const ChevronRight = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export default MobileOptionsSheet;
