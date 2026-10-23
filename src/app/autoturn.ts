import { getSettings } from "@/core/settings-store";
import type { VideoSettings } from "@/core/settings";
import type { MediaState, PageInfo } from "@/core/types";
import type { PageContext, PlatformAdapter } from "@/platform/types";
import { jitter, sleep } from "@/utils/async";
import { logger } from "@/core/logger";
import type { AutoTurnView } from "@/ui/contract";
import { collectMedia, focusMedia, pickPrimaryMedia } from "./media-preferences";

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
  /** 按任务点顺序返回当前应播放的子 frame（没有任务点信息时为 null） */
  getMediaPlaybackTarget(): MediaPlaybackTarget | null;
  /** 只恢复指定子 frame 的媒体，并暂停其他子 frame */
  activateMediaFrame(frameId: string): void;
  resumeChildMedia(): void;
  /** 停止翻页时暂停当前页面/子 frame 的视频与音频 */
  pauseMedia(): void;
  /** 顶层 URL + 子 frame URL/类型的稳定签名，用于判断任务点是否切换 */
  getTaskSignature(): string;
  /** 平台是否弹出人机验证（【9010】验证码页）；检测到后不得继续点击 */
  hasVerificationChallenge(): boolean;
  onState(state: AutoTurnView): void;
  onStopped(reason: string): void;
}

/** 学习通同页多任务点时的播放目标 */
export interface MediaPlaybackTarget {
  /** 匹配到的子 frame；null 表示任务点 iframe 尚未连接或全部完成 */
  frameId: string | null;
  taskUrl: string;
  taskIndex: number;
  taskTotal: number;
  state: MediaState | null;
  allTasksFinished: boolean;
  /** tasks：按任务点 DOM 顺序；frames：任务点信息不足时按子 frame 连接顺序兜底 */
  source?: "tasks" | "frames";
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
    // 停止翻页后立即暂停视频/音频，避免声音继续播放
    try {
      this.host.pauseMedia();
    } catch {
      /* ignore */
    }
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

