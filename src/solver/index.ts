/**
 * 解题流水线：缓存 → 题库精确 → 题库模糊 → 远程题库 → AI → 人工 pending。
 *
 * 结果始终按输入顺序返回；低于 settings.solving.minConfidence 的答案标记为 pending，
 * 供 UI 以“建议答案”形式展示并等待人工确认。
 */

import { solveWithAi } from "../ai";
import { getCachedSolve, putCache, searchBank, type BankMatch } from "../bank";
import { queryRemote } from "../bank/remote";
import { logger } from "../core/logger";
import { QUESTION_TYPE_LABEL, type AiSettings, type RemoteBankSettings, type Settings } from "../core/settings";
import type {
  AnswerValue,
  BankEntry,
  Question,
  QuestionType,
  RemoteAnswer,
  SolveResult,
  SolveSource,
} from "../core/types";
import { clamp } from "../utils/async";
import { questionHash } from "../utils/text";

export interface SolverDeps {
  getCachedSolve: (question: Question) => Promise<SolveResult | null>;
  searchBank: (question: Question) => Promise<BankMatch | null>;
  queryRemote: (question: Question, config: RemoteBankSettings) => Promise<RemoteAnswer | null>;
  solveWithAi: (questions: Question[], settings: AiSettings) => Promise<Map<string, SolveResult>>;
  putCache: (question: Question, result: SolveResult) => Promise<void>;
}

export const defaultSolverDeps: SolverDeps = {
  getCachedSolve: (question) => getCachedSolve(question),
  searchBank: (question) => searchBank(question),
  queryRemote: (question, config) => queryRemote(question, config),
  solveWithAi: (questions, settings) => solveWithAi(questions, settings),
  putCache: (question, result) => putCache(question, result),
};

