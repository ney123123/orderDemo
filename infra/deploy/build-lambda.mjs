// Bundles src/lambda/toolAdapter.ts (domain + templates) into one ESM file + zip for Lambda (nodejs22.x).
// The AWS SDK v3 is bundled too, so the deployed code runs the versions we tested.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "dist/lambda/toolAdapter");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "src/lambda/toolAdapter.ts")],
  outfile: join(out, "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: true,
  sourcemap: false,
  loader: { ".md": "text" },
  // Some CJS deps call require(); give ESM a require.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  alias: { "@": join(root, "src") },
  logLevel: "warning",
});
execFileSync("zip", ["-q", "-j", join(out, "../toolAdapter.zip"), join(out, "index.mjs")]);
console.log("built", join(out, "../toolAdapter.zip"));
