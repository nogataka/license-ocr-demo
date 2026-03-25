import { defineConfig } from "astro/config";

export default defineConfig({
  server: {
    port: 7575,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  vite: {
    optimizeDeps: {
      exclude: ["onnxruntime-web"],
    },
    worker: {
      format: "es",
    },
  },
});
