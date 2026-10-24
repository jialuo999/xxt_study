/**
 * 学习通章节树（#content1 #coursetree）。
 *
 * 真实页面结构（2026-10 实测）：
 * - `.posCatalog_select`：章节行，id 形如 `cur1226896752`；
 * - `.posCatalog_name`：可点击标题，原生 `onclick="getTeacherAjax(...)"`；
 * - `.orangeNew`：该章节待完成任务点数；0 表示无待完成；
 * - `.icon_Completed`：整章已完成；
 * - `.posCatalog_active`：当前章节。
 *
 * 这里只读目录并返回“下一个待完成章节”，不拼 URL、不调用私有接口；
 * 点击仍交给页面原生 `getTeacherAjax` 处理。
 */

export interface CatalogEntry {
  /** 行 id，例如 cur1226896752 */
  id: string;
  /** 去掉 cur 前缀的章节 id */
  chapterId: string;
  number: string;
  title: string;
  /** 待完成任务点数；没有 .orangeNew 时为 null */
  pending: number | null;
  completed: boolean;
  active: boolean;
  /** 分组行（下面还有子章节），不直接点击 */
  group: boolean;
  /** 可点击的原生标题节点 */
  target: HTMLElement;
  row: HTMLElement;
}

function text(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isHtmlElement(node: Node | null | undefined): node is HTMLElement {
  return Boolean(node && node.nodeType === 1);
}

function directChild(row: HTMLElement, className: string): HTMLElement | null {
  for (const child of Array.from(row.children)) {
    if (isHtmlElement(child) && child.classList.contains(className)) return child;
  }
  return null;
}

function findCatalogRoot(doc: Document): HTMLElement | null {
  try {
    return (
      doc.querySelector<HTMLElement>("#content1 #coursetree") ??
      doc.querySelector<HTMLElement>("#coursetree")
    );
  } catch {
    return null;
  }
}

function chapterIdFromHref(doc: Document): string {
  try {
    const url = new URL(doc.defaultView?.location.href ?? doc.URL);
    return url.searchParams.get("chapterId") ?? url.searchParams.get("knowledgeid") ?? "";
  } catch {
    return "";
  }
}

/** 读取章节树；页面没有目录时返回空数组 */
export function readCourseCatalog(doc: Document): CatalogEntry[] {
  const root = findCatalogRoot(doc);
  if (!root) return [];
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const row of Array.from(root.querySelectorAll<HTMLElement>(".posCatalog_select"))) {
    if (!row.id || seen.has(row.id)) continue;
    const name = directChild(row, "posCatalog_name");
    if (!name) continue; // 分组标题（.posCatalog_title）不可作为任务章节
    const title = text(name.getAttribute("title")) || text(name.textContent);
    if (!title) continue;
    const number = text(row.querySelector(".posCatalog_sbar")?.textContent);
    const pendingText = text(row.querySelector(".orangeNew")?.textContent);
    const pending = /^\d+$/.test(pendingText) ? Number(pendingText) : null;
    const completed = Boolean(row.querySelector(".icon_Completed"));
    const active = row.classList.contains("posCatalog_active");
    const anchor = row.closest("li");
    const level =
      anchor && isHtmlElement(anchor)
        ? Array.from(anchor.children).find(
            (child): child is HTMLElement =>
              isHtmlElement(child) && child.classList.contains("posCatalog_level"),
          )
        : undefined;
    const group = Boolean(level?.querySelector(".posCatalog_select"));
    seen.add(row.id);
    entries.push({
      id: row.id,
      chapterId: row.id.replace(/^cur/, ""),
      number,
      title,
      pending,
      completed,
      active,
      group,
      target: name,
      row,
    });
  }
  return entries;
}

/** 当前高亮章节 id（去掉 cur 前缀）；没有目录时返回空串 */
export function activeChapterId(doc: Document): string {
  try {
    const active = doc.querySelector<HTMLElement>(".posCatalog_select.posCatalog_active");
    return active?.id.replace(/^cur/, "") ?? "";
  } catch {
    return "";
  }
}

/** 跳过已完成/无待完成章节，返回当前章节之后第一个还需要学习的章节 */
export function findNextPendingChapter(doc: Document): CatalogEntry | null {
  const entries = readCourseCatalog(doc);
  if (entries.length === 0) return null;
  const currentId = activeChapterId(doc) || chapterIdFromHref(doc);
  const activeIndex = currentId
    ? entries.findIndex((entry) => entry.chapterId === currentId)
    : -1;
  const start = activeIndex >= 0 ? activeIndex + 1 : 0;
  for (let index = start; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.group) continue;
    if (entry.completed) continue;
    // .orangeNew 为 0 说明平台明确表示“无待完成任务点”，直接跳过；
    // 没有该标记时不能推断完成，保留为候选，避免漏掉真实待办。
    if (entry.pending !== null && entry.pending <= 0) continue;
    if (!entry.target.isConnected) continue;
    if (entry.target.hasAttribute("disabled")) continue;
    if (entry.target.getAttribute("aria-disabled") === "true") continue;
    return entry;
  }
  return null;
}
