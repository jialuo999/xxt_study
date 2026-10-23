import { useState } from "preact/hooks";
import type { DeepPartial, Settings } from "@/core/settings";
import { MODE_LABEL } from "@/ui/labels";
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
          { value: "hint", label: MODE_LABEL.hint },
          { value: "review", label: MODE_LABEL.review },
          { value: "auto", label: MODE_LABEL.auto },
        ]}
      />
      <div style="margin-top:8px">
        <Toggle
          checked={solving.autoSubmit}
          onChange={(autoSubmit) => save({ solving: { autoSubmit } })}
          label="自动提交"
          description="全自动模式下自动提交"
        />
        <Toggle
          checked={solving.includeTypes.short}
          onChange={(enabled) =>
            save({ solving: { includeTypes: { ...solving.includeTypes, short: enabled } } })
          }
          label="作答简答题"
          description="AI 生成简答文本"
        />
        <Toggle
          checked={solving.allowExam}
          onChange={(enabled) => {
            if (enabled) setExamConfirm(true);
            else save({ solving: { allowExam: false } });
          }}
          label="允许在考试页面自动作答"
          description="高风险，默认关闭"
        />
      </div>
      <Field
        label={`最低置信度：${Math.round(solving.minConfidence * 100)}%`}
        hint="低于该值标记待确认"
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
        title="确认开启考试作答？"
        onClose={() => setExamConfirm(false)}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setExamConfirm(false)}>
              保持关闭
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                save({ solving: { allowExam: true } });
                setExamConfirm(false);
              }}
            >
              我了解风险，开启
            </Button>
          </>
        }
      >
        在考试页面自动作答可能违反学校与平台规定，并可能触发风控。请确认你有权这样做，并自行承担后果。
      </Modal>
    </>
  );
}
