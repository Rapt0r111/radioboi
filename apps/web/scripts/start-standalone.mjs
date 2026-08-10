import { cpSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { repairStandalone } from "./repair-standalone.mjs";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function findStandaloneServer(startDir) {
  const preferred = join(startDir, "apps", "web", "server.js");
  if (existsSync(preferred)) {
    return preferred;
  }

  // Nested pack builds (before outputFileTracingRoot pin) placed server.js under
  // standalone/<rel-path>/apps/web/server.js — search once as a fallback.
  const stack = [startDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isFile() && entry.name === "server.js" && dir.replace(/\\/g, "/").endsWith("/apps/web")) {
        return full;
      }
      if (entry.isDirectory() && entry.name !== "node_modules") {
        stack.push(full);
      }
    }
  }
  return null;
}

const standaloneBase = join(appRoot, ".next", "standalone");

if (!existsSync(standaloneBase)) {
  throw new Error("Production build is missing. Run `bun run build` before `bun run start`.");
}

// Bun junctions + missing hoists break after zip/copy. Repair is idempotent.
// Skip with RADIOBOI_SKIP_STANDALONE_REPAIR=1 only for debugging.
// Verbose: RADIOBOI_STANDALONE_REPAIR_VERBOSE=1
if (process.env.RADIOBOI_SKIP_STANDALONE_REPAIR !== "1") {
  const result = repairStandalone({
    standaloneBase,
    quiet: process.env.RADIOBOI_STANDALONE_REPAIR_VERBOSE !== "1",
  });
  if (
    result.linkStats.replaced > 0 ||
    result.linkStats.broken > 0 ||
    result.hoistStats.hoisted > 0
  ) {
    console.log(
      `[standalone] repaired for portable Node (links=${result.linkStats.replaced}, hoisted=${result.hoistStats.hoisted})`,
    );
  }
}

const standaloneServer = findStandaloneServer(standaloneBase);
const standaloneRoot = standaloneServer ? dirname(standaloneServer) : join(standaloneBase, "apps", "web");

if (!standaloneServer || !existsSync(standaloneServer)) {
  throw new Error("Production build is missing. Run `bun run build` before `bun run start`.");
}

// Next's standalone output excludes these runtime-served directories. Keep the
// local production command faithful to the deployable server, including audio
// recordings and compiled static chunks.
for (const [source, destination] of [
  [join(appRoot, "public"), join(standaloneRoot, "public")],
  [join(appRoot, ".next", "static"), join(standaloneRoot, ".next", "static")],
]) {
  if (existsSync(source)) cpSync(source, destination, { recursive: true, force: true });
}

await import(pathToFileURL(standaloneServer).href);
