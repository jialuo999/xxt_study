import { beforeEach, describe, expect, it } from "vitest";
import {
  activeChapterId,
  findNextPendingChapter,
  readCourseCatalog,
} from "../../src/platform/chaoxing/catalog";
import { nextPage } from "../../src/platform/chaoxing/next";
import type { PageContext } from "../../src/platform/types";
import treeHtml from "../fixtures/chaoxing/course-tree.html?raw";

function mountTree(): void {
  document.body.innerHTML = treeHtml;
}

function makeChapterContext(): PageContext {
  return {
    doc: document,
    win: window,
    url: new URL(
      "https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1226896752&courseId=266326215&clazzid=152603200",
    ),
    page: {
      kind: "chapter",
      url: "https://mooc1.chaoxing.com/mycourse/studentstudy",
      title: "学生学习页面",
      supported: true,
    },
    frameId: "top",
  };
}

describe("course catalog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.title = "";
    // fixture 里的 onclick 是学习通原生入口；测试中提供一个空实现，避免 jsdom 抛错
    (window as unknown as { getTeacherAjax?: () => void }).getTeacherAjax = () => undefined;
  });

  it("读取真实结构的章节树，识别完成/待完成/当前章节", () => {
    mountTree();
    const entries = readCourseCatalog(document);
    expect(entries.map((entry) => entry.chapterId)).toEqual([
      "1226896752",
      "1226896754",
      "1226896755",
      "1226896757",
      "1226896759",
    ]);
    expect(entries.find((entry) => entry.active)?.chapterId).toBe("1226896752");
    expect(entries.find((entry) => entry.chapterId === "1226896755")?.completed).toBe(true);
    expect(entries.find((entry) => entry.chapterId === "1226896754")?.pending).toBe(2);
    expect(activeChapterId(document)).toBe("1226896752");
  });

  it("从当前章节之后跳过已完成/无待完成章节，返回下一待完成章节", () => {
    mountTree();
    const next = findNextPendingChapter(document);
    expect(next?.chapterId).toBe("1226896754");
    expect(next?.title).toBe("动生电动势");
  });

  it("当前章节本身已完成时继续向后找", () => {
    mountTree();
    document.querySelector("#cur1226896752")?.classList.remove("posCatalog_active");
    document.querySelector("#cur1226896755")?.classList.add("posCatalog_active");
    const next = findNextPendingChapter(document);
    // 3.4 的 orangeNew=0 表示无待完成，应跳到 3.5
    expect(next?.chapterId).toBe("1226896759");
  });

  it("后面没有待完成章节时返回 null", () => {
    mountTree();
    document.querySelector("#cur1226896752")?.classList.remove("posCatalog_active");
    document.querySelector("#cur1226896759")?.classList.add("posCatalog_active");
    expect(findNextPendingChapter(document)).toBeNull();
  });

  it("nextPage 优先点击章节树中的下一待完成章节（跳过已完成）", async () => {
    mountTree();
    const clicked: string[] = [];
    for (const name of Array.from(document.querySelectorAll<HTMLElement>(".posCatalog_name"))) {
      // jsdom 不会执行真实页面的内联 getTeacherAjax；移除后只验证点击目标
      name.removeAttribute("onclick");
      name.addEventListener("click", () => {
        clicked.push(name.getAttribute("title") ?? name.textContent?.trim() ?? "");
      });
    }
    const result = await nextPage(makeChapterContext());
    expect(result.ok).toBe(true);
    expect(result.action).toBe("catalog:1226896754");
    expect(clicked).toEqual(["动生电动势"]);
  });

  it("目录中没有待完成章节时返回明确结果，不误点已完成章节", async () => {
    mountTree();
    document.querySelector("#cur1226896752")?.classList.remove("posCatalog_active");
    document.querySelector("#cur1226896759")?.classList.add("posCatalog_active");
    const result = await nextPage(makeChapterContext());
    expect(result.ok).toBe(false);
    expect(result.action).toBe("catalog-end");
    expect(result.message).toContain("没有待完成");
  });
});
