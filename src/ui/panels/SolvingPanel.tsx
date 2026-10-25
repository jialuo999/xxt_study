import { useState } from "preact/hooks";
import type { DeepPartial, Settings } from "@/core/settings";
import { t } from "@/core/i18n";
import { modeLabel } from "@/ui/labels";
import { Button, Field, Modal, Segmented, Toggle } from "@/ui/components";
import type { PageProps } from "../pages/shared";

/** 答题设置：模式、自动提交、简答、考试保护与最低置信度。 */
export function SolvingPanel({ controller, state }: Pick<PageProps, "controller" | "state">) {
  const { solving } = state.settings;
  const [examConfirm, setExamConfirm] = useState(false);
  const save = (patch: DeepPartial<Settings>) => controller.saveSettings(patch);

  return (
    <>
      <Segmented
        value={solving.mode}
        onChange={(mode) => save({ solving: { mode } })}
        options={[
          { value: "hint", label: modeLabel("hint") },
          { value: "review", label: modeLabel("review") },
          { value: "auto", label: modeLabel("auto") },
        ]}
      />
      <div style="margin-top:8px">
        <Toggle
          checked={solving.autoSubmit}
          onChange={(autoSubmit) => save({ solving: { autoSubmit } })}
          label={t("solvingPanel.autoSubmit")}
          description={t("solvingPanel.autoSubmitHint")}
        />
        <Toggle
          checked={solving.includeTypes.short}
          onChange={(enabled) =>
            save({ solving: { includeTypes: { ...solving.includeTypes, short: enabled } } })
          }
          label={t("solvingPanel.shortAnswer")}
          description={t("solvingPanel.shortAnswerHint")}
        />
        <Toggle
          checked={solving.allowExam}
          onChange={(enabled) => {
            if (enabled) setExamConfirm(true);
            else save({ solving: { allowExam: false } });
          }}
          label={t("solvingPanel.allowExam")}
          description={t("solvingPanel.allowExamHint")}
        />
      </div>
      <Field
        label={t("solvingPanel.minConfidence", {
          percent: Math.round(solving.minConfidence * 100),
        })}
        hint={t("solvingPanel.minConfidenceHint")}
      >
        <input
          class="sh-range"
          type="range"
          min="0.4"
          max="0.95"
          step="0.01"
          value={solving.minConfidence}
          onInput={(event) =>
            save({ solving: { minConfidence: Number(event.currentTarget.value) } })
          }
        />
      </Field>

      <Modal
        open={examConfirm}
        title={t("solvingPanel.examTitle")}
        onClose={() => setExamConfirm(false)}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setExamConfirm(false)}>
              {t("solvingPanel.keepOff")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                save({ solving: { allowExam: true } });
                setExamConfirm(false);
              }}
            >
              {t("solvingPanel.enableExam")}
            </Button>
          </>
        }
      >
        {t("solvingPanel.examBody")}
      </Modal>
    </>
  );
}
