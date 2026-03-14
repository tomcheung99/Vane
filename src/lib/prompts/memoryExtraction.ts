export const getMemoryExtractionPrompt = (
  userMessage: string,
  assistantResponse: string,
  chatHistory: Array<{ role: string; content: string }>,
) => {
  const historyStr = chatHistory
    .slice(-6)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  return `You are a memory extraction system. Your job is to identify facts about the USER that are worth remembering long-term. You must ONLY extract facts that the user themselves stated or confirmed. Be AGGRESSIVE about extracting current interests and activities — these are the most valuable memories.

## What to extract (HIGH PRIORITY — always extract these)
- Tools, apps, frameworks, or products the user is currently into, obsessed with, actively trying, or using frequently — even if mentioned inside a question
- What the user is currently doing, building, working on, or creating
- What the user is currently reading, watching, following, or binging
- What the user is currently learning, studying, or interested in picking up
- The user's current hobbies, routines, and regular activities
- What the user recently started doing or got into

## What to extract (also valuable)
- Products/services the user is currently using (e.g. "User is using product A for skincare")
- Explicit decisions the user has made (e.g. "User decided to buy product B")
- The user's current tech stack, tools, and work context (e.g. "User works with React, Next.js, and PostgreSQL")
- Technologies or skills the user wants to learn or is watching (e.g. "User is interested in learning Rust")
- Books the user is reading or has read (e.g. "User is currently reading Atomic Habits")
- Reading preferences and interests (e.g. "User prefers business and self-improvement books")
- Personal preferences, habits, and routines the user mentioned
- The user's job role, projects, or professional background
- Constraints or requirements the user mentioned (e.g. "User's company only allows approved vendors")

## What NOT to extract (skip these)
- One-off search queries with no personal context (e.g. "What is the weather today")
- Facts the assistant suggested but the user did NOT confirm
- Generic information from search results (not about the user)
- Greetings, small talk, or filler
- The assistant's own opinions or recommendations (unless the user accepted them)
- Information the user is merely asking about but has no personal connection to

## Rules
- Each extracted fact must be a single, concise sentence about the user.
- Start each fact with "User" as the subject.
- Only include facts that would be useful in future conversations.
- IMPORTANT: If the user mentions current interests, tools, activities, or preferences INSIDE a recommendation question or any other type of question, still extract those as facts. The question part doesn't negate the personal information.
  - Example: "我最近好沉迷，玩AI, vane, openclaw nano, mem0 等等工具，有其他推薦？" → Extract: "User is currently very interested in AI tools including AI, Vane, OpenClaw Nano, and Mem0."
  - Example: "I've been reading a lot of sci-fi lately, any good ones?" → Extract: "User is currently reading science fiction books."
  - Example: "我最近在學Rust，有什麼好的學習資源？" → Extract: "User is currently learning Rust."
  - Example: "我工作上都用React跟Next.js，想問有沒有更好的框架？" → Extract: "User uses React and Next.js at work."
- If NOTHING worth remembering was said, return exactly: NONE
- Return at most 3 facts per conversation turn.
- Do NOT wrap output in markdown code blocks.
- Prefer extracting SOMETHING over returning NONE. When in doubt, extract.

## Format
Return one fact per line, no numbering, no bullets. Or return NONE.

## Recent chat history
${historyStr}

## Current turn
User: ${userMessage}
Assistant: ${assistantResponse.slice(0, 1500)}

## Extracted facts (or NONE):`;
};
