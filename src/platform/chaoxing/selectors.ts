/**
 * 学习通（Chaoxing）选择器候选集。
 *
 * 选择器思路参考 https://github.com/CodFrm/cxmooc-tools （MIT License），
 * 本项目为独立实现，未复制其源码；候选数组顺序即优先级，每个选择器都会做
 * 独立的 try/catch，避免某个选择器失效影响整体采集。
 */

/** 学习通主域（mooc1 / mooc2-ans / i / passport 等子域） */
export const CHAIXING_HOST_SUFFIX = "chaoxing.com";

/** 题目容器候选（合并选择器，保证返回顺序为文档顺序） */
export const QUESTION_CONTAINER_SELECTOR = ".TiMu, .questionLi, [data-questionid]";

/** 题目容器候选（逐条兜底，合并选择器失效时使用） */
export const QUESTION_CONTAINER_SELECTORS = [".TiMu", ".questionLi", "[data-questionid]"] as const;

/** 题干候选 */
export const STEM_SELECTORS = [
  ".Zy_TItle > .clearfix",
  ".Zy_TItle .clearfix",
  ".Cy_TItle .clearfix",
  ".mark_name",
  ".qtContent",
] as const;

/** 题型标签候选（这些元素的文本通常就是【单选题】之类） */
export const TYPE_LABEL_SELECTORS = [".mark_name", ".question-type", ".type_txt", ".newZy_TItle"] as const;

/** 标题行候选（题型标签可能内嵌在【】中） */
export const TITLE_SELECTORS = [".Zy_TItle", ".Cy_TItle", ".qtContent"] as const;

/** 选项行候选（无原生 input 的文本型选项） */
export const OPTION_SELECTORS = [
  ".Zy_ulTk li",
  ".clearfix > ul li",
  "ul li",
  ".answerBg",
  ".answer_p",
  "label",
] as const;

/** 选项内部的原生 input 候选 */
export const OPTION_INPUT_SELECTORS = ["input[type='radio']", "input[type='checkbox']"] as const;

/** 选项行宿主（用于从 input 反查整行元素） */
export const OPTION_HOLDER_SELECTOR = "li, label, .answerBg, .answer_p, .answer, .option, .clearfix";

/** 填空输入框候选 */
export const BLANK_SELECTORS = [
  ".XztiHover1 input",
  ".XztiHover1 textarea",
  "input.inp",
  "input[type='text']",
  "textarea",
  ".blank input",
  ".blank textarea",
  "input:not([type])",
] as const;

/** 简答/富文本输入候选 */
export const TEXT_INPUT_SELECTORS = [
  ".edui_body [contenteditable='true']",
  "[contenteditable='true']",
  "[contenteditable='']",
  ".ql-editor",
] as const;

/** 提交按钮候选（#tempsave 在部分版本是“暂存”，放到最后，避免误点） */
export const SUBMIT_BUTTON_SELECTORS = [
  ".Btn_blue_1",
  ".bluebtn",
  ".completeBtn",
  "#submitbtn",
  ".subBnt",
  "button[type='submit']",
  "input[type='submit']",
  "#tempsave",
] as const;

/** 提交按钮文本关键字（按优先级） */
export const SUBMIT_TEXT_KEYWORDS = [
  "提交作业",
  "提交答案",
  "交卷",
  "保存并提交",
  "提交试卷",
  "提交",
] as const;

/** 提交后结果文本关键字 */
export const RESULT_TEXT_KEYWORDS = ["提交成功", "交卷成功", "成绩", "已完成", "已提交"] as const;

/** 下一节/下一章导航候选 */
export const NEXT_SELECTORS = [
  "#prevNextFocusNext",
  ".orientationright",
  ".nextChapter",
  "span.currents ~ span",
  ".prev_next.next",
  ".nextBtn",
  "#next",
] as const;

/** 下一节文本关键字 */
export const NEXT_TEXT_KEYWORDS = ["下一节", "下一章", "下一页", "下一题"] as const;

/** 视频元素候选 */
export const VIDEO_SELECTORS = ["#video_html5_api", "video"] as const;

/** 章节页 iframe 候选 */
export const CHAPTER_IFRAME_SELECTORS = ["#iframe", "iframe#iframe", ".chapter iframe"] as const;

/** 知识卡片标记 */
export const CARDS_MARKERS = [".knowledge-card", ".card_list", ".cardItem", "[data-card]", "#knowledge"] as const;

/** 章节页标记（DOM 兜底） */
export const CHAPTER_MARKERS = ["#prevNextFocusNext", ".orientationright", ".nextChapter", "#chapterList"] as const;

/** 页面路由规则：URL 命中即判定页面类型 */
export interface RouteRule {
  kind: "chapter" | "cards" | "video" | "homework" | "exam";
  pattern: RegExp;
  reason: string;
}

export const ROUTE_RULES: readonly RouteRule[] = [
  {
    kind: "video",
    pattern: /\/ananas\/modules\/video\//i,
    reason: "URL 命中视频模块 /ananas/modules/video/",
  },
  {
    kind: "cards",
    pattern: /\/knowledge\/cards/i,
    reason: "URL 命中知识卡片 /knowledge/cards",
  },
  {
    kind: "chapter",
    pattern: /\/mycourse\/studentstudy/i,
    reason: "URL 命中章节学习 /mycourse/studentstudy",
  },
  {
    kind: "exam",
    pattern: /\/exam-ans\/exam\/test\/|reVersionTestStartNew|reVersionPaperMarkContentNew|\/exam\/test\//i,
    reason: "URL 命中考试路由 /exam-ans/exam/test/",
  },
  {
    kind: "homework",
    pattern: /\/work\/doHomeWorkNew|\/work\/selectWorkQuestionYiPiYue|\/mooc2\/work\/dowork/i,
    reason: "URL 命中作业路由 /work/doHomeWorkNew",
  },
];

/** 章节测验 URL 特征（学习通章节测验常复用作业路由，需要配合标题判断） */
export const QUIZ_URL_PATTERN = /quiz|chapterquiz|chapter-quiz/i;

/** 章节测验标题特征 */
export const QUIZ_TITLE_PATTERN = /章节测验|单元测验|随堂测验/;
