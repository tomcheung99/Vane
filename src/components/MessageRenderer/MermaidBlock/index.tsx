'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';

let mermaidInitialized = false;

const MermaidBlock = ({ children }: { children: string }) => {
  const id = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mermaidInitialized) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      mermaidInitialized = true;
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const render = async () => {
      try {
        const { svg } = await mermaid.render(`mermaid-${id}`, children);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to render diagram');
      }
    };

    render();
  }, [children, id]);

  if (error) {
    return (
      <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
        <p className="font-medium mb-1">Mermaid render error</p>
        <p className="font-mono text-xs">{error}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center overflow-x-auto rounded-lg bg-white dark:bg-dark-secondary p-4 border border-light-200 dark:border-dark-200"
    />
  );
};

export default MermaidBlock;
