'use client';

import React, { useEffect, useId, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';

let mermaidInitialized = false;

const MermaidBlock = ({ children }: { children: string }) => {
  const id = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const prevChildrenRef = useRef<string>('');
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!mermaidInitialized) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    mermaidInitialized = true;
  }

  const doRender = useCallback(async (code: string) => {
    if (!containerRef.current) return;

    // Remove any orphaned render artifacts from a previous failed attempt
    const staleNode = document.getElementById(`dmermaid-${id}`);
    if (staleNode) staleNode.remove();

    try {
      const { svg } = await mermaid.render(`dmermaid-${id}`, code);
      if (containerRef.current) {
        containerRef.current.innerHTML = svg;
        setError(null);
        setRendered(true);
      }
    } catch (err: any) {
      // Only show error if content hasn't changed since we started
      if (prevChildrenRef.current === code) {
        setError(err?.message || 'Failed to render diagram');
        setRendered(false);
      }
    }
  }, [id]);

  useEffect(() => {
    // Skip if content hasn't actually changed
    if (prevChildrenRef.current === children) return;
    prevChildrenRef.current = children;

    // Debounce renders during streaming — wait for content to stabilize
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    renderTimeoutRef.current = setTimeout(() => {
      void doRender(children);
    }, 300);

    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [children, doRender]);

  return (
    <div className="my-4">
      {/* Always keep container mounted so ref is never null */}
      <div
        ref={containerRef}
        className={`flex justify-center overflow-x-auto rounded-lg bg-white dark:bg-dark-secondary p-4 border border-light-200 dark:border-dark-200 ${
          error && !rendered ? 'hidden' : ''
        }`}
      />
      {error && !rendered && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          <p className="font-medium mb-1">Mermaid render error</p>
          <p className="font-mono text-xs">{error}</p>
        </div>
      )}
    </div>
  );
};

export default MermaidBlock;