  /** 检测到平台人机验证时立即停止，避免继续点击加重风控 */
  private stopForVerification(): boolean {
    if (!this.host.hasVerificationChallenge()) return false;
    this.stop("检测到平台验证，自动翻页已暂停；请手动完成验证后重新开始");
    return true;
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
    if (this.stopForVerification()) return;
    if (this.steps >= settings.autoTurn.maxSteps) {
      this.stop(`已达到最大步数（${settings.autoTurn.maxSteps}），已停止`);
      return;
    }
    if (settings.autoTurn.stopOnUnanswered && this.host.hasUnansweredQuestions()) {
      this.stop("检测到未答题目，已暂停自动翻页");
      return;
    }

    const isAlive = () => this.running && token === this.loopToken;
    let external: MediaState | null = null;
    let mediaHandled = false;

    if (settings.autoTurn.waitVideoEnd) {
      // 学习通同页多个任务点时，按任务点 DOM 顺序只播放当前的子 frame
      let target = this.host.getMediaPlaybackTarget();
      if (!target && document.querySelector("iframe")) {
        target = await this.discoverMediaPlaybackTarget(2000, isAlive);
      }
      if (target) {
        logger.debug("autoturn", "媒体播放目标", {
          source: target.source,
          frameId: target.frameId,
          taskIndex: target.taskIndex,
          taskTotal: target.taskTotal,
          allTasksFinished: target.allTasksFinished,
        });
        if (target.allTasksFinished) {
          mediaHandled = true;
          this.emit("当前任务点均已完成，跳过等待", false);
          logger.info("autoturn", "当前章节任务点均已完成，跳过媒体等待");
        } else {
          const kind = target.source === "frames" ? "视频" : "任务点";
          const label = target.taskTotal
            ? `第 ${target.taskIndex + 1}/${target.taskTotal} 个${kind}`
            : `第 ${target.taskIndex + 1} 个${kind}`;
          this.emit(`按顺序播放${label}`, false);
          logger.info("autoturn", `按任务点顺序等待${label}`, { frameId: target.frameId, mode: target.source });
          const taskResult = await this.waitForTaskMedia(isAlive);
          if (!this.running || token !== this.loopToken) return;
          if (taskResult === "timeout") {
            this.stop("等待任务点视频结束超时，已暂停");
            return;
          }
          if (taskResult === "blocked") {
            this.stop("任务点视频处于暂停且无法自动恢复，请手动播放后重新开始");
            return;
          }
          if (taskResult === "stalled") {
            this.stop("视频已结束，但任务点未标记完成；请手动确认后再继续");
            return;
          }
          if (taskResult === "done") mediaHandled = true;
        }
      }
    }

    if (settings.autoTurn.waitVideoEnd && !mediaHandled) {
      external = this.host.getChildMediaState();
      if (!external?.hasMedia && document.querySelector("iframe")) {
        // 跨域 iframe 的媒体状态由子 frame 上报，刚进入页面时可能还没到
        external = await this.discoverChildMedia(2000, isAlive);
      }

      const taskFinished = Boolean(external?.currentTaskFinished);
      if (taskFinished) {
        this.emit("当前任务点均已完成，跳过等待", false);
        logger.info("autoturn", "当前任务点均已完成，跳过媒体等待");
      } else if (external?.allTasksFinished) {
        logger.debug("autoturn", "当前章节任务点均已完成", external);
      }
      if (!taskFinished) {
        this.emit("等待视频/音频播放结束…", false);
        if (external?.hasMedia) {
          const externalResult = await this.waitForExternalMedia(
            MEDIA_WAIT_TIMEOUT,
            isAlive,
            settings.video.resumeOnPause,
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
        let localResult: MediaWaitResult = "done";
        if (!external?.hasMedia || localMedia.length > 0) {
          localResult = await waitForMedia(
            document,
            MEDIA_WAIT_TIMEOUT,
            isAlive,
            settings.video,
          );
          if (!this.running || token !== this.loopToken) return;
          if (localResult === "blocked") {
            this.stop("视频/音频处于暂停且无法自动恢复，请手动播放后重新开始");
            return;
          }
          if (localResult === "timeout") {
            this.stop("等待视频/音频结束超时，已暂停");
            return;
          }
        }
        if (localResult === "none") {
          // 本地没找到媒体时，再给子 frame 一次上报机会
          const lateExternal = this.host.getChildMediaState();
          if (lateExternal?.hasMedia) {
            const lateResult = await this.waitForExternalMedia(
              MEDIA_WAIT_TIMEOUT,
              isAlive,
              settings.video.resumeOnPause,
            );
            if (!this.running || token !== this.loopToken) return;
            if (lateResult === "blocked") {
              this.stop("视频/音频处于暂停且无法自动恢复，请手动播放后重新开始");
              return;
            }
            if (lateResult === "timeout") {
              this.stop("等待视频/音频结束超时，已暂停");
              return;
            }
          } else if (settings.autoTurn.contentWaitMs > 0) {
            const wait = Math.min(120000, Math.max(0, settings.autoTurn.contentWaitMs));
            this.emit(`未检测到音视频，等待 ${Math.ceil(wait / 1000)} 秒后翻页`, false, Date.now() + wait);
            await sleep(wait);
            if (!this.running || token !== this.loopToken) return;
          }
        }
      }
    }

    const delay = jitter(settings.autoTurn.minDelayMs, settings.autoTurn.maxDelayMs);
    this.emit(`${Math.max(1, Math.ceil(delay / 1000))} 秒后翻页`, false, Date.now() + delay);
    await sleep(delay);
    if (!this.running || token !== this.loopToken) return;
    if (this.stopForVerification()) return;

    const adapter = this.host.getAdapter();
    const context = this.host.getContext();
    if (!adapter?.nextPage || !context) {
      this.stop("当前页面没有可用的翻页按钮");
      return;
    }

    const before = this.host.getTaskSignature();
    logger.debug("autoturn", "翻页前任务签名", before);
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

    // 点击后必须看到任务点/页面真的变化，否则会重复执行同一个任务点
    let changed = await this.waitForTaskChange(
      before,
      () => this.running && token === this.loopToken,
    );
    for (let attempt = 0; !changed && this.running && token === this.loopToken && attempt < 2; attempt++) {
      logger.debug("autoturn", "点击后页面未变化，尝试下一个翻页候选");
      try {
        result = await adapter.nextPage(context);
      } catch (error) {
        logger.error("autoturn", "重试翻页时出错", error);
        break;
      }
      if (!this.running || token !== this.loopToken) return;
      if (!result.ok) break;
      changed = await this.waitForTaskChange(
        before,
        () => this.running && token === this.loopToken,
      );
    }
    if (!changed) {
      this.stop("点击下一节后页面没有变化（任务点可能已完成或按钮无效），已暂停");
      return;
    }

    this.steps++;
    this.visited.push(before);
    if (this.visited.filter((signature) => signature === before).length >= 3) {
      this.stop("检测到页面重复，可能已到最后一页");
      return;
    }
    this.persist(true);
    logger.debug("autoturn", "任务点已切换", this.host.getTaskSignature());
    this.emit(result.message || `已翻到下一页（${this.steps}）`, false);
    logger.info("autoturn", `第 ${this.steps} 步：${result.action}`);

    await sleep(1000);
    if (this.running && token === this.loopToken) void this.loop();
  }

  /** 等待任务点签名变化；用于确认翻页点击真的生效 */
  private async waitForTaskChange(before: string, isAlive: () => boolean): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < 4000) {
      await sleep(350);
      if (!isAlive()) return false;
      if (this.host.getTaskSignature() !== before) return true;
    }
    return false;
  }

