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
  isTrustedOrigin,
  sendToWindow,
  validateFrameMessage,
} from "@/core/messages";
import { getAdapter } from "@/platform/registry";
import type { PageContext, PlatformAdapter } from "@/platform/types";
import { detectVerificationChallenge } from "@/platform/chaoxing/verification";
import { resetSubmitGuard } from "@/platform/chaoxing/submit";
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
import {
  chapterIdFromUrl,
  selectMediaPlaybackTarget,
  summarizeChildMediaState,
  taskUrlKey,
  type MediaPlaybackTarget,
} from "./media-target";
import { collectDocumentMedia, collectMedia, pickPrimaryMedia } from "./media-preferences";
import { startPlaybackGuard as createPlaybackGuard, type PlaybackGuard } from "./playback-guard";
import {
  acquireLock,
  heartbeatLock,
  lockKeyFromUrl,
  readLock,
  releaseLock,
  TAB_LOCK_HEARTBEAT_MS,
} from "./tab-lock";
import { buildDiagnostics, formatDiagnostics } from "./diagnostics";

const NOTICE_KEY = "study-helper.notice.v1";

/**
 * 子 frame 心跳是 15s；后台标签页会被浏览器节流，sweep 阈值必须留足余量。
 * 15s 阈值会和心跳同周期竞态，误删健康 frame 后 PING 无法重新建连。
 */
const FRAME_STALE_MS = 120_000;

interface ChildFrame {
  frameId: string;
  source: Window;
  token: string;
  nonce: string;
  url: string;
  title: string;
  pageKind: PageInfo["kind"];
  questions: Question[];
  lastSeen: number;
}

interface PendingFill {
  resolve: (results: FillResult[], timedOut?: boolean) => void;
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
  private activeMediaFrameId = "";
  private filledQuestionIds = new Set<string>();
  private submitConfirmAt = 0;
  private hostGuard: PlaybackGuard | null = null;
  private lastGuardNoticeAt = 0;
  private tabId = createToken();
  private tabLockKey = "";
  private tabLockTimer: ReturnType<typeof setInterval> | null = null;
  private tabLockHeld = false;
  private lastTabLockHeartbeat = 0;
  private disposed = false;
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
      filledQuestionIds: [],
      autoTurn: {
        running: false,
        steps: 0,
        maxSteps: getSettings().autoTurn.maxSteps,
        message: "",
        nextAt: null,
      },
      bank: {
        total: 0,
        lastUpdated: null,
        storage: "indexeddb",
        indexedDbAvailable: true,
      },
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
        this.stopPlaybackGuard();
        this.releaseAutoTurnLock();
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
    if (
      !this.state.verification.detected &&
      this.isAutoTurnPage() &&
      this.autoTurn.hasRestorableSession()
    ) {
      if (this.acquireAutoTurnLock()) {
        let restored = false;
        try {
          restored = this.autoTurn.restore();
        } catch (error) {
          logger.warn("autoturn", "恢复自动翻页失败", error);
        }
        // restore 可能因为页面已变化/会话过期而选择不恢复；此时必须释放锁，
        // 否则其他标签页会被一个没有真正运行的锁永久挡住。
        if (!restored) this.releaseAutoTurnLock();
      } else {
        logger.warn("autoturn", "多标签互斥：已取消刷新后自动恢复");
      }
    }
    window.addEventListener("pagehide", this.handlePageHide);

