/** "7" / "7.5" / "7.50" → 750. Parsed as text, never through floating point. */
export function parseDollars(input: string): number | undefined {
  const m = /^\s*\$?(\d{1,4})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return undefined;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

export const centsToInput = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
