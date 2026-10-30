// All authoritative money is integer cents. Formatting is the only place cents become text.

export type Cents = number;

export function formatCents(cents: Cents): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Invalid cents value: ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
