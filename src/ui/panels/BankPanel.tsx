import type { DeepPartial, Settings } from "@/core/settings";
import { Field, TextInput, Toggle } from "@/ui/components";
import type { PageProps } from "../pages/shared";

/** 题库设置：模糊阈值、缓存天数与远程题库接口。 */
export function BankPanel({ controller, state }: Pick<PageProps, "controller" | "state">) {
  const { bank } = state.settings;
  const save = (patch: DeepPartial<Settings>) => controller.saveSettings(patch);

  return (
    <>
      <Field
        label={`模糊匹配阈值：${bank.fuzzyThreshold.toFixed(2)}`}
        hint="建议 0.84–0.90"
      >
        <input
          class="sh-range"
          type="range"
          min="0.7"
          max="0.98"
          step="0.01"
          value={bank.fuzzyThreshold}
          onInput={(event) => save({ bank: { fuzzyThreshold: Number(event.currentTarget.value) } })}
        />
      </Field>
      <Field label="缓存保留天数" hint="缓存命中不重复请求">
        <TextInput
          type="number"
          min="0"
          max="365"
          value={bank.cacheTtlDays}
          onBlur={(event) => {
            const value = Number(event.currentTarget.value);
            if (Number.isFinite(value)) save({ bank: { cacheTtlDays: Math.max(0, value) } });
          }}
        />
      </Field>
      <div class="sh-divider" style="margin:9px 0" />
      <Toggle
        checked={bank.remote.enabled}
        onChange={(enabled) => save({ bank: { remote: { enabled } } })}
        label="启用远程题库"
        description="HTTP 接口，失败回退 AI"
      />
      {bank.remote.enabled ? (
        <div class="sh-stack" style="margin-top:6px">
          <Field label="接口 URL">
            <TextInput
              value={bank.remote.url}
              placeholder="https://example.com/api/search"
              onBlur={(event) => save({ bank: { remote: { url: event.currentTarget.value.trim() } } })}
            />
          </Field>
          <Field label="答案字段路径" hint="如 data.answer；留空用 answer">
            <TextInput
              value={bank.remote.answerPath}
              placeholder="answer"
              onBlur={(event) =>
                save({ bank: { remote: { answerPath: event.currentTarget.value.trim() } } })
              }
            />
          </Field>
          <Field label="置信度字段路径">
            <TextInput
              value={bank.remote.confidencePath}
              placeholder="confidence"
              onBlur={(event) =>
                save({ bank: { remote: { confidencePath: event.currentTarget.value.trim() } } })
              }
            />
          </Field>
          <Field label="请求体模板" hint="占位符：{{question}} / {{type}} / {{options}}">
            <textarea
              class="sh-textarea"
              rows={4}
              value={bank.remote.bodyTemplate}
              onBlur={(event) =>
                save({ bank: { remote: { bodyTemplate: event.currentTarget.value } } })
              }
            />
          </Field>
        </div>
      ) : null}
    </>
  );
}
