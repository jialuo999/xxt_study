import type {
  BankEntry,
  FillResult,
  MediaState,
  PageInfo,
  Question,
  SolveResult,
  SubmitResult,
} from "@/core/types";
import {
  getSettings,
  updateSettings,
  replaceSettings,
  subscribeSettings,
} from "@/core/settings-store";
import { DEFAULT_SETTINGS, type DeepPartial, type Settings } from "@/core/settings";
import {
  getLogs,
  clearLogs as clearLogBuffer,
  exportLogs as exportLogText,
  logger,
  subscribeLogs,
} from "@/core/logger";
import { gmGet, gmSet } from "@/core/gm";
import {
  createMessage,
  createToken,
  isFrameMessage,
  isTrustedOrigin,
  sendToWindow,
} from "@/core/messages";
import { getAdapter } from "@/platform/registry";
import type { PageContext, PlatformAdapter } from "@/platform/types";
import { detectVerificationChallenge } from "@/platform/chaoxing/verification";
import {
  initBank,
  getBankStats,
  importBankText,
  detectBankFormat,
  clearBank,
  exportBank,
  searchBankByText,
} from "@/bank";
import { solveQuestions } from "@/solver";
import { testAiConnection } from "@/ai";
import { sleep } from "@/utils/async";
import type {
  AiTestView,
  FrameSummary,
  ImportResultView,
  ToastView,
  UiController,
  UiState,
} from "@/ui/contract";
import { AutoTurnRunner } from "./autoturn";
import type { MediaPlaybackTarget } from "./autoturn";
import { collectMedia } from "./media-preferences";

const NOTICE_KEY = "study-helper.notice.v1";

const TASK_URL_KEYS = [
  "jobid",
  "jobId",
  "knowledgeId",
  "knowledgeid",
  "chapterId",
  "chapterid",
  "objectId",
  "objectid",
  "clazzid",
  "clazzId",
  "courseId",
  "courseid",
] as const;

/** 去掉 _dc 等缓存参数，只保留能区分任务点的 URL 特征 */
function taskUrlKey(raw: string): string {
  try {
    const url = new URL(raw);
    const search = TASK_URL_KEYS.filter((key) => url.searchParams.has(key))
      .map((key) => `${key}=${url.searchParams.get(key)}`)
      .join("&");
    return `${url.origin}${url.pathname}${search ? `?${search}` : ""}`;
  } catch {
    return raw;
  }
}

/** 任务点 iframe 与子 frame URL 的最终兜底：jobid / objectid */
function taskKeyParam(url: URL): string {
  try {
    return (
      url.searchParams.get("jobid") ??
      url.searchParams.get("jobId") ??
      url.searchParams.get("objectid") ??
      url.searchParams.get("objectId") ??
      ""
    );
  } catch {
    return "";
  }
}

interface ChildFrame {
  frameId: string;
  source: Window;
  token: string;
  url: string;
  title: string;
  pageKind: PageInfo["kind"];
  questions: Question[];
  lastSeen: number;
}