    this.urlTimer = setInterval(() => {
      try {
        this.checkVerification();
        if (location.href !== this.lastHref) {
          this.lastHref = location.href;
          void this.onNavigation().catch((error: unknown) => {
            logger.warn("nav", "页面跳转处理失败", error);
          });
        }
      } catch (error) {
        logger.warn("boot", "定时检查失败", error);
      }
    }, 1200);
    this.frameSweepTimer = setInterval(() => {
      try {
        this.sweepFrames();
      } catch (error) {
        logger.warn("frame", "frame 清理失败", error);
      }
    }, 10000);

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
    this.filledQuestionIds.clear();
    this.submitConfirmAt = 0;
    // 同一 Document 内重新扫描时允许再次提交（SPA 换题/分页场景）
    resetSubmitGuard(document);
    this.patch({
      status: "scanning",
      statusText: "扫描题目…",
      filledQuestionIds: [],
    });
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
    let timedOut = false;
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
        if (!child) {
          for (const question of questions) {
            results.push({
              questionId: question.id,
              ok: false,
              message: "子页面连接已断开，请重新扫描",
            });
          }
          continue;
        }
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
        results.push(...filled.results);
        if (filled.timedOut) {
          timedOut = true;
          logger.warn("fill", "子页面填入响应超时", { frameId, expected: answers.length });
        }
      }
    }

    // 只有真正返回 ok 的题目才算“已填入”；超时/失败不能计入覆盖率。
    for (const result of results) {
      if (result.ok) this.filledQuestionIds.add(result.questionId);
    }
    this.patch({ filledQuestionIds: [...this.filledQuestionIds] });

    const ok = results.filter((result) => result.ok).length;
    const failed = results.length - ok;
    const summary = timedOut
      ? `填入超时：${ok} 成功，${failed} 失败`
      : failed
        ? `填入完成：${ok} 成功，${failed} 失败`
        : `已填入 ${ok} 题`;
    this.patch({ status: "idle", statusText: summary });
    this.toast(failed || timedOut ? (timedOut ? "error" : "warn") : "success", summary);
    logger.info("fill", `填入完成：成功 ${ok}，失败 ${failed}${timedOut ? "，含超时" : ""}`);
    return failed === 0 && ok > 0 && !timedOut;
  }

  async submit(): Promise<void> {
    if (this.isExamBlocked()) {
      this.toast("warn", "考试页面已保护：已阻止提交");
      return;
    }
    const settings = getSettings();
    if (settings.solving.mode === "hint") {
      this.toast("warn", "当前为「仅提示」模式，不会提交；请切换到复核后提交/全自动");
      return;
    }
    const pageKind = this.state.page.kind;
    const total = this.state.questions.length;
    const filled = this.state.questions.filter((question) =>
      this.filledQuestionIds.has(question.id),
    ).length;
    if (total === 0) {
      this.toast("warn", "还没有采集到题目，无法提交");
      return;
    }
    // filled 只统计脚本 fillAll 的结果；用户手动填写不会出现在这里，
    // 因此不能以 filled===0 硬拦截，只做二次确认，避免误提交空白/部分答案。
    let confirmed = false;
    if (filled < total) {
      const now = Date.now();
      if (now - this.submitConfirmAt > 15000) {
        this.submitConfirmAt = now;
        this.toast(
          "warn",
          filled === 0
            ? "未检测到脚本填入；若已手动填写，请再次点击「提交」确认"
            : `还有 ${total - filled} 题未填入，确认要提交请再次点击「提交」`,
        );
        logger.warn("submit", "提交前覆盖不足，等待二次确认", { filled, total });
        return;
      }
      confirmed = true;
    }
    this.submitConfirmAt = 0;
    // 复核模式不自动点掉平台原生确认框；只有用户二次确认或全自动且 100% 覆盖时才自动确认。
    const autoConfirm =
      confirmed || (settings.solving.mode === "auto" && filled === total);

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
        result = await this.adapter.submit(this.context, { autoConfirm });
      } else {
        const child = this.children.get(target);
        if (!child) {
          this.patch({ status: "idle", statusText: "提交失败" });
          this.toast("error", "子页面连接已断开");
          return;
        }
        sendToWindow(child.source, createMessage({ t: "SUBMIT", token: child.token, autoConfirm }));
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
    if (result.ok) {
      this.autoTurn.stop("提交完成，自动翻页已停止");
      this.filledQuestionIds.clear();
      this.patch({ filledQuestionIds: [] });
    }
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
    if (!this.acquireAutoTurnLock()) return;
    if (!getSettings().autoTurn.enabled) {
      updateSettings({ autoTurn: { enabled: true } });
      this.patch({ settings: getSettings() });
    }
    this.autoTurn.start();
    if (this.autoTurn.isRunning) this.toast("info", "自动翻页已开始");
  }

  stopAutoTurn(): void {
    this.autoTurn.stop();
    this.releaseAutoTurnLock();
  }

  private handlePageHide = (event: PageTransitionEvent): void => {
    // 进入 bfcache 时页面只是被冻结；dispose 会让用户按“后退”恢复后没有面板/代理。
    if (event.persisted) return;
    this.releaseAutoTurnLock();
    this.dispose();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseAutoTurnLock();
    if (this.urlTimer) clearInterval(this.urlTimer);
    if (this.frameSweepTimer) clearInterval(this.frameSweepTimer);
    this.urlTimer = null;
    this.frameSweepTimer = null;
    window.removeEventListener("message", this.handleMessage);
    window.removeEventListener("pagehide", this.handlePageHide);
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    this.autoTurn.stop("页面已卸载");
    this.stopPlaybackGuard();
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

  /**
   * 生成并复制脱敏诊断包（页面结构、选择器命中、媒体/翻页状态、脱敏设置与最近日志）。
   * 只有用户点击时才生成，不包含答案。
   */
  async copyDiagnostics(): Promise<boolean> {
    try {
      const report = buildDiagnostics(
        {
          page: this.state.page,
          frames: this.state.frames,
          questions: this.state.questions,
          settings: this.state.settings,
          logs: this.state.logs,
          media: this.getChildMediaState(),
          autoTurn: this.state.autoTurn,
          verification: {
            detected: this.state.verification.detected,
            message: this.state.verification.message,
          },
          tabLock: this.currentTabLockState(),
        },
        document,
        typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
      );
      const text = formatDiagnostics(report);
      const copied = await copyText(text);
      this.toast(
        copied ? "success" : "error",
        copied ? "诊断包已复制到剪贴板" : "复制失败，请从运行日志手动导出",
      );
      logger.info("diagnostics", copied ? "诊断包已复制" : "诊断包复制失败");
      return copied;
    } catch (error) {
      logger.error("diagnostics", "生成诊断包失败", error);
      this.toast("error", "生成诊断包失败");
      return false;
    }
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
        bank: {
          total: stats.total,
          lastUpdated: stats.newestUpdatedAt,
          storage: stats.storage,
          indexedDbAvailable: stats.indexedDbAvailable,
        },
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
    let adapter: PlatformAdapter | null = null;
    try {
      adapter = getAdapter(url);
    } catch (error) {
      logger.warn("platform", "适配器匹配失败", error);
      adapter = null;
    }
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
    const message = validateFrameMessage(event.data);
    if (!message) return;
    if (!isTrustedOrigin(event.origin)) return;
    const source = event.source as Window | null;
    if (!source) return;

    switch (message.t) {
      case "HELLO": {
        const existing = this.children.get(message.frameId);
        // 同一 frame 重新加载时复用 token；不同来源冒用 frameId 时重新发 token
        const sameSource = Boolean(existing && existing.source === source);
        const sameUrl = Boolean(existing && existing.url === message.url);
        const token = sameSource ? existing!.token : createToken();
        if (!sameSource) {
          // 页面/任务点切换后，旧 frame 的媒体状态已经不可信，只清该来源对应的状态
          for (const [frameId, child] of this.children) {
            if (child.source === source && frameId !== message.frameId) {
              this.children.delete(frameId);
              this.childMedia.delete(frameId);
            }
          }
        } else if (!sameUrl) {
          // SPA 内同一 iframe 换 URL：旧题目/媒体状态不能继续沿用
          this.childMedia.delete(message.frameId);
        }
        this.children.set(message.frameId, {
          frameId: message.frameId,
          source,
          token,
          nonce: message.nonce,
          url: message.url,
          title: message.title,
          pageKind: message.pageKind,
          questions: sameUrl ? existing!.questions : [],
          lastSeen: Date.now(),
        });
        sendToWindow(source, createMessage({ t: "WELCOME", token, nonce: message.nonce }));
        // 已有正在播放的目标时，新加载的预加载 frame 默认暂停，避免多个视频同时出声
        if (this.activeMediaFrameId && this.activeMediaFrameId !== message.frameId) {
          sendToWindow(source, createMessage({ t: "PAUSE_MEDIA", token }));
        }
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
      case "GUARD_NOTICE": {
        const child = this.children.get(message.frameId);
        if (!child || child.token !== message.token) return;
        child.lastSeen = Date.now();
        logger.warn("guard", message.message, {
          frameId: message.frameId,
          level: message.level,
        });
        if (message.level === "warn") this.toast("warn", message.message);
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

  private waitForFill(
    frameId: string,
    timeoutMs: number,
  ): Promise<{ results: FillResult[]; timedOut: boolean }> {
    return new Promise((resolve) => {
      const existing = this.pendingFills.get(frameId);
      if (existing) {
        clearTimeout(existing.timer);
        this.pendingFills.delete(frameId);
        existing.resolve([], true);
      }
      const timer = setTimeout(() => {
        if (!this.pendingFills.has(frameId)) return;
        this.pendingFills.delete(frameId);
        resolve({ results: [], timedOut: true });
      }, timeoutMs);
      this.pendingFills.set(frameId, {
        resolve: (results, timedOut = false) => resolve({ results, timedOut }),
        timer,
      });
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
    return chapterIdFromUrl(location.href);
  }

  private liveChildren(): ChildFrame[] {
    return [...this.children.values()].filter((child) => {
      try {
        return !child.source.closed;
      } catch {
        return false;
      }
    });
  }

  /**
   * 学习通同页多任务点时，按任务点 DOM 顺序选出当前应播放的子 frame。
   *
   * 具体的选择/章节过滤逻辑在 `media-target.ts` 的纯函数中，便于单测。
   */
  getMediaPlaybackTarget(): MediaPlaybackTarget | null {
    const target = selectMediaPlaybackTarget({
      children: this.liveChildren(),
      childMedia: this.childMedia,
      chapterId: this.currentChapterId(),
    });
    return this.pinActiveMediaTarget(target);
  }

  /**
   * 当前目标还在播放且任务点未完成时，不因为任务点快照抖动而切走。
   * 媒体切换本身会暂停/恢复播放器，目标来回跳就是“切换抖动”的主要来源。
   */
  private pinActiveMediaTarget(
    target: MediaPlaybackTarget | null,
  ): MediaPlaybackTarget | null {
    const activeId = this.activeMediaFrameId;
    if (!activeId) return target;
    const entry = this.childMedia.get(activeId);
    const child = this.children.get(activeId);
    if (!entry || !child || Date.now() - entry.at >= 3500) return target;
    const state = entry.state;
    if (!state.hasMedia || state.allEnded || state.currentTaskFinished) return target;
    if (target?.frameId === activeId) return target;
    // 当前视频还没播完/任务点没完成，先保持当前目标
    return {
      frameId: activeId,
      taskUrl: child.url,
      taskIndex: target?.taskIndex ?? 0,
      taskTotal: target?.taskTotal ?? 1,
      state,
      allTasksFinished: false,
      source: target?.source ?? "frames",
    };
  }

  /**
   * 只恢复指定子 frame 的媒体；目标切换时只暂停上一个目标，
   * 不再每轮向所有 frame 发 PAUSE，避免视频被反复暂停/恢复导致抖动。
   */
  activateMediaFrame(frameId: string): void {
    const target = this.children.get(frameId);
    if (!target) return;

    if (this.activeMediaFrameId !== frameId) {
      if (!this.activeMediaFrameId) {
        // 首次激活：暂停其他已连接 frame，避免平台自动播放多个视频
        for (const child of this.children.values()) {
          if (child.frameId === frameId) continue;
          sendToWindow(child.source, createMessage({ t: "PAUSE_MEDIA", token: child.token }));
        }
      } else {
        const previous = this.children.get(this.activeMediaFrameId);
        if (previous) {
          // 旧目标暂停；守卫未接入主流程，这里只需要停媒体
          sendToWindow(previous.source, createMessage({ t: "PAUSE_MEDIA", token: previous.token }));
        }
      }
      this.activeMediaFrameId = frameId;
    }

    // 守卫只跟随当前播放目标启动，避免所有子 frame 一起自动恢复暂停的视频。
    // 注意：0.2.0 的播放守卫目前不接入自动翻页主流程（见 review-hardening-fixes），
    // 避免与播放器自身的暂停策略互相拉扯导致抖动；保留消息与模块供后续实机验证。
    sendToWindow(target.source, createMessage({ t: "RESUME_MEDIA", token: target.token }));
  }

  /** 汇总子 frame 的媒体状态（只统计当前章节的 frame），供自动翻页判断媒体是否结束 */
  getChildMediaState(): MediaState | null {
    return summarizeChildMediaState({
      children: this.liveChildren(),
      childMedia: this.childMedia,
      chapterId: this.currentChapterId(),
    });
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

  /**
   * 抢多标签锁：同一门课程只允许一个标签页自动翻页。
   * 冲突时只拒绝启动，不停止对方；锁心跳过期后可自动接管。
   */
  private acquireAutoTurnLock(): boolean {
    const key = lockKeyFromUrl(location.href);
    const label = `${document.title || "学习通"} · ${location.pathname}`;
    const result = acquireLock(key, this.tabId, label, Date.now());
    if (!result.ok) {
      const holder = result.holder;
      const detail = holder.label ? `（${holder.label}）` : "";
      this.toast("warn", `另一个标签页正在自动翻页${detail}，请先停止它`);
      logger.warn("autoturn", "多标签互斥：另一个标签页正在运行", {
        holderTab: holder.tabId,
        holderLabel: holder.label,
        heartbeatAt: holder.heartbeatAt,
      });
      return false;
    }
    this.tabLockKey = key;
    this.tabLockHeld = true;
    this.lastTabLockHeartbeat = Date.now();
    if (this.tabLockTimer) clearInterval(this.tabLockTimer);
    this.tabLockTimer = setInterval(() => {
      if (!this.tabLockHeld || !this.tabLockKey) return;
      const now = Date.now();
      if (heartbeatLock(this.tabLockKey, this.tabId, now)) {
        this.lastTabLockHeartbeat = now;
        return;
      }
      this.tabLockHeld = false;
      this.stopTabLockTimer();
      this.autoTurn.stop("自动翻页已被另一个标签页接管");
    }, TAB_LOCK_HEARTBEAT_MS);
    return true;
  }

  private stopTabLockTimer(): void {
    if (this.tabLockTimer) clearInterval(this.tabLockTimer);
    this.tabLockTimer = null;
  }

  private releaseAutoTurnLock(): void {
    this.stopTabLockTimer();
    if (this.tabLockHeld && this.tabLockKey) {
      releaseLock(this.tabLockKey, this.tabId);
    }
    this.tabLockHeld = false;
    this.lastTabLockHeartbeat = 0;
  }

  private currentTabLockState(): { holder: boolean; heartbeatAt: number | null } {
    if (this.tabLockHeld) {
      return { holder: true, heartbeatAt: this.lastTabLockHeartbeat || null };
    }
    const external = this.tabLockKey ? readLock(this.tabLockKey) : null;
    return { holder: false, heartbeatAt: external?.heartbeatAt ?? null };
  }

  /** 自动翻页开始时只启动顶层播放守卫；子 frame 的守卫在成为播放目标时再启动 */
  private startPlaybackGuard(): void {
    if (!this.hostGuard) {
      this.hostGuard = createPlaybackGuard({
        doc: document,
        isEnabled: () => getSettings().video.resumeOnPause,
        // 只保活“主播放器”，避免把同文档里的隐藏广告/背景音也恢复。
        collectMedia: () => {
          const primary = pickPrimaryMedia(collectDocumentMedia(document));
          return primary ? [primary] : [];
        },
        onNotice: (message, level) => this.onGuardNotice(message, level),
      });
    }
  }

  private stopPlaybackGuard(): void {
    this.hostGuard?.stop();
    this.hostGuard = null;
    for (const child of this.children.values()) {
      sendToWindow(child.source, createMessage({ t: "GUARD_STOP", token: child.token }));
    }
  }

  private onGuardNotice(message: string, level: "info" | "warn"): void {
    logger[level === "warn" ? "warn" : "info"]("guard", message);
    if (level !== "warn") return;
    // 同一类提示 15 秒内只弹一次，避免播放器反复暂停时刷屏。
    if (Date.now() - this.lastGuardNoticeAt < 15000) return;
    this.lastGuardNoticeAt = Date.now();
    this.toast("warn", message);
  }

  /** 停止自动翻页时暂停所有视频/音频 */
  pauseMedia(): void {
    // 先挂起守卫，避免它把脚本刚暂停的视频又恢复。
    this.hostGuard?.suspend();
    this.activeMediaFrameId = "";
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
    // 顶层 URL 变化后不要沿用旧章节的媒体/目标/题目状态；子 frame 会在 1 秒内重新上报。
    this.childMedia.clear();
    this.activeMediaFrameId = "";
    for (const child of this.children.values()) child.questions = [];
    this.filledQuestionIds.clear();
    this.submitConfirmAt = 0;
    resetSubmitGuard(document);
    this.patch({ filledQuestionIds: [] });
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
      if (closed || Date.now() - child.lastSeen > FRAME_STALE_MS) {
        this.children.delete(frameId);
        this.childMedia.delete(frameId);
        if (this.activeMediaFrameId === frameId) this.activeMediaFrameId = "";
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

/** 复制文本：优先 Clipboard API，失败时回退到临时 textarea（需要用户点击手势） */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 回退到 execCommand */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.opacity = "0";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}
