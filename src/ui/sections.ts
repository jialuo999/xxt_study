import type { UiController } from "./contract";

/** 功能就近设置的板块 key：每个 key 只属于一个 Tab，避免同一设置出现两处。 */
export const SECTION_KEYS = {
  homeAutoTurn: "home.autoTurn",
  solveSolving: "solve.solving",
  solveAi: "solve.ai",
  bankSettings: "bank.settings",
  settingsAppearance: "settings.appearance",
  settingsAdvanced: "settings.advanced",
  settingsData: "settings.data",
  settingsLogs: "settings.logs",
} as const;

export type SectionKey = (typeof SECTION_KEYS)[keyof typeof SECTION_KEYS];

/** 功能页的设置区默认收起；设置页首个板块（外观）默认展开。 */
export const SECTION_DEFAULT_OPEN: Record<SectionKey, boolean> = {
  "home.autoTurn": false,
  "solve.solving": false,
  "solve.ai": false,
  "bank.settings": false,
  "settings.appearance": true,
  "settings.advanced": false,
  "settings.data": false,
  "settings.logs": false,
};

export const SETTINGS_PAGE_SECTIONS: SectionKey[] = [
  SECTION_KEYS.settingsAppearance,
  SECTION_KEYS.settingsAdvanced,
  SECTION_KEYS.settingsData,
  SECTION_KEYS.settingsLogs,
];

export function isSectionOpen(
  states: Record<string, boolean> | undefined,
  key: SectionKey,
): boolean {
  return states?.[key] ?? SECTION_DEFAULT_OPEN[key];
}

export function toggleSection(
  controller: UiController,
  states: Record<string, boolean> | undefined,
  key: SectionKey,
): void {
  controller.saveSettings({ ui: { sectionStates: { [key]: !isSectionOpen(states, key) } } });
}

export function openSection(controller: UiController, key: SectionKey): void {
  controller.saveSettings({ ui: { sectionStates: { [key]: true } } });
}

export function setAllSections(
  controller: UiController,
  keys: SectionKey[],
  open: boolean,
): void {
  controller.saveSettings({
    ui: { sectionStates: Object.fromEntries(keys.map((key) => [key, open])) },
  });
}
