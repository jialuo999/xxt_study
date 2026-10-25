import type { PageInfo, Question } from "@/core/types";
import { t } from "@/core/i18n";
import {
  createMessage,
  createToken,
  isTrustedOrigin,
  sendToWindow,
  validateFrameMessage,
  type FrameMessage,
} from "@/core/messages";
import { getSettings } from "@/core/settings-store";
import { logger } from "@/core/logger";
import { getAdapter } from "@/platform/registry";
import { primeFontDecoder } from "@/platform/chaoxing/font/decoder";
import type { PageContext, PlatformAdapter } from "@/platform/types";
import { frameId as getFrameId } from "./frames";
import { collectTaskPointState } from "./task-points";
import {
  collectDocumentMedia,
  collectMedia,
  focusMedia,
  pickPrimaryMedia,
} from "./media-preferences";
import { chapterIdFromUrl } from "./media-target";
import { startPlaybackGuard, type PlaybackGuard } from "./playback-guard";
import { resetSubmitGuard } from "@/platform/chaoxing/submit";

const UNKNOWN: PageInfo = {
  kind: "unknown",
  url: location.href,
  title: document.title,
  supported: false,
};

/**
 * 子 frame 内的轻量 agent：采集题目、执行填入/提交，并把结果回报给 UI Host。
 * 不渲染任何界面。
 */
export class FrameAgent {
  private adapter: PlatformAdapter | null = null;
  private context: PageContext | null = null;
  private token = "";
  private nonce = createToken();
  private lastUrl = location.href;
  private urlTimer: ReturnType<typeof setInterval> | null = null;
  private questions: Question[] = [];
  private lastSignature = "";
  private frameId = getFrameId();
  private helloAttempts = 0;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private mediaTimer: ReturnType<typeof setInterval> | null = null;
  private mediaListener: (() => void) | null = null;
  private mediaTimeListener: (() => void) | null = null;
  private mediaFinishes = new WeakMap<HTMLMediaElement, { src: string; duration: number }>();
  private mutationTimer: ReturnType<typeof setTimeout> | null = null;
  private guard: PlaybackGuard | null = null;
  private disposed = false;

  constructor(private readonly hostWindow: Window) {}

  start(): void {
    if (!this.detect()) {
      logger.debug("frame", "当前 frame 无适配器，跳过");
      return;
    }
    window.addEventListener("message", this.onMessage);
    this.sendHello();
    this.helloTimer = setInterval(() => {
      if (this.token || this.disposed) {
        this.stopHello();
        return;
      }
      if (++this.helloAttempts > 10) {
        this.stopHello();
        return;
      }
      this.sendHello();
    }, 1500);
    setTimeout(() => this.collectAndSend(true), 600);
    // 字体样式可能稍后才注入；解析成功后重新采集一次，避免第一批题目带乱码
    void primeFontDecoder(document).then((font) => {
      if (font && !this.disposed) {
        setTimeout(() => this.collectAndSend(true), 0);
      }
    });
    this.observe();
    this.startMediaReporter();
    // 子 frame 内也可能是 SPA/任务点路由：URL 变化时重新握手，Host 才能更新签名并触发翻页校验。
    this.urlTimer = setInterval(() => this.checkUrlChange(), 1500);
    window.addEventListener("popstate", this.onUrlChange);
    window.addEventListener("hashchange", this.onUrlChange);
  }

  private onUrlChange = (): void => {
    this.checkUrlChange();
  };

  private checkUrlChange(): void {
    if (this.disposed) return;
    if (location.href === this.lastUrl) return;
    this.lastUrl = location.href;
    this.detect();
    this.lastSignature = "";
    resetSubmitGuard(document);
    this.sendHello();
  }

  private detect(): boolean {
    const url = new URL(location.href);
    const adapter = getAdapter(url);
    if (!adapter) {
      this.adapter = null;
      this.context = null;
      return false;
    }
    let page: PageInfo;
    try {
      page = adapter.detectPage(document, url);
    } catch (error) {
      logger.warn("frame", "页面识别失败", error);
      page = UNKNOWN;
    }
    if (!page.supported) {
      this.adapter = null;
      this.context = null;
      return false;
    }
    this.adapter = adapter;
    this.context = {
      doc: document,
      win: window,
      url,
      page,
      frameId: this.frameId,
    };
    return true;
  }

