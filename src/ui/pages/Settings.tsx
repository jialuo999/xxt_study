import { useEffect, useState } from "preact/hooks";
import type { DeepPartial, Settings, ThemeMode } from "@/core/settings";
import { applyLanguage, t, type Language } from "@/core/i18n";
import {
  Badge,
  Button,
  CollapsibleCard,
  Field,
  Icon,
  Modal,
  Segmented,
  TextInput,
  Toggle,
} from "@/ui/components";
import { LogsPanel } from "@/ui/LogsPanel";
import { languageLabel, themeLabel } from "@/ui/labels";
import {
  SECTION_KEYS,
  SETTINGS_PAGE_SECTIONS,
  isSectionOpen,
  setAllSections,
  toggleSection,
} from "@/ui/sections";
import type { PageProps } from "./shared";

const PROJECT_URL = "https://github.com/jialuo999/xxt_study";

export function SettingsPage({ controller, state }: PageProps) {
  applyLanguage(state.settings.ui.language);
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
      setGenericError(t("settings.genericEmpty"));
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
        setGenericError(t("settings.genericFields"));
        return;
      }
      save({
        advanced: {
          genericConfig: parsed as unknown as Settings["advanced"]["genericConfig"],
        },
      });
      setGenericError(null);
    } catch {
      setGenericError(t("settings.genericJson"));
    }
  };

  const errorCount = state.logs.filter((entry) => entry.level === "error").length;
  const version = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

  return (
    <div class="sh-stack">
      <div class="sh-settings-toolbar">
        <span class="sh-small sh-faint">{t("settings.expandHint")}</span>
        <Button
          size="sm"
          variant="ghost"
          icon={allOpen ? "chevronDown" : "chevronRight"}
          onClick={() => setAllSections(controller, SETTINGS_PAGE_SECTIONS, !allOpen)}
        >
          {allOpen ? t("settings.collapseAll") : t("settings.expandAll")}
        </Button>
      </div>

      <CollapsibleCard
        id={SECTION_KEYS.settingsAppearance}
        title={t("settings.appearanceTitle")}
        hint={t("settings.appearanceHint")}
        summary={t("settings.appearanceSummary", {
          theme: themeLabel(settings.ui.theme),
          language: languageLabel(settings.ui.language),
          hotkey: settings.ui.hotkey,
        })}
        open={isOpen(SECTION_KEYS.settingsAppearance)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.settingsAppearance)}
      >
        <Field label={t("settings.theme")}>
          <Segmented<ThemeMode>
            value={settings.ui.theme}
            onChange={(theme) => save({ ui: { theme } })}
            options={[
              { value: "auto", label: themeLabel("auto") },
              { value: "light", label: themeLabel("light") },
              { value: "dark", label: themeLabel("dark") },
            ]}
          />
        </Field>
        <Field label={t("settings.language")} hint={t("settings.languageHint")}>
          <Segmented<Language>
            value={settings.ui.language}
            onChange={(language) => save({ ui: { language } })}
            options={[
              { value: "auto", label: t("language.auto") },
              { value: "zh-CN", label: t("language.zhCN") },
              { value: "en", label: t("language.en") },
            ]}
          />
        </Field>
        <Field label={t("settings.hotkey")} hint={t("settings.hotkeyHint")}>
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
        title={t("settings.advancedTitle")}
        hint={t("settings.advancedHint")}
        summary={t("settings.advancedSummary", {
          debug: settings.advanced.debug ? t("settings.debugOn") : t("settings.debugOff"),
          configured: settings.advanced.genericConfig
            ? t("settings.configured")
            : t("settings.notConfigured"),
        })}
        open={isOpen(SECTION_KEYS.settingsAdvanced)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.settingsAdvanced)}
      >
        <Toggle
          checked={settings.advanced.debug}
          onChange={(debug) => save({ advanced: { debug } })}
          label={t("settings.debug")}
          description={t("settings.debugHint")}
        />
        <Field label={t("settings.genericConfig")} hint={t("settings.genericConfigHint")}>
          <textarea
            class="sh-textarea"
            rows={7}
            spellcheck={false}
            value={genericDraft}
            placeholder={t("settings.genericPlaceholder")}
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
            {t("settings.saveGeneric")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setGenericDraft("");
              setGenericError(null);
            }}
          >
            {t("settings.clearDraft")}
          </Button>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        id={SECTION_KEYS.settingsData}
        title={t("settings.dataTitle")}
        hint={t("settings.dataHint")}
        summary={t("settings.dataSummary", {
          keyState: settings.ai.apiKey ? t("settings.keySet") : t("settings.keyUnset"),
          count: state.bank.total,
        })}
        open={isOpen(SECTION_KEYS.settingsData)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.settingsData)}
      >
        <div class="sh-actions">
          <Button size="sm" variant="danger" icon="trash" onClick={() => setResetConfirm(true)}>
            {t("settings.reset")}
          </Button>
        </div>
        <div class="sh-hint" style="margin-top:8px">
          {t("settings.dataNote", {
            key: settings.ai.apiKey ? mask(settings.ai.apiKey) : t("settings.keyUnset"),
            count: state.bank.total,
          })}
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        id={SECTION_KEYS.settingsLogs}
        title={t("settings.logsTitle")}
        hint={t("settings.logsHint")}
        summary={
          errorCount
            ? t("settings.logsSummaryErrors", { count: state.logs.length, errors: errorCount })
            : t("settings.logsSummary", { count: state.logs.length })
        }
        open={isOpen(SECTION_KEYS.settingsLogs)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.settingsLogs)}
        action={
          errorCount ? (
            <Badge tone="danger">{t("settings.logsErrorBadge", { count: errorCount })}</Badge>
          ) : undefined
        }
      >
        <LogsPanel controller={controller} state={state} />
        <div class="sh-actions" style="margin-top:8px">
          <Button
            size="sm"
            variant="ghost"
            icon="copy"
            onClick={() => void controller.copyDiagnostics()}
          >
            {t("settings.copyDiagnostics")}
          </Button>
          <span class="sh-small sh-faint">{t("settings.diagnosticsHint")}</span>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        id={SECTION_KEYS.settingsAbout}
        title={t("about.title")}
        hint={t("about.hint")}
        summary={t("about.summary", { version })}
        open={isOpen(SECTION_KEYS.settingsAbout)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.settingsAbout)}
        action={<Badge tone="accent">{`v${version}`}</Badge>}
      >
        <div class="sh-stack" style="gap:6px">
          <div class="sh-row sh-row--between">
            <span class="sh-small sh-muted">{t("about.version")}</span>
            <span class="sh-small">{version}</span>
          </div>
          <div class="sh-row sh-row--between">
            <span class="sh-small sh-muted">{t("about.developer")}</span>
            <span class="sh-small">{t("about.developerValue")}</span>
          </div>
          <div class="sh-row sh-row--between">
            <span class="sh-small sh-muted">{t("about.license")}</span>
            <span class="sh-small">{t("about.licenseValue")}</span>
          </div>
          <div class="sh-row sh-row--between" style="align-items:flex-start">
            <span class="sh-small sh-muted">{t("about.project")}</span>
            <a
              class="sh-link"
              href={PROJECT_URL}
              target="_blank"
              rel="noreferrer noopener"
              title={t("about.openProject")}
            >
              {t("about.projectValue")}
              <Icon name="external" size={12} />
            </a>
          </div>
          <div class="sh-hint" style="margin-top:4px">
            {t("about.note")}
          </div>
        </div>
      </CollapsibleCard>

      <Modal
        open={resetConfirm}
        title={t("settings.resetTitle")}
        onClose={() => setResetConfirm(false)}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setResetConfirm(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                controller.resetSettings();
                setResetConfirm(false);
              }}
            >
              {t("settings.resetConfirm")}
            </Button>
          </>
        }
      >
        {t("settings.resetBody")}
      </Modal>
    </div>
  );
}

function mask(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}
