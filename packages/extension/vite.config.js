import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync, existsSync, rmSync, readdirSync, readFileSync, writeFileSync } from "fs";

/**
 * Custom plugin: cleans dist/ then copies static extension files (manifest,
 * content scripts, service worker, lint rules) alongside the Vite-built
 * React panel (which doubles as the side panel content).
 *
 * These files can't go through Vite's bundler because:
 *   - manifest.json is static JSON
 *   - content-script.js + injected-hook.js run in page context (no imports)
 *   - service-worker.js is a MV3 background script (importScripts only)
 *   - crawler.js is loaded by the service worker via importScripts
 *   - rules/index.js is loaded at runtime by the panel
 */
function copyStaticFiles() {
  return {
    name: "copy-extension-files",

    // Clean the entire dist/ folder BEFORE Vite builds, so no stale files linger
    buildStart() {
      const dist = resolve(__dirname, "dist");
      if (existsSync(dist)) {
        rmSync(dist, { recursive: true, force: true });
      }
      mkdirSync(dist, { recursive: true });
    },

    // Copy static files AFTER Vite finishes bundling the React panel
    closeBundle() {
      const dist = resolve(__dirname, "dist");

      // Copy manifest
      copyFileSync(
        resolve(__dirname, "manifest.json"),
        resolve(dist, "manifest.json")
      );

      // Simple file copies (no transformation needed)
      const staticFiles = [
        ["src/background/service-worker.js", "service-worker.js"],
        ["src/background/ferry-hook.js", "ferry-hook.js"],
        ["src/content/content-script.js", "content-script.js"],
        ["src/content/injected-hook.js", "injected-hook.js"],
        ["src/rules/index.js", "rules/index.js"],
      ];

      for (const [src, dest] of staticFiles) {
        const destPath = resolve(dist, dest);
        const destDir = resolve(destPath, "..");
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        copyFileSync(resolve(__dirname, src), destPath);
      }

      // Inline ferry-hook.js into crawler.js so the service worker needs only
      // one importScripts("crawler.js") call. Chrome MV3 service workers support
      // importScripts() from the manifest-registered SW file, but scripts loaded
      // *by* importScripts() cannot themselves call importScripts() — so we
      // pre-bundle ferry-hook.js + crawler.js into a single output file.
      const ferryHook = readFileSync(resolve(__dirname, "src/background/ferry-hook.js"), "utf-8");
      const crawler   = readFileSync(resolve(__dirname, "src/background/crawler.js"), "utf-8");
      writeFileSync(resolve(dist, "crawler.js"), ferryHook + "\n\n" + crawler);

      // Copy icon files
      const iconsDir = resolve(__dirname, "icons");
      const distIcons = resolve(dist, "icons");
      if (existsSync(iconsDir)) {
        if (!existsSync(distIcons)) mkdirSync(distIcons, { recursive: true });
        for (const file of readdirSync(iconsDir)) {
          copyFileSync(resolve(iconsDir, file), resolve(distIcons, file));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyStaticFiles()],
  root: resolve(__dirname, "src/panel"),
  base: "./",  // CRITICAL: relative paths for Chrome extension context
  build: {
    outDir: resolve(__dirname, "dist/panel"),
    emptyOutDir: false,  // We handle cleanup ourselves in buildStart
    rollupOptions: {
      input: resolve(__dirname, "src/panel/index.html"),
    },
    target: "chrome110",
    minify: false,
    sourcemap: true,
  },
});
