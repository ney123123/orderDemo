import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StateTemplates } from "../domain/stateBlock/renderStateBlock";
import { STATES } from "../domain/stateMachine/deriveState";

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../prompts/states");

/** Reads prompts/states/*.md (versioned in git). Kept outside the domain so the domain stays I/O-free. */
export function loadStateTemplates(dir: string = DEFAULT_DIR): StateTemplates {
  const read = (name: string) => readFileSync(join(dir, `${name}.md`), "utf8");
  const templates = { _header: read("_header") } as StateTemplates;
  for (const state of STATES) templates[state] = read(state);
  return templates;
}
