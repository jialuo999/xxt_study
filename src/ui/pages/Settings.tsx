import { useEffect, useState } from "preact/hooks";
import type { DeepPartial, Settings, ThemeMode } from "@/core/settings";
import {
  Badge,
  Button,
  CollapsibleCard,
  Field,
  Modal,
  Segmented,
  TextInput,
  Toggle,
} from "@/ui/components";
import { LogsPanel } from "@/ui/LogsPanel";
import {
  SECTION_KEYS,
  SETTINGS_PAGE_SECTIONS,
  isSectionOpen,
  setAllSections,
  toggleSection,
} from "@/ui/sections";
import type { PageProps } from "./shared";

const THEME_LABEL: Record<ThemeMode, string> = {
  auto: "跟随系统",
  light: "浅色",
  dark: "深色",
};

export function SettingsPage({ controller, state }: PageProps) {
  const settings = state.settings;
  const [resetConfirm, setResetConfirm] = useState(false);
  const [genericDraft, setGenericDraft] = useState(() =>
    settings.advanced.genericConfig ? JSON.stringify(settings.advanced.genericConfig, null, 2) : "",
  );
  const [genericError, setGenericError] = useState<string | null>(null);

  useEffect(() => {
    setGenericDraft(
      settings.advanced.genericConfig ? JSON.stringify(settings.advanced.genericConfig, null, 2) : "",
    );
  }, [settings.advanced.genericConfig]);

  const save = (patch: DeepPartial<Settings>) => controller.saveSettings(patch);

  const sectionStates = settings.ui.sectionStates ?? {};
  const isOpen = (key: (typeof SETTINGS_PAGE_SECTIONS)[number]) =>
    isSectionOpen(sectionStates, key);
  const allOpen = SETTINGS_PAGE_SECTIONS.every((key) => isOpen(key));

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

  const errorCount = state.logs.filter((entry) => entry.level === "error").length;

  return (
    <div class="sh-stack">
      <div class="sh-settings-toolbar">
        <span class="sh-small sh-faint">点击标题展开 / 收起</span>
        <Button
          size="sm"
          variant="ghost"
          icon={allOpen ? "chevronDown" : "chevronRight"}
          onClick={() => setAllSections(controller, SETTINGS_PAGE_SECTIONS, !allOpen)}
        >
          {allOpen ? "全部收起" : "全部展开"}
        </Button>
      </div>

      <CollapsibleCard
        id={SECTION_KEYS.settingsAppearance}
        title="外观与快捷键"
        hint="主题与呼出快捷键"
        summary={`${THEME_LABEL[settings.ui.theme]} · ${settings.ui.hotkey}`}
        open={isOpen(SECTION_KEYS.settingsAppearance)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.settingsAppearance)}
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
        id={SECTION_KEYS.settingsAdvanced}
        title="高级与通用适配器"
        hint="调试日志与自定义平台选择器"
        summary={`${settings.advanced.debug ? "调试开" : "调试关"}${
          settings.advanced.genericConfig ? " · 已配置" : ""
        }`}
        open={isOpen(SECTION_KEYS.settingsAdvanced)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.settingsAdvanced)}
      >
        <Toggle
          checked={settings.advanced.debug}
          onChange={(debug) => save({ advanced: { debug } })}
          label="调试模式"
          description="输出详细日志"
        />
        <Field label="通用适配器 JSON" hint="必填：name / matches / questionContainer / stem">
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
        id={SECTION_KEYS.settingsData}
        title="数据与隐私"
        hint="数据仅保存在本机"
        summary={`AI Key ${settings.ai.apiKey ? "已设置" : "未设置"} · 题库 ${state.bank.total} 条`}
        open={isOpen(SECTION_KEYS.settingsData)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.settingsData)}
      >
        <div class="sh-actions">
          <Button size="sm" variant="danger" icon="trash" onClick={() => setResetConfirm(true)}>
            恢复默认设置
          </Button>
        </div>
        <div class="sh-hint" style="margin-top:8px">
          AI Key 在「答题 → AI 接口」中配置 · 当前 Key：
          {settings.ai.apiKey ? mask(settings.ai.apiKey) : "未设置"} · 题库 {state.bank.total} 条
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        id={SECTION_KEYS.settingsLogs}
        title="运行日志"
        hint="自动脱敏，最多保留 500 条"
        summary={`${state.logs.length} 条记录${errorCount ? ` · ${errorCount} 条错误` : ""}`}
        open={isOpen(SECTION_KEYS.settingsLogs)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.settingsLogs)}
        action={errorCount ? <Badge tone="danger">{errorCount} 错误</Badge> : undefined}
      >
        <LogsPanel controller={controller} state={state} />
        <div class="sh-actions" style="margin-top:8px">
          <Button
            size="sm"
            variant="ghost"
            icon="copy"
            onClick={() => void controller.copyDiagnostics()}
          >
            复制诊断包
          </Button>
          <span class="sh-small sh-faint">
            页面结构 + 选择器命中 + 脱敏设置与日志，不含答案
          </span>
        </div>
      </CollapsibleCard>

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

function mask(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}