  private async discoverChildMedia(
    timeoutMs: number,
    isAlive: () => boolean,
  ): Promise<MediaState | null> {
    const started = Date.now();
    let latest: MediaState | null = null;
    while (Date.now() - started < timeoutMs) {
      if (!isAlive()) return latest;
      latest = this.host.getChildMediaState();
      if (latest?.hasMedia) return latest;
      await sleep(500);
    }
    return this.host.getChildMediaState();
  }

  private async discoverMediaPlaybackTarget(
    timeoutMs: number,
    isAlive: () => boolean,
  ): Promise<MediaPlaybackTarget | null> {
    const started = Date.now();
    let latest: MediaPlaybackTarget | null = null;
    while (Date.now() - started < timeoutMs) {
      if (!isAlive()) return latest;
      latest = this.host.getMediaPlaybackTarget();
      if (latest) return latest;
      await sleep(300);
    }
    return this.host.getMediaPlaybackTarget();
  }

  /**
   * 学习通同页多任务点：按任务点顺序播放。
   * 只对当前任务点的子 frame 发送恢复播放，其他 frame 暂停；
   * 等它播完且任务点标记完成后，再切到下一个任务点。
   */
  private async waitForTaskMedia(isAlive: () => boolean): Promise<MediaWaitResult> {
    const settings = getSettings();
    const started = Date.now();
    let lastFrameId = "";
    let lastActivate = 0;
    let pausedSince = 0;
    let lastNotice = 0;
    let pendingSince = 0;
    let endedSince = 0;
    let noMediaSince = 0;

    while (Date.now() - started < MEDIA_WAIT_TIMEOUT) {
      if (!isAlive()) return "none";
      const target = this.host.getMediaPlaybackTarget();
      if (!target) return "none";
      if (target.allTasksFinished) return "done";

      if (!target.frameId) {
        if (!pendingSince) pendingSince = Date.now();
        if (Date.now() - pendingSince > 8000) {
          logger.warn("autoturn", "任务点 iframe 尚未匹配到子 frame，回退到通用媒体等待");
          return "none";
        }
        await sleep(500);
        continue;
      }
      pendingSince = 0;

      const state = target.state;
      if (!state) {
        if (!noMediaSince) noMediaSince = Date.now();
        if (Date.now() - noMediaSince > 10000) {
          logger.warn("autoturn", "任务点 iframe 未上报媒体，按已完成处理", {
            frameId: target.frameId,
          });
          return "done";
        }
      } else {
        noMediaSince = 0;
      }

      if (state?.allEnded) {
        if (!endedSince) {
          endedSince = Date.now();
          this.emit("任务点视频已结束，等待任务点完成…", false);
          logger.info("autoturn", "任务点视频结束，等待任务点完成标记", {
            frameId: target.frameId,
          });
        }
        // 视频结束后平台通常很快写回 .ans-job-finished；超时则停止而不是直接翻页，
        // 避免把还没标记完成的后续任务点跳过去。
        if (Date.now() - endedSince > 20000) return "stalled";
        await sleep(600);
        continue;
      }
      endedSince = 0;

      const frameChanged = target.frameId !== lastFrameId;
      lastFrameId = target.frameId;
      lastActivate = Date.now();
      this.host.activateMediaFrame(target.frameId);
      if (frameChanged) {
        const kind = target.source === "frames" ? "视频" : "任务点";
        const label = target.taskTotal
          ? `第 ${target.taskIndex + 1}/${target.taskTotal} 个${kind}`
          : `第 ${target.taskIndex + 1} 个${kind}`;
        this.emit(`开始播放${label}`, false);
        logger.info("autoturn", `开始播放${label}`, {
          frameId: target.frameId,
          mode: target.source ?? "tasks",
        });
      }

      if (settings.video.resumeOnPause && state?.anyPaused) {
        if (!pausedSince) pausedSince = Date.now();
        if (Date.now() - lastActivate > 1500) {
          lastActivate = Date.now();
          this.host.activateMediaFrame(target.frameId);
        }
        if (Date.now() - pausedSince > 8000 && Date.now() - lastNotice > 15000) {
          lastNotice = Date.now();
          this.emit(`第 ${target.taskIndex + 1} 个任务点视频已暂停，请手动点击播放`, false);
          logger.info("autoturn", "任务点视频暂停且无法自动恢复，等待手动播放", {
            frameId: target.frameId,
          });
        }
      } else {
        pausedSince = 0;
      }

      await sleep(500);
    }
    return "timeout";
  }

