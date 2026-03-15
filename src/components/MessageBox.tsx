'use client';

/* eslint-disable @next/next/no-img-element */
import React, { MutableRefObject, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  BookCopy,
  Disc3,
  Volume2,
  StopCircle,
  Layers3,
  Plus,
  CornerDownRight,
  RotateCcw,
  Square,
  AlertCircle,
  PencilLine,
  Check,
  X,
} from 'lucide-react';
import Markdown, { MarkdownToJSX, RuleType } from 'markdown-to-jsx';
import Copy from './MessageActions/Copy';
import MessageSources from './MessageSources';
import SearchImages from './SearchImages';
import SearchVideos from './SearchVideos';
import { useSpeech } from 'react-text-to-speech';
import ThinkBox from './ThinkBox';
import { useChat, Section } from '@/lib/hooks/useChat';
import Citation from './MessageRenderer/Citation';
import AssistantSteps from './AssistantSteps';
import { ResearchBlock } from '@/lib/types';
import Renderer from './Widgets/Renderer';
import CodeBlock from './MessageRenderer/CodeBlock';
import TextareaAutosize from 'react-textarea-autosize';

const ThinkTagProcessor = ({
  children,
  thinkingEnded,
}: {
  children: React.ReactNode;
  thinkingEnded: boolean;
}) => {
  return (
    <ThinkBox content={children as string} thinkingEnded={thinkingEnded} />
  );
};

