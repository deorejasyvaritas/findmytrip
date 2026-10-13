import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// Códigos de socios (Travelpayouts Drive, White Label, etc.): se pegan en
// `partner-head.html`, que no se sube a git, y se insertan en el <head> de
// todas las páginas al compilar. Así nunca hay conflictos al hacer `git pull`.
function partnerHead(): Plugin {
  const file = resolve(__dirname, "partner-head.html");
  return {
    name: "partner-head",
    transformIndexHtml(html) {
      if (!existsSync(file)) return html;
      return html.replace("</head>", `${readFileSync(file, "utf8")}\n  </head>`);
    },
  };
}

// `npm run dev` levanta la web y el Worker (API) juntos en http://localhost:5173.
// El agente gratuito (Workers AI) solo existe en Cloudflare: para probarlo en
// local usá `npm run dev:ai` (requiere `npx wrangler login`).
export default defineConfig({
  // Fecha de compilación, visible en Perfil: sirve para confirmar que el deploy tomó.
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC") },
  plugins: [react(), cloudflare({ remoteBindings: process.env.CF_REMOTE === "1" }), partnerHead()],
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: {
            main: resolve(__dirname, "index.html"),
            vuelos: resolve(__dirname, "vuelos.html"),
          },
        },
      },
    },
  },
});
