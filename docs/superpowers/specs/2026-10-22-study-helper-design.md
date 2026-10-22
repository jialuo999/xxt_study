# 学习通 / 在线学习平台浏览器助手 — 设计文档

- 日期：2026-10-22
- 状态：已批准并实现（0.1.0）
- 交付：Tampermonkey 用户脚本 `dist/study-helper.user.js`

## 1. 目标

在学习通等平台注入现代化悬浮面板，提供自动翻页、题目识别与作答、本地题库检索、OpenAI 兼容 AI 解题，并支持「仅提示 / 复核后提交 / 全自动」三种模式。

成功标准：

- 单文件用户脚本安装即用，页面样式不受污染。
- 5 类题型可采集、填答、回读校验。
- 自动翻页跨越 ≥3 个章节/卡片，视频结束再翻页，刷新可恢复。
- 本地题库 1 万条：精确 <10ms，模糊 <50ms。
- AI 批量解题、JSON 容错、Key 脱敏；复核模式可逐题查看来源与置信度。
- 考试页默认禁用；不实现验证码绕过、视频进度伪造、反检测。

## 2. 关键决策

| 项 | 决策 |
| --- | --- |
| 交付 | Tampermonkey 用户脚本，Vite + TypeScript + Preact |
| 自动化 | 仅提示 / 复核后提交（默认）/ 全自动 |
| 题库 | 本地 IndexedDB 为主，可选通用 HTTP 远程题库 |
| 首版平台 | 学习通全量页面 + 通用配置适配器 |
| AI | OpenAI 兼容 Chat Completions，预置 DeepSeek |
| UI | Shadow DOM + 自建设计令牌，深/浅色、悬浮球 + 面板 |

## 3. 架构

```
Top frame (UI Host)
  Preact Panel (Shadow DOM)
  HostController: 状态机 / 帧聚合 / 解题 / 填答 / 提交 / 自动翻页
  AutoTurnRunner: 单步翻页 + 延迟 + 视频等待 + session 恢复
  Bank (IndexedDB) · Cache · Settings (GM) · Logs
        ▲ postMessage（origin + token + schema 校验）
Child frames
  FrameAgent: collectQuestions / fillAnswer / submit / observe
```

- 每个匹配帧注入脚本；只有最上层同源窗口挂载 UI，其余为 agent。
- 子帧通过 `postMessage` 发送 `HELLO / QUESTIONS / FILLED / SUBMIT_RESULT`；宿主用 `WELCOME` 下发一次性 token 与 `COLLECT / FILL / SUBMIT / NEXT`。
- 所有外部请求走 `GM_xmlhttpRequest`，`@connect *` 支持自定义 AI/题库域名。
- 页面跳转由 URL 轮询 + MutationObserver 双重感知。

## 4. 模块

| 模块 | 职责 |
| --- | --- |
| `core` | 类型、设置、GM 封装、日志、帧消息 |
| `platform/chaoxing` | 路由识别、题目采集、填答、提交、下一节、视频等待 |
| `platform/generic` | 配置驱动的通用适配器 |
| `bank` | 导入、规范化、精确/模糊索引、缓存、远程题库 |
| `ai` | Provider、Prompt、JSON 解析与修复、批量与重试 |
| `solver` | 缓存 → 题库 → 远程 → AI → 人工 的优先级流水线 |
| `app` | HostController、FrameAgent、AutoTurnRunner、启动 |
| `ui` | Preact 面板、页面、组件、主题 |

## 5. 数据模型

```ts
type QuestionType = "single" | "multiple" | "judge" | "fill" | "short" | "unknown";

interface Question {
  id: string;
  type: QuestionType;
  stem: string;
  options: { key: string; text: string }[];
  blankCount?: number;
  hasImage: boolean;
  frameId: string;
  index: number;
}

type AnswerValue =
  | { kind: "choice"; keys: string[]; texts?: string[] }
  | { kind: "judge"; value: boolean }
  | { kind: "fill"; values: string[] }
  | { kind: "text"; text: string };

interface SolveResult {
  questionId: string;
  answer: AnswerValue | null;
  confidence: number;
  source: "bank-exact" | "bank-fuzzy" | "remote" | "ai" | "manual";
  status: "solved" | "pending" | "failed";
  explanation?: string;
  latencyMs: number;
  costTokens?: number;
}
```

