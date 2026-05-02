import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const fsStub = path.resolve(__dirname, "src/stubs/fs.ts");
const fsPromisesStub = path.resolve(__dirname, "src/stubs/fs-promises.ts");

// vite-plugin-node-polyfills v0.22 injects bare-specifier imports for its
// shims (e.g. `from "vite-plugin-node-polyfills/shims/buffer"`). In dev
// vite resolves them dynamically; in `vite build` rollup must bundle the
// shim source — but pnpm's deeply-nested .pnpm store + bare-specifier
// resolution from third-party chunks (Reown / WalletConnect have hundreds
// of these) defeats rollup's default resolver, leaving bare specifiers
// in the production bundle. Browsers reject those at module load and the
// page goes blank with `Failed to resolve module specifier "..."`.
//
// Fix: explicitly alias each shim entry to its absolute on-disk path via
// require.resolve, which honours pnpm's symlinks and finds the real file
// regardless of which hashed `.pnpm/...` directory it currently lives in.
const bufferShim = require.resolve("vite-plugin-node-polyfills/shims/buffer");
const processShim = require.resolve("vite-plugin-node-polyfills/shims/process");
const globalShim = require.resolve("vite-plugin-node-polyfills/shims/global");

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ["crypto", "buffer", "stream", "util", "events", "path"],
      globals: { Buffer: true, process: true },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: [
      { find: "@", replacement: "/src" },
      { find: "node:fs/promises", replacement: fsPromisesStub },
      { find: "node:fs", replacement: fsStub },
      { find: /^fs$/, replacement: fsStub },
      // Pin the shim specifiers at absolute on-disk paths so rollup can
      // bundle them. Without these aliases the bare specifier leaks into
      // the production bundle and the browser refuses to load it.
      {
        find: "vite-plugin-node-polyfills/shims/buffer",
        replacement: bufferShim,
      },
      {
        find: "vite-plugin-node-polyfills/shims/process",
        replacement: processShim,
      },
      {
        find: "vite-plugin-node-polyfills/shims/global",
        replacement: globalShim,
      },
    ],
  },
  build: {
    target: "esnext",
    // Intentionally NOT suppressing UNRESOLVED_IMPORT warnings any more —
    // they were masking the bare-specifier leak above. If a new one shows
    // up at build time, fail visibly so we can add an alias for it.
  },
});
