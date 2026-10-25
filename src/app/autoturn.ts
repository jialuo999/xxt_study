import { getSettings } from "@/core/settings-store";
import { t } from "@/core/i18n";
import type { MediaState, PageInfo } from "@/core/types";
import type { PageContext, PlatformAdapter } from "@/platform/types";
import { jitter, sleep } from "@/utils/async";
import { logger } from "@/core/logger";
import type { AutoTurnView } from "@/ui/contract";
import { findMedia, waitForMedia, type MediaWaitResult } from "./media-wait";
import { taskUrlKey, type MediaPlaybackTarget } from "./media-target";
import { isReadingTaskKind } from "./task-points";

export type { MediaPlaybackTarget } from "./media-target";

const SESSION_KEY = "study-helper.autoturn.v1";
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MEDIA_WAIT_TIMEOUT = 45 * 60 * 1000;
/** 单篇阅读/文档任务最长等待时间；滚动完成后平台通常几秒内写回任务点状态 */
const READING_WAIT_TIMEOUT = 10 * 60 * 1000;

/** 当前目标是否是阅读/文档/PPT 任务（由内容 frame 转发滚动指令完成） */
export function isReadingTarget(target: MediaPlaybackTarget | null): boolean {
  if (!target || target.allTasksFinished) return false;
  return isReadingTaskKind(target.kind);
}

interface AutoTurnSession {
  running: boolean;
  steps: number;
  visited: string[];
  lastUrl: string;
  savedAt?: number;
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
  /** 请求内容 frame 完成阅读/文档任务（目标可能没有可握手的子 frame） */
  startReadingTask?(target: MediaPlaybackTarget): void;
  resumeChildMedia(): void;
  /** 停止翻页时暂停当前页面/子 frame 的视频与音频 */
  pauseMedia(): void;
  /** 顶层 URL + 子 frame URL/类型的稳定签名，用于判断任务点是否切换 */
  getTaskSignature(): string;
  /** 平台是否弹出人机验证（【9010】验证码页）；检测到后不得继续点击 */
  hasVerificationChallenge(): boolean;
  /** 自动翻页真正开始（含刷新后恢复）时调用，用于启动播放守卫等 */
  onStarted?(): void;
  onState(state: AutoTurnView): void;
  onStopped(reason: string): void;
}

/** 学习通同页多任务点时的播放目标（定义在 media-target.ts，便于纯函数测试） */

export class AutoTurnRunner {
  private running = false;
  private steps = 0;
  private visited: string[] = [];
  private loopToken = 0;

  constructor(private readonly host: AutoTurnHost) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** 是否存在“刷新后待恢复”的会话（Host 用于先抢多标签锁再恢复） */
  hasRestorableSession(): boolean {
    const settings = getSettings();
    if (!settings.autoTurn.enabled || !settings.autoTurn.resumeOnReload) return false;
    const session = readSession();
    return Boolean(session?.running);
  }

  /** 刷新后恢复上次运行；返回是否真正恢复，供 Host 在失败时释放多标签锁 */
  restore(): boolean {
    const settings = getSettings();
    if (!settings.autoTurn.enabled || !settings.autoTurn.resumeOnReload) {
      this.persist(false);
      return false;
    }
    const session = readSession();
    if (!session?.running) return false;
    // 只恢复同一页面/章节的会话，避免隔了很久在任意章节页刷新时“自己动起来”。
    if (session.lastUrl && taskUrlKey(session.lastUrl) !== taskUrlKey(location.href)) {
      logger.info("autoturn", "忽略过期的自动翻页会话（页面已变化）");
      this.persist(false);
      return false;
    }
    this.running = true;
    this.steps = session.steps;
    this.visited = session.visited ?? [];
    this.host.onStarted?.();
    logger.info("autoturn", `恢复自动翻页（第 ${this.steps} 步）`);
    this.emit(t("autoturn.restored"));
    setTimeout(() => void this.loop(), Math.max(800, settings.autoTurn.startDelayMs));
    return true;
  }

