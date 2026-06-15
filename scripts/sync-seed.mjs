// Copies the canonical model manifest (site/models.json — the live, remotely-updatable source)
// into the app bundle as ui/src/models.seed.json, the OFFLINE seed imported synchronously by
// catalog.ts. One canonical file, no drift: every dev/build run re-syncs the seed from canonical.
// Runs as predev/prebuild (see package.json). Fails loudly if canonical is missing — no silent
// empty seed.
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const src = fileURLToPath(new URL("site/models.json", root));
const dest = fileURLToPath(new URL("ui/src/models.seed.json", root));

copyFileSync(src, dest);
console.log(`[sync-seed] ${src} -> ${dest}`);
