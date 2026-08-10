/**
 * Make Next.js `output: "standalone"` portable under Bun on Windows.
 *
 * Bun installs create absolute-path junctions into `node_modules/.bun/...`.
 * Next's file tracer often preserves those junctions. After zip/copy to another
 * folder (or machine) they break, and Node cannot resolve packages that live
 * only as siblings inside the Bun store (e.g. `@swc/helpers`).
 *
 * This script:
 * 1. Replaces junctions/symlinks under `.next/standalone` with real copies.
 * 2. Hoists packages from `node_modules/.bun/node_modules/*` into the parent
 *    `node_modules/` so classic Node resolution works.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneBase = join(appRoot, ".next", "standalone");

function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    try {
      const linked = readlinkSync(path);
      // readlink may return relative
      return join(dirname(path), linked);
    } catch {
      return null;
    }
  }
}

function materializeLinks(dir, stats = { replaced: 0, broken: 0, skipped: 0 }) {
  if (!existsSync(dir)) return stats;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return stats;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (isLink(full)) {
      const target = safeRealpath(full);
      if (!target || !existsSync(target)) {
        stats.broken += 1;
        try {
          rmSync(full, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        continue;
      }

      let targetReal = target;
      try {
        targetReal = realpathSync(target);
      } catch {
        /* keep */
      }

      // Already a self-referential edge case
      try {
        if (realpathSync(full) === targetReal && !isLink(full)) {
          stats.skipped += 1;
          continue;
        }
      } catch {
        /* materialize below */
      }

      const tmp = `${full}.__radioboi_materialize__`;
      try {
        rmSync(tmp, { recursive: true, force: true });
        cpSync(targetReal, tmp, { recursive: true, dereference: true, force: true });
        rmSync(full, { recursive: true, force: true });
        // rename via copy+rm for cross-device safety
        cpSync(tmp, full, { recursive: true, force: true });
        rmSync(tmp, { recursive: true, force: true });
        stats.replaced += 1;
      } catch (err) {
        try {
          rmSync(tmp, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        throw new Error(`Failed to materialize link ${full} -> ${targetReal}: ${err.message}`);
      }

      try {
        if (statSync(full).isDirectory()) {
          materializeLinks(full, stats);
        }
      } catch {
        /* ignore */
      }
      continue;
    }

    if (entry.isDirectory() && entry.name !== ".git") {
      materializeLinks(full, stats);
    }
  }

  return stats;
}

function copyPackageIfMissing(src, dest) {
  if (!existsSync(src)) return false;
  if (existsSync(join(dest, "package.json")) && !isLink(dest)) {
    return false;
  }
  try {
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true });
    }
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, dereference: true, force: true });
    return true;
  } catch (err) {
    console.warn(`[repair-standalone] skip hoist ${src}: ${err.message}`);
    return false;
  }
}

function hoistFromStore(storeDir, destNodeModules, stats) {
  let entries;
  try {
    entries = readdirSync(storeDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const src = join(storeDir, entry.name);

    if (entry.name.startsWith("@")) {
      let scoped;
      try {
        scoped = readdirSync(src, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of scoped) {
        const srcPkg = join(src, child.name);
        const destPkg = join(destNodeModules, entry.name, child.name);
        if (copyPackageIfMissing(srcPkg, destPkg)) {
          stats.hoisted += 1;
        }
      }
      continue;
    }

    const destPkg = join(destNodeModules, entry.name);
    if (copyPackageIfMissing(src, destPkg)) {
      stats.hoisted += 1;
    }
  }
}

function hoistBunStores(dir, stats = { hoisted: 0 }) {
  if (!existsSync(dir)) return stats;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return stats;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    let isDir = entry.isDirectory();
    if (!isDir) {
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
    }
    if (!isDir) continue;

    if (entry.name === "node_modules") {
      const bunStore = join(full, ".bun", "node_modules");
      if (existsSync(bunStore)) {
        hoistFromStore(bunStore, full, stats);
      }
      hoistBunStores(full, stats);
      continue;
    }

    if (entry.name === ".git") continue;
    hoistBunStores(full, stats);
  }

  return stats;
}

function findServerJs(base) {
  const preferred = join(base, "apps", "web", "server.js");
  if (existsSync(preferred)) return preferred;

  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (
        entry.isFile() &&
        entry.name === "server.js" &&
        dir.replace(/\\/g, "/").endsWith("/apps/web")
      ) {
        return full;
      }
      if (entry.isDirectory() && entry.name !== "node_modules") {
        stack.push(full);
      }
    }
  }
  return null;
}

