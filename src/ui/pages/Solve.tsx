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
import {
  SOURCE_TONE,
  STATUS_TONE,
  modeLabel,
  pageKindLabel,
  questionTypeLabel,
  sourceLabel,
  statusLabel,
} from "@/ui/labels";
import { applyLanguage, t } from "@/core/i18n";
import { formatAnswer } from "@/utils/text";
import { AiPanel } from "@/ui/panels/AiPanel";
import { SolvingPanel } from "@/ui/panels/SolvingPanel";
import { SECTION_KEYS, isSectionOpen, toggleSection } from "@/ui/sections";
import type { Question, SolveResult } from "@/core/types";
import type { PageProps } from "./shared";

type Filter = "all" | "pending" | "solved" | "failed";

export function SolvePage({ controller, state }: PageProps) {
  applyLanguage(state.settings.ui.language);
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
              {t("solve.title", { kind: pageKindLabel(page.kind), count: questions.length })}
            </div>
            <div class="sh-card__hint">
              {modeLabel(settings.solving.mode)}
              {settings.solving.autoSubmit ? t("solve.autoSubmitSuffix") : t("solve.manualSubmitSuffix")}
            </div>
          </div>
          <Badge tone={examBlocked ? "danger" : solved === questions.length && questions.length > 0 ? "success" : "accent"}>
            {examBlocked
              ? t("solve.examProtected")
              : t("solve.answered", { solved, total: questions.length })}
          </Badge>
        </div>
        {state.progress ? (
          <div style="margin-top:9px">
            <div class="sh-row sh-row--between" style="margin-bottom:4px">
              <span class="sh-small sh-muted">{t("solve.progress")}</span>
              <span class="sh-small sh-faint">
                {state.progress.done}/{state.progress.total}
              </span>
            </div>
            <Progress value={state.progress.done} max={state.progress.total} />
          </div>
        ) : null}
        <div class="sh-actions" style="margin-top:10px">
          <Button size="sm" icon="scan" disabled={busy} onClick={() => void controller.refresh()}>
            {t("solve.scan")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="wand"
            disabled={busy || questions.length === 0 || examBlocked}
            onClick={() => void controller.solve()}
          >
            {state.status === "solving" ? t("solve.solving") : t("solve.start")}
          </Button>
          <Button
            size="sm"
            icon="check"
            disabled={busy || solved === 0 || examBlocked || hintMode}
            onClick={() => void controller.fillAll()}
          >
            {t("solve.fillAll")}
          </Button>
          <Button
            size="sm"
            icon="send"
            disabled={busy || questions.length === 0 || examBlocked || hintMode}
            onClick={() => void controller.submit()}
          >
            {t("solve.submit")}
          </Button>
        </div>
        <div class="sh-hint" style="margin-top:6px">
          {hintMode
            ? t("solve.hintMode")
            : t("solve.filledHint", { filled: filledCount, total: questions.length })}
        </div>
      </Card>

      <CollapsibleCard
        id={SECTION_KEYS.solveSolving}
        title={t("solve.settingsTitle")}
        hint={t("solve.settingsHint")}
        summary={t("solve.settingsSummary", {
          mode: modeLabel(settings.solving.mode),
          confidence,
        })}
        open={isSectionOpen(sectionStates, SECTION_KEYS.solveSolving)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.solveSolving)}
      >
        <SolvingPanel controller={controller} state={state} />
      </CollapsibleCard>

      <CollapsibleCard
        id={SECTION_KEYS.solveAi}
        title={t("solve.aiTitle")}
        hint={t("solve.aiHint")}
        summary={t("solve.aiSummary", {
          enabled: settings.ai.enabled ? t("common.enabled") : t("common.disabled"),
          keyState: settings.ai.apiKey
            ? t("solve.aiSummaryKeySet")
            : t("solve.aiSummaryKeyMissing"),
        })}
        open={isSectionOpen(sectionStates, SECTION_KEYS.solveAi)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.solveAi)}
        action={
          <Badge tone={settings.ai.enabled ? "success" : "muted"}>
            {settings.ai.enabled ? t("solve.aiBadgeOn") : t("solve.aiBadgeOff")}
          </Badge>
        }
      >
        <AiPanel controller={controller} state={state} />
      </CollapsibleCard>

      {questions.length === 0 ? (
        <EmptyState
          icon="scan"
          title={t("solve.emptyTitle")}
          description={t("solve.emptyDesc")}
          action={
            <Button size="sm" icon="refresh" disabled={busy} onClick={() => void controller.refresh()}>
              {t("solve.rescan")}
            </Button>
          }
        />
      ) : (
        <>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("solve.filterAll", { count: questions.length }) },
              { value: "pending", label: t("solve.filterPending", { count: pending }) },
              { value: "solved", label: t("solve.filterSolved", { count: solved }) },
              { value: "failed", label: t("solve.filterFailed", { count: failed }) },
            ]}
          />
          {state.status === "solving" ? (
            <div class="sh-row sh-small sh-muted" style="justify-content:center;gap:6px">
              <Spinner size={13} /> {t("solve.solvingHint")}
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
              <EmptyState
                icon="check"
                title={t("solve.filterEmptyTitle")}
                description={t("solve.filterEmptyDesc")}
              />
            ) : null}
          </div>
        </>
      )}

      <div class="sh-hint" style="text-align:center;padding:2px 0 6px">
        {t("solve.footer")}
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
        <Badge tone="muted">{questionTypeLabel(question.type)}</Badge>
        {result ? (
          <>
            <Badge tone={SOURCE_TONE[result.source]}>{sourceLabel(result.source)}</Badge>
            <Badge tone={STATUS_TONE[result.status]}>{statusLabel(result.status)}</Badge>
          </>
        ) : (
          <Badge tone="muted">{t("solve.notSolved")}</Badge>
        )}
        {question.hasImage ? <Badge tone="warn">{t("solve.hasImage")}</Badge> : null}
      </div>
      <div class="sh-qitem__stem">{question.stem || t("solve.emptyStem")}</div>
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
        {result ? <Confidence value={result.confidence} /> : <span class="sh-faint sh-small">{t("solve.waiting")}</span>}
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
