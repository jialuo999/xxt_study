import { useEffect, useState } from "preact/hooks";
import { AI_PRESETS, type AiPresetId, type DeepPartial, type Settings } from "@/core/settings";
import { t } from "@/core/i18n";
import { aiPresetLabel } from "@/ui/labels";
import { Button, Field, IconButton, Select, TextInput, Toggle } from "@/ui/components";
import type { AiTestView } from "@/ui/contract";
import type { PageProps } from "../pages/shared";

/** AI 接口设置：开关、预设、Base URL、Key、模型与连接测试。 */
export function AiPanel({ controller, state }: Pick<PageProps, "controller" | "state">) {
  const { ai } = state.settings;
  const [draft, setDraft] = useState({
    baseUrl: ai.baseUrl,
    model: ai.model,
    apiKey: ai.apiKey,
  });
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestView | null>(null);
  const save = (patch: DeepPartial<Settings>) => controller.saveSettings(patch);

  useEffect(() => {
    setDraft({ baseUrl: ai.baseUrl, model: ai.model, apiKey: ai.apiKey });
  }, [ai.baseUrl, ai.model, ai.apiKey]);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      save({
        ai: {
          baseUrl: draft.baseUrl.trim(),
          model: draft.model.trim(),
          apiKey: draft.apiKey.trim(),
        },
      });
      setTestResult(await controller.testAi());
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <Toggle
        checked={ai.enabled}
        onChange={(enabled) => save({ ai: { enabled } })}
        label={t("aiPanel.enable")}
        description={t("aiPanel.enableHint")}
      />
      <div class="sh-stack" style="margin-top:8px">
        <Field label={t("aiPanel.preset")}>
          <Select
            value={presetValue(ai.baseUrl)}
            onChange={(event) => {
              const preset = AI_PRESETS.find(
                (item) => item.id === (event.currentTarget.value as AiPresetId),
              );
              if (!preset || preset.id === "custom") return;
              setDraft((current) => ({
                ...current,
                baseUrl: preset.baseUrl,
                model: preset.model,
              }));
              save({ ai: { baseUrl: preset.baseUrl, model: preset.model } });
            }}
            options={AI_PRESETS.map((preset) => ({
              value: preset.id,
              label: aiPresetLabel(preset.id),
            }))}
          />
        </Field>
        <Field label={t("aiPanel.baseUrl")} hint={t("aiPanel.baseUrlHint")}>
          <TextInput
            value={draft.baseUrl}
            placeholder="https://api.deepseek.com/v1"
            onInput={(event) =>
              setDraft((current) => ({ ...current, baseUrl: event.currentTarget.value }))
            }
            onBlur={() => save({ ai: { baseUrl: draft.baseUrl.trim() } })}
          />
        </Field>
        <Field label={t("aiPanel.apiKey")}>
          <div class="sh-row">
            <TextInput
              class="sh-grow"
              type={showKey ? "text" : "password"}
              value={draft.apiKey}
              placeholder="sk-..."
              autocomplete="off"
              spellcheck={false}
              onInput={(event) =>
                setDraft((current) => ({ ...current, apiKey: event.currentTarget.value }))
              }
              onBlur={() => save({ ai: { apiKey: draft.apiKey.trim() } })}
            />
            <IconButton
              icon={showKey ? "eyeOff" : "eye"}
              label={showKey ? t("aiPanel.hideKey") : t("aiPanel.showKey")}
              onClick={() => setShowKey((value) => !value)}
            />
          </div>
        </Field>
        <Field label={t("aiPanel.model")}>
          <TextInput
            value={draft.model}
            placeholder="deepseek-chat"
            onInput={(event) =>
              setDraft((current) => ({ ...current, model: event.currentTarget.value }))
            }
            onBlur={() => save({ ai: { model: draft.model.trim() } })}
          />
        </Field>
        <div class="sh-row">
          <Button size="sm" icon="send" disabled={testing} onClick={() => void runTest()}>
            {testing ? t("aiPanel.testing") : t("aiPanel.test")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft((current) => ({ ...current, apiKey: "" }));
              save({ ai: { apiKey: "" } });
              setTestResult(null);
            }}
          >
            {t("aiPanel.clearKey")}
          </Button>
        </div>
        {testResult ? (
          <div
            class="sh-hint"
            style={{ color: testResult.ok ? "var(--sh-success)" : "var(--sh-danger)" }}
          >
            {testResult.message}
            {testResult.latencyMs ? ` · ${testResult.latencyMs}ms` : ""}
          </div>
        ) : null}
      </div>
    </>
  );
}

function presetValue(baseUrl: string): AiPresetId {
  return (
    AI_PRESETS.find((preset) => preset.baseUrl && preset.baseUrl === baseUrl)?.id ?? "custom"
  );
}
