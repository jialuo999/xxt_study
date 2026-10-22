import { getSettings } from "@/core/settings-store";
import type { VideoSettings } from "@/core/settings";
import type { MediaState, PageInfo } from "@/core/types";
import type { PageContext, PlatformAdapter } from "@/platform/types";
import { jitter, sleep } from "@/utils/async";
import { logger } from "@/core/logger";
import type { AutoTurnView } from "@/ui/contract";
import { collectMedia } from "./media-preferences";

const SESSION_KEY = "study-helper.autoturn.v1";
const MEDIA_WAIT_TIMEOUT = 45 * 60 * 1000;

interface AutoTurnSession {
  running: boolean;
  steps: number;
  visited: string[];
  lastUrl: string;
}

export interface AutoTurnHost {
  getAdapter(): PlatformAdapter | null;
  getContext(): PageContext | null;
  getPage(): PageInfo;
  hasUnansweredQuestions(): boolean;
  getChildMediaState(): MediaState | null;
  resumeChildMedia(): void;
  onState(state: AutoTurnView): void;
  onStopped(reason: string): void;
}

export class AutoTurnRunner {
  private running = false;
  private steps = 0;
  private visited: string[] = [];
  private loopToken = 0;

  constructor(private readonly host: AutoTurnHost) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** 刷新后恢复上次运行 */
  restore(): void {
    const settings = getSettings();
    if (!settings.autoTurn.enabled || !settings.autoTurn.resumeOnReload) {
      this.persist(false);
      return;
    }
    const session = readSession();
    if (!session?.running) return;
    this.running = true;
    this.steps = session.steps;
    this.visited = session.visited ?? [];
    logger.info("autoturn", `恢复自动翻页（第 ${this.steps} 步）`);
    this.emit("已恢复自动翻页，即将继续");
    setTimeout(() => void this.loop(), Math.max(800, settings.autoTurn.startDelayMs));
  }

