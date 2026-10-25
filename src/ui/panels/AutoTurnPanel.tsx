import type { DeepPartial, Settings } from "@/core/settings";
import { t } from "@/core/i18n";
import { Toggle } from "@/ui/components";
import type { PageProps } from "../pages/shared";

/** 自动翻页与媒体播放设置：翻页开关 + 媒体偏好开关。 */
export function AutoTurnPanel({ controller, state }: Pick<PageProps, "controller" | "state">) {
  const { autoTurn, video } = state.settings;
  const save = (patch: DeepPartial<Settings>) => controller.saveSettings(patch);

  return (
    <>
      <Toggle
        checked={autoTurn.enabled}
        onChange={(enabled) => save({ autoTurn: { enabled } })}
        label={t("autoTurnPanel.enable")}
        description={t("autoTurnPanel.enableHint")}
      />
      <Toggle
        checked={autoTurn.waitVideoEnd}
        onChange={(waitVideoEnd) => save({ autoTurn: { waitVideoEnd } })}
        label={t("autoTurnPanel.waitMedia")}
        description={t("autoTurnPanel.waitMediaHint")}
      />
      <Toggle
        checked={autoTurn.stopOnUnanswered}
        onChange={(stopOnUnanswered) => save({ autoTurn: { stopOnUnanswered } })}
        label={t("autoTurnPanel.stopUnanswered")}
        description={t("autoTurnPanel.stopUnansweredHint")}
      />
      <Toggle
        checked={autoTurn.resumeOnReload}
        onChange={(resumeOnReload) => save({ autoTurn: { resumeOnReload } })}
        label={t("autoTurnPanel.resumeOnReload")}
        description={t("autoTurnPanel.resumeOnReloadHint")}
      />

      <Toggle
        checked={autoTurn.readingAuto}
        onChange={(readingAuto) => save({ autoTurn: { readingAuto } })}
        label={t("autoTurnPanel.readingAuto")}
        description={t("autoTurnPanel.readingAutoHint")}
      />

      <div class="sh-subhead">{t("autoTurnPanel.mediaSection")}</div>
      <Toggle
        checked={video.defaultMuted}
        onChange={(defaultMuted) => save({ video: { defaultMuted } })}
        label={t("autoTurnPanel.muted")}
        description={t("autoTurnPanel.mutedHint")}
      />
      <Toggle
        checked={video.resumeOnPause}
        onChange={(resumeOnPause) => save({ video: { resumeOnPause } })}
        label={t("autoTurnPanel.resumeOnPause")}
        description={t("autoTurnPanel.resumeOnPauseHint")}
      />
    </>
  );
}
