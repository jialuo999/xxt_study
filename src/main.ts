import { boot } from "./app/boot";
import { logger } from "./core/logger";

function run(): void {
  void boot().catch((error: unknown) => {
    // 启动失败时不要留下未处理的 Promise 拒绝；日志仍可在面板/控制台查看。
    logger.error("boot", "学习助手启动失败", error);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", run, { once: true });
} else {
  run();
}
