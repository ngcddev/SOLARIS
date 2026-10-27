/**
 * Generates the command center key pair.
 *   npm run keys            -> prints the keys (copy into .env.local)
 *   npm run keys -- --write -> appends them to .env.local if it has no keys yet
 * The secret key must only ever live in .env.local (git-ignored).
 */
import fs from "node:fs";
import { generateCenterKeys, toBase64 } from "../src/lib/packet";

async function main() {
  const keys = await generateCenterKeys();
  const pub = toBase64(keys.publicKey);
  const sec = toBase64(keys.secretKey);
  if (process.argv.includes("--write")) {
    const file = ".env.local";
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (/^CENTER_SECRET_KEY=.+/m.test(current)) {
      console.error(`${file} already has CENTER_SECRET_KEY; refusing to overwrite.`);
      process.exit(1);
    }
    fs.appendFileSync(file, `\nCENTER_PUBLIC_KEY=${pub}\nCENTER_SECRET_KEY=${sec}\n`);
    console.log(`Keys written to ${file} (git-ignored). Public key: ${pub}`);
    return;
  }
  console.log("# Add these to .env.local - never commit the secret key.");
  console.log(`CENTER_PUBLIC_KEY=${pub}`);
  console.log(`CENTER_SECRET_KEY=${sec}`);
}

main();
