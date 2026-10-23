import { useState } from "preact/hooks";
import {
  Badge,
  Button,
  Card,
  CollapsibleCard,
  Confidence,
  EmptyState,
  Progress,
  Segmented,
  Spinner,
} from "@/ui/components";
import { MODE_LABEL, SOURCE_LABEL, SOURCE_TONE, STATUS_LABEL, STATUS_TONE } from "@/ui/labels";
import { PAGE_KIND_LABEL, QUESTION_TYPE_LABEL } from "@/core/settings";
import { formatAnswer } from "@/utils/text";
import { AiPanel } from "@/ui/panels/AiPanel";
import { SolvingPanel } from "@/ui/panels/SolvingPanel";
import { SECTION_KEYS, isSectionOpen, toggleSection } from "@/ui/sections";
import type { Question, SolveResult } from "@/core/types";
import type { PageProps } from "./shared";

type Filter = "all" | "pending" | "solved" | "failed";

export function SolvePage({ controller, state }: PageProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const { questions, results, settings, page } = state;
  const busy = ["scanning", "solving", "filling", "submitting"].includes(state.status);
  const examBlocked = page.kind === "exam" && !settings.solving.allowExam;
  const solved = questions.filter((question) => results[question.id]?.status === "solved").length;
  const pending = questions.filter((question) => results[question.id]?.status === "pending").length;
  const failed = questions.filter((question) => results[question.id]?.status === "failed").length;
  const filledCount = state.filledQuestionIds.length;
  const hintMode = settings.solving.mode === "hint";
  const sectionStates = settings.ui.sectionStates ?? {};
  const confidence = Math.round(settings.solving.minConfidence * 100);

  const visible = questions.filter((question) => {
    if (filter === "all") return true;
    return results[question.id]?.status === filter;
  });

  return (
    <div class="sh-stack">
      <Card accent>
        <div class="sh-row sh-row--between">
          <div class="sh-grow">
            <div class="sh-card__title">
              {PAGE_KIND_LABEL[page.kind]} · {questions.length} 题
            </div>
            <div class="sh-card__hint">
              {MODE_LABEL[settings.solving.mode]}
              {settings.solving.autoSubmit ? " · 自动提交" : " · 手动提交"}
            </div>
          </div>
          <Badge tone={examBlocked ? "danger" : solved === questions.length && questions.length > 0 ? "success" : "accent"}>
            {examBlocked ? "考试保护" : `${solved}/${questions.length} 已答`}
          </Badge>
        </div>
        {state.progress ? (
          <div style="margin-top:9px">
            <div class="sh-row sh-row--between" style="margin-bottom:4px">
              <span class="sh-small sh-muted">解题进度</span>
              <span class="sh-small sh-faint">
                {state.progress.done}/{state.progress.total}
              </span>
            </div>
            <Progress value={state.progress.done} max={state.progress.total} />
          </div>
        ) : null}
        <div class="sh-actions" style="margin-top:10px">
          <Button size="sm" icon="scan" disabled={busy} onClick={() => void controller.refresh()}>
            扫描
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="wand"
            disabled={busy || questions.length === 0 || examBlocked}
            onClick={() => void controller.solve()}
          >
            {state.status === "solving" ? "解题中…" : "开始解题"}
          </Button>
          <Button
            size="sm"
            icon="check"
            disabled={busy || solved === 0 || examBlocked || hintMode}
            onClick={() => void controller.fillAll()}
          >
            全部填入
          </Button>
          <Button
            size="sm"
            icon="send"
            disabled={busy || questions.length === 0 || examBlocked || hintMode}
            onClick={() => void controller.submit()}
          >
            提交
          </Button>
        </div>
        <div class="sh-hint" style="margin-top:6px">
          {hintMode
            ? "「仅提示」模式不会自动填入或提交"
            : `已填入 ${filledCount}/${questions.length} 题；手动填写后首次提交会要求二次确认`}
        </div>
      </Card>

      <CollapsibleCard
        id={SECTION_KEYS.solveSolving}
        title="答题设置"
        hint="作答方式、题型与最低置信度"
        summary={`${MODE_LABEL[settings.solving.mode]} · 最低 ${confidence}%`}
        open={isSectionOpen(sectionStates, SECTION_KEYS.solveSolving)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.solveSolving)}
      >
        <SolvingPanel controller={controller} state={state} />
      </CollapsibleCard>

      <CollapsibleCard
        id={SECTION_KEYS.solveAi}
        title="AI 接口"
        hint="OpenAI 兼容，Key 仅存本机"
        summary={`${settings.ai.enabled ? "已启用" : "未启用"} · ${
          settings.ai.apiKey ? "Key 已配置" : "未配置 Key"
        }`}
        open={isSectionOpen(sectionStates, SECTION_KEYS.solveAi)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.solveAi)}
        action={
          <Badge tone={settings.ai.enabled ? "success" : "muted"}>
            {settings.ai.enabled ? "启用" : "关闭"}
          </Badge>
        }
      >
        <AiPanel controller={controller} state={state} />
      </CollapsibleCard>

      {questions.length === 0 ? (
        <EmptyState
          icon="scan"
          title="还没有采集到题目"
          description="打开作业/章节测验页面后点击扫描；若仍为空，可能是页面结构变化，请在 设置 → 运行日志 中查看诊断。"
          action={
            <Button size="sm" icon="refresh" disabled={busy} onClick={() => void controller.refresh()}>
              重新扫描
            </Button>
          }
        />
      ) : (
        <>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `全部 ${questions.length}` },
              { value: "pending", label: `待确认 ${pending}` },
              { value: "solved", label: `已答 ${solved}` },
              { value: "failed", label: `失败 ${failed}` },
            ]}
          />
          {state.status === "solving" ? (
            <div class="sh-row sh-small sh-muted" style="justify-content:center;gap:6px">
              <Spinner size={13} /> 正在请求题库与 AI…
            </div>
          ) : null}
          <div class="sh-list">
            {visible.map((question) => (
              <QuestionItem
                key={question.id}
                question={question}
                result={results[question.id]}
              />
            ))}
            {visible.length === 0 ? (
              <EmptyState icon="check" title="这个筛选下没有题目" description="切换到「全部」查看。" />
            ) : null}
          </div>
        </>
      )}

      <div class="sh-hint" style="text-align:center;padding:2px 0 6px">
        答案按选项文本匹配，选项乱序也能正确填入
      </div>
    </div>
  );
}

