import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";

const fsStub = path.resolve(__dirname, "src/stubs/fs.ts");
const fsPromisesStub = path.resolve(__dirname, "src/stubs/fs-promises.ts");

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
    ],
  },
  build: {
    target: "esnext",
    rollupOptions: {
      onwarn(warning, warn) {
        // Suppress unresolved shim warning from vite-plugin-node-polyfills
        // when processing workspace packages — the shim is injected at runtime.
        if (
          warning.code === "UNRESOLVED_IMPORT" &&
          typeof warning.message === "string" &&
          warning.message.includes("vite-plugin-node-polyfills")
        ) {
          return;
        }
        warn(warning);
      },
    },
  },
});
