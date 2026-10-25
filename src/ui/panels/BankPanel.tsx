import type { DeepPartial, Settings } from "@/core/settings";
import { t } from "@/core/i18n";
import { Field, TextInput, Toggle } from "@/ui/components";
import type { PageProps } from "../pages/shared";

/** 题库设置：模糊阈值、缓存天数与远程题库接口。 */
export function BankPanel({ controller, state }: Pick<PageProps, "controller" | "state">) {
  const { bank } = state.settings;
  const save = (patch: DeepPartial<Settings>) => controller.saveSettings(patch);

  return (
    <>
      <Field
        label={t("bankPanel.fuzzy", { value: bank.fuzzyThreshold.toFixed(2) })}
        hint={t("bankPanel.fuzzyHint")}
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
      <Field label={t("bankPanel.cacheDays")} hint={t("bankPanel.cacheHint")}>
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
        label={t("bankPanel.remoteEnable")}
        description={t("bankPanel.remoteEnableHint")}
      />
      {bank.remote.enabled ? (
        <div class="sh-stack" style="margin-top:6px">
          <Field label={t("bankPanel.url")}>
            <TextInput
              value={bank.remote.url}
              placeholder="https://example.com/api/search"
              onBlur={(event) => save({ bank: { remote: { url: event.currentTarget.value.trim() } } })}
            />
          </Field>
          <Field label={t("bankPanel.answerPath")} hint={t("bankPanel.answerPathHint")}>
            <TextInput
              value={bank.remote.answerPath}
              placeholder="answer"
              onBlur={(event) =>
                save({ bank: { remote: { answerPath: event.currentTarget.value.trim() } } })
              }
            />
          </Field>
          <Field label={t("bankPanel.confidencePath")}>
            <TextInput
              value={bank.remote.confidencePath}
              placeholder="confidence"
              onBlur={(event) =>
                save({ bank: { remote: { confidencePath: event.currentTarget.value.trim() } } })
              }
            />
          </Field>
          <Field label={t("bankPanel.bodyTemplate")} hint={t("bankPanel.bodyTemplateHint")}>
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
