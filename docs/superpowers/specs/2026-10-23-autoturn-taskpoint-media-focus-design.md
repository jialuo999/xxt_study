# 任务点重复、视频重播与播放器聚焦修复 — 设计文档

- 日期：2026-10-23
- 状态：已批准并实现
- 范围：`src/app/frames.ts`、`src/app/agent.ts`、`src/app/autoturn.ts`、`src/app/host.ts`、`src/app/media-preferences.ts`、`src/platform/chaoxing/next.ts`、`src/core/types.ts`、README
- 触发：用户日志 `study-helper-logs-1792685043761.txt` 与反馈「已完成任务点重复执行」「视频播完不翻页反而重播」「部分页面要求鼠标聚焦视频」

## 1. 现象与根因

### 1.1 视频播完不翻页、反而重播

学习通播放器（`videojs`）结束后可能立即循环/自动播放下一段。原判断是**瞬时**读取 `ended` 或 `duration - currentTime <= 1`：

- 主 frame 的 `waitForMedia` 每秒轮询一次，循环发生在两次轮询之间时永远看不到结尾；
- 子 frame 的 `MEDIA_STATE` 每秒上报一次，`ended` 事件触发时播放器可能已经把 `currentTime` 重置为 0；
- 结果自动翻页一直等待，视频反复播放。

### 1.2 已完成任务点重复执行

- 自动翻页只点击一次「下一节」，默认认为成功，不校验任务点是否真的切换；
- 顶层章节页 URL 在任务点切换时通常不变，原重复检测只比较顶层 URL；
- 已完成任务点没有识别（学习通任务点父级类名 `.ans-job-finished`），平台可能仍加载并重播。

### 1.3 播放器要求鼠标聚焦

部分播放器需要视频区域获得焦点/鼠标悬停后才允许 `play()`、倍速或恢复播放；原实现直接调用 `play()`，容易被拒绝后判定 blocked。

### 1.4 frame id 冲突

原 `frameId()` 使用 `sessionStorage`。同源嵌套 iframe 共享 sessionStorage，多个 frame 会拿到同一个 id，Host 侧互相覆盖，媒体/任务状态混乱。

## 2. 修复方案

### 2.1 媒体完成状态改为“锁存”

- 子 frame agent 维护 `WeakMap<media, {src, duration}>`：一旦看到 `ended` 或距结尾 ≤1 秒，就记录完成；
- `src`/`duration` 变化（切换分段/新视频）时清除记录，继续等待；
- 增加 `timeupdate` 监听（500ms 节流），捕捉轮询间隙的结尾；
- 主 frame `waitForMedia` 采用同样的锁存逻辑，并在判定完成后等待 1.2 秒再确认；
- 跨 frame 的 `waitForExternalMedia` 要求 `allEnded` 稳定 1.5 秒，再翻页。

### 2.2 已完成任务点跳过

- 子 frame 检测 `.ans-job-icon` 的父级 `.ans-job-finished`，上报 `currentTaskFinished` / `allTasksFinished`；
- Host 汇总后，自动翻页在任务点已完成时跳过媒体等待，直接进入翻页流程，避免平台自动重播；
- `MediaState` 增加两个可选字段，旧消息/旧测试不受影响。

### 2.3 翻页必须“看得见变化”

- Host 新增 `getTaskSignature()`：顶层 URL + 子 frame URL（去掉 `_dc` 等缓存参数，保留 jobid/knowledgeId/chapterId 等）+ frame 类型/标题 + 当前 `.currents` 文本；
- 自动翻页点击后最多等待 4 秒，签名变化才计为一步；
- 未变化时最多再尝试 2 个候选按钮（`nextPage` 内部用 WeakSet 记住已点击元素，重试时跳过）；
- 仍无变化则停止并提示，不再循环执行同一个任务点；
- `visited` 改用任务签名，避免顶层 URL 不变导致误判。

### 2.4 聚焦播放器

- 新增 `focusMedia()`：设置 `tabIndex`、`focus()`，并派发 `mouseover` / `mouseenter` / `mousemove`；
- 自动翻页恢复播放、子 frame `resumeMedia` 前调用；
- `play()` 失败后尝试点击视频区域再播放一次，仍未成功才判定 blocked。

### 2.5 frame id 唯一

- 改为在每个 window 的全局对象上生成并保存 `__studyHelperFrameId`；
- 顶层仍为 `top`；同源嵌套 frame 各自独立，避免 Host 状态互相覆盖。

## 3. 验证

- 新增 `tests/unit/autoturn.test.ts`：签名变化才计步；无变化点击 3 次候选后停止。
- `waitForMedia` 新增“播放结束后立即循环仍能识别完成”测试。
- `nextPage` 新增“重复尝试跳过已点击候选”测试。
- `focusMedia` 新增焦点与鼠标事件测试。
- 全量 typecheck / test / build 通过。
