import { getSettings } from "@/core/settings-store";
import type { PageInfo } from "@/core/types";
import type { PageContext, PlatformAdapter } from "@/platform/types";
import { jitter, sleep } from "@/utils/async";
import { logger } from "@/core/logger";
import type { AutoTurnView } from "@/ui/contract";

const SESSION_KEY = "study-helper.autoturn.v1";

interface AutoTurnSession {
  running: boolean;
  steps: number;
  startedAt: number;
  visited: string[];
  lastUrl: string;
}

export interface AutoTurnHost {
  getAdapter(): PlatformAdapter | null;
  getContext(): PageContext | null;
  getPage(): PageInfo;
  hasUnansweredQuestions(): boolean;
  onState(state: AutoTurnView): void;
  onStopped(reason: string): void;
}

export class AutoTurnRunner {
  private running = false;
  private steps = 0;
  private visited: string[] = [];
  private startedAt = 0;
  private loopToken = 0;

  constructor(private readonly host: AutoTurnHost) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** 刷新后恢复上次运行 */
  restore(): void {
    const settings = getSettings();
    if (!settings.autoTurn.enabled) {
      this.persist(false);
      return;
    }
    const session = readSession();
    if (!session?.running) return;
    this.running = true;
    this.steps = session.steps;
    this.visited = session.visited ?? [];
    this.startedAt = session.startedAt || Date.now();
    logger.info("autoturn", `恢复自动翻页（第 ${this.steps} 步）`);
    this.emit("已恢复自动翻页，即将继续");
    setTimeout(() => void this.loop(), 1600);
  }

  start(): void {
    if (this.running) return;
    const settings = getSettings();
    if (!settings.autoTurn.enabled) return;
    this.running = true;
    this.steps = 0;
    this.startedAt = Date.now();
    this.visited = [];
    this.persist(true);
    logger.info("autoturn", "开始自动翻页");
    this.emit("准备开始自动翻页");
    void this.loop();
  }

  stop(reason = "已停止自动翻页"): void {
    if (!this.running) {
      this.emit(reason, true);
      return;
    }
    this.running = false;
    this.loopToken++;
    this.persist(false);
    logger.info("autoturn", reason);
    this.emit(reason, true);
    this.host.onStopped(reason);
  }

  private async loop(): Promise<void> {
    const token = ++this.loopToken;
    if (!this.running) return;
    const settings = getSettings();
    const page = this.host.getPage();

    if (!page.supported) {
      this.stop("当前页面不支持自动翻页");
      return;
    }
    if (page.kind !== "chapter" && page.kind !== "cards" && page.kind !== "video") {
      this.stop("当前页面不是章节/视频页，自动翻页已停止");
      return;
    }
    if (this.steps >= settings.autoTurn.maxSteps) {
      this.stop(`已达到最大步数（${settings.autoTurn.maxSteps}），已停止`);
      return;
    }
    if (settings.autoTurn.stopOnUnanswered && this.host.hasUnansweredQuestions()) {
      this.stop("检测到未答题目，已暂停自动翻页");
      return;
    }

    if (settings.autoTurn.waitVideoEnd) {
      this.emit("等待视频播放结束…", false);
      const result = await waitForVideo(document, 45 * 60 * 1000, () => this.running && token === this.loopToken);
      if (!this.running || token !== this.loopToken) return;
      if (result === "blocked") {
        this.stop("视频未播放：请手动点击一次播放后再继续");
        return;
      }
      if (result === "timeout") {
        this.stop("等待视频结束超时，已暂停");
        return;
      }
    }

    const delay = jitter(settings.autoTurn.minDelayMs, settings.autoTurn.maxDelayMs);
    this.emit(`${Math.max(1, Math.ceil(delay / 1000))} 秒后翻页`, false, Date.now() + delay);
    await sleep(delay);
    if (!this.running || token !== this.loopToken) return;

    const adapter = this.host.getAdapter();
    const context = this.host.getContext();
    if (!adapter?.nextPage || !context) {
      this.stop("当前页面没有可用的翻页按钮");
      return;
    }

    const before = location.href;
    let result;
    try {
      result = await adapter.nextPage(context);
    } catch (error) {
      logger.error("autoturn", "翻页时出错", error);
      this.stop("翻页出错，已暂停");
      return;
    }
    if (!this.running || token !== this.loopToken) return;
    if (!result.ok) {
      this.stop(result.message || "翻页失败，已暂停");
      return;
    }

    this.steps++;
    this.visited.push(before);
    if (this.visited.filter((url) => url === before).length >= 3) {
      this.stop("检测到页面重复，可能已到最后一页");
      return;
    }
    this.persist(true);
    this.emit(result.message || `已翻到下一页（${this.steps}）`, false);
    logger.info("autoturn", `第 ${this.steps} 步：${result.action}`);

    await sleep(1400);
    if (this.running && token === this.loopToken) void this.loop();
  }

  private emit(message: string, stopped = false, nextAt: number | null = null): void {
    const settings = getSettings();
    this.host.onState({
      running: this.running,
      steps: this.steps,
      maxSteps: settings.autoTurn.maxSteps,
      message: stopped && !this.running ? message : message,
      nextAt,
    });
  }

  private persist(running: boolean): void {
    const session: AutoTurnSession = {
      running,
      steps: this.steps,
      startedAt: this.startedAt,
      visited: this.visited.slice(-30),
      lastUrl: location.href,
    };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* ignore */
    }
  }
}

function readSession(): AutoTurnSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AutoTurnSession;
  } catch {
    return null;
  }
}

function findVideo(doc: Document, depth = 0): HTMLVideoElement | null {
  const direct = doc.querySelector<HTMLVideoElement>("#video_html5_api, video");
  if (direct) return direct;
  if (depth >= 3) return null;
  for (const iframe of Array.from(doc.querySelectorAll("iframe"))) {
    try {
      const childDoc = iframe.contentDocument;
      if (childDoc) {
        const found = findVideo(childDoc, depth + 1);
        if (found) return found;
      }
    } catch {
      /* cross-origin */
    }
  }
  return null;
}

export type VideoWaitResult = "done" | "none" | "blocked" | "timeout";

export async function waitForVideo(
  doc: Document,
  timeoutMs: number,
  isAlive: () => boolean,
): Promise<VideoWaitResult> {
  let video = findVideo(doc);
  if (!video && doc.querySelector("iframe")) {
    // 章节页的 iframe 可能尚未加载完，给播放器一点出现时间
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!isAlive()) return "none";
      await sleep(500);
      video = findVideo(doc);
      if (video) break;
    }
  }
  if (!video) return "none";
  if (video.ended || (video.duration > 0 && video.duration - video.currentTime <= 1)) {
    return "done";
  }

  if (video.paused && video.currentTime < 1) {
    try {
      await video.play();
    } catch {
      /* autoplay may be blocked */
    }
  }

  const started = Date.now();
  let blockedChecked = false;
  while (Date.now() - started < timeoutMs) {
    if (!isAlive()) return "none";
    if (video.ended || (video.duration > 0 && video.duration - video.currentTime <= 1)) {
      return "done";
    }
    if (!blockedChecked && Date.now() - started > 3500) {
      blockedChecked = true;
      if (video.paused && video.currentTime < 1 && video.duration > 0) {
        return "blocked";
      }
    }
    await sleep(1000);
  }
  return "timeout";
}
