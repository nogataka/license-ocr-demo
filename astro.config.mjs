import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://nogataka.github.io",
  base: "/license-ocr-demo",
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
