import type { PageInfo, Question } from "@/core/types";
import {
  createMessage,
  isFrameMessage,
  sendToWindow,
  type FrameMessage,
} from "@/core/messages";
import { getSettings } from "@/core/settings-store";
import { logger } from "@/core/logger";
import { getAdapter } from "@/platform/registry";
import type { PageContext, PlatformAdapter } from "@/platform/types";
import { frameId as getFrameId } from "./frames";
import { collectMedia, focusMedia, pickPrimaryMedia } from "./media-preferences";

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
    this.observe();
    this.startMediaReporter();
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
    sendToWindow(
      this.hostWindow,
      createMessage({
        t: "HELLO",
        frameId: this.frameId,
        url: location.href,
        title: document.title,
        pageKind: page.kind,
      }),
    );
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
    const message = event.data;
    if (!isFrameMessage(message)) return;
    if (message.t === "WELCOME") {
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
  private taskPointState(): { currentTaskFinished: boolean; allTasksFinished: boolean } {
    const result = { currentTaskFinished: false, allTasksFinished: false };
    try {
      const icons = Array.from(document.querySelectorAll<HTMLElement>(".ans-job-icon"));
      if (icons.length === 0) return result;
      const items = icons
        .map((icon) => icon.parentElement)
        .filter((item): item is HTMLElement => Boolean(item));
      if (items.length === 0) return result;
      result.allTasksFinished = items.every((item) =>
        item.classList.contains("ans-job-finished"),
      );
      for (const item of items) {
        const iframe = item.querySelector("iframe");
        if (!iframe) continue;
        let visible = true;
        try {
          const rect = iframe.getBoundingClientRect();
          visible = rect.width > 0 && rect.height > 0;
        } catch {
          /* ignore */
        }
        if (visible) {
          const win = iframe.ownerDocument.defaultView;
          const style = win?.getComputedStyle(iframe);
          if (style && (style.display === "none" || style.visibility === "hidden")) visible = false;
        }
        if (visible && item.classList.contains("ans-job-finished")) {
          result.currentTaskFinished = true;
          break;
        }
      }
    } catch {
      /* ignore */
    }
    return result;
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
          state: { hasMedia, allEnded, anyPaused, ...taskState },
        }),
      );
    } catch (error) {
      logger.debug("frame", "媒体状态上报失败", error);
    }
  }

  private pauseMedia(): void {
    for (const media of collectMedia(document)) {
      try {
        if (!media.paused) media.pause();
      } catch {
        /* ignore */
      }
    }
    this.reportMediaState();
  }

  private async resumeMedia(): Promise<void> {
    const settings = getSettings();
    if (!settings.video.resumeOnPause) return;
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
          try {
            primary.click();
            await primary.play();
          } catch {
            /* 浏览器可能拒绝自动播放 */
          }
        }
      }
    } catch {
      /* 浏览器可能拒绝自动播放 */
    }
    this.reportMediaState();
  }

  private collectAndSend(force = false): void {
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
          message: "题目已变化，请重新扫描",
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
      result = { ok: false, message: "考试页面已保护，已阻止提交" };
    } else if (!this.adapter.submit) {
      result = { ok: false, message: "当前页面没有提交按钮" };
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
