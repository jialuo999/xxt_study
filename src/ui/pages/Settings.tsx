import { useEffect, useState } from "preact/hooks";
import {
  AI_PRESETS,
  type DeepPartial,
  type Settings,
  type ThemeMode,
} from "@/core/settings";
import {
  Badge,
  Button,
  CollapsibleCard,
  Field,
  IconButton,
  Modal,
  Segmented,
  Select,
  TextInput,
  Toggle,
} from "@/ui/components";
import { MODE_LABEL } from "@/ui/labels";
import type { AiTestView } from "@/ui/contract";
import { LogsPanel } from "@/ui/LogsPanel";
import type { PageProps } from "./shared";

type SectionKey =
  | "solving"
  | "ai"
  | "autoTurn"
  | "advanced"
  | "appearance"
  | "data"
  | "logs";

const SECTION_KEYS: SectionKey[] = [
  "solving",
  "ai",
  "autoTurn",
  "advanced",
  "appearance",
  "data",
  "logs",
];

const DEFAULT_OPEN: Record<SectionKey, boolean> = {
  solving: true,
  ai: true,
  autoTurn: false,
  advanced: false,
  appearance: false,
  data: false,
  logs: false,
};

const THEME_LABEL: Record<ThemeMode, string> = {
  auto: "跟随系统",
  light: "浅色",
  dark: "深色",
};

