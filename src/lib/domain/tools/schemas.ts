import { z } from "zod";
import { MAX_QUANTITY } from "../cart/schema";

// Connect flow-module tool inputs arrive as strings (§7), so every field is a string here and is
// converted after validation. An empty string means "not given" (the model often sends "" for unset fields).

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

const upper = (values: readonly [string, ...string[]]) =>
  z.string().trim().transform((s) => s.toUpperCase()).pipe(z.enum(values));

const count = (max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,2}$/, "must be a whole number written in digits")
    .transform(Number)
    .pipe(z.number().int().min(1).max(max));

const yesNo = z
  .string()
  .trim()
  .transform((s) => s.toLowerCase())
  .pipe(z.enum(["yes", "no", "true", "false"]))
  .transform((s) => s === "yes" || s === "true");

const id = z.string().trim().min(1).max(40);
const size = upper(["REGULAR", "LARGE"]);

const lineOptions = {
  format: optional(upper(["SINGLE", "COMBO"])),
  spicy: optional(yesNo),
  sideId: optional(id.transform((s) => s.toLowerCase())),
  sideSize: optional(size),
  drinkId: optional(id.transform((s) => s.toLowerCase())),
  drinkSize: optional(size),
  size: optional(size),
};

export const AddToCartInput = z.object({
  itemId: id,
  quantity: optional(count(MAX_QUANTITY)),
  ...lineOptions,
});

export const UpdateCartInput = z.object({
  lineId: id,
  quantity: optional(count(MAX_QUANTITY)),
  remove: optional(yesNo),
  splitQuantity: optional(count(MAX_QUANTITY)),
  ...lineOptions,
});

export const ReviewOrderInput = z.object({});

export const SubmitOrderInput = z.object({
  reviewToken: z.string().trim().min(1).max(64),
  customerName: optional(z.string().trim().max(40)),
  pickupNote: optional(z.string().trim().max(200)),
});

export type AddToCartArgs = z.infer<typeof AddToCartInput>;
export type UpdateCartArgs = z.infer<typeof UpdateCartInput>;
export type SubmitOrderArgs = z.infer<typeof SubmitOrderInput>;

/** Short, model-readable summary of what was wrong with the arguments. Never echoes values. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
    .join("; ");
}
