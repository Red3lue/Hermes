import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const fsStub = path.resolve(__dirname, "src/stubs/fs.ts");
const fsPromisesStub = path.resolve(__dirname, "src/stubs/fs-promises.ts");

// vite-plugin-node-polyfills v0.22 injects bare-specifier imports for its
// shims (e.g. `from "vite-plugin-node-polyfills/shims/buffer"`).
//
// In `vite dev`: those bare specifiers resolve fine through vite's normal
// dev-server resolver. We must NOT alias them or vite's optimizeDeps
// pre-bundling produces a TDZ in the CJS interop wrapper:
//   "Cannot access '__vite__cjsImport0_vitePluginNodePolyfills_shims_buffer'
//    before initialization"
//
// In `vite build`: rollup's default resolver chokes on the bare specifier
// because pnpm's deeply-nested .pnpm store + the shim being a sub-package
// of vite-plugin-node-polyfills together defeat module resolution. Without
// help, the bare specifier leaks verbatim into hundreds of third-party
// chunks (Reown / WalletConnect) and the deployed page goes blank with
// "Failed to resolve module specifier".
//
// Fix: alias the three shim entries at their absolute on-disk paths,
// resolved via createRequire (which honours pnpm symlinks). Apply ONLY
// at build time so dev keeps working.
const bufferShim = require.resolve("vite-plugin-node-polyfills/shims/buffer");
const processShim = require.resolve("vite-plugin-node-polyfills/shims/process");
const globalShim = require.resolve("vite-plugin-node-polyfills/shims/global");

export default defineConfig(({ command }) => {
  const isBuild = command === "build";

  const shimAliases = isBuild
    ? [
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
      ]
    : [];

  return {
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
        ...shimAliases,
      ],
    },
    build: {
      target: "esnext",
    },
  };
});
