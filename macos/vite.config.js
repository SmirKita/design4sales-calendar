import { defineConfig } from "vite";

// WKWebView opens bundled files offline. A single classic script works under file://
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-mac",
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
  },
  plugins: [{
    name: "bundled-webview-entry",
    transformIndexHtml: {
      order: "post",
      handler: (html) => html
        .replace(/<script type="module" crossorigin src=/g, "<script defer src=")
        .replace(/<link rel="stylesheet" crossorigin href=/g, '<link rel="stylesheet" href='),
    },
  }],
});
