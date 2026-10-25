import {
  Badge,
  Button,
  Card,
  CollapsibleCard,
  Icon,
  Select,
  Stat,
} from "@/ui/components";
import { modeLabel, pageKindLabel, questionTypeLabel, sourceLabel } from "@/ui/labels";
import { VIDEO_RATES } from "@/core/settings";
import { applyLanguage, t } from "@/core/i18n";
import { AutoTurnPanel } from "@/ui/panels/AutoTurnPanel";
import {
  SECTION_KEYS,
  isSectionOpen,
  openSection,
  toggleSection,
  type SectionKey,
} from "@/ui/sections";
import type { PageProps } from "./shared";

export function HomePage({ controller, state, onNavigate }: PageProps) {
  applyLanguage(state.settings.ui.language);
  const { page, questions, results, autoTurn, frames, settings } = state;
  const solved = questions.filter((question) => results[question.id]?.status === "solved").length;
  const pending = questions.filter((question) => results[question.id]?.status === "pending").length;
  const busy = ["scanning", "solving", "filling", "submitting"].includes(state.status);
  const examBlocked = page.kind === "exam" && !settings.solving.allowExam;
  const filledCount = state.filledQuestionIds.length;
  const hintMode = settings.solving.mode === "hint";
  const sectionStates = settings.ui.sectionStates ?? {};
  const openSolveSection = (key: SectionKey) => {
    openSection(controller, key);
    onNavigate("solve");
  };

  return (
    <div class="sh-stack">
      <div class="sh-hero">
        <div class="sh-hero__icon">
          <Icon name="layers" size={18} />
        </div>
        <div class="sh-grow">
          <div class="sh-row" style="gap:6px;flex-wrap:wrap">
            <span style="font-weight:700;font-size:12.5px">{pageKindLabel(page.kind)}</span>
            <Badge tone={page.supported ? "success" : "muted"}>
              {page.supported ? t("home.supported") : t("home.unsupported")}
            </Badge>
          </div>
          <div class="sh-faint sh-small sh-truncate" style="margin-top:2px">
            {safeHost(page.url)}
            {frames.length > 1 ? t("home.frameCount", { count: frames.length }) : ""}
          </div>
        </div>
        <Badge tone={state.status === "error" ? "danger" : busy ? "warn" : "accent"}>
          {state.statusText || t("app.statusIdle")}
        </Badge>
      </div>

      {examBlocked ? (
        <Card accent>
          <div class="sh-row" style="align-items:flex-start">
            <Icon name="shield" size={16} />
            <div class="sh-grow">
              <div class="sh-card__title">{t("home.examProtectedTitle")}</div>
              <div class="sh-card__hint">{t("home.examProtectedBody")}</div>
            </div>
          </div>
          <div style="margin-top:8px">
            <Button
              size="sm"
              variant="ghost"
              icon="settings"
              onClick={() => openSolveSection(SECTION_KEYS.solveSolving)}
            >
              {t("home.goSolveSettings")}
            </Button>
          </div>
        </Card>
      ) : null}

      {!settings.ai.apiKey && settings.ai.enabled ? (
        <Card>
          <div class="sh-row" style="align-items:flex-start">
            <Icon name="key" size={16} />
            <div class="sh-grow">
              <div class="sh-card__title">{t("home.missingKeyTitle")}</div>
              <div class="sh-card__hint">{t("home.missingKeyBody")}</div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openSolveSection(SECTION_KEYS.solveAi)}
            >
              {t("home.configure")}
            </Button>
          </div>
        </Card>
      ) : null}

      <div class="sh-grid">
        <Stat value={questions.length} label={t("home.statQuestions")} />
        <Stat value={solved} label={t("home.statSolved")} />
        <Stat value={pending} label={t("home.statPending")} />
        <Stat value={frames.length || 1} label={t("home.statFrames")} />
      </div>

      <Card
        title={t("home.autoTurn")}
        hint={
          autoTurn.running
            ? autoTurn.message || t("home.autoTurnWaiting")
            : settings.autoTurn.enabled
              ? t("home.autoTurnEnabled")
              : t("home.autoTurnDisabled")
        }
        accent
        action={
          <Badge tone={autoTurn.running ? "success" : "muted"}>
            {autoTurn.running ? t("home.autoTurnRunning") : t("home.autoTurnStopped")}
          </Badge>
        }
      >
        <div class="sh-stack" style="gap:8px">
          <div class="sh-row sh-row--between">
            <span class="sh-small sh-muted">{t("home.steps", { count: autoTurn.steps })}</span>
            <div class="sh-row" style="gap:6px">
              <span class="sh-small sh-faint">{t("home.rate")}</span>
              <Select
                class="sh-select--compact"
                value={String(settings.video.playbackRate)}
                onChange={(event) =>
                  controller.saveSettings({
                    video: { playbackRate: Number(event.currentTarget.value) || 1 },
                  })
                }
                options={VIDEO_RATES.map((rate) => ({
                  value: String(rate),
                  label: `${rate}x`,
                }))}
              />
            </div>
          </div>
          <div class="sh-small sh-faint">
            {settings.autoTurn.waitVideoEnd ? t("home.waitMedia") : t("home.noWaitMedia")}
          </div>
          <div class="sh-actions">
            {autoTurn.running ? (
              <Button size="sm" icon="pause" onClick={() => controller.stopAutoTurn()}>
                {t("home.stopTurn")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon="play"
                disabled={!page.supported || busy}
                onClick={() => controller.startAutoTurn()}
              >
                {t("home.startTurn")}
              </Button>
            )}
            <Button size="sm" icon="scan" disabled={busy} onClick={() => void controller.refresh()}>
              {t("home.rescan")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openSection(controller, SECTION_KEYS.homeAutoTurn)}
            >
              {t("home.turnSettings")}
            </Button>
          </div>
        </div>
      </Card>

      <CollapsibleCard
        id={SECTION_KEYS.homeAutoTurn}
        title={t("home.autoTurnSettings")}
        hint={t("home.autoTurnSettingsHint")}
        summary={`${settings.autoTurn.enabled ? t("home.turnEnabled") : t("home.turnDisabled")} · ${
          settings.video.defaultMuted ? t("home.mutedOn") : t("home.mutedOff")
        }`}
        open={isSectionOpen(sectionStates, SECTION_KEYS.homeAutoTurn)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.homeAutoTurn)}
      >
        <AutoTurnPanel controller={controller} state={state} />
      </CollapsibleCard>

      <Card
        title={t("home.quickActions")}
        hint={t("home.currentMode", { mode: modeLabel(settings.solving.mode) })}
        action={
          <Button size="sm" variant="ghost" onClick={() => onNavigate("solve")}>
            {t("home.viewQuestions")}
          </Button>
        }
      >
        <div class="sh-actions">
          <Button
            size="sm"
            icon="wand"
            disabled={busy || questions.length === 0 || examBlocked}
            onClick={() => void controller.solve()}
          >
            {t("home.solve")}
          </Button>
          <Button
            size="sm"
            icon="check"
            disabled={busy || solved === 0 || examBlocked || hintMode}
            onClick={() => void controller.fillAll()}
          >
            {t("home.fillAll")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="send"
            disabled={busy || questions.length === 0 || examBlocked || hintMode}
            onClick={() => void controller.submit()}
          >
            {t("home.submit")}
          </Button>
        </div>
        <div class="sh-hint" style="margin-top:6px">
          {t("home.filledHint", { filled: filledCount, total: questions.length })}
        </div>
        {questions.length > 0 ? (
          <div class="sh-hint" style="margin-top:8px">
            {t("home.latestQuestion")}
            {questionTypeLabel(questions[0].type)} ·{" "}
            {results[questions[0].id]
              ? `${sourceLabel(results[questions[0].id].source)} · ${Math.round(
                  results[questions[0].id].confidence * 100,
                )}%`
              : t("home.notSolved")}
          </div>
        ) : null}
      </Card>

      <div class="sh-hint" style="text-align:center;padding:2px 0 6px">
        {t("home.footer")}
      </div>
    </div>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