const MessageBox = ({
  section,
  sectionIndex,
  dividerRef,
  isLast,
}: {
  section: Section;
  sectionIndex: number;
  dividerRef?: MutableRefObject<HTMLDivElement | null>;
  isLast: boolean;
}) => {
  const {
    loading,
    sendMessage,
    editMessage,
    rewrite,
    stopGeneration,
    researchEnded,
    chatHistory,
  } = useChat();

  const parsedMessage = section.parsedTextBlocks.join('\n\n');
  const speechMessage = section.speechMessage || '';
  const thinkingEnded = section.thinkingEnded;
  const [isEditing, setIsEditing] = useState(false);
  const [editedQuery, setEditedQuery] = useState(section.message.query);

  const sourceBlocks = section.message.responseBlocks.filter(
    (block): block is typeof block & { type: 'source' } =>
      block.type === 'source',
  );

  const sources = sourceBlocks.flatMap((block) => block.data);

  const hasContent = section.parsedTextBlocks.length > 0;

  const { speechStatus, start, stop } = useSpeech({ text: speechMessage });

  useEffect(() => {
    if (!isEditing) {
      setEditedQuery(section.message.query);
    }
  }, [isEditing, section.message.query]);

  const handleCancelEdit = () => {
    setEditedQuery(section.message.query);
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    await editMessage(section.message.messageId, editedQuery);
    setIsEditing(false);
  };

  const markdownOverrides: MarkdownToJSX.Options = {
    renderRule(next, node, renderChildren, state) {
      if (node.type === RuleType.codeInline) {
        return `\`${node.text}\``;
      }

      if (node.type === RuleType.codeBlock) {
        return (
          <CodeBlock key={state.key} language={node.lang || ''}>
            {node.text}
          </CodeBlock>
        );
      }

      return next();
    },
    overrides: {
      think: {
        component: ThinkTagProcessor,
        props: {
          thinkingEnded: thinkingEnded,
        },
      },
      citation: {
        component: Citation,
      },
    },
  };

  return (
    <div className="space-y-6">
      <div className={'w-full pt-8 break-words'}>
        <div className="lg:w-9/12 space-y-3">
          {!isEditing ? (
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-black dark:text-white font-medium text-3xl">
                {section.message.query}
              </h2>
              {!loading && (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-black/70 dark:text-white/70 hover:bg-light-secondary dark:hover:bg-dark-secondary hover:text-black dark:hover:text-white transition duration-200"
                >
                  <PencilLine size={14} />
                  Edit
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary dark:bg-dark-secondary p-3">
              <TextareaAutosize
                autoFocus
                minRows={2}
                value={editedQuery}
                onChange={(e) => setEditedQuery(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void handleSaveEdit();
                  }

                  if (e.key === 'Escape') {
                    e.preventDefault();
                    handleCancelEdit();
                  }
                }}
                className="w-full resize-none bg-transparent text-sm text-black dark:text-white placeholder:text-black/50 dark:placeholder:text-white/50 focus:outline-none"
                placeholder="Edit your message"
              />
              <p className="text-xs text-black/60 dark:text-white/60">
                Saving will regenerate from this message and remove later replies
                in this branch.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-black/70 dark:text-white/70 hover:bg-light-200 dark:hover:bg-dark-200 transition duration-200"
                >
                  <X size={14} />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveEdit()}
                  disabled={
                    loading ||
                    editedQuery.trim().length === 0 ||
                    editedQuery.trim() === section.message.query
                  }
                  className="flex items-center gap-1.5 rounded-full bg-[#24A0ED] px-3 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:bg-[#e0e0dc79] dark:disabled:bg-[#ececec21] transition duration-200"
                >
                  <Check size={14} />
                  Save & regenerate
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col space-y-9 lg:space-y-0 lg:flex-row lg:justify-between lg:space-x-9">
        <div
          ref={dividerRef}
          className="flex flex-col space-y-6 w-full lg:w-9/12"
        >
          {sources.length > 0 && (
            <div className="flex flex-col space-y-2">
              <div className="flex flex-row items-center space-x-2">
                <BookCopy className="text-black dark:text-white" size={20} />
                <h3 className="text-black dark:text-white font-medium text-xl">
                  Sources
                </h3>
              </div>
              <MessageSources sources={sources} />
            </div>
          )}

          {section.message.responseBlocks
            .filter(
              (block): block is ResearchBlock =>
                block.type === 'research' && block.data.subSteps.length > 0,
            )
            .map((researchBlock) => (
              <div key={researchBlock.id} className="flex flex-col space-y-2">
                <AssistantSteps
                  block={researchBlock}
                  status={section.message.status}
                  isLast={isLast}
                />
              </div>
            ))}

          {isLast &&
            loading &&
            !researchEnded &&
            !section.message.responseBlocks.some(
              (b) => b.type === 'research' && b.data.subSteps.length > 0,
            ) && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-light-secondary dark:bg-dark-secondary border border-light-200 dark:border-dark-200">
                <Disc3 className="w-4 h-4 text-black dark:text-white animate-spin" />
                <span className="text-sm text-black/70 dark:text-white/70">
                  Brainstorming...
                </span>
              </div>
            )}

          {isLast && !loading && section.message.status === 'error' && !hasContent && (
            <div className="flex flex-col gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertCircle size={16} />
                <span className="text-sm font-medium">
                  Failed to get a response. Please try again.
                </span>
              </div>
              <button
                onClick={() => rewrite(section.message.messageId)}
                className="flex items-center gap-1.5 self-start px-3 py-1.5 text-sm rounded-lg bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 transition duration-200"
              >
                <RotateCcw size={14} />
                Retry
              </button>
            </div>
          )}

          {section.widgets.length > 0 && <Renderer widgets={section.widgets} />}

          <div className="flex flex-col space-y-2">
            {sources.length > 0 && (
              <div className="flex flex-row items-center space-x-2">
                <Disc3
                  className={cn(
                    'text-black dark:text-white',
                    isLast && loading ? 'animate-spin' : 'animate-none',
                  )}
                  size={20}
                />
                <h3 className="text-black dark:text-white font-medium text-xl">
                  Answer
                </h3>
              </div>
            )}

            {hasContent && (
              <>
                <Markdown
                  className={cn(
                    'prose prose-h1:mb-3 prose-h2:mb-2 prose-h2:mt-6 prose-h2:font-[800] prose-h3:mt-4 prose-h3:mb-1.5 prose-h3:font-[600] dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 font-[400]',
                    'max-w-none break-words text-black dark:text-white',
                  )}
                  options={markdownOverrides}
                >
                  {parsedMessage}
                </Markdown>

                {isLast && loading ? (
                  <div className="flex flex-row items-center w-full text-black dark:text-white py-4">
                    <button
                      onClick={() => stopGeneration()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-light-secondary dark:bg-dark-secondary hover:bg-light-200 dark:hover:bg-dark-200 transition duration-200"
                    >
                      <Square size={14} />
                      Stop generating
                    </button>
                  </div>
                ) : section.message.status === 'error' ? (
                  <div className="flex flex-col gap-2 w-full py-4">
                    <div className="flex items-center gap-2 text-red-500 dark:text-red-400 text-sm">
                      <AlertCircle size={14} />
                      <span>Something went wrong. Please try again.</span>
                    </div>
                    <div className="flex flex-row items-center justify-between w-full text-black dark:text-white">
                      <div className="flex flex-row items-center">
                        <button
                          type="button"
                          onClick={() => rewrite(section.message.messageId)}
                          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-black/70 dark:text-white/70 hover:bg-light-secondary dark:hover:bg-dark-secondary hover:text-black dark:hover:text-white transition duration-200"
                        >
                          <RotateCcw size={14} />
                          Retry
                        </button>
                      </div>
                      <div className="flex flex-row items-center -mr-2">
                        {parsedMessage && (
                          <Copy initialMessage={parsedMessage} section={section} />
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-row items-center justify-between w-full text-black dark:text-white py-4">
                    <div />
                    <div className="flex flex-row items-center -mr-2">
                      <Copy initialMessage={parsedMessage} section={section} />
                      <button
                        onClick={() => {
                          if (speechStatus === 'started') {
                            stop();
                          } else {
                            start();
                          }
                        }}
                        className="p-2 text-black/70 dark:text-white/70 rounded-full hover:bg-light-secondary dark:hover:bg-dark-secondary transition duration-200 hover:text-black dark:hover:text-white"
                      >
                        {speechStatus === 'started' ? (
                          <StopCircle size={16} />
                        ) : (
                          <Volume2 size={16} />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {isLast &&
                  section.suggestions &&
                  section.suggestions.length > 0 &&
                  hasContent &&
                  !loading && (
                    <div className="mt-6">
                      <div className="flex flex-row items-center space-x-2 mb-4">
                        <Layers3
                          className="text-black dark:text-white"
                          size={20}
                        />
                        <h3 className="text-black dark:text-white font-medium text-xl">
                          Related
                        </h3>
                      </div>
                      <div className="space-y-0">
                        {section.suggestions.map(
                          (suggestion: string, i: number) => (
                            <div key={i}>
                              <div className="h-px bg-light-200/40 dark:bg-dark-200/40" />
                              <button
                                onClick={() => sendMessage(suggestion)}
                                className="group w-full py-4 text-left transition-colors duration-200"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex flex-row space-x-3 items-center">
                                    <CornerDownRight
                                      size={15}
                                      className="group-hover:text-sky-400 transition-colors duration-200 flex-shrink-0"
                                    />
                                    <p className="text-sm text-black/70 dark:text-white/70 group-hover:text-sky-400 transition-colors duration-200 leading-relaxed">
                                      {suggestion}
                                    </p>
                                  </div>
                                  <Plus
                                    size={16}
                                    className="text-black/40 dark:text-white/40 group-hover:text-sky-400 transition-colors duration-200 flex-shrink-0"
                                  />
                                </div>
                              </button>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  )}
              </>
            )}
          </div>
        </div>

        {hasContent && (
          <div className="lg:sticky lg:top-20 flex flex-col items-center space-y-3 w-full lg:w-3/12 z-30 h-full pb-4">
            <SearchImages
              query={section.message.query}
              chatHistory={chatHistory}
              messageId={section.message.messageId}
            />
            <SearchVideos
              chatHistory={chatHistory}
              query={section.message.query}
              messageId={section.message.messageId}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBox;