  start(): void {
    if (this.running) return;
    const settings = getSettings();
    if (!settings.autoTurn.enabled) return;
    this.running = true;
    this.steps = 0;
    this.visited = [];
    this.persist(true);
    this.host.onStarted?.();
    logger.info("autoturn", "开始自动翻页");
    const delay = Math.max(0, settings.autoTurn.startDelayMs);
    this.emit(
      delay
        ? t("autoturn.startingIn", { seconds: Math.ceil(delay / 1000) })
        : t("autoturn.preparing"),
      false,
      Date.now() + delay,
    );
    setTimeout(() => {
      if (this.running) void this.loop();
    }, delay);
  }

  stop(reason = t("autoturn.defaultStop")): void {
    if (!this.running) {
      // 未运行时的 stop 不得暂停用户正在播放的媒体；只清理残留会话。
      this.persist(false);
      this.emit(reason, true);
      return;
    }
    // 停止翻页后立即暂停视频/音频，避免声音继续播放
    try {
      this.host.pauseMedia();
    } catch {
      /* ignore */
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
    this.stop(t("autoturn.verifyStop"));
    return true;
  }

  private async loop(): Promise<void> {
    const token = ++this.loopToken;
    if (!this.running) return;
    const settings = getSettings();
    const page = this.host.getPage();

    if (!page.supported) {
      this.stop(t("autoturn.unsupported"));
      return;
    }
    if (page.kind !== "chapter" && page.kind !== "cards" && page.kind !== "video") {
      this.stop(t("autoturn.notChapterPage"));
      return;
    }
    if (this.stopForVerification()) return;
    if (this.steps >= settings.autoTurn.maxSteps) {
      this.stop(t("autoturn.maxSteps", { count: settings.autoTurn.maxSteps }));
      return;
    }
    if (settings.autoTurn.stopOnUnanswered && this.host.hasUnansweredQuestions()) {
      this.stop(t("autoturn.unansweredStop"));
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
          this.emit(t("autoturn.tasksDone"), false);
          logger.info("autoturn", "当前章节任务点均已完成，跳过媒体等待");
        } else {
          const kind =
            target.source === "frames" ? t("autoturn.kind.video") : t("autoturn.kind.task");
          const label = target.taskTotal
            ? t("autoturn.taskLabel", {
                index: target.taskIndex + 1,
                total: target.taskTotal,
                kind,
              })
            : t("autoturn.taskLabelSingle", { index: target.taskIndex + 1, kind });
          this.emit(t("autoturn.playInOrder", { label }), false);
          logger.info("autoturn", `按任务点顺序等待${label}`, { frameId: target.frameId, mode: target.source });
          const taskResult = await this.waitForTaskMedia(isAlive);
          if (!this.running || token !== this.loopToken) return;
          if (taskResult === "timeout") {
            this.stop(t("autoturn.waitTaskTimeout"));
            return;
          }
          if (taskResult === "blocked") {
            this.stop(t("autoturn.taskPaused"));
            return;
          }
          if (taskResult === "stalled") {
            this.stop(t("autoturn.taskNotFinished"));
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
        this.emit(t("autoturn.tasksDone"), false);
        logger.info("autoturn", "当前任务点均已完成，跳过媒体等待");
      } else if (external?.allTasksFinished) {
        logger.debug("autoturn", "当前章节任务点均已完成", external);
      }
      if (!taskFinished) {
        this.emit(t("autoturn.waitMedia"), false);
        if (external?.hasMedia) {
          const externalResult = await this.waitForExternalMedia(
            MEDIA_WAIT_TIMEOUT,
            isAlive,
            settings.video.resumeOnPause,
          );
          if (!this.running || token !== this.loopToken) return;
          if (externalResult === "blocked") {
            this.stop(t("autoturn.mediaPaused"));
            return;
          }
          if (externalResult === "timeout") {
            this.stop(t("autoturn.waitMediaTimeout"));
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
            (message) => this.emit(message, false),
          );
          if (!this.running || token !== this.loopToken) return;
          if (localResult === "blocked") {
            this.stop(t("autoturn.mediaPaused"));
            return;
          }
          if (localResult === "timeout") {
            this.stop(t("autoturn.waitMediaTimeout"));
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
              this.stop(t("autoturn.mediaPaused"));
              return;
            }
            if (lateResult === "timeout") {
              this.stop(t("autoturn.waitMediaTimeout"));
              return;
            }
          } else if (settings.autoTurn.contentWaitMs > 0) {
            const wait = Math.min(120000, Math.max(0, settings.autoTurn.contentWaitMs));
            this.emit(
              t("autoturn.noMediaWait", { seconds: Math.ceil(wait / 1000) }),
              false,
              Date.now() + wait,
            );
            await sleep(wait);
            if (!this.running || token !== this.loopToken) return;
          }
        }
      }
    }

    const delay = jitter(settings.autoTurn.minDelayMs, settings.autoTurn.maxDelayMs);
    this.emit(
      t("autoturn.nextIn", { seconds: Math.max(1, Math.ceil(delay / 1000)) }),
      false,
      Date.now() + delay,
    );
    await sleep(delay);
    if (!this.running || token !== this.loopToken) return;
    if (this.stopForVerification()) return;

    const adapter = this.host.getAdapter();
    const context = this.host.getContext();
    if (!adapter?.nextPage || !context) {
      this.stop(t("autoturn.noNextButton"));
      return;
    }

    const before = this.host.getTaskSignature();
    logger.debug("autoturn", "翻页前任务签名", before);
    let result;
    // 页面/按钮可能比任务点晚加载：找不到按钮时短暂重试，而不是立刻停机。
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await adapter.nextPage(context);
      } catch (error) {
        logger.error("autoturn", "翻页时出错", error);
        this.stop(t("autoturn.turnError"));
        return;
      }
      if (!this.running || token !== this.loopToken) return;
      if (result.ok) break;
      if (attempt < 2) {
        this.emit(result.message || t("autoturn.waitNextButton"), false);
        logger.debug("autoturn", "翻页按钮不可用，稍后重试", { attempt: attempt + 1 });
        await sleep(700 * (attempt + 1));
      }
    }
    if (!result?.ok) {
      this.stop(result?.message || t("autoturn.turnFailed"));
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
      this.stop(t("autoturn.noChange"));
      return;
    }

    this.steps++;
    this.visited.push(before);
    if (this.visited.filter((signature) => signature === before).length >= 3) {
      this.stop(t("autoturn.duplicate"));
      return;
    }
    this.persist(true);
    logger.debug("autoturn", "任务点已切换", this.host.getTaskSignature());
    this.emit(result.message || t("autoturn.turned", { step: this.steps }), false);
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
    let readingKey = "";
    let readingStarted = 0;

    while (Date.now() - started < MEDIA_WAIT_TIMEOUT) {
      if (!isAlive()) return "none";
      const target = this.host.getMediaPlaybackTarget();
      if (!target) return "none";
      if (target.allTasksFinished) return "done";

      // 阅读/文档/PPT 任务：文档 iframe 往往不握手，由内容 frame 转发滚动指令；
      // 完成状态仍以内容 frame 的任务点快照为准。
      if (isReadingTarget(target)) {
        if (!settings.autoTurn.readingAuto) {
          logger.warn("autoturn", "检测到阅读/文档任务，但自动完成已关闭");
          return "stalled";
        }
        const key = target.taskId || target.taskUrl || `task-${target.taskIndex}`;
        if (key !== readingKey) {
          readingKey = key;
          readingStarted = Date.now();
          if (lastFrameId) {
            this.host.pauseMedia();
            lastFrameId = "";
          }
          this.host.startReadingTask?.(target);
          const label = target.taskTotal
            ? t("autoturn.taskLabel", {
                index: target.taskIndex + 1,
                total: target.taskTotal,
                kind: t("autoturn.kind.task"),
              })
            : t("autoturn.currentTask");
          this.emit(t("autoturn.readingTask", { label }), false);
          logger.info("autoturn", "开始完成阅读/文档任务", {
            taskIndex: target.taskIndex,
            taskTotal: target.taskTotal,
            kind: target.kind,
            taskId: target.taskId,
            ownerFrameId: target.ownerFrameId,
          });
        }
        if (Date.now() - readingStarted > READING_WAIT_TIMEOUT) {
          logger.warn("autoturn", "阅读/文档任务等待超时，任务点仍未完成", {
            taskIndex: target.taskIndex,
            taskId: target.taskId,
          });
          return "stalled";
        }
        await sleep(500);
        continue;
      }
      readingKey = "";

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
        // 不能按“已完成”处理：目标任务点还没完成，直接翻页会跳过未完成任务。
        if (Date.now() - noMediaSince > 20000) {
          logger.warn("autoturn", "任务点 iframe 长时间未上报媒体，暂停等待人工确认", {
            frameId: target.frameId,
            kind: target.kind,
          });
          return "stalled";
        }
      } else {
        noMediaSince = 0;
      }

      if (state?.allEnded) {
        if (!endedSince) {
          endedSince = Date.now();
          this.emit(t("autoturn.taskVideoEnded"), false);
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
      if (frameChanged) {
        lastFrameId = target.frameId;
        lastActivate = Date.now();
        this.host.activateMediaFrame(target.frameId);
        const kindLabel =
          target.source === "frames" ? t("autoturn.kind.video") : t("autoturn.kind.task");
        const label = target.taskTotal
          ? t("autoturn.taskLabel", {
              index: target.taskIndex + 1,
              total: target.taskTotal,
              kind: kindLabel,
            })
          : t("autoturn.taskLabelSingle", { index: target.taskIndex + 1, kind: kindLabel });
        const playLabel = t("autoturn.playTask", { label });
        this.emit(playLabel, false);
        logger.info("autoturn", playLabel, {
          frameId: target.frameId,
          mode: target.source ?? "tasks",
        });
      }

      if (settings.video.resumeOnPause && state?.anyPaused) {
        if (!pausedSince) pausedSince = Date.now();
        // 只在目标切换或暂停恢复重试时发 RESUME；不能每 500ms 都发，
        // 否则播放器会被连续 play 打断，表现为画面抖动。
        if (Date.now() - lastActivate > 5000) {
          lastActivate = Date.now();
          this.host.activateMediaFrame(target.frameId);
        }
        if (Date.now() - pausedSince > 8000 && Date.now() - lastNotice > 15000) {
          lastNotice = Date.now();
          this.emit(
            t("autoturn.taskVideoPaused", { index: target.taskIndex + 1 }),
            false,
          );
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
    let lastResumeAttempt = 0;
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
        // 不要每个轮询周期都 play()：部分播放器被连续 play 会反复暂停/恢复，表现为抖动
        if (Date.now() - lastResumeAttempt > 3000) {
          lastResumeAttempt = Date.now();
          this.host.resumeChildMedia();
        }
        // 不因暂停直接停止，等待用户手动播放；播放结束后会自动继续翻页
        if (Date.now() - pausedSince > 8000 && Date.now() - lastPauseNotice > 15000) {
          lastPauseNotice = Date.now();
          this.emit(t("autoturn.videoPaused"), false);
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
      savedAt: Date.now(),
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
    const parsed = JSON.parse(raw) as AutoTurnSession;
    if (
      typeof parsed?.running !== "boolean" ||
      !Number.isFinite(parsed.steps) ||
      !Array.isArray(parsed.visited)
    ) {
      return null;
    }
    if (parsed.savedAt !== undefined) {
      if (!Number.isFinite(parsed.savedAt)) return null;
      if (Date.now() - parsed.savedAt > SESSION_TTL_MS) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export { waitForMedia } from "./media-wait";
export type { MediaWaitResult } from "./media-wait";