interface PendingFill {
  resolve: (results: FillResult[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingSubmit {
  resolve: (result: SubmitResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const UNKNOWN_PAGE: PageInfo = {
  kind: "unknown",
  url: typeof location === "undefined" ? "" : location.href,
  title: "",
  supported: false,
};

export class HostController implements UiController {
  state: UiState;
  private listeners = new Set<(state: UiState) => void>();
  private adapter: PlatformAdapter | null = null;
  private context: PageContext | null = null;
  private localQuestions: Question[] = [];
  private children = new Map<string, ChildFrame>();
  private childMedia = new Map<string, { state: MediaState; at: number }>();
  private pendingFills = new Map<string, PendingFill>();
  private pendingSubmits = new Map<string, PendingSubmit>();
  private autoTurn: AutoTurnRunner;
  private initialized = false;
  private lastHref = "";
  private urlTimer: ReturnType<typeof setInterval> | null = null;
  private frameSweepTimer: ReturnType<typeof setInterval> | null = null;
  private toastSeq = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshSeq = 0;
  private disposers: Array<() => void> = [];

  constructor() {
    this.state = {
      ready: false,
      page: { ...UNKNOWN_PAGE, title: document.title },
      verification: { detected: false, message: "" },
      frames: [],
      questions: [],
      results: {},
      status: "idle",
      statusText: "初始化…",
      progress: null,
      autoTurn: {
        running: false,
        steps: 0,
        maxSteps: getSettings().autoTurn.maxSteps,
        message: "",
        nextAt: null,
      },
      bank: { total: 0, lastUpdated: null },
      settings: getSettings(),
      logs: getLogs(),
      lastSubmit: null,
      toast: null,
      noticeAccepted: gmGet<boolean>(NOTICE_KEY, false),
    };

    this.autoTurn = new AutoTurnRunner({
      getAdapter: () => this.adapter,
      getContext: () => this.context,
      getPage: () => this.state.page,
      hasUnansweredQuestions: () => this.hasUnansweredQuestions(),
      getChildMediaState: () => this.getChildMediaState(),
      getMediaPlaybackTarget: () => this.getMediaPlaybackTarget(),
      activateMediaFrame: (frameId) => this.activateMediaFrame(frameId),
      resumeChildMedia: () => this.resumeChildMedia(),
      pauseMedia: () => this.pauseMedia(),
      getTaskSignature: () => this.getTaskSignature(),
      hasVerificationChallenge: () => this.state.verification.detected,
      onState: (autoTurn) => this.patch({ autoTurn }),
      onStopped: (reason) => {
        this.toast("info", reason);
        this.patch({ statusText: "自动翻页已停止" });
      },
    });
  }

  get isAutoRunning(): boolean {
    return this.autoTurn.isRunning;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.lastHref = location.href;
    logger.info("boot", `学习助手启动：${location.host}${location.pathname}`);

    window.addEventListener("message", this.handleMessage);
    this.disposers.push(
      subscribeSettings((settings) => {
        this.patch({ settings });
        if (!settings.autoTurn.enabled && this.autoTurn.isRunning) {
          this.autoTurn.stop("自动翻页已关闭");
        }
      }),
      subscribeLogs((logs) => this.patch({ logs })),
    );
    this.detectPage();
    this.checkVerification();
    this.patch({ page: this.state.page, settings: getSettings() });

    await this.initBankSafe();
    await this.refresh();
    if (!this.state.verification.detected && this.isAutoTurnPage()) this.autoTurn.restore();

    this.urlTimer = setInterval(() => {
      this.checkVerification();
      if (location.href !== this.lastHref) {
        this.lastHref = location.href;
        void this.onNavigation();
      }
    }, 1200);
    this.frameSweepTimer = setInterval(() => this.sweepFrames(), 10000);

    this.patch({
      ready: true,
      statusText: this.state.verification.detected ? "需要手动验证" : "待命",
    });
    if (!this.state.verification.detected) {
      this.toast("info", "学习助手已就绪，默认人工复核");
    }
  }

  subscribe(listener: (state: UiState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh(): Promise<void> {
    if (this.checkVerification()) return;
    const seq = ++this.refreshSeq;
    this.patch({ status: "scanning", statusText: "扫描题目…" });
    this.detectPage();
    this.collectLocal();
    // 通知子 frame 重新采集
    for (const child of this.children.values()) {
      sendToWindow(child.source, createMessage({ t: "COLLECT", token: child.token }));
    }
    await sleep(450);
    if (seq !== this.refreshSeq) return;
    this.rebuildQuestions();
    this.patch({
      status: "idle",
      statusText: this.state.questions.length
        ? `已采集 ${this.state.questions.length} 题`
        : "未发现题目",
    });
    logger.debug("scan", `刷新完成，本地 ${this.localQuestions.length} 题，${this.children.size} 个子 frame`);
  }

  async solve(): Promise<void> {
    if (this.isExamBlocked()) {
      this.toast("warn", "考试页面已保护：请在设置中显式开启后再作答");
      return;
    }
    if (this.state.questions.length === 0) {
      await this.refresh();
    }
    const settings = getSettings();
    const questions = this.state.questions.filter((question) => {
      const included = settings.solving.includeTypes[question.type as keyof typeof settings.solving.includeTypes];
      return included !== false;
    });
    if (questions.length === 0) {
      this.toast("warn", "没有可作答的题目");
      return;
    }

    this.patch({
      status: "solving",
      statusText: "解题中…",
      progress: { done: 0, total: questions.length },
    });

    try {
      const results = await solveQuestions(questions, {
        settings,
        onProgress: (done, total) => {
          this.patch({ progress: { done, total } });
        },
      });
      const merged: Record<string, SolveResult> = { ...this.state.results };
      for (const result of results) merged[result.questionId] = result;
      this.patch({ results: merged });
      const solved = results.filter((result) => result.status === "solved").length;
      const pending = results.filter((result) => result.status === "pending").length;
      this.patch({
        status: "idle",
        progress: null,
        statusText: `已解 ${solved} 题${pending ? `，${pending} 题待确认` : ""}`,
      });
      this.toast(
        pending ? "warn" : "success",
        pending ? `解题完成：${solved} 题已答，${pending} 题待确认` : `解题完成：${solved} 题已答`,
      );

      if (settings.solving.mode === "auto") {
        await this.runAutoFlow(settings);
      } else if (settings.solving.autoFillOnScan && settings.solving.mode !== "hint") {
        await this.fillAll();
      }
    } catch (error) {
      logger.error("solve", "解题失败", error);
      this.patch({ status: "error", statusText: "解题失败", progress: null });
      this.toast("error", `解题失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async fillAll(questionIds?: string[]): Promise<boolean> {
    if (this.isExamBlocked()) {
      this.toast("warn", "考试页面已保护：已阻止自动填入");
      return false;
    }
    if (getSettings().solving.mode === "hint" && !questionIds) {
      this.toast("info", "当前为「仅提示」模式，未操作页面");
      return false;
    }
    const targets = this.state.questions.filter((question) => {
      if (questionIds && !questionIds.includes(question.id)) return false;
      return Boolean(this.state.results[question.id]?.answer);
    });
    if (targets.length === 0) {
      this.toast("warn", "没有可填入的答案，请先解题");
      return false;
    }

    this.patch({ status: "filling", statusText: "填入答案…" });
    const settings = getSettings();
    const grouped = new Map<string, Question[]>();
    for (const question of targets) {
      const list = grouped.get(question.frameId) ?? [];
      list.push(question);
      grouped.set(question.frameId, list);
    }

    const results: FillResult[] = [];
    for (const [frameId, questions] of grouped) {
      if (frameId === "top") {
        if (!this.adapter || !this.context) continue;
        for (const question of questions) {
          const answer = this.state.results[question.id]?.answer;
          if (!answer) continue;
          try {
            results.push(
              await this.adapter.fillAnswer(this.context, question, answer, {
                delayMs: settings.solving.fillDelayMs,
              }),
            );
          } catch (error) {
            results.push({
              questionId: question.id,
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } else {
        const child = this.children.get(frameId);
        if (!child) continue;
        const answers = questions
          .map((question) => ({
            questionId: question.id,
            answer: this.state.results[question.id]?.answer,
          }))
          .filter((item): item is { questionId: string; answer: NonNullable<typeof item.answer> } =>
            Boolean(item.answer),
          );
        if (answers.length === 0) continue;
        sendToWindow(
          child.source,
          createMessage({ t: "FILL", token: child.token, answers, delayMs: settings.solving.fillDelayMs }),
        );
        const filled = await this.waitForFill(frameId, 30000);
        results.push(...filled);
      }
    }

    const ok = results.filter((result) => result.ok).length;
    const failed = results.length - ok;
    this.patch({
      status: "idle",
      statusText: failed ? `填入完成：${ok} 成功，${failed} 失败` : `已填入 ${ok} 题`,
    });
    this.toast(failed ? "warn" : "success", failed ? `填入完成：${ok} 成功，${failed} 失败` : `已填入 ${ok} 题`);
    logger.info("fill", `填入完成：成功 ${ok}，失败 ${failed}`);
    return failed === 0 && ok > 0;
  }

  async submit(): Promise<void> {
    if (this.isExamBlocked()) {
      this.toast("warn", "考试页面已保护：已阻止提交");
      return;
    }
    const settings = getSettings();
    const pageKind = this.state.page.kind;
    const unanswered = this.state.questions.filter(
      (question) => !this.state.results[question.id]?.answer,
    );
    if (unanswered.length > 0) {
      this.toast("warn", `还有 ${unanswered.length} 题没有答案，仍尝试提交`);
    }
    const target = this.pickSubmitFrame();
    if (!target) {
      this.toast("warn", "当前页面不是作业/测验/考试，无法提交");
      return;
    }
    this.patch({ status: "submitting", statusText: "提交中…" });
    let result: SubmitResult;
    try {
      if (target === "top") {
        if (!this.adapter?.submit || !this.context) {
          this.patch({ status: "idle", statusText: "提交按钮不可用" });
          this.toast("warn", "当前页面没有找到提交按钮");
          return;
        }
        result = await this.adapter.submit(this.context, { autoConfirm: true });
      } else {
        const child = this.children.get(target);
        if (!child) {
          this.patch({ status: "idle", statusText: "提交失败" });
          this.toast("error", "子页面连接已断开");
          return;
        }
        sendToWindow(child.source, createMessage({ t: "SUBMIT", token: child.token, autoConfirm: true }));
        result = await this.waitForSubmit(target, 45000);
      }
    } catch (error) {
      result = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    this.patch({ status: "idle", lastSubmit: result, statusText: result.ok ? "提交成功" : "提交状态未知" });
    this.toast(result.ok ? "success" : "warn", result.message);
    if (result.ok) this.autoTurn.stop("提交完成，自动翻页已停止");
    if (settings.solving.mode === "auto" && !result.ok) {
      logger.warn("submit", "自动提交失败", result);
    }
    if (pageKind === "exam") {
      logger.info("submit", "考试提交返回", { ok: result.ok });
    }
  }

  startAutoTurn(): void {
    if (this.state.verification.detected) {
      this.toast("warn", "请先在页面上完成人机验证，再开始自动翻页");
      return;
    }
    if (this.isExamBlocked()) {
      this.toast("warn", "考试页面已保护：禁止自动翻页");
      return;
    }
    if (!this.isAutoTurnPage() || !this.adapter?.nextPage) {
      this.toast("warn", "当前页面不支持自动翻页");
      return;
    }
    if (!getSettings().autoTurn.enabled) {
      updateSettings({ autoTurn: { enabled: true } });
      this.patch({ settings: getSettings() });
    }
    this.autoTurn.start();
    if (this.autoTurn.isRunning) this.toast("info", "自动翻页已开始");
  }

  stopAutoTurn(): void {
    this.autoTurn.stop();
  }

  dispose(): void {
    if (this.urlTimer) clearInterval(this.urlTimer);
    if (this.frameSweepTimer) clearInterval(this.frameSweepTimer);
    this.urlTimer = null;
    this.frameSweepTimer = null;
    window.removeEventListener("message", this.handleMessage);
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    this.autoTurn.stop("页面已卸载");
    if (this.toastTimer) clearTimeout(this.toastTimer);
    for (const pending of this.pendingFills.values()) clearTimeout(pending.timer);
    for (const pending of this.pendingSubmits.values()) clearTimeout(pending.timer);
    this.pendingFills.clear();
    this.pendingSubmits.clear();
  }

  async importBankFile(file: File): Promise<ImportResultView> {
    try {
      const text = await file.text();
      const format = detectBankFormat(file.name);
      const result = await importBankText(text, format, file.name);
      await this.syncBankStats();
      const view: ImportResultView = {
        added: result.added,
        skipped: result.skipped + result.duplicates,
        failed: result.skipped,
        message: `导入完成：新增 ${result.added} 条，更新 ${result.updated} 条，跳过 ${
          result.skipped + result.duplicates
        } 条${result.skipped ? `（失败 ${result.skipped}）` : ""}`,
      };
      this.toast(result.failed ? "warn" : "success", view.message);
      return view;
    } catch (error) {
      logger.error("bank", "导入题库失败", error);
      const message = `导入失败：${error instanceof Error ? error.message : String(error)}`;
      this.toast("error", message);
      return { added: 0, skipped: 0, failed: 0, message };
    }
  }

  async clearBank(): Promise<void> {
    try {
      await clearBank();
      await this.syncBankStats();
      this.toast("success", "本地题库已清空");
    } catch (error) {
      logger.error("bank", "清空题库失败", error);
      this.toast("error", "清空题库失败");
    }
  }

  async searchBank(query: string): Promise<BankEntry[]> {
    try {
      const hits = await searchBankByText(query, 30);
      return hits.map((hit) => hit.entry);
    } catch (error) {
      logger.error("bank", "检索题库失败", error);
      return [];
    }
  }

  async exportBank(): Promise<string> {
    try {
      return await exportBank("json");
    } catch (error) {
      logger.error("bank", "导出题库失败", error);
      return "[]";
    }
  }

  async testAi(): Promise<AiTestView> {
    const settings = getSettings();
    if (!settings.ai.apiKey) {
      return { ok: false, message: "请先填写 API Key" };
    }
    try {
      const result = await testAiConnection(settings.ai);
      this.toast(result.ok ? "success" : "error", result.message);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.toast("error", `连接失败：${message}`);
      return { ok: false, message: `连接失败：${message}` };
    }
  }

  saveSettings(patch: DeepPartial<Settings>): void {
    const next = updateSettings(patch);
    this.patch({ settings: next });
  }

  resetSettings(): void {
    const next = replaceSettings({ ...DEFAULT_SETTINGS });
    this.patch({ settings: next });
    this.toast("success", "已恢复默认设置");
  }

  clearLogs(): void {
    clearLogBuffer();
    this.patch({ logs: getLogs() });
  }

  exportLogs(): string {
    return exportLogText();
  }

  acceptNotice(): void {
    gmSet(NOTICE_KEY, true);
    this.patch({ noticeAccepted: true });
  }

  setCollapsed(collapsed: boolean): void {
    const settings = updateSettings({ ui: { collapsed } });
    this.patch({ settings });
  }

  togglePanel(): void {
    this.setCollapsed(!getSettings().ui.collapsed);
  }

  private async runAutoFlow(settings: Settings): Promise<void> {
    const pending = this.state.questions.filter(
      (question) => this.state.results[question.id]?.status === "pending",
    );
    if (pending.length > 0) {
      this.toast("warn", `有 ${pending.length} 题待确认，全自动流程已暂停`);
      return;
    }
    const filled = await this.fillAll();
    if (!filled) {
      this.toast("warn", "自动填入未全部成功，已暂停提交");
      return;
    }
    if (!settings.solving.autoSubmit) return;
    await sleep(1200);
    await this.submit();
  }

  private async initBankSafe(): Promise<void> {
    try {
      await initBank();
      await this.syncBankStats();
    } catch (error) {
      logger.warn("bank", "题库初始化失败，将继续使用 AI/远程", error);
    }
  }

  private async syncBankStats(): Promise<void> {
    try {
      const stats = await getBankStats();
      this.patch({
        bank: { total: stats.total, lastUpdated: stats.newestUpdatedAt },
      });
    } catch (error) {
      logger.warn("bank", "读取题库统计失败", error);
    }
  }

  /**
   * 检测学习通【9010】/图片验证码页面。
   * 不尝试识别或绕过验证码：只暂停自动翻页、阻止继续点击，并持续提示用户手动处理。
   */
  private checkVerification(): boolean {
    const view = detectVerificationChallenge(document);
    const previous = this.state.verification.detected;

    if (view.detected) {
      if (!previous) {
        logger.warn("verify", "检测到平台人机验证，自动翻页已暂停", {
          message: view.message,
          reason: view.reason,
          pageKind: this.state.page.kind,
          url: location.pathname,
        });
      }
      if (this.autoTurn.isRunning) {
        this.autoTurn.stop("检测到平台验证，自动翻页已暂停；请手动完成验证后重新开始");
      }
      if (!previous) {
        this.toast("warn", "检测到平台人机验证，请先在页面上完成验证");
      }
      if (
        !previous ||
        this.state.status !== "error" ||
        this.state.statusText !== "需要手动验证"
      ) {
        this.patch({ verification: view, status: "error", statusText: "需要手动验证" });
      }
      return true;
    }

    if (previous) {
      logger.info("verify", "页面验证已通过");
      this.patch({ verification: view, status: "idle", statusText: "验证已通过，可重新开始" });
      this.toast("success", "验证已通过，可以重新开始自动翻页");
    }
    return false;
  }

  private detectPage(): void {
    const url = new URL(location.href);
    const adapter = getAdapter(url);
    this.adapter = adapter;
    if (!adapter) {
      this.context = null;
      this.patch({
        page: { kind: "unknown", url: location.href, title: document.title, supported: false },
      });
      return;
    }
    let page: PageInfo;
    try {
      page = adapter.detectPage(document, url);
    } catch (error) {
      logger.warn("platform", "页面识别失败", error);
      page = { kind: "unknown", url: location.href, title: document.title, supported: false };
    }
    this.context = {
      doc: document,
      win: window,
      url,
      page,
      frameId: "top",
    };
    this.patch({ page });
  }

  private collectLocal(): void {
    if (!this.adapter || !this.context) {
      this.localQuestions = [];
      return;
    }
    try {
      this.localQuestions = this.adapter.collectQuestions(this.context);
    } catch (error) {
      logger.warn("scan", "本地题目采集失败", error);
      this.localQuestions = [];
    }
  }

  private rebuildQuestions(): void {
    const merged = new Map<string, Question>();
    for (const question of this.localQuestions) merged.set(question.id, question);
    for (const child of this.children.values()) {
      for (const question of child.questions) merged.set(question.id, question);
    }
    const questions = [...merged.values()].sort((a, b) => {
      if (a.frameId === b.frameId) return a.index - b.index;
      return a.frameId.localeCompare(b.frameId);
    });
    this.patch({ questions, frames: this.buildFrames() });
  }

  private buildFrames(): FrameSummary[] {
    const frames: FrameSummary[] = [
      {
        frameId: "top",
        url: location.href,
        title: document.title,
        pageKind: this.state.page.kind,
        questionCount: this.localQuestions.length,
        isTop: true,
      },
    ];
    for (const child of this.children.values()) {
      frames.push({
        frameId: child.frameId,
        url: child.url,
        title: child.title,
        pageKind: child.pageKind,
        questionCount: child.questions.length,
        isTop: false,
      });
    }
    return frames;
  }

  private handleMessage = (event: MessageEvent): void => {
    const message = event.data;
    if (!isFrameMessage(message)) return;
    if (!isTrustedOrigin(event.origin)) return;
    const source = event.source as Window | null;
    if (!source) return;

    switch (message.t) {
      case "HELLO": {
        const existing = this.children.get(message.frameId);
        // 同一 frame 重新加载时复用 token；不同来源冒用 frameId 时重新发 token
        const sameSource = Boolean(existing && existing.source === source);
        const token = sameSource ? existing!.token : createToken();
        if (!sameSource) {
          // 页面/任务点切换后，旧 frame 的媒体状态已经不可信，先清空等待新上报
          this.childMedia.clear();
        }
        this.children.set(message.frameId, {
          frameId: message.frameId,
          source,
          token,
          url: message.url,
          title: message.title,
          pageKind: message.pageKind,
          questions: sameSource ? existing!.questions : [],
          lastSeen: Date.now(),
        });
        sendToWindow(source, createMessage({ t: "WELCOME", token }));
        sendToWindow(source, createMessage({ t: "COLLECT", token }));
        logger.debug("frame", `连接子 frame ${message.frameId}（${message.pageKind}）`);
        this.rebuildQuestions();
        break;
      }
      case "QUESTIONS": {
        const child = this.children.get(message.frameId);
        if (!child || child.token !== message.token) return;
        child.questions = message.questions;
        child.pageKind = message.pageKind;
        child.lastSeen = Date.now();
        this.rebuildQuestions();
        break;
      }
      case "STATE": {
        const child = this.children.get(message.frameId);
        if (!child || child.token !== message.token) return;
        child.pageKind = message.pageKind;
        child.url = message.url;
        child.lastSeen = Date.now();
        this.patch({ frames: this.buildFrames() });
        break;
      }
      case "PING": {
        const child = [...this.children.values()].find((item) => item.token === message.token);
        if (child) child.lastSeen = Date.now();
        break;
      }
      case "FILLED": {
        const child = this.children.get(message.frameId);
        if (!child || child.token !== message.token) return;
        const pending = this.pendingFills.get(message.frameId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingFills.delete(message.frameId);
          pending.resolve(message.results);
        }
        break;
      }
      case "MEDIA_STATE": {
        const child = this.children.get(message.frameId);
        if (!child || child.token !== message.token) return;
        const state = message.state;
        if (
          !state ||
          typeof state.hasMedia !== "boolean" ||
          typeof state.allEnded !== "boolean" ||
          typeof state.anyPaused !== "boolean"
        ) {
          return;
        }
        this.childMedia.set(message.frameId, { state, at: Date.now() });
        break;
      }
      case "SUBMIT_RESULT": {
        const child = this.children.get(message.frameId);
        if (!child || child.token !== message.token) return;
        const pending = this.pendingSubmits.get(message.frameId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingSubmits.delete(message.frameId);
          pending.resolve(message.result);
        }
        break;
      }
      default:
        break;
    }
  };

  private waitForFill(frameId: string, timeoutMs: number): Promise<FillResult[]> {
    return new Promise((resolve) => {
      const existing = this.pendingFills.get(frameId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.resolve([]);
      }
      const timer = setTimeout(() => {
        this.pendingFills.delete(frameId);
        resolve([]);
      }, timeoutMs);
      this.pendingFills.set(frameId, { resolve, timer });
    });
  }

  private waitForSubmit(frameId: string, timeoutMs: number): Promise<SubmitResult> {
    return new Promise((resolve) => {
      const existing = this.pendingSubmits.get(frameId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.resolve({ ok: false, message: "新的提交请求已替换上一次请求" });
      }
      const timer = setTimeout(() => {
        this.pendingSubmits.delete(frameId);
        resolve({ ok: false, message: "提交状态未知，请人工确认" });
      }, timeoutMs);
      this.pendingSubmits.set(frameId, { resolve, timer });
    });
  }

  private pickSubmitFrame(): string | null {
    if (this.state.page.kind === "homework" || this.state.page.kind === "exam" || this.state.page.kind === "quiz") {
      if (this.localQuestions.length > 0 || this.adapter?.submit) return "top";
    }
    for (const child of this.children.values()) {
      if (
        (child.pageKind === "homework" || child.pageKind === "exam" || child.pageKind === "quiz") &&
        child.questions.length > 0
      ) {
        return child.frameId;
      }
    }
    if (this.adapter?.submit && this.state.questions.length > 0) return "top";
    return null;
  }

  private isExamBlocked(): boolean {
    if (getSettings().solving.allowExam) return false;
    if (this.state.page.kind === "exam") return true;
    for (const child of this.children.values()) {
      if (child.pageKind === "exam") return true;
    }
    return false;
  }

  private hasUnansweredQuestions(): boolean {
    if (this.state.questions.length === 0) return false;
    return this.state.questions.some((question) => {
      const result = this.state.results[question.id];
      return !result || result.status !== "solved";
    });
  }

  private currentChapterId(): string {
    try {
      return new URL(location.href).searchParams.get("chapterId") ?? "";
    } catch {
      return "";
    }
  }

  /**
   * 学习通同页多任务点时，按任务点 DOM 顺序选出当前应播放的子 frame。
   *
   * 内容 frame 的 agent 会上报第一个“未完成且带 iframe”的任务点 URL；
   * 这里把该 URL 与已连接子 frame 的 URL 匹配，自动翻页只激活这一个 frame，
   * 其他 frame 暂停，避免多个视频同时播放/互相抢进度。
   */
  getMediaPlaybackTarget(): MediaPlaybackTarget | null {
    const entries = [...this.childMedia.entries()].filter(
      ([, item]) => Date.now() - item.at < 3500,
    );
    const taskEntry = entries
      .filter(
        ([, item]) =>
          item.state.taskTotal !== undefined ||
          item.state.nextTaskUrl !== undefined ||
          item.state.allTasksFinished !== undefined,
      )
      .sort((a, b) => b[1].at - a[1].at)[0];
    if (!taskEntry) return null;

    const state = taskEntry[1].state;
    if (state.allTasksFinished) {
      return {
        frameId: null,
        taskUrl: "",
        taskIndex: -1,
        taskTotal: state.taskTotal ?? 0,
        state: null,
        allTasksFinished: true,
      };
    }
    const taskUrl = state.nextTaskUrl;
    if (!taskUrl) return null;

    const child = this.findChildForTask(taskUrl);
    return {
      frameId: child?.frameId ?? null,
      taskUrl,
      taskIndex: state.nextTaskIndex ?? 0,
      taskTotal: state.taskTotal ?? 0,
      state: child ? (this.childMedia.get(child.frameId)?.state ?? null) : null,
      allTasksFinished: false,
    };
  }

  /** 只恢复指定子 frame 的媒体，并暂停其他子 frame，保证一次只播一个任务点 */
  activateMediaFrame(frameId: string): void {
    for (const child of this.children.values()) {
      sendToWindow(
        child.source,
        createMessage({
          t: child.frameId === frameId ? "RESUME_MEDIA" : "PAUSE_MEDIA",
          token: child.token,
        }),
      );
    }
  }

  private findChildForTask(taskUrl: string): ChildFrame | null {
    // 优先最近活跃的 frame，避免任务点切换后匹配到尚未被 sweep 清理的旧 frame
    const children = [...this.children.values()]
      .filter((child) => {
        try {
          return !child.source.closed;
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.lastSeen - a.lastSeen);
    const targetKey = taskUrlKey(taskUrl);
    for (const child of children) {
      if (taskUrlKey(child.url) === targetKey) return child;
    }
    // 部分播放器 URL 会追加随机参数，退化为按 jobid / objectid 匹配
    try {
      const target = new URL(taskUrl);
      const targetJob = taskKeyParam(target);
      if (targetJob) {
        for (const child of children) {
          try {
            if (taskKeyParam(new URL(child.url)) === targetJob) return child;
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /** 汇总子 frame 的媒体状态，供自动翻页判断视频/音频是否结束 */
  getChildMediaState(): MediaState | null {
    // 只信任最近上报；frame 卸载/切换后旧状态最多保留 3.5 秒，避免把上一页的“已完成”带过来
    const entries = [...this.childMedia.entries()].filter(
      ([, item]) => Date.now() - item.at < 3500,
    );
    if (entries.length === 0) return null;
    const media = entries.map(([, item]) => item).filter((item) => item.state.hasMedia);

    // 任务点完成状态只取“当前章节”的内容 frame；只有整章任务点都完成才跳过，
    // 避免章节里还有未完成视频时被单个知识卡片的完成状态带过去
    const chapterId = this.currentChapterId();
    let allTasksFinished = false;
    for (const [frameId, item] of entries) {
      if (!chapterId) {
        if (item.state.allTasksFinished) allTasksFinished = true;
        continue;
      }
      const child = this.children.get(frameId);
      if (!child) continue;
      let matchesChapter = false;
      try {
        const url = new URL(child.url);
        const knowledgeId =
          url.searchParams.get("knowledgeid") ?? url.searchParams.get("knowledgeId") ?? "";
        matchesChapter =
          knowledgeId === chapterId || url.searchParams.get("chapterId") === chapterId;
      } catch {
        /* ignore */
      }
      if (!matchesChapter) continue;
      if (item.state.allTasksFinished) allTasksFinished = true;
    }
    const finished = allTasksFinished;

    if (media.length === 0 && !finished) return null;
    return {
      hasMedia: media.length > 0,
      allEnded: media.length > 0 && media.every((item) => item.state.allEnded),
      anyPaused: media.some((item) => item.state.anyPaused),
      currentTaskFinished: finished,
      allTasksFinished,
    };
  }

  /**
   * 任务点签名：顶层 URL + 子 frame URL/类型 + 当前章节高亮文本。
   * 学习通切换任务点时顶层 URL 往往不变，需要靠子 frame URL 判断是否真的翻页。
   */
  getTaskSignature(): string {
    const frameKeys = this.state.frames.map(
      (frame) => `${frame.pageKind}:${taskUrlKey(frame.url)}:${frame.title ?? ""}`,
    );
    const frames = [...new Set(frameKeys)].sort().join("|");
    let current = "";
    try {
      current = (document.querySelector(".currents")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      /* ignore */
    }
    return `${taskUrlKey(location.href)}|${this.state.page.kind}|${current}|${frames}`;
  }

  /** 停止自动翻页时暂停所有视频/音频 */
  pauseMedia(): void {
    for (const media of collectMedia(document)) {
      try {
        if (!media.paused) media.pause();
      } catch {
        /* ignore */
      }
    }
    for (const child of this.children.values()) {
      sendToWindow(child.source, createMessage({ t: "PAUSE_MEDIA", token: child.token }));
    }
  }

  /** 请求子 frame 恢复暂停的媒体播放 */
  resumeChildMedia(): void {
    for (const child of this.children.values()) {
      const media = this.childMedia.get(child.frameId);
      if (!media?.state.hasMedia) continue;
      sendToWindow(child.source, createMessage({ t: "RESUME_MEDIA", token: child.token }));
    }
  }

  private async onNavigation(): Promise<void> {
    logger.info("nav", `页面跳转：${location.pathname}`);
    this.detectPage();
    this.localQuestions = [];
    this.rebuildQuestions();
    await this.refresh();
    if (!this.isAutoTurnPage()) {
      this.autoTurn.stop("进入答题页面，自动翻页已停止");
    }
    if (this.state.page.kind === "exam" && !getSettings().solving.allowExam) {
      this.autoTurn.stop("进入考试页面，自动翻页已停止");
    }
  }

  private sweepFrames(): void {
    let changed = false;
    for (const [frameId, child] of this.children) {
      let closed = false;
      try {
        closed = child.source.closed;
      } catch {
        closed = false;
      }
      if (closed || Date.now() - child.lastSeen > 60_000) {
        this.children.delete(frameId);
        this.childMedia.delete(frameId);
        changed = true;
      }
    }
    if (changed) this.rebuildQuestions();
  }

  private isAutoTurnPage(): boolean {
    return this.state.page.kind === "chapter" || this.state.page.kind === "cards" || this.state.page.kind === "video";
  }

  private toast(kind: ToastView["kind"], text: string): void {
    const id = ++this.toastSeq;
    this.patch({ toast: { id, kind, text } });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      if (this.state.toast?.id === id) this.patch({ toast: null });
    }, 3800);
  }

  private patch(patch: Partial<UiState>): void {
    this.state = {
      ...this.state,
      ...patch,
      settings: patch.settings ?? getSettings(),
      logs: patch.logs ?? getLogs(),
    };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        logger.warn("ui", "状态订阅者出错", error);
      }
    }
  }
}