  start(): void {
    if (this.running) return;
    const settings = getSettings();
    if (!settings.autoTurn.enabled) return;
    this.running = true;
    this.steps = 0;
    this.visited = [];
    this.persist(true);
    logger.info("autoturn", "开始自动翻页");
    const delay = Math.max(0, settings.autoTurn.startDelayMs);
    this.emit(delay ? `将在 ${Math.ceil(delay / 1000)} 秒后开始` : "准备开始自动翻页", false, Date.now() + delay);
    setTimeout(() => {
      if (this.running) void this.loop();
    }, delay);
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
      this.emit("等待视频/音频播放结束…", false);
      const external = this.host.getChildMediaState();
      if (external?.hasMedia) {
        const externalResult = await this.waitForExternalMedia(
          45 * 60 * 1000,
          () => this.running && token === this.loopToken,
        );
        if (!this.running || token !== this.loopToken) return;
        if (externalResult === "blocked") {
          this.stop("视频/音频处于暂停且无法自动恢复，请手动播放后重新开始");
          return;
        }
        if (externalResult === "timeout") {
          this.stop("等待视频/音频结束超时，已暂停");
          return;
        }
      }
      const localMedia = findMedia(document);
      if (!external?.hasMedia || localMedia.length > 0) {
        const result = await waitForMedia(
          document,
          MEDIA_WAIT_TIMEOUT,
          () => this.running && token === this.loopToken,
          settings.video,
        );
        if (!this.running || token !== this.loopToken) return;
        if (result === "blocked") {
          this.stop("视频/音频处于暂停且无法自动恢复，请手动播放后重新开始");
          return;
        }
        if (result === "timeout") {
          this.stop("等待视频/音频结束超时，已暂停");
          return;
        }
        if (result === "none" && settings.autoTurn.contentWaitMs > 0) {
          const wait = Math.min(120000, Math.max(0, settings.autoTurn.contentWaitMs));
          this.emit(`未检测到音视频，等待 ${Math.ceil(wait / 1000)} 秒后翻页`, false, Date.now() + wait);
          await sleep(wait);
          if (!this.running || token !== this.loopToken) return;
        }
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

  private async waitForExternalMedia(
    timeoutMs: number,
    isAlive: () => boolean,
  ): Promise<MediaWaitResult> {
    const started = Date.now();
    let pausedSince = 0;
    while (Date.now() - started < timeoutMs) {
      if (!isAlive()) return "none";
      const state = this.host.getChildMediaState();
      if (!state?.hasMedia) return "none";
      if (state.allEnded) return "done";
      if (state.anyPaused) {
        if (!pausedSince) pausedSince = Date.now();
        this.host.resumeChildMedia();
        if (Date.now() - pausedSince > 6000) return "blocked";
      } else {
        pausedSince = 0;
      }
      await sleep(1000);
    }
    return "timeout";
  }

  private emit(message: string, stopped = false, nextAt: number | null = null): void {
    const settings = getSettings();
    this.host.onState({
      running: this.running,
      steps: this.steps,
      maxSteps: settings.autoTurn.maxSteps,
      message,
      nextAt,
    });
  }

  private persist(running: boolean): void {
    const session: AutoTurnSession = {
      running,
      steps: this.steps,
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

export type MediaWaitResult = "done" | "none" | "blocked" | "timeout";

function findMedia(doc: Document): HTMLMediaElement[] {
  return collectMedia(doc);
}

/** 等待页面中的视频/音频播放结束；暂停时按设置尝试恢复播放 */
export async function waitForMedia(
  doc: Document,
  timeoutMs: number,
  isAlive: () => boolean,
  preferences: VideoSettings = getSettings().video,
): Promise<MediaWaitResult> {
  let media = findMedia(doc);
  if (media.length === 0 && doc.querySelector("iframe")) {
    // 章节页 iframe 可能尚未加载完，给播放器一点出现时间
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!isAlive()) return "none";
      await sleep(500);
      media = findMedia(doc);
      if (media.length > 0) break;
    }
  }
  if (media.length === 0) return "none";

  const started = Date.now();
  const pausedSince = new Map<HTMLMediaElement, number>();
  const lastAttempt = new Map<HTMLMediaElement, number>();

  const allDone = () =>
    media.every((element) => {
      try {
        return element.ended || (element.duration > 0 && element.duration - element.currentTime <= 1);
      } catch {
        return true;
      }
    });

  const tryResume = async (element: HTMLMediaElement, now: number) => {
    let paused = false;
    try {
      paused = element.paused;
    } catch {
      return;
    }
    if (!paused || allDone()) {
      pausedSince.delete(element);
      return;
    }
    const canResume = preferences.resumeOnPause;
    if (!canResume) {
      if (!pausedSince.has(element)) pausedSince.set(element, now);
      return;
    }
    const last = lastAttempt.get(element) ?? 0;
    if (now - last < 2000) return;
    lastAttempt.set(element, now);
    try {
      // play() 可能因浏览器自动播放策略被拒绝；保持静音可显著提高成功率
      if (preferences.defaultMuted) element.muted = true;
      await element.play();
    } catch {
      /* 由下面的 blocked 判定处理 */
    }
  };

  while (Date.now() - started < timeoutMs) {
    if (!isAlive()) return "none";
    media = media.filter((element) => element.isConnected);
    if (media.length === 0) return "none";
    if (allDone()) return "done";

    const now = Date.now();
    for (const element of media) await tryResume(element, now);

    for (const element of media) {
      let paused = false;
      try {
        paused = element.paused;
      } catch {
        continue;
      }
      if (!paused) {
        pausedSince.delete(element);
        continue;
      }
      if (!pausedSince.has(element)) pausedSince.set(element, now);
      const pausedFor = now - (pausedSince.get(element) ?? now);
      if (pausedFor > 5000) {
        return "blocked";
      }
    }

    await sleep(1000);
  }
  return "timeout";
}
