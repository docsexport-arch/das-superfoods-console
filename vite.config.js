import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", sourcemap: false },
  test: { environment: "node", include: ["tests/**/*.test.{js,jsx}"] },
});
