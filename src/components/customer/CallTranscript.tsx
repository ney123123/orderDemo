"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../shared/api";

interface Conversation {
  channel: "CHAT" | "VOICE";
  lines: { who: "customer" | "assistant"; text: string; at: string }[];
}

/**
 * Written record of a call started from this page. The chat window already shows typed chats, so this
 * panel appears only for calls. It updates after each reply from the assistant, not word by word.
 */
export function CallTranscript() {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const refresh = async () => {
      const r = await api<{ conversation: Conversation | null }>("/api/conversation");
      if (r.ok) setConversation(r.data.conversation);
    };
    refresh();
    const timer = setInterval(() => document.visibilityState === "visible" && refresh(), 3000);
    return () => clearInterval(timer);
  }, []);

  const count = conversation?.lines.length ?? 0;
  // Keep the newest line in view inside the list, without moving the page.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [count]);

  if (conversation?.channel !== "VOICE" || count === 0) return null;
  return (
    <section aria-labelledby="transcript-heading" className="mt-4 rounded-lg border border-line bg-card p-5">
      <h2 id="transcript-heading" className="font-display text-xl font-bold">Call transcript</h2>
      <p className="mt-1 text-sm text-ink-soft">Updates after each reply.</p>
      <ol ref={list} aria-live="polite" className="mt-3 max-h-80 space-y-2 overflow-y-auto text-[15px]">
        {conversation.lines.map((l, i) => (
          <li key={i}>
            <span className="font-bold">{l.who === "customer" ? "You" : "Us"}:</span> {l.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