  private async waitForExternalMedia(
    timeoutMs: number,
    isAlive: () => boolean,
    allowResume: boolean,
  ): Promise<MediaWaitResult> {
    const started = Date.now();
    let pausedSince = 0;
    let endedSince = 0;
    let lastPauseNotice = 0;
    while (Date.now() - started < timeoutMs) {
      if (!isAlive()) return "none";
      const state = this.host.getChildMediaState();
      if (!state?.hasMedia) return "none";
      if (state.allEnded) {
        // 稳定 1.5 秒再确认，避免播放器结束瞬间自动切换分段/循环造成误判
        if (!endedSince) endedSince = Date.now();
        if (Date.now() - endedSince >= 1500) return "done";
      } else {
        endedSince = 0;
      }
      if (allowResume && state.anyPaused) {
        if (!pausedSince) pausedSince = Date.now();
        this.host.resumeChildMedia();
        // 不因暂停直接停止，等待用户手动播放；播放结束后会自动继续翻页
        if (Date.now() - pausedSince > 8000 && Date.now() - lastPauseNotice > 15000) {
          lastPauseNotice = Date.now();
          this.emit("视频已暂停，请手动点击播放；播放结束后会自动翻页", false);
          logger.info("autoturn", "视频暂停且无法自动恢复，等待手动播放");
        }
      } else {
        pausedSince = 0;
      }
      await sleep(500);
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

export type MediaWaitResult = "done" | "none" | "blocked" | "timeout" | "stalled";

function findMedia(doc: Document): HTMLMediaElement[] {
  return collectMedia(doc);
}

/** 媒体所在任务点是否已完成（学习通 .ans-job-finished） */
function isTaskPointFinished(media: HTMLMediaElement): boolean {
  try {
    return Boolean(media.closest(".ans-job-finished"));
  } catch {
    return false;
  }
}

/** 等待页面中的视频/音频播放结束；暂停时按设置尝试恢复播放 */
export async function waitForMedia(
  doc: Document,
  timeoutMs: number,
  isAlive: () => boolean,
  preferences: VideoSettings = getSettings().video,
): Promise<MediaWaitResult> {
  let allMedia = findMedia(doc);
  if (allMedia.length === 0 && doc.querySelector("iframe")) {
    // 章节页 iframe 可能尚未加载完，给播放器一点出现时间
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!isAlive()) return "none";
      await sleep(500);
      allMedia = findMedia(doc);
      if (allMedia.length > 0) break;
    }
  }
  if (allMedia.length === 0) return "none";

  const started = Date.now();
  const pausedSince = new Map<HTMLMediaElement, number>();
  const lastAttempt = new Map<HTMLMediaElement, number>();
  const finished = new WeakMap<HTMLMediaElement, { src: string; duration: number }>();

  const mediaSource = (element: HTMLMediaElement): string => {
    try {
      return element.currentSrc || element.src || "";
    } catch {
      return "";
    }
  };

  const mediaDuration = (element: HTMLMediaElement): number => {
    try {
      return element.duration;
    } catch {
      return Number.NaN;
    }
  };

  const markFinished = (element: HTMLMediaElement): void => {
    const src = mediaSource(element);
    const duration = mediaDuration(element);
    let nearEnd = false;
    try {
      nearEnd = duration > 0 && duration - element.currentTime <= 1;
    } catch {
      /* ignore */
    }
    let ended = false;
    try {
      ended = element.ended;
    } catch {
      /* ignore */
    }
    if (ended || nearEnd) finished.set(element, { src, duration });
  };

  const isFinished = (element: HTMLMediaElement): boolean => {
    const src = mediaSource(element);
    const duration = mediaDuration(element);
    const previous = finished.get(element);
    if (previous && (previous.src !== src || Math.abs(previous.duration - duration) > 1)) {
      // 切换到了新的视频/分段，重新等待
      finished.delete(element);
    }
    markFinished(element);
    return finished.has(element);
  };

  const onFinishEvent = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLMediaElement) markFinished(target);
  };
  document.addEventListener("ended", onFinishEvent, true);
  document.addEventListener("timeupdate", onFinishEvent, true);

  const cleanup = () => {
    document.removeEventListener("ended", onFinishEvent, true);
    document.removeEventListener("timeupdate", onFinishEvent, true);
  };

  const tryResume = async (element: HTMLMediaElement, now: number) => {
    let paused = false;
    try {
      paused = element.paused;
    } catch {
      return;
    }
    if (!paused || isFinished(element)) {
      pausedSince.delete(element);
      return;
    }
    const last = lastAttempt.get(element) ?? 0;
    if (now - last < 2000) return;
    lastAttempt.set(element, now);
    focusMedia(element);
    try {
      // play() 可能因浏览器自动播放策略被拒绝；保持静音可显著提高成功率
      if (preferences.defaultMuted) element.muted = true;
      await element.play();
    } catch {
      // 部分播放器需要鼠标聚焦/点击视频区域后才允许播放
      try {
        element.click();
      } catch {
        /* ignore */
      }
      try {
        await element.play();
      } catch {
        /* 由下面的 blocked 判定处理 */
      }
    }
  };

  while (Date.now() - started < timeoutMs) {
    if (!isAlive()) {
      cleanup();
      return "none";
    }
    // 多视频/音频页面：只跟踪“未完成任务点”的媒体，并按 DOM 顺序逐个等待，
    // 避免主播放器启发式在多个媒体之间来回切换导致进度跳动。
    const connected = findMedia(doc).filter((element) => element.isConnected);
    const unfinished = connected.filter(
      (element) => !isTaskPointFinished(element) && !isFinished(element),
    );
    if (unfinished.length === 0) {
      cleanup();
      return connected.length > 0 ? "done" : "none";
    }
    const primary = pickPrimaryMedia(unfinished);
    if (!primary) {
      cleanup();
      return "none";
    }

    const now = Date.now();
    if (preferences.resumeOnPause) {
      await tryResume(primary, now);

      let paused = false;
      try {
        paused = primary.paused;
      } catch {
        paused = false;
      }
      if (!paused) {
        pausedSince.delete(primary);
      } else {
        if (!pausedSince.has(primary)) pausedSince.set(primary, now);
        const pausedFor = now - (pausedSince.get(primary) ?? now);
        if (pausedFor > 5000) {
          cleanup();
          return "blocked";
        }
      }
    }

    await sleep(1000);
  }
  cleanup();
  return "timeout";
}