export interface SolveQuestionsOptions {
  settings: Settings;
  onProgress?: (done: number, total: number, result: SolveResult) => void;
  /** 便于测试注入，生产环境使用默认实现 */
  deps?: Partial<SolverDeps>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTypeIncluded(settings: Settings, type: QuestionType): boolean {
  if (type === "unknown") return false;
  const includeTypes = settings.solving?.includeTypes;
  if (!includeTypes) return true;
  return includeTypes[type] === true;
}

function pendingResult(
  question: Question,
  explanation: string,
  source: SolveSource = "manual",
): SolveResult {
  return {
    questionId: question.id,
    answer: null,
    confidence: 0,
    source,
    status: "pending",
    explanation,
    latencyMs: 0,
  };
}

/** 低于阈值的答案保留内容但标记 pending（供 UI 展示建议答案） */
function applyConfidenceGate(result: SolveResult, minConfidence: number): SolveResult {
  if (!result.answer) {
    return { ...result, answer: null, confidence: 0, status: "pending" };
  }
  if (result.confidence < minConfidence) {
    return {
      ...result,
      status: "pending",
      explanation: result.explanation
        ? `${result.explanation}（置信度低于 ${Math.round(minConfidence * 100)}%）`
        : `置信度 ${Math.round(result.confidence * 100)}% 低于阈值，建议人工确认`,
    };
  }
  return { ...result, status: "solved" };
}

/** 题库模糊命中 → 0.75~0.95 的置信度 */
export function fuzzyConfidence(score: number, threshold: number): number {
  if (!Number.isFinite(score)) return 0.75;
  const safeThreshold = clamp(threshold, 0, 1);
  const span = Math.max(0.0001, 1 - safeThreshold);
  const ratio = clamp((score - safeThreshold) / span, 0, 1);
  return Math.round((0.75 + 0.2 * ratio) * 1000) / 1000;
}

/** 来源中文说明（UI 使用） */
export const SOURCE_LABELS: Record<SolveSource, string> = {
  "bank-exact": "题库·精确",
  "bank-fuzzy": "题库·相似",
  remote: "远程题库",
  ai: "AI",
  manual: "人工",
};

export function describeSource(source: SolveSource): string {
  return SOURCE_LABELS[source] ?? source;
}

function cloneAnswer(answer: AnswerValue): AnswerValue {
  switch (answer.kind) {
    case "choice":
      return {
        kind: "choice",
        keys: [...answer.keys],
        texts: answer.texts ? [...answer.texts] : undefined,
      };
    case "judge":
      return { kind: "judge", value: answer.value };
    case "fill":
      return { kind: "fill", values: [...answer.values] };
    case "text":
      return { kind: "text", text: answer.text };
    default:
      return answer;
  }
}

/** 跨题型模糊命中（single ↔ multiple）时，把答案收敛到当前题型 */
function adaptAnswerToType(answer: AnswerValue, type: QuestionType): AnswerValue {
  if (answer.kind === "choice" && type === "single" && answer.keys.length > 1) {
    return {
      kind: "choice",
      keys: answer.keys.slice(0, 1),
      texts: answer.texts ? answer.texts.slice(0, 1) : undefined,
    };
  }
  return answer;
}

/**
 * 由题目与解题结果生成可回填题库的条目；无答案时返回 null。
 * 选择题同时保存选项文本，便于导出与人工核对。
 */
export function toBankEntry(
  question: Question,
  result: SolveResult,
  source?: string,
): BankEntry | null {
  if (!result.answer) return null;
  const optionTexts = question.options.map((option) => `${option.key}. ${option.text}`);
  const hash = questionHash(
    question.type,
    question.stem,
    question.options.map((option) => option.text),
  );
  const isChoice = question.type === "single" || question.type === "multiple";
  return {
    id: `bank-${hash}`,
    hash,
    type: question.type,
    stem: question.stem,
    options: isChoice && optionTexts.length ? optionTexts : undefined,
    answer: cloneAnswer(result.answer),
    source: source ?? result.source,
    updatedAt: Date.now(),
  };
}

/**
 * 按优先级解题，返回与输入顺序一致的 SolveResult[]。
 */
export async function solveQuestions(
  questions: Question[],
  options: SolveQuestionsOptions,
): Promise<SolveResult[]> {
  const { settings, onProgress } = options;
  const deps: SolverDeps = { ...defaultSolverDeps, ...options.deps };
  const total = questions.length;
  const results: SolveResult[] = new Array(total);
  const cacheWrites: Array<Promise<void>> = [];
  let done = 0;

  const emit = (index: number, result: SolveResult): void => {
    results[index] = result;
    done++;
    if (onProgress) {
      try {
        onProgress(done, total, result);
      } catch (error) {
        logger.warn("solver", "onProgress 回调异常", { message: errorMessage(error) });
      }
    }
  };

  const record = (index: number, question: Question, candidate: SolveResult): void => {
    const finalResult = applyConfidenceGate(candidate, minConfidence);
    emit(index, finalResult);
    if (
      finalResult.status === "solved" &&
      finalResult.answer &&
      (finalResult.source === "ai" || finalResult.source === "remote")
    ) {
      cacheWrites.push(
        deps.putCache(question, finalResult).catch((error: unknown) => {
          logger.warn("solver", "写入解题缓存失败", { message: errorMessage(error) });
        }),
      );
    }
  };

  const minConfidence = clamp(Number(settings.solving?.minConfidence ?? 0.6), 0, 1);
  const fuzzyThreshold = clamp(Number(settings.bank?.fuzzyThreshold ?? 0.86), 0, 1);
  const remoteConfig = settings.bank?.remote;
  const remoteEnabled = Boolean(remoteConfig?.enabled);
  const aiEnabled = Boolean(settings.ai?.enabled);

  const remaining: number[] = [];

  // 阶段 1：缓存 → 题库精确/模糊（逐题，保持输入顺序）
  for (let index = 0; index < total; index++) {
    const question = questions[index];
    if (!question) continue;

    if (question.hasImage) {
      emit(index, pendingResult(question, "题干或选项含图片，需人工查看"));
      continue;
    }
    if (!isTypeIncluded(settings, question.type)) {
      emit(
        index,
        pendingResult(
          question,
          `已在设置中关闭「${QUESTION_TYPE_LABEL[question.type] ?? question.type}」自动作答`,
        ),
      );
      continue;
    }

    const startedAt = Date.now();

    try {
      const cached = await deps.getCachedSolve(question);
      if (cached?.answer) {
        record(index, question, {
          ...cached,
          questionId: question.id,
          latencyMs: Date.now() - startedAt,
        });
        continue;
      }
    } catch (error) {
      logger.warn("solver", "读取解题缓存失败", { message: errorMessage(error) });
    }

    try {
      const match = await deps.searchBank(question);
      if (match) {
        const latencyMs = Date.now() - startedAt;
        if (match.mode === "exact") {
          record(index, question, {
            questionId: question.id,
            answer: adaptAnswerToType(cloneAnswer(match.entry.answer), question.type),
            confidence: 0.99,
            source: "bank-exact",
            status: "solved",
            explanation: "命中本地题库（精确匹配）",
            latencyMs,
          });
        } else {
          record(index, question, {
            questionId: question.id,
            answer: adaptAnswerToType(cloneAnswer(match.entry.answer), question.type),
            confidence: fuzzyConfidence(match.score, fuzzyThreshold),
            source: "bank-fuzzy",
            status: "solved",
            explanation: `命中本地题库（相似度 ${Math.round(match.score * 100)}%）`,
            latencyMs,
          });
        }
        continue;
      }
    } catch (error) {
      logger.warn("solver", "本地题库检索失败", { message: errorMessage(error) });
    }

    remaining.push(index);
  }

  // 阶段 2：远程题库（启用时，逐题请求避免压垮服务）
  let afterRemote: number[] = [];
  if (remoteEnabled && remoteConfig) {
    for (const index of remaining) {
      const question = questions[index];
      const startedAt = Date.now();
      try {
        const remote = await deps.queryRemote(question, remoteConfig);
        if (remote?.answer) {
          record(index, question, {
            questionId: question.id,
            answer: cloneAnswer(remote.answer),
            confidence: clamp(Number(remote.confidence) || 0.7, 0, 1),
            source: "remote",
            status: "solved",
            explanation: "来自远程题库",
            latencyMs: Date.now() - startedAt,
          });
          continue;
        }
      } catch (error) {
        logger.warn("solver", "远程题库查询失败", { message: errorMessage(error) });
      }
      afterRemote.push(index);
    }
  } else {
    afterRemote = remaining;
  }

  // 阶段 3：AI 批量（启用时）
  const afterAi: number[] = [];
  if (aiEnabled && afterRemote.length) {
    const aiQuestions = afterRemote.map((index) => questions[index]);
    try {
      const aiResults = await deps.solveWithAi(aiQuestions, settings.ai);
      for (const index of afterRemote) {
        const question = questions[index];
        const result = aiResults.get(question.id);
        if (result?.answer) {
          record(index, question, {
            ...result,
            questionId: question.id,
            source: "ai",
            status: "solved",
          });
          continue;
        }
        afterAi.push(index);
      }
    } catch (error) {
      logger.warn("solver", "AI 解题失败", { message: errorMessage(error) });
      afterAi.push(...afterRemote);
    }
  } else {
    afterAi.push(...afterRemote);
  }

  // 阶段 4：人工 pending
  for (const index of afterAi) {
    const question = questions[index];
    if (!results[index]) {
      emit(
        index,
        pendingResult(
          question,
          aiEnabled ? "未能获得可靠答案，请人工作答" : "AI 未启用，请人工作答",
        ),
      );
    }
  }

  // 等待缓存写入完成（不阻塞结果返回的语义，但保持可测试）
  if (cacheWrites.length) await Promise.allSettled(cacheWrites);

  return results;
}
