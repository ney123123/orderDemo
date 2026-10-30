// Usage: npm run hash-password            (reads the password from stdin, prints ADMIN_PASSWORD_HASH)
//        npm run hash-password -- --write (also writes ADMIN_PASSWORD_HASH into .env.local)
import { randomBytes, scrypt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const write = process.argv.includes("--write");
const rl = createInterface({ input: process.stdin, output: process.stderr });
rl.question("Admin password: ", (password) => {
  rl.close();
  if (password.length < 12) {
    console.error("Use at least 12 characters.");
    process.exit(1);
  }
  const [N, r, p] = [16384, 8, 1];
  const salt = randomBytes(16);
  scrypt(password, salt, 32, { N, r, p, maxmem: 256 * N * r }, (err, key) => {
    if (err) throw err;
    const hash = `scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${key.toString("base64url")}`;
    if (!write) return console.log(hash);
    const file = ".env.local";
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    const line = `ADMIN_PASSWORD_HASH=${hash}`;
    writeFileSync(file, /^ADMIN_PASSWORD_HASH=.*$/m.test(text) ? text.replace(/^ADMIN_PASSWORD_HASH=.*$/m, line) : `${text.trimEnd()}\n${line}\n`);
    console.error(`Updated ADMIN_PASSWORD_HASH in ${file}. Restart npm run dev.`);
  });
});
