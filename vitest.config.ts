import { defineConfig } from "vitest/config";

// Tests del motor en Node, sin el plugin de Cloudflare.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