设置版本化（`version: 1`），涵盖 UI、自动翻页、答题模式、AI、题库/远程、高级配置。默认：复核模式、考试关闭、自动提交关闭、最低置信度 0.6、模糊阈值 0.86、翻页延迟 2–5s。

## 6. 关键流程

**自动翻页**：页面识别 → 恢复 session → 检查未答题目 → 等待视频/音频结束 → 随机延迟 → 点击下一节 → 校验 URL → 循环；重复页面/达到最大步数/按钮失效时停止。支持开始前延迟、刷新恢复、无媒体内容等待。

**媒体播放**：每个 frame 应用默认静音与倍速；平台重置倍速后定时重新断言。跨 frame 通过 `MEDIA_STATE`/`RESUME_MEDIA` 汇总状态并请求恢复，视频/音频结束后才翻页。暂停恢复只在自动翻页等待媒体结束时生效。只调整 `muted`/`playbackRate`/`play()`，不伪造进度。

**作业答题**：采集/子帧回报 → 去重 → 缓存 → 题库精确/模糊 → 远程 → AI → 置信度门禁 → 面板复核 → 按帧分组填入 → 回读校验 → 提交（可选自动确认）。

**全自动**：仅在显式开启后生效；填完校验通过后提交；低置信度、验证码、页面异常、提交失败立即暂停。

- 自动翻页：`autoTurn` 支持 `startDelayMs`、`resumeOnReload`、`contentWaitMs`。
- 视频/音频：`video` 支持 `defaultMuted`、`playbackRate`、`resumeOnPause`；只操作媒体元素，暂停恢复仅限自动翻页等待期间。
- 首页只允许 top frame 挂载 UI，子 frame 一律作为 agent，避免跨域 iframe 出现多个悬浮球。

## 7. 错误与边界

- iframe 跨域：子帧 agent + `postMessage`；失败重试后标记失效。
- 选择器失效：候选数组 + 文本兜底；日志记录；通用配置适配器作为逃生口。
- 选项乱序：按选项文本相似度映射，不按位置。
- 含图/公式：转人工，不送纯文本模型。
- AI JSON 非法：修复重试一次；仍失败转人工。
- 429/超时：指数退避；错误脱敏；不阻塞其他题。
- 视频自动播放被拦截：暂停翻页并提示手动播放。
- 提交确认弹窗：仅在点击提交期间临时包装 `unsafeWindow.confirm`，`finally` 恢复。
- 提交结果未知：15s 超时标记「状态未知」，禁止自动重复提交。
- 验证码/风控：立即暂停全部自动化。

## 8. 安全与合规

- Key 仅存 GM storage，输入掩码，日志/错误/导出统一脱敏。
- 无遥测；仅请求用户配置的 AI/题库地址。
- 默认人工复核；考试需二次确认；不做验证码绕过、视频进度伪造、反检测。
- README 与首启弹窗展示免责声明。

## 9. 测试

- Vitest + jsdom。
- 单元：文本归一化、哈希、答案映射、相似度、CSV/JSON 解析、AI JSON 修复、远程模板、设置合并、帧协议。
- DOM：5 类题采集、选项乱序、判断同义词、多空填空、提交按钮、下一节、页面识别。
- 手动：真实学习通页面 3 章节翻页、1 份作业全流程、题库导入、AI 测试、刷新恢复。

## 10. 风险

- 学习通 DOM 多版本变化：候选选择器 + 真实页面回归；必要时快速修补选择器。
- 平台风控/协议风险：默认复核、限速、考试门禁、不做反检测。
- AI 幻觉：题库优先、选项合法性校验、低置信度转人工。
- 大题库性能：5 万条上限、懒加载索引、精确哈希优先。
- 用户 Key 安全：GM 存储 + 脱敏 + 不写日志。

## 11. 里程碑

M0 脚手架 → M1 UI 骨架 → M2 自动翻页 → M3 题目采集/填答 → M4 题库 → M5 AI/流水线 → M6 自动提交/考试门禁 → M7 通用适配器/文档 → M8 真实页面验收/打包。

## 12. 第三方参考

选择器思路参考 MIT 项目 [CodFrm/cxmooc-tools](https://github.com/CodFrm/cxmooc-tools)，未复制源码；完整出处与许可见 `THIRD_PARTY_NOTICES.md`。
