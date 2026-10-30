// Structured, expected failures. Domain services return these instead of throwing,
// so tool handlers and APIs can pass a stable code back to the caller.

export const ERROR_CODES = [
  "INVALID_INPUT",
  "UNKNOWN_ITEM",
  "UNKNOWN_LINE",
  "OPTION_NOT_ALLOWED",
  "ITEM_SOLD_OUT",
  "OPTION_SOLD_OUT",
  "CART_EMPTY",
  "CART_INCOMPLETE",
  "SHOP_CLOSED",
  "ORDERS_PAUSED",
  "REVIEW_REQUIRED",
  "PRICE_CHANGED",
  "ITEM_UNAVAILABLE",
  "NAME_REQUIRED",
  "ALREADY_SUBMITTED",
  "CONFLICT",
  "NOT_FOUND",
  "INVALID_TRANSITION",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface DomainError {
  code: ErrorCode;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(code: ErrorCode, message: string): Result<T> => ({
  ok: false,
  error: { code, message },
});
