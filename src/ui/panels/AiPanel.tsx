import { useEffect, useState } from "preact/hooks";
import { AI_PRESETS, type DeepPartial, type Settings } from "@/core/settings";
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
        label="启用 AI 解题"
        description="题库未命中时调用大模型"
      />
      <div class="sh-stack" style="margin-top:8px">
        <Field label="服务预设">
          <Select
            value={presetValue(ai.baseUrl)}
            onChange={(event) => {
              const preset = AI_PRESETS.find((item) => item.label === event.currentTarget.value);
              if (!preset || preset.label === "自定义") return;
              setDraft((current) => ({
                ...current,
                baseUrl: preset.baseUrl,
                model: preset.model,
              }));
              save({ ai: { baseUrl: preset.baseUrl, model: preset.model } });
            }}
            options={AI_PRESETS.map((preset) => ({ value: preset.label, label: preset.label }))}
          />
        </Field>
        <Field label="Base URL" hint="不带 /chat/completions">
          <TextInput
            value={draft.baseUrl}
            placeholder="https://api.deepseek.com/v1"
            onInput={(event) =>
              setDraft((current) => ({ ...current, baseUrl: event.currentTarget.value }))
            }
            onBlur={() => save({ ai: { baseUrl: draft.baseUrl.trim() } })}
          />
        </Field>
        <Field label="API Key">
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
              label={showKey ? "隐藏 Key" : "显示 Key"}
              onClick={() => setShowKey((value) => !value)}
            />
          </div>
        </Field>
        <Field label="模型">
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
            {testing ? "测试中…" : "测试连接"}
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
            清除 Key
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

function presetValue(baseUrl: string): string {
  return AI_PRESETS.find((preset) => preset.baseUrl && preset.baseUrl === baseUrl)?.label ?? "自定义";
}