export function SettingsPage({ controller, state }: PageProps) {
  const settings = state.settings;
  const [aiDraft, setAiDraft] = useState({
    baseUrl: settings.ai.baseUrl,
    model: settings.ai.model,
    apiKey: settings.ai.apiKey,
  });
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestView | null>(null);
  const [examConfirm, setExamConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [genericDraft, setGenericDraft] = useState(() =>
    settings.advanced.genericConfig ? JSON.stringify(settings.advanced.genericConfig, null, 2) : "",
  );
  const [genericError, setGenericError] = useState<string | null>(null);

  useEffect(() => {
    setAiDraft({
      baseUrl: settings.ai.baseUrl,
      model: settings.ai.model,
      apiKey: settings.ai.apiKey,
    });
  }, [settings.ai.baseUrl, settings.ai.model, settings.ai.apiKey]);

  useEffect(() => {
    setGenericDraft(
      settings.advanced.genericConfig ? JSON.stringify(settings.advanced.genericConfig, null, 2) : "",
    );
  }, [settings.advanced.genericConfig]);

  const save = (patch: DeepPartial<Settings>) => controller.saveSettings(patch);

  const sectionStates = settings.ui.sectionStates ?? {};
  const isOpen = (key: SectionKey) => sectionStates[key] ?? DEFAULT_OPEN[key];
  const toggleSection = (key: SectionKey) => {
    save({ ui: { sectionStates: { [key]: !isOpen(key) } } });
  };
  const allOpen = SECTION_KEYS.every((key) => isOpen(key));
  const toggleAllSections = () => {
    const next = Object.fromEntries(SECTION_KEYS.map((key) => [key, !allOpen])) as Record<
      string,
      boolean
    >;
    save({ ui: { sectionStates: next } });
  };

  const saveGenericConfig = () => {
    const text = genericDraft.trim();
    if (!text) {
      setGenericError("请粘贴配置 JSON；清空请使用「恢复默认设置」");
      return;
    }
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (
        typeof parsed.name !== "string" ||
        !Array.isArray(parsed.matches) ||
        typeof parsed.questionContainer !== "string" ||
        typeof parsed.stem !== "string"
      ) {
        setGenericError("至少需要 name / matches / questionContainer / stem 四个字段");
        return;
      }
      save({
        advanced: {
          genericConfig: parsed as unknown as Settings["advanced"]["genericConfig"],
        },
      });
      setGenericError(null);
    } catch {
      setGenericError("JSON 格式错误，请检查逗号、引号与括号");
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      save({
        ai: {
          baseUrl: aiDraft.baseUrl.trim(),
          model: aiDraft.model.trim(),
          apiKey: aiDraft.apiKey.trim(),
        },
      });
      const result = await controller.testAi();
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  const errorCount = state.logs.filter((entry) => entry.level === "error").length;

  return (
    <div class="sh-stack">
      <div class="sh-settings-toolbar">
        <span class="sh-small sh-faint">点击标题展开 / 收起</span>
        <Button
          size="sm"
          variant="ghost"
          icon={allOpen ? "chevronDown" : "chevronRight"}
          onClick={toggleAllSections}
        >
          {allOpen ? "全部收起" : "全部展开"}
        </Button>
      </div>

      <CollapsibleCard
        id="solving"
        title="答题"
        hint="答题方式、题库与缓存"
        summary={`${MODE_LABEL[settings.solving.mode]} · 题库 ${state.bank.total} 条`}
        open={isOpen("solving")}
        onToggle={() => toggleSection("solving")}
      >
        <Segmented
          value={settings.solving.mode}
          onChange={(mode) => save({ solving: { mode } })}
          options={[
            { value: "hint", label: MODE_LABEL.hint },
            { value: "review", label: MODE_LABEL.review },
            { value: "auto", label: MODE_LABEL.auto },
          ]}
        />
        <div style="margin-top:8px">
          <Toggle
            checked={settings.solving.autoSubmit}
            onChange={(autoSubmit) => save({ solving: { autoSubmit } })}
            label="自动提交"
            description="全自动模式下自动提交"
          />
          <Toggle
            checked={settings.solving.includeTypes.short}
            onChange={(enabled) =>
              save({ solving: { includeTypes: { ...settings.solving.includeTypes, short: enabled } } })
            }
            label="作答简答题"
            description="AI 生成简答文本"
          />
          <Toggle
            checked={settings.solving.allowExam}
            onChange={(enabled) => {
              if (enabled) setExamConfirm(true);
              else save({ solving: { allowExam: false } });
            }}
            label="允许在考试页面自动作答"
            description="高风险，默认关闭"
          />
        </div>
        <div class="sh-divider" style="margin:9px 0" />
        <Field
          label={`最低置信度：${Math.round(settings.solving.minConfidence * 100)}%`}
          hint="低于该值标记待确认"
        >
          <input
            class="sh-range"
            type="range"
            min="0.4"
            max="0.95"
            step="0.01"
            value={settings.solving.minConfidence}
            onInput={(event) =>
              save({ solving: { minConfidence: Number(event.currentTarget.value) } })
            }
          />
        </Field>

        <div class="sh-subhead">题库与缓存</div>
        <Field
          label={`模糊匹配阈值：${settings.bank.fuzzyThreshold.toFixed(2)}`}
          hint="建议 0.84–0.90"
        >
          <input
            class="sh-range"
            type="range"
            min="0.7"
            max="0.98"
            step="0.01"
            value={settings.bank.fuzzyThreshold}
            onInput={(event) =>
              save({ bank: { fuzzyThreshold: Number(event.currentTarget.value) } })
            }
          />
        </Field>
        <Field label="缓存保留天数" hint="缓存命中不重复请求">
          <TextInput
            type="number"
            min="0"
            max="365"
            value={settings.bank.cacheTtlDays}
            onBlur={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value)) save({ bank: { cacheTtlDays: Math.max(0, value) } });
            }}
          />
        </Field>
        <div class="sh-divider" style="margin:9px 0" />
        <Toggle
          checked={settings.bank.remote.enabled}
          onChange={(enabled) => save({ bank: { remote: { enabled } } })}
          label="启用远程题库"
          description="HTTP 接口，失败回退 AI"
        />
        {settings.bank.remote.enabled ? (
          <div class="sh-stack" style="margin-top:6px">
            <Field label="接口 URL">
              <TextInput
                value={settings.bank.remote.url}
                placeholder="https://example.com/api/search"
                onBlur={(event) => save({ bank: { remote: { url: event.currentTarget.value.trim() } } })}
              />
            </Field>
            <Field label="答案字段路径" hint="如 data.answer；留空用 answer">
              <TextInput
                value={settings.bank.remote.answerPath}
                placeholder="answer"
                onBlur={(event) =>
                  save({ bank: { remote: { answerPath: event.currentTarget.value.trim() } } })
                }
              />
            </Field>
            <Field label="置信度字段路径">
              <TextInput
                value={settings.bank.remote.confidencePath}
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
                value={settings.bank.remote.bodyTemplate}
                onBlur={(event) =>
                  save({ bank: { remote: { bodyTemplate: event.currentTarget.value } } })
                }
              />
            </Field>
          </div>
        ) : null}
      </CollapsibleCard>

      <CollapsibleCard
        id="ai"
        title="AI 接口"
        hint="OpenAI 兼容接口，Key 仅存本机"
        summary={`${settings.ai.enabled ? "已启用" : "已关闭"} · ${
          settings.ai.apiKey ? "Key 已配置" : "未配置 Key"
        }`}
        open={isOpen("ai")}
        onToggle={() => toggleSection("ai")}
        action={
          <Badge tone={settings.ai.enabled ? "success" : "muted"}>
            {settings.ai.enabled ? "启用" : "关闭"}
          </Badge>
        }
      >
        <Toggle
          checked={settings.ai.enabled}
          onChange={(enabled) => save({ ai: { enabled } })}
          label="启用 AI 解题"
          description="题库未命中时调用大模型"
        />
        <div class="sh-stack" style="margin-top:8px">
          <Field label="服务预设">
            <Select
              value={presetValue(settings.ai.baseUrl)}
              onChange={(event) => {
                const preset = AI_PRESETS.find((item) => item.label === event.currentTarget.value);
                if (!preset || preset.label === "自定义") return;
                setAiDraft((draft) => ({ ...draft, baseUrl: preset.baseUrl, model: preset.model }));
                save({ ai: { baseUrl: preset.baseUrl, model: preset.model } });
              }}
              options={AI_PRESETS.map((preset) => ({ value: preset.label, label: preset.label }))}
            />
          </Field>
          <Field label="Base URL" hint="不带 /chat/completions">
            <TextInput
              value={aiDraft.baseUrl}
              placeholder="https://api.deepseek.com/v1"
              onInput={(event) =>
                setAiDraft((draft) => ({ ...draft, baseUrl: event.currentTarget.value }))
              }
              onBlur={() => save({ ai: { baseUrl: aiDraft.baseUrl.trim() } })}
            />
          </Field>
          <Field label="API Key">
            <div class="sh-row">
              <TextInput
                class="sh-grow"
                type={showKey ? "text" : "password"}
                value={aiDraft.apiKey}
                placeholder="sk-..."
                autocomplete="off"
                spellcheck={false}
                onInput={(event) =>
                  setAiDraft((draft) => ({ ...draft, apiKey: event.currentTarget.value }))
                }
                onBlur={() => save({ ai: { apiKey: aiDraft.apiKey.trim() } })}
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
              value={aiDraft.model}
              placeholder="deepseek-chat"
              onInput={(event) =>
                setAiDraft((draft) => ({ ...draft, model: event.currentTarget.value }))
              }
              onBlur={() => save({ ai: { model: aiDraft.model.trim() } })}
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
                setAiDraft((draft) => ({ ...draft, apiKey: "" }));
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
      </CollapsibleCard>

      <CollapsibleCard
        id="autoTurn"
        title="自动翻页"
        hint="翻页与媒体行为（延迟/步数内置）"
        summary={`${settings.autoTurn.enabled ? "已启用" : "未启用"} · ${
          settings.video.defaultMuted ? "默认静音" : "不静音"
        }`}
        open={isOpen("autoTurn")}
        onToggle={() => toggleSection("autoTurn")}
      >
        <Toggle
          checked={settings.autoTurn.enabled}
          onChange={(enabled) => save({ autoTurn: { enabled } })}
          label="启用自动翻页"
          description="章节完成后自动下一节"
        />
        <Toggle
          checked={settings.autoTurn.waitVideoEnd}
          onChange={(waitVideoEnd) => save({ autoTurn: { waitVideoEnd } })}
          label="等待视频/音频结束"
          description="媒体播完再翻页"
        />
        <Toggle
          checked={settings.autoTurn.stopOnUnanswered}
          onChange={(stopOnUnanswered) => save({ autoTurn: { stopOnUnanswered } })}
          label="遇到未答题目时暂停"
          description="有未答题目时暂停"
        />
        <Toggle
          checked={settings.autoTurn.resumeOnReload}
          onChange={(resumeOnReload) => save({ autoTurn: { resumeOnReload } })}
          label="刷新/跳转后自动恢复"
          description="刷新后继续上次进度"
        />

        <div class="sh-subhead">媒体播放</div>
        <Toggle
          checked={settings.video.defaultMuted}
          onChange={(defaultMuted) => save({ video: { defaultMuted } })}
          label="默认静音"
          description="打开媒体时自动静音"
        />
        <Toggle
          checked={settings.video.resumeOnPause}
          onChange={(resumeOnPause) => save({ video: { resumeOnPause } })}
          label="自动翻页时暂停后恢复"
          description="翻页等待时恢复暂停"
        />
      </CollapsibleCard>

      <CollapsibleCard
        id="advanced"
        title="高级与通用适配器"
        hint="自定义平台选择器（实验性）"
        summary={`${settings.advanced.debug ? "调试开" : "调试关"}${
          settings.advanced.genericConfig ? " · 已配置" : ""
        }`}
        open={isOpen("advanced")}
        onToggle={() => toggleSection("advanced")}
      >
        <Toggle
          checked={settings.advanced.debug}
          onChange={(debug) => save({ advanced: { debug } })}
          label="调试模式"
          description="输出详细日志"
        />
        <Field
          label="通用适配器 JSON"
          hint="必填：name / matches / questionContainer / stem"
        >
          <textarea
            class="sh-textarea"
            rows={7}
            spellcheck={false}
            value={genericDraft}
            placeholder={'{\n  "name": "作业",\n  "matches": ["example.com"],\n  "questionContainer": ".question",\n  "stem": ".stem",\n  "options": ".option",\n  "nextButton": ".next"\n}'}
            onInput={(event) => setGenericDraft(event.currentTarget.value)}
          />
        </Field>
        {genericError ? (
          <div class="sh-hint" style="color:var(--sh-danger);margin-top:4px">
            {genericError}
          </div>
        ) : null}
        <div class="sh-actions" style="margin-top:8px">
          <Button size="sm" icon="check" onClick={saveGenericConfig}>
            保存通用适配器
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setGenericDraft("");
              setGenericError(null);
            }}
          >
            清空编辑框
          </Button>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        id="appearance"
        title="外观与快捷键"
        hint="主题与呼出快捷键"
        summary={`${THEME_LABEL[settings.ui.theme]} · ${settings.ui.hotkey}`}
        open={isOpen("appearance")}
        onToggle={() => toggleSection("appearance")}
      >
        <Field label="主题">
          <Segmented<ThemeMode>
            value={settings.ui.theme}
            onChange={(theme) => save({ ui: { theme } })}
            options={[
              { value: "auto", label: "跟随系统" },
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ]}
          />
        </Field>
        <Field label="快捷键" hint="如 Alt+Shift+S">
          <TextInput
            value={settings.ui.hotkey}
            onBlur={(event) =>
              save({ ui: { hotkey: event.currentTarget.value.trim() || "Alt+Shift+S" } })
            }
          />
        </Field>
      </CollapsibleCard>

      <CollapsibleCard
        id="data"
        title="数据与隐私"
        hint="数据仅保存在本机"
        summary={`Key ${settings.ai.apiKey ? "已设置" : "未设置"} · 题库 ${state.bank.total} 条`}
        open={isOpen("data")}
        onToggle={() => toggleSection("data")}
      >
        <div class="sh-actions">
          <Button size="sm" variant="danger" icon="trash" onClick={() => setResetConfirm(true)}>
            恢复默认设置
          </Button>
        </div>
        <div class="sh-hint" style="margin-top:8px">
          当前 Key：{settings.ai.apiKey ? mask(settings.ai.apiKey) : "未设置"} · 题库{" "}
          {state.bank.total} 条
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        id="logs"
        title="运行日志"
        hint="自动脱敏，最多保留 500 条"
        summary={`${state.logs.length} 条记录${errorCount ? ` · ${errorCount} 条错误` : ""}`}
        open={isOpen("logs")}
        onToggle={() => toggleSection("logs")}
        action={errorCount ? <Badge tone="danger">{errorCount} 错误</Badge> : undefined}
      >
        <LogsPanel controller={controller} state={state} />
      </CollapsibleCard>

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

      <Modal
        open={resetConfirm}
        title="恢复默认设置？"
        onClose={() => setResetConfirm(false)}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setResetConfirm(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                controller.resetSettings();
                setResetConfirm(false);
              }}
            >
              确认恢复
            </Button>
          </>
        }
      >
        将重置 AI、答题模式、自动翻页、题库阈值与外观设置，但不会删除题库与日志。
      </Modal>
    </div>
  );
}

function presetValue(baseUrl: string): string {
  return AI_PRESETS.find((preset) => preset.baseUrl && preset.baseUrl === baseUrl)?.label ?? "自定义";
}

function mask(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}
