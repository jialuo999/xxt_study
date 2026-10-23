# 同页多任务点顺序播放 — 设计文档

- 日期：2026-10-23
- 状态：已实现
- 范围：`src/app/task-points.ts`、`src/app/agent.ts`、`src/app/host.ts`、`src/app/autoturn.ts`、`src/core/types.ts`、`tests/unit/*`
- 触发：用户反馈「单个页面多个媒体时视频播放有问题，一会儿放一会儿往前拉；能不能从上到下一个个放，并结合任务点是否完成判断」；此前日志显示同一章节页连接了 3 个 `video` frame。

## 1. 问题

旧逻辑对同页所有子 frame 的媒体做汇总：

- `getChildMediaState()` 把所有 frame 的 `hasMedia/allEnded/anyPaused` 合并；
- `resumeChildMedia()` 对**所有**子 frame 发 `RESUME_MEDIA`，多个视频会同时开始播放；
- `waitForExternalMedia()` 等待所有 frame 的媒体全部结束，主播放器选择又基于“正在播放/可见面积”，播放器之间会互相抢焦点/进度，表现为播放一会就切走或跳进度。

同时，旧逻辑只在整章 `.ans-job-finished` 全部完成时跳过等待，没有“当前该播第几个任务点”的概念。

## 2. 方案

### 2.1 任务点顺序（内容 frame）

新增 `src/app/task-points.ts#collectTaskPointState(doc)`：

- 读取 `.ans-job-icon` 的父级：带 `.ans-job-finished` 视为已完成；
- 按 DOM 顺序（页面从上到下）返回第一个未完成、且带 iframe 的任务点：
  `nextTaskUrl`、`nextTaskIndex`、`taskTotal`；
- 同时保留 `currentTaskFinished` / `allTasksFinished`；
- 只读 DOM，不点击、不播放。

内容 frame 的 `FrameAgent` 在每秒的 `MEDIA_STATE` 中附带上述字段；视频子 frame 没有任务点标记，因此只有内容 frame 会上报任务顺序。

### 2.2 Host 选择播放目标

新增 `getMediaPlaybackTarget()`：

- 从最近 3.5 秒的 `MEDIA_STATE` 中找到带任务点信息的内容 frame；
- `allTasksFinished` → 返回“全部完成”，自动翻页直接跳过媒体等待；
- 否则用 `nextTaskUrl` 匹配已连接子 frame：
  - 先按 `taskUrlKey`（origin + path + jobid/knowledgeId/chapterId 等）匹配；
  - 再按 `jobid` / `objectid` 兜底；
- 返回 `frameId`、任务序号、总数、该 frame 的媒体状态。

新增 `activateMediaFrame(frameId)`：

- 只向目标子 frame 发 `RESUME_MEDIA`；
- 向其他所有子 frame 发 `PAUSE_MEDIA`，保证同一时间只播一个任务点。

### 2.3 自动翻页顺序等待

`AutoTurnRunner` 有任务目标时不再走通用 `waitForExternalMedia`，改为 `waitForTaskMedia()`：

1. 目标 frame 未连接 → 最多等 8 秒；
2. 目标 frame 未上报媒体 → 最多等 10 秒后按已完成处理（阅读类任务点）；
3. 每次目标变化时只激活当前 frame；目标 paused 时按设置重试恢复，8 秒后提示手动播放；
4. 当前视频结束后等待任务点写入 `.ans-job-finished`；20 秒仍未标记则停止并提示，**不直接翻页**，避免跳过后续任务点；
5. 内容 frame 上报下一个 `nextTaskUrl` 后自动切到下一个任务点；全部完成或没有目标时结束等待，再翻页。

任务点信息不足（通用平台、iframe 未匹配、DOM 变化）时回退到“按子 frame 连接顺序逐个播放”：

- 只选择当前未结束、未标记完成的子 frame；
- 只恢复该 frame，其他 frame 不主动发 `PAUSE`；
- 目标切换时才暂停上一个目标，避免每 4 秒对所有 frame 发一次暂停/恢复造成视频抖动；
- 全部子 frame 都结束后再翻页。

这样即使 `.ans-job-icon` / iframe URL 匹配失败，也不会回到“所有视频一起恢复”的旧行为。

### 2.4 抖动修复

上一版 `activateMediaFrame()` 在每次自动翻页轮询中都向所有其他子 frame 发 `PAUSE_MEDIA`，并在暂停重试时反复恢复，导致正在播放的视频被周期性暂停/恢复。现在：

- 只有目标 frame 变化时才暂停上一个目标；
- 已播放中的目标只接收 `RESUME_MEDIA`（agent 发现没暂停就什么都不做）；
- 暂停重试最多 1.5 秒一次，不再向非目标 frame 发指令。


## 3. 非目标

- 不自动点击任务点/不滚动页面；
- 不修改视频进度，不伪造观看时长；
- 不改变单视频页的等待行为（仍按主播放器等待）。

## 4. 验证

- 新增 `tests/unit/task-points.test.ts`：按 DOM 顺序选择、跳过已完成、跳过无 iframe、无任务点；
- `tests/unit/autoturn.test.ts`：多任务点时依次激活 `frame-a` → `frame-b`，且不会同时恢复；
- 现有媒体/单视频测试保持通过；
- `npm run typecheck`、`npm test`、`npm run build` 通过。

调试日志可查看：

- `媒体播放目标`：`source: "tasks" | "frames"`，判断走的是任务点顺序还是 frame 兜底；
- `开始播放第 N/M 个任务点/视频`：实际激活顺序；
- `任务点视频结束，等待任务点完成标记`：是否在等平台写回完成状态。

## 5. 风险与后续

- 任务点 iframe 的 URL 可能与子 frame 实际 URL 不同（随机参数）；已用 `taskUrlKey` + `jobid` 兜底，仍无法匹配时回退旧逻辑并记录日志。
- 阅读类任务点没有媒体，当前只跳过等待，不主动点击；如平台要求打开/滚动才会标记完成，需要在后续版本增加受控的 `scrollIntoView`。
- 真实页面 DOM 可能与公开结构不同；建议在调试模式日志中确认 `按任务点顺序等待第 N/M 个任务点` 与 `开始播放第 N 个任务点`。
