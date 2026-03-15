import { Check, ClipboardList } from 'lucide-react';
import { useState } from 'react';
import { Section } from '@/lib/hooks/useChat';

const stripCitations = (message: string) => {
  return message
    .replace(/<citation\b[^>]*>[\s\S]*?<\/citation>/gi, '')
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const Copy = ({
  section,
  initialMessage,
}: {
  section: Section;
  initialMessage: string;
}) => {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(stripCitations(initialMessage));

        setCopied(true);
        setTimeout(() => setCopied(false), 1000);
      }}
      className="p-2 text-black/70 dark:text-white/70 rounded-full hover:bg-light-secondary dark:hover:bg-dark-secondary transition duration-200 hover:text-black dark:hover:text-white"
    >
      {copied ? <Check size={16} /> : <ClipboardList size={16} />}
    </button>
  );
};

export default Copy;