function QuestionItem({ question, result }: { question: Question; result?: SolveResult }) {
  const status = result?.status ?? "pending";
  return (
    <div class="sh-qitem" data-status={status}>
      <div class="sh-qitem__head">
        <span class="sh-qitem__index">#{question.index + 1}</span>
        <Badge tone="muted">{QUESTION_TYPE_LABEL[question.type]}</Badge>
        {result ? (
          <>
            <Badge tone={SOURCE_TONE[result.source]}>{SOURCE_LABEL[result.source]}</Badge>
            <Badge tone={STATUS_TONE[result.status]}>{STATUS_LABEL[result.status]}</Badge>
          </>
        ) : (
          <Badge tone="muted">未解题</Badge>
        )}
        {question.hasImage ? <Badge tone="warn">含图</Badge> : null}
      </div>
      <div class="sh-qitem__stem">{question.stem || "（空题干）"}</div>
      {question.options.length > 0 ? (
        <div class="sh-hint" style="margin-top:4px">
          {question.options.map((option) => `${option.key}. ${option.text}`).join("　")}
        </div>
      ) : null}
      {result?.answer ? <div class="sh-qitem__answer">{formatAnswer(result.answer)}</div> : null}
      {result?.explanation ? (
        <div class="sh-hint" style="margin-top:3px">
          {result.explanation}
        </div>
      ) : null}
      <div class="sh-qitem__meta">
        {result ? <Confidence value={result.confidence} /> : <span class="sh-faint sh-small">等待解题</span>}
        {result ? (
          <span class="sh-faint sh-small">
            {result.latencyMs < 1000 ? `${result.latencyMs}ms` : `${(result.latencyMs / 1000).toFixed(1)}s`}
          </span>
        ) : null}
        {result?.costTokens ? (
          <span class="sh-faint sh-small">~{result.costTokens} tokens</span>
        ) : null}
      </div>
    </div>
  );
}
