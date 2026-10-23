import { mountUi } from "@/ui/mount";
import { logger } from "@/core/logger";
import { findUiHost, isTopFrame } from "./frames";
import { HostController } from "./host";
import { FrameAgent } from "./agent";
import { startMediaPreferences } from "./media-preferences";

let booted = false;

export async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  if (isLoginLikePage()) {
    logger.debug("boot", "登录/认证页面，跳过注入");
    return;
  }

  // 每一帧都应用媒体偏好；跨域 iframe 由该 iframe 内的脚本自行处理
  const stopMediaPreferences = startMediaPreferences();
  window.addEventListener("pagehide", (event) => {
    // bfcache 只冻结页面，不能在这里销毁；否则退后恢复时媒体偏好失效
    if (event.persisted) return;
    try {
      stopMediaPreferences();
    } catch {
      /* ignore */
    }
  });

  if (isTopFrame()) {
    if (document.getElementById("study-helper-host")) return;
    const controller = new HostController();
    mountUi(controller);
    logger.info("boot", "UI Host 已挂载（top frame）");
    await controller.init();
    return;
  }

  const agent = new FrameAgent(findUiHost());
  agent.start();
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    try {
      agent.dispose();
    } catch {
      /* ignore */
    }
  });
  logger.debug("boot", "子 frame agent 已启动");
}

function isLoginLikePage(): boolean {
  try {
    const { hostname, pathname } = location;
    return /passport|login|sso|cas/i.test(`${hostname}${pathname}`);
  } catch {
    return false;
  }
}
