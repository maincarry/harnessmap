import * as esbuild from "esbuild";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, readdirSync } from "node:fs";
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "public", "vendor");

// clean old galaxy asset files (galaxy-* emitted by the file loader) so rebuilds don't pile up
try { for (const f of readdirSync(outDir)) if (/^ga-.*\.(png|jpg|webp|svg)$/.test(f)) rmSync(join(outDir, f)); } catch {}

await esbuild.build({
  entryPoints: [join(here, "entry.tsx")],
  bundle: true, format: "iife", target: "es2020", minify: true,
  jsx: "automatic",
  outfile: join(outDir, "galaxy.js"),
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".png": "file", ".jpg": "file", ".webp": "file", ".svg": "file" },
  assetNames: "ga-[name]-[hash]",     // flat: /vendor/ route strips slashes, so no subdir
  publicPath: "/vendor",
  alias: {
    "@tanstack/react-router": join(here, "_shims", "tanstack-router.tsx"),
    "@/lib/crash-reporter": join(here, "_shims", "crash-reporter.ts"),
    "@": here,
  },
  logLevel: "info",
});
console.log("[galaxy] js bundled → public/vendor/galaxy.js");
execSync(`bunx @tailwindcss/cli -i "${join(here, "galaxy.css")}" -o "${join(outDir, "galaxy.css")}" --minify`, { stdio: "inherit", cwd: here });
console.log("[galaxy] css built → public/vendor/galaxy.css");

// Cache-bust: stamp galaxy.js's content hash into index.html's GALAXY_V so the browser fetches a fresh
// URL whenever the bundle changes (belt-and-suspenders with the server's no-cache on galaxy.js/.css).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const jsBuf = readFileSync(join(outDir, "galaxy.js"));
const ver = createHash("sha1").update(jsBuf).digest("hex").slice(0, 10);
const idxPath = join(here, "..", "..", "public", "index.html");
let idx = readFileSync(idxPath, "utf8");
idx = idx.replace(/var GALAXY_V='[^']*'; \/\*galaxy-build-version\*\//, `var GALAXY_V='${ver}'; /*galaxy-build-version*/`);
writeFileSync(idxPath, idx);
console.log("[galaxy] stamped index.html GALAXY_V =", ver);
