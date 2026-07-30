import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = join(appRoot, ".next", "standalone", "apps", "web");
const standaloneServer = join(standaloneRoot, "server.js");

if (!existsSync(standaloneServer)) {
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
