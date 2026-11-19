// Copies MapLibre's module web worker into public/ so it is served at a stable
// URL (bundlers cannot resolve MapLibre v6's import.meta.url worker reference).
// Runs on `npm install` (postinstall), including on Vercel.
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const destDir = path.join(root, "public", "maplibre");
mkdirSync(destDir, { recursive: true });
copyFileSync(src, path.join(destDir, "maplibre-gl-worker.mjs"));
console.log("Copied MapLibre worker to public/maplibre/");
