import { defineConfig } from "vite";

export default defineConfig({
  base: "/overlay/",
  build: {
    outDir: "../worker/public/overlay",
    emptyOutDir: true,
  },
});
