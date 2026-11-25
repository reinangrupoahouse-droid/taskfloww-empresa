import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { appUpdatesPlugin } from "./scripts/app-updates-plugin";
import { timbradoImagePlugin } from "./scripts/timbrado-image-plugin";

// Pages has no application server: exclude server handlers and their secrets
// from the browser bundle. Existing static-build behavior reports this limit.
const staticServerFunctions = {
  name: "pages-server-functions",
  enforce: "pre" as const,
  load(id: string) {
    if (!id.includes("/src/") || !id.endsWith(".functions.ts")) return null;
    const source = readFileSync(id, "utf8");
    const names = [...source.matchAll(/export const (\w+)\s*=\s*createServerFn/g)].map(match => match[1]);
    if (!names.length) return null;
    return names.map(name => `export const ${name} = async () => { throw new Error("Esta função precisa de servidor e não está disponível no GitHub Pages."); };`).join("\n");
  },
};

export default defineConfig({
  // GitHub Pages serves project sites under /<repo-name>/.
  // Keep this in sync with the repository name, otherwise asset URLs break and the page opens blank.
  base: "/taskfloww-empresa/",
  define: {
    // The app uses this flag to avoid TanStack Start server behavior in the static GitHub Pages build.
    "import.meta.env.VITE_GITHUB_PAGES": JSON.stringify("true"),
  },
  resolve: {
    alias: {
      "@tanstack/react-start/server": "/src/pages-react-start-stub.ts",
      "@tanstack/react-start": "/src/pages-react-start-stub.ts",
    },
  },
  plugins: [appUpdatesPlugin(), staticServerFunctions, timbradoImagePlugin, react(), tailwindcss(), tsconfigPaths()],
  build: {
    // Static files are generated here first, then scripts/prepare-gh-pages.mjs renames the entry file.
    outDir: ".gh-pages-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: "index.pages.html",
    },
  },
});
