import { ListSpansCommand, QConnectClient, SearchSessionsCommand } from "@aws-sdk/client-qconnect";

export interface TranscriptLine {
  who: "customer" | "assistant";
  text: string;
  at: string;
}

/** Reads what was said in one Connect contact. The website shows it next to a call. */
export interface TranscriptSource {
  getTranscript(contactId: string): Promise<TranscriptLine[]>;
}

interface SpanMessage {
  participant?: string;
  timestamp?: Date | string;
  values?: { text?: { value?: string } }[];
}

/**
 * Transcript from the AI agent's trace spans (Q Connect ListSpans). The instance stores no transcripts,
 * and every model call carries the conversation so far, so the latest inference span plus its output is
 * the whole conversation. It updates once per AI reply, not word by word.
 */
export class QConnectTranscript implements TranscriptSource {
  private readonly sessionIds = new Map<string, string>();

  constructor(
    private readonly opts: { assistantId: string; client?: QConnectClient },
    private readonly client = opts.client ?? new QConnectClient({}),
  ) {}

  async getTranscript(contactId: string): Promise<TranscriptLine[]> {
    const sessionId = await this.sessionId(contactId);
    if (!sessionId) return [];
    const { spans = [] } = await this.client.send(new ListSpansCommand({ assistantId: this.opts.assistantId, sessionId }));
    const last = spans
      .filter((s) => s.spanName === "inference")
      .sort((a, b) => +new Date(a.startTimestamp ?? 0) - +new Date(b.startTimestamp ?? 0))
      .at(-1);
    if (!last) return [];
    const attrs = last.attributes as { inputMessages?: SpanMessage[]; outputMessages?: SpanMessage[] } | undefined;
    return [...(attrs?.inputMessages ?? []), ...(attrs?.outputMessages ?? [])].flatMap(toLine);
  }

  /** The AI session is named after the contact; it appears a moment after the contact starts. */
  private async sessionId(contactId: string): Promise<string | undefined> {
    const known = this.sessionIds.get(contactId);
    if (known) return known;
    const r = await this.client.send(
      new SearchSessionsCommand({ assistantId: this.opts.assistantId, searchExpression: { filters: [{ field: "NAME", operator: "EQUALS", value: contactId }] } }),
    );
    const id = r.sessionSummaries?.[0]?.sessionId;
    if (id) this.sessionIds.set(contactId, id);
    return id;
  }
}

/** Spoken or typed turns only: tool calls and tool results (JSON) and the model's reasoning are dropped. */
export function toLine(m: SpanMessage): TranscriptLine[] {
  const text = (m.values ?? [])
    .map((v) => v.text?.value)
    .filter(Boolean)
    .join(" ")
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
    .replace(/<\/?message>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.startsWith("{")) return [];
  return [{ who: m.participant === "CUSTOMER" ? "customer" : "assistant", text, at: m.timestamp ? new Date(m.timestamp).toISOString() : "" }];
}
