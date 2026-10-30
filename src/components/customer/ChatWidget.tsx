"use client";

import { useEffect } from "react";

type AmazonConnect = ((...args: unknown[]) => void) & { ac?: unknown[] };

/**
 * Loads the official Amazon Connect Communications Widget (the snippet from the console's widget page)
 * and answers its `authenticate` callback with a JWT from our server. The widget renders its own launcher.
 */
export function ChatWidget({ scriptUrl, widgetId, snippetId }: { scriptUrl: string; widgetId: string; snippetId: string }) {
  useEffect(() => {
    const w = window as unknown as { amazon_connect?: AmazonConnect };
    if (document.getElementById(widgetId)) return;
    const ac: AmazonConnect = w.amazon_connect ?? Object.assign((...args: unknown[]) => void (ac.ac ??= []).push(args), {});
    w.amazon_connect = ac;
    const s = document.createElement("script");
    s.src = scriptUrl;
    s.async = true;
    // Must be the widget id, as in the console snippet: the widget script finds its configuration by it.
    s.id = widgetId;
    document.head.appendChild(s);
    ac("styles", { iconType: "CHAT", openChat: { color: "#1d2b22", backgroundColor: "#e8b10b" }, closeChat: { color: "#1d2b22", backgroundColor: "#e8b10b" } });
    ac("snippetId", snippetId);
    ac("supportedMessagingContentTypes", ["text/plain", "text/markdown"]);
    ac("authenticate", (callback: (token: string) => void) => {
      fetch("/api/connect/widget-token", { method: "POST" })
        .then((r) => r.json())
        .then((d: { ok: boolean; token?: string; error?: { message: string } }) => {
          if (d.ok && d.token) callback(d.token);
          // e.g. the daily chat limit: the widget has no error slot of its own.
          else if (d.error) window.alert(d.error.message);
        })
        .catch(() => undefined);
    });
  }, [scriptUrl, widgetId, snippetId]);
  return null;
}
