import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import monkey from "vite-plugin-monkey";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  resolve: {
    alias: { "@": srcDir },
    preserveSymlinks: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    preact(),
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: "学习助手 · Study Helper",
        namespace: "https://github.com/local/study-helper",
        version: pkg.version,
        description: "学习通自动翻页、题库检索与 AI 答题助手（默认人工复核）",
        author: "Study Helper contributors",
        license: "MIT",
        match: ["*://*.chaoxing.com/*"],
        grant: [
          "GM_getValue",
          "GM_setValue",
          "GM_xmlhttpRequest",
          "GM_registerMenuCommand",
          "GM_addValueChangeListener",
          "GM_removeValueChangeListener",
          "unsafeWindow",
        ],
        connect: ["*"],
        "run-at": "document-idle",
      },
      build: {
        fileName: "study-helper.user.js",
      },
    }),
  ],
  build: {
    target: "es2022",
  },
});
