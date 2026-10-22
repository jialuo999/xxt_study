import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import monkey from "vite-plugin-monkey";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": srcDir },
    preserveSymlinks: true,
  },
  plugins: [
    preact(),
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: "学习助手 · Study Helper",
        namespace: "https://github.com/local/study-helper",
        version: "0.1.0",
        description: "学习通自动翻页、题库检索与 AI 答题助手（默认人工复核）",
        author: "Study Helper contributors",
        license: "MIT",
        match: ["*://*.chaoxing.com/*"],
        grant: [
          "GM_getValue",
          "GM_setValue",
          "GM_xmlhttpRequest",
          "GM_registerMenuCommand",
          "GM_notification",
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
