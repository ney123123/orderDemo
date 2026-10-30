"use client";

import { useState } from "react";
import { announceCartChange, api } from "../shared/api";

const TOOLS = ["addToCart", "updateCart", "reviewOrder", "submitOrder"] as const;
const EXAMPLES: Record<(typeof TOOLS)[number], string> = {
  addToCart: "itemId=beef\nformat=COMBO\nspicy=yes",
  updateCart: "lineId=L1\nsideId=fries\nsideSize=LARGE\ndrinkId=coke\ndrinkSize=REGULAR",
  reviewOrder: "",
  submitOrder: "",
};

interface ToolResult {
  ok: boolean;
  state: string;
  error?: { code: string; message: string };
  stateBlock: string;
}

/**
 * §4 mock mode: calls the four AI tool handlers directly with string arguments, the way
 * the Connect adapter will, and shows the state block the AI agent would get. There is no AI here.
 */
export function MockConsole() {
  const [tool, setTool] = useState<(typeof TOOLS)[number]>("addToCart");
  const [args, setArgs] = useState(EXAMPLES.addToCart);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastToken, setLastToken] = useState("");
  const example = (t: (typeof TOOLS)[number]) => (t === "submitOrder" ? `reviewToken=${lastToken}\ncustomerName=Sam` : EXAMPLES[t]);

  async function call(e: React.FormEvent) {
    e.preventDefault();
    const parsed: Record<string, string> = {};
    for (const line of args.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) parsed[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    const r = await api<{ result: ToolResult }>("/api/mock/tool", { method: "POST", body: { tool, args: parsed } });
    if (!r.ok) return setError(r.error.message);
    setError(null);
    setResult(r.data.result);
    const token = /reviewToken "([^"]+)"/.exec(r.data.result.stateBlock)?.[1];
    if (token) setLastToken(token);
    announceCartChange();
  }

  return (
    <section aria-labelledby="mock-heading" className="rounded-lg border-2 border-dashed border-mustard-deep bg-card p-5">
      <h2 id="mock-heading" className="font-display text-xl font-bold">Local test console — not Amazon Connect</h2>
      <p className="mt-1 text-sm text-ink-soft">
        For development only. This calls the AI tools directly and shows the step instructions the AI agent would receive. No AI model or Amazon Connect is involved.
      </p>
      <form onSubmit={call} className="mt-4 space-y-3">
        <label className="block">
          <span className="text-sm font-bold">Tool</span>
          <select value={tool} onChange={(e) => { const t = e.target.value as (typeof TOOLS)[number]; setTool(t); setArgs(example(t)); }} className="mt-1 block rounded border border-line bg-card px-2 py-2">
            {TOOLS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-bold">Arguments, one key=value per line (all strings, as Connect sends them)</span>
          <textarea value={args} onChange={(e) => setArgs(e.target.value)} rows={5} className="mt-1 w-full rounded border border-line px-3 py-2 font-mono text-sm" />
        </label>
        <button type="submit" className="rounded bg-ink px-4 py-2 font-bold text-paper hover:bg-leaf">Call {tool}</button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-ketchup">{error}</p>}
      {result && (
        <div className="mt-4">
          <p className="text-sm">
            <strong>{result.ok ? "ok" : `error ${result.error?.code}`}</strong>, state <strong>{result.state}</strong>
          </p>
          <pre className="mt-2 max-h-96 overflow-auto rounded bg-paper p-3 text-xs whitespace-pre-wrap">{result.stateBlock}</pre>
        </div>
      )}
    </section>
  );
}
