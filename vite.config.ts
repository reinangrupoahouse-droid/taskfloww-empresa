// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { NitroConfig } from "nitro/types";
import { VitePWA } from "vite-plugin-pwa";
import { timbradoImagePlugin } from "./scripts/timbrado-image-plugin";
import { appUpdatesPlugin } from "./scripts/app-updates-plugin";

const nitroConfig = {
  preset: "vercel",
  routeRules: {
    "/app-release.json": { headers: { "cache-control": "no-store" } },
  },
} satisfies NitroConfig;

export default defineConfig({
  plugins: [
    timbradoImagePlugin,
    appUpdatesPlugin(),
    VitePWA({
      outDir: ".vercel/output/static",
      // Não substitua o service worker no meio de uma sessão. Com atualização
      // automática, uma página ainda usando chunks antigos podia perder esses
      // arquivos do cache e falhar ao abrir Dashboard/Clientes sem internet.
      registerType: "prompt",
      injectRegister: "auto",
      includeAssets: ["taskflow-mark.png", "push-sw.js"],
      manifest: {
        name: "Taskfloww Empresa",
        short_name: "Taskfloww Empresa",
        description: "Gestão de tarefas e conversas.",
        theme_color: "#090909",
        background_color: "#090909",
        display: "standalone",
        icons: [
          {
            src: "/taskflow-mark.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Push no celular: o arquivo só trata push/notificationclick.
        importScripts: ["/push-sw.js"],
        // After the user accepts an update, the activated worker must control
        // the open tab before the app reloads into the new cached shell.
        clientsClaim: true,
        // Version checks must reach the published server, not the installed cache.
        globIgnores: ["**/app-release.json"],
        // O HTML raiz é a casca do SPA: ao abrir /clientes, /dashboard etc.
        // sem rede, ele permite que o roteador renderize a rota atual usando
        // os módulos e dados já persistidos no aparelho.
        navigateFallback: "/",
        navigateFallbackDenylist: [/^\/api\//],
        additionalManifestEntries: [{ url: "/", revision: String(Date.now()) }],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "taskfloww-empresa-pages",
              networkTimeoutSeconds: 3,
            },
          },
        ],
      },
    }),
  ],
  // Generate Vercel Build Output instead of the previous Cloudflare target.
  vite: { server: { host: "127.0.0.1", port: 5187, strictPort: true } },
  nitro: nitroConfig,
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