function resolveCritical(standaloneWeb) {
  const require = createRequire(join(standaloneWeb, "server.js"));
  const critical = ["next", "@swc/helpers/_/_interop_require_default", "react", "react-dom"];
  const missing = [];
  for (const id of critical) {
    try {
      require.resolve(id);
    } catch {
      missing.push(id);
    }
  }
  return missing;
}

export function repairStandalone(options = {}) {
  const base = options.standaloneBase ?? standaloneBase;
  const quiet = options.quiet === true;

  if (!existsSync(base)) {
    throw new Error(`Standalone output missing: ${base}. Run bun run build first.`);
  }

  if (!quiet) {
    console.log(`[repair-standalone] materializing links under ${base}`);
  }
  const linkStats = materializeLinks(base);
  if (!quiet) {
    console.log(
      `[repair-standalone] links: replaced=${linkStats.replaced} broken=${linkStats.broken} skipped=${linkStats.skipped}`,
    );
  }

  if (!quiet) {
    console.log(`[repair-standalone] hoisting Bun package stores`);
  }
  const hoistStats = hoistBunStores(base);
  if (!quiet) {
    console.log(`[repair-standalone] hoisted packages: ${hoistStats.hoisted}`);
  }

  // Extra hoist into both standalone root and apps/web node_modules
  const storeCandidates = [
    join(base, "node_modules", ".bun", "node_modules"),
    join(base, "apps", "web", "node_modules", ".bun", "node_modules"),
  ];
  const webNm = join(base, "apps", "web", "node_modules");
  const rootNm = join(base, "node_modules");
  for (const store of storeCandidates) {
    if (!existsSync(store)) continue;
    if (existsSync(rootNm)) hoistFromStore(store, rootNm, hoistStats);
    if (existsSync(webNm)) hoistFromStore(store, webNm, hoistStats);
  }

  const server = findServerJs(base);
  if (!server) {
    throw new Error(`standalone server.js not found under ${base}`);
  }
  const standaloneWeb = dirname(server);

  let missing = resolveCritical(standaloneWeb);
  if (missing.length > 0) {
    // Last resort: monorepo root Bun store (only works on build machine before move)
    const monorepoBun = join(appRoot, "..", "..", "node_modules", ".bun", "node_modules");
    if (existsSync(monorepoBun)) {
      if (!quiet) {
        console.log(`[repair-standalone] last-resort hoist from ${monorepoBun}`);
      }
      mkdirSync(rootNm, { recursive: true });
      mkdirSync(webNm, { recursive: true });
      hoistFromStore(monorepoBun, rootNm, hoistStats);
      hoistFromStore(monorepoBun, webNm, hoistStats);
      missing = resolveCritical(standaloneWeb);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Standalone repair incomplete; Node still cannot resolve: ${missing.join(", ")}. ` +
        `Re-run build / pack on a machine with a healthy bun install.`,
    );
  }

  if (!quiet) {
    console.log(`[repair-standalone] OK — critical modules resolve from ${standaloneWeb}`);
  }

  return { base, standaloneWeb, linkStats, hoistStats };
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1]
  ? process.argv[1].replace(/\//g, sep).toLowerCase()
  : "";
const self = thisFile.replace(/\//g, sep).toLowerCase();
if (invoked === self || invoked.endsWith(`${sep}repair-standalone.mjs`)) {
  try {
    repairStandalone();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