  private sendHello(): void {
    const page = this.context?.page ?? UNKNOWN;
    const meta = this.frameAttachmentMeta();
    sendToWindow(
      this.hostWindow,
      createMessage({
        t: "HELLO",
        frameId: this.frameId,
        url: location.href,
        title: document.title,
        pageKind: page.kind,
        nonce: this.nonce,
        ...meta,
      }),
    );
  }

  /**
   * 视频/文档 iframe 的 URL 往往相同（`/ananas/modules/video/index.html`），
   * jobid 只存在于 iframe 的 `data` / 属性上。把它随 HELLO/STATE 报给 Host，
   * 才能在同页多个任务点里精确找到当前该播放的那个 frame。
   */
  private frameAttachmentMeta(): { jobid?: string; mid?: string } {
    try {
      const frame = window.frameElement as HTMLIFrameElement | null;
      if (!frame) return {};
      const raw = frame.getAttribute("data");
      let data: Record<string, unknown> | null = null;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            data = parsed as Record<string, unknown>;
          }
        } catch {
          /* ignore */
        }
      }
      const jobid =
        frame.getAttribute("jobid")?.trim() ||
        (data && typeof data.jobid === "string" ? data.jobid : "") ||
        (data && typeof data._jobid === "string" ? data._jobid : "") ||
        "";
      const mid =
        frame.getAttribute("mid")?.trim() ||
        (data && typeof data.mid === "string" ? data.mid : "") ||
        "";
      return {
        ...(jobid ? { jobid } : {}),
        ...(mid ? { mid } : {}),
      };
    } catch {
      return {};
    }
  }

  private stopHello(): void {
    if (this.helloTimer) {
      clearInterval(this.helloTimer);
      this.helloTimer = null;
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (!this.token || this.disposed) return;
      sendToWindow(this.hostWindow, createMessage({ t: "PING", token: this.token }));
    }, 15000);
  }

  private onMessage = (event: MessageEvent): void => {
    if (!this.adapter || !this.context) return;
    if (event.source !== this.hostWindow && event.source !== window.parent) return;
    // 只接受来自学习通/教育网父页面的指令；第三方站点嵌入时不得驱动填入/提交。
    if (!isTrustedOrigin(event.origin)) return;
    const message = validateFrameMessage(event.data);
    if (!message) return;
    if (message.t === "WELCOME") {
      if (message.nonce !== this.nonce) return;
      this.token = message.token;
      this.stopHello();
      this.startHeartbeat();
      void this.collectAndSend(true);
      return;
    }
    if (!("token" in message) || message.token !== this.token) return;
    switch (message.t) {
      case "COLLECT":
        void this.collectAndSend(true);
        break;
      case "FILL":
        void this.handleFill(message);
        break;
      case "SUBMIT":
        void this.handleSubmit(message);
        break;
      case "NEXT":
        void this.handleNext();
        break;
      case "RESUME_MEDIA":
        void this.resumeMedia();
        break;
      case "PAUSE_MEDIA":
        this.pauseMedia();
        break;
      case "GUARD_START":
        this.startGuard();
        break;
      case "GUARD_STOP":
        this.stopGuard();
        break;
      default:
        break;
    }
  };

  private startMediaReporter(): void {
    if (this.mediaTimer) return;
    const report = () => this.reportMediaState();
    this.mediaListener = report;
    this.mediaTimer = setInterval(report, 1000);
    document.addEventListener("pause", report, true);
    document.addEventListener("play", report, true);
    document.addEventListener("ended", report, true);
    let lastTimeReport = 0;
    this.mediaTimeListener = () => {
      const now = Date.now();
      if (now - lastTimeReport < 500) return;
      lastTimeReport = now;
      report();
    };
    document.addEventListener("timeupdate", this.mediaTimeListener, true);
    report();
  }

  private mediaSource(media: HTMLMediaElement): string {
    try {
      return media.currentSrc || media.src || "";
    } catch {
      return "";
    }
  }

  private mediaDuration(media: HTMLMediaElement): number {
    try {
      return media.duration;
    } catch {
      return Number.NaN;
    }
  }

  /** 记录“曾经播放到结尾”，避免播放器结束后立刻循环导致状态永远不是 ended */
  private isMediaFinished(media: HTMLMediaElement): boolean {
    const src = this.mediaSource(media);
    const duration = this.mediaDuration(media);
    const previous = this.mediaFinishes.get(media);
    if (previous && (previous.src !== src || Math.abs(previous.duration - duration) > 1)) {
      // 播放器切换到了新的视频/分段，重新等待
      this.mediaFinishes.delete(media);
    }
    let nearEnd = false;
    try {
      nearEnd = duration > 0 && duration - media.currentTime <= 1;
    } catch {
      /* ignore */
    }
    let ended = false;
    try {
      ended = media.ended;
    } catch {
      /* ignore */
    }
    if (ended || nearEnd) this.mediaFinishes.set(media, { src, duration });
    return this.mediaFinishes.has(media);
  }

  /** 学习通任务点完成状态（内容 frame 中 .ans-job-icon 的父级类名） */
  private taskPointState(): ReturnType<typeof collectTaskPointState> {
    return collectTaskPointState(document);
  }

  private reportMediaState(): void {
    if (!this.token || this.disposed) return;
    try {
      // 多视频页面只跟踪主播放器，避免隐藏的预加载/广告元素让等待永远不结束
      const primary = pickPrimaryMedia(collectMedia(document));
      const hasMedia = primary != null;
      const allEnded = primary ? this.isMediaFinished(primary) : false;
      let anyPaused = false;
      if (primary) {
        try {
          anyPaused = primary.paused && !primary.ended;
        } catch {
          anyPaused = false;
        }
      }
      const taskState = this.taskPointState();
      sendToWindow(
        this.hostWindow,
        createMessage({
          t: "MEDIA_STATE",
          token: this.token,
          frameId: this.frameId,
          state: {
            hasMedia,
            allEnded,
            anyPaused,
            chapterId: chapterIdFromUrl(location.href) || undefined,
            ...taskState,
          },
        }),
      );
    } catch (error) {
      logger.debug("frame", "媒体状态上报失败", error);
    }
  }

  private pauseMedia(): void {
    // 脚本主动暂停：先让守卫进入 suspend，避免它把刚暂停的视频又恢复。
    this.guard?.suspend();
    for (const media of collectMedia(document)) {
      try {
        if (!media.paused) media.pause();
      } catch {
        /* ignore */
      }
    }
    this.reportMediaState();
  }

  private startGuard(): void {
    if (this.guard || this.disposed) return;
    this.guard = startPlaybackGuard({
      doc: document,
      isEnabled: () => getSettings().video.resumeOnPause,
      // 只保活主播放器；同页的预加载/隐藏媒体不参与自动恢复。
      collectMedia: () => {
        const primary = pickPrimaryMedia(collectDocumentMedia(document));
        return primary ? [primary] : [];
      },
      onNotice: (message, level) => this.sendGuardNotice(message, level),
    });
  }

  private stopGuard(): void {
    this.guard?.stop();
    this.guard = null;
  }

  private sendGuardNotice(message: string, level: "info" | "warn"): void {
    if (!this.token || this.disposed) return;
    sendToWindow(
      this.hostWindow,
      createMessage({
        t: "GUARD_NOTICE",
        token: this.token,
        frameId: this.frameId,
        level,
        message,
      }),
    );
  }

  private async resumeMedia(): Promise<void> {
    const settings = getSettings();
    if (!settings.video.resumeOnPause) return;
    this.guard?.resume();
    const primary = pickPrimaryMedia(collectMedia(document));
    if (!primary) {
      this.reportMediaState();
      return;
    }
    try {
      if (primary.paused && !primary.ended) {
        focusMedia(primary);
        if (settings.video.defaultMuted) primary.muted = true;
        try {
          await primary.play();
        } catch {
          // 不点击视频兜底：click 会切换播放/暂停，反复重试会造成画面抖动
        }
      }
    } catch {
      /* 浏览器可能拒绝自动播放 */
    }
    this.reportMediaState();
  }

  private collectAndSend(force = false): void {
    // 未收到 WELCOME 前不采集：消息会被 Host 丢弃，白白消耗字体解码与 DOM 查询。
    if (!this.token) return;
    this.detect();
    if (!this.adapter || !this.context) {
      if (this.token) {
        sendToWindow(
          this.hostWindow,
          createMessage({
            t: "QUESTIONS",
            token: this.token,
            frameId: this.frameId,
            pageKind: "unknown",
            questions: [],
          }),
        );
      }
      return;
    }
    try {
      const page = this.adapter.detectPage(document, new URL(location.href));
      this.context.page = page;
      const questions = this.adapter.collectQuestions(this.context);
      this.questions = questions;
      const signature = questions.map((question) => `${question.id}:${question.options.length}`).join("|");
      if (!force && signature === this.lastSignature) return;
      this.lastSignature = signature;
      sendToWindow(
        this.hostWindow,
        createMessage({
          t: "QUESTIONS",
          token: this.token,
          frameId: this.frameId,
          pageKind: page.kind,
          questions,
        }),
      );
      sendToWindow(
        this.hostWindow,
        createMessage({
          t: "STATE",
          token: this.token,
          frameId: this.frameId,
          url: location.href,
          pageKind: page.kind,
          ...this.frameAttachmentMeta(),
        }),
      );
      logger.debug("frame", `采集 ${questions.length} 题`);
    } catch (error) {
      logger.warn("frame", "采集失败", error);
    }
  }

  private async handleFill(
    message: Extract<FrameMessage, { t: "FILL" }>,
  ): Promise<void> {
    if (!this.adapter || !this.context) return;
    const results = [];
    for (const item of message.answers) {
      let question = this.questions.find((candidate) => candidate.id === item.questionId);
      if (!question) {
        this.collectAndSend(true);
        question = this.questions.find((candidate) => candidate.id === item.questionId);
      }
      if (!question) {
        results.push({
          questionId: item.questionId,
          ok: false,
          message: t("run.toast.questionChanged"),
        });
        continue;
      }
      try {
        const result = await this.adapter.fillAnswer(this.context, question, item.answer, {
          delayMs: message.delayMs ?? getSettings().solving.fillDelayMs,
        });
        results.push(result);
      } catch (error) {
        results.push({
          questionId: item.questionId,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    sendToWindow(
      this.hostWindow,
      createMessage({ t: "FILLED", token: this.token, frameId: this.frameId, results }),
    );
  }

  private async handleSubmit(
    message: Extract<FrameMessage, { t: "SUBMIT" }>,
  ): Promise<void> {
    if (!this.adapter || !this.context) return;
    const settings = getSettings();
    let result;
    if (this.context.page.kind === "exam" && !settings.solving.allowExam) {
      result = { ok: false, message: t("run.toast.examSubmit") };
    } else if (!this.adapter.submit) {
      result = { ok: false, message: t("run.toast.noSubmitButton") };
    } else {
      try {
        result = await this.adapter.submit(this.context, {
          autoConfirm: message.autoConfirm === true,
        });
      } catch (error) {
        result = {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    sendToWindow(
      this.hostWindow,
      createMessage({
        t: "SUBMIT_RESULT",
        token: this.token,
        frameId: this.frameId,
        result,
      }),
    );
  }

  private async handleNext(): Promise<void> {
    if (!this.adapter?.nextPage || !this.context) return;
    try {
      await this.adapter.nextPage(this.context);
    } catch (error) {
      logger.warn("frame", "翻页失败", error);
    }
  }

  private observe(): void {
    try {
      const observer = new MutationObserver(() => {
        if (this.mutationTimer) clearTimeout(this.mutationTimer);
        this.mutationTimer = setTimeout(() => {
          if (!this.disposed) this.collectAndSend();
        }, 500);
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "value", "checked"],
      });
    } catch (error) {
      logger.debug("frame", "MutationObserver 启动失败", error);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopHello();
    this.stopGuard();
    if (this.urlTimer) {
      clearInterval(this.urlTimer);
      this.urlTimer = null;
    }
    window.removeEventListener("popstate", this.onUrlChange);
    window.removeEventListener("hashchange", this.onUrlChange);
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.mutationTimer) clearTimeout(this.mutationTimer);
    if (this.mediaTimer) {
      clearInterval(this.mediaTimer);
      this.mediaTimer = null;
    }
    if (this.mediaListener) {
      document.removeEventListener("pause", this.mediaListener, true);
      document.removeEventListener("play", this.mediaListener, true);
      document.removeEventListener("ended", this.mediaListener, true);
      this.mediaListener = null;
    }
    if (this.mediaTimeListener) {
      document.removeEventListener("timeupdate", this.mediaTimeListener, true);
      this.mediaTimeListener = null;
    }
    window.removeEventListener("message", this.onMessage);
  }
}
