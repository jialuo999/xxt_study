import { mountUi } from "@/ui/mount";
import { logger } from "@/core/logger";
import { findUiHost } from "./frames";
import { HostController } from "./host";
import { FrameAgent } from "./agent";

let booted = false;

export async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  if (isLoginLikePage()) {
    logger.debug("boot", "登录/认证页面，跳过注入");
    return;
  }
  const host = findUiHost();
  if (host === window) {
    if (document.getElementById("study-helper-host")) return;
    const controller = new HostController();
    mountUi(controller);
    logger.info("boot", "UI Host 已挂载");
    await controller.init();
    return;
  }
  const agent = new FrameAgent(host);
  agent.start();
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
