# 阅读/文档任务与“跳过已完成”修复 — 设计文档

- 日期：2026-10-24
- 状态：已实现
- 基线：`73a4a63`
- 触发：用户反馈「本项目适配了 PDF/文字阅读模块吗」+「跳转功能还有问题，跳过已完成和跳过当前页面的多个媒体中的已完成」；同时提供了真实学习通页面保存文件（`E:\download\学生学习页面.html` 与 `学生学习页面_files`）作为 DOM 样本。

## 1. 真实页面结论

从保存页的 `cards.html` / `index(2).html` / `file.html` 与顶层 `学生学习页面.html` 确认：

1. **任务点权威数据在 `window.mArg.attachments` / `window.attachments`**：
   - 视频任务点：`job:true` 表示未完成，`isPassed:true` 表示已完成；
   - 非任务点 PDF：没有 `job`/`isPassed`，即使 `property.module=insertdoc` 也不应计入任务点；
   - 视频 iframe 的 `data` 里有 `jobid`/`_jobid`/`mid`；PDF iframe 的 `data` 只有 `_jobid`/`mid`。
2. **完成标记在 `.ans-attach-ct` 容器上**（`.ans-job-finished`），不在 `.ans-job-icon` 自身；PDF 附件没有 `.ans-job-icon`，旧逻辑完全识别不到阅读任务。
   - 同页多个视频 iframe 的 URL 完全相同（都是 `/ananas/modules/video/index.html`），`jobid` 只在 iframe 属性/`data` 上，子 frame 的 `location.href` 不含 jobid。原逻辑按 URL 匹配会挑到“最近连接”的 frame，可能正好是已完成任务点。因此子 frame 现在把 `window.frameElement` 的 `jobid`/`mid` 随 `HELLO`/`STATE` 上报，Host 用 `jobid` 精确选择播放目标。
3. **文档阅读页是三层 iframe**：
   `cards` 内容 frame → `ananas/modules/pdf` 文档模块（含 `#panView`）→ `pan-yz.chaoxing.com` 文档页（`file.html`）。
   文档页滚动到底会 `parent.postMessage({isFinished:1})`；文档模块收到后调用自己的 `finishJob()`，平台再把 `.ans-job-finished` 写回任务点。因此脚本只需要真实滚动，不能自己写完成状态。
4. **章节树**：顶层 `#content1 #coursetree`，`.posCatalog_select` 行 id 为 `cur<chapterId>`，`.posCatalog_name` 带原生 `onclick="getTeacherAjax(...)"`；`.orangeNew` 是待完成任务数，`.icon_Completed` 是整章已完成，`.posCatalog_active` 是当前章节。
5. 用户截图是 `file.html` 文档预览页（标题 `大科学家法拉第…….pdf`），底部缩放条与 `#fileInfoNameInput` 可唯一识别；该 PDF 在当前课程里是**非任务点附件**，所以不能仅凭页面外观就强行判为任务点。

## 2. 方案

### 2.1 任务点模型（R4.9/R4.10）

`src/app/task-points.ts` 重写为三层数据源：

1. `attachments`（优先）：按 iframe `data` 的 `jobid`/`_jobid`/`mid` 对齐，输出 `jobid`、`module` 映射的 `kind`（media/read/doc/ppt/quiz/link/unknown）、`name`；
2. `.ans-attach-ct` + iframe `data`：真实页面完成标记在容器上，兼容 `ans-job-finished` 在祖先/内部；
3. `.ans-job-icon`：旧版/简化页面兜底。

任务点判定：

- `attachment.job === true`（未完成）或 `attachment.isPassed === true`（已完成）→ 任务点；
- 只有 `module`、没有 `job`/`isPassed` → 非任务点附件（如保存页中的两个 PDF）；
- 没有 `attachments` 时，有 `.ans-job-icon` 即任务点。

只返回任务点快照；`allTasksFinished` 只在任务点全部完成时为真；`currentTaskFinished` 改为与 `allTasksFinished` 一致，避免“任意一个已完成任务点”导致整页跳过等待。

### 2.2 目标选择与跳过已完成（R4.2/R4.10）

`src/app/media-target.ts`：

- 目标增加 `kind`、`taskId`、`taskName`、`ownerFrameId`；
- `findChildForTask` 优先按 `taskId` 匹配子 frame 上报的 `jobid`，再按 URL key，最后 `jobid`/`objectid` 兜底；同 URL 多个视频不再选错；
- 阅读/文档任务没有可握手子 frame 时，返回 `frameId:null` 但保留 `ownerFrameId`，由内容 frame 找到附件 iframe；
- 兜底按 `children` 顺序时，只允许当前任务点快照里出现过的 URL，并过滤已完成 URL，避免上一章节残留 video frame（没有 `chapterId`）被误播；
- `pinActiveMediaTarget` 增加任务点快照检查：当前活动 iframe 对应任务已完成/不在当前快照时立即放开固定。

### 2.3 章节树跳转（R4.1）

新增 `src/platform/chaoxing/catalog.ts`：

- `readCourseCatalog` 读取 `#content1 #coursetree` 的 `.posCatalog_select`，解析 `.posCatalog_name`、`.orangeNew`、`.icon_Completed`、`.posCatalog_active`；
- `findNextPendingChapter` 从当前章节之后找第一个非分组、未完成、待完成数 > 0 的章节；
- `next.ts` 优先点击该章节的 `.posCatalog_name`（保留页面原生 `getTeacherAjax`），跳过已完成/无待完成章节；目录不可用时回退原「下一节」按钮；目录没有待完成章节时返回 `catalog-end`。

### 2.4 阅读/文档/PPT 自动化（R4.2）

- 消息：`READER_TASK` / `READER_STOP`（`core/messages.ts`）；
- `host.startReadingTask(target)` 把任务下发给 `ownerFrameId`（内容 frame）；
- `reader-agent.ts` 在每个 frame 运行：
  - 有 `jobid` 时匹配附件 iframe 并继续转发；
  - 文档模块外层（`#panView`/`#wpsView`）继续转发；
  - 文档页（`#fileInfoNameInput`/`.fileBox`）真实滚动 window 到底；PPT `.swiper-container` 翻页；`#ReadWeb`/`#img.imglook`/`#reader` 优先滚正文容器；
  - `READER_STOP` 停止滚动并继续向下转发；
- `autoturn.waitForTaskMedia` 识别 `read/doc/ppt`：
  - 首次下发一次阅读指令，不重复；
  - 只有任务点快照变为已完成/切换到下一个任务点才返回 `done`；
  - 10 分钟未完成返回 `stalled`，暂停并提示人工，绝不按“无媒体 10 秒”误判完成；
  - 关闭 `autoTurn.readingAuto` 时直接暂停提示。

### 2.5 可观测性

- 诊断包增加章节树、任务点、阅读/文档选择器命中矩阵；
- `MediaState.tasks` 里任务点 URL 继续脱敏；
- 日志记录阅读指令下发、阅读页滚动开始/结束、任务点快照选择来源。

## 3. 非目标与安全边界

- 不调用学习通 `finishJob()` / `/mooc-ans/job/document` 等“直接完成任务”接口；
- 不伪造视频进度、不 seek、不修改播放时长；
- 不识别/绕过验证码；
- 阅读自动化默认开启，但只对识别到的任务点生效；非任务点 PDF（如用户截图）不会被强行“完成”。

## 4. 验证

- `tests/unit/task-points.test.ts`：attachments 优先、非任务点 PDF 忽略、阅读任务无 icon、已完成阅读任务；
- `tests/unit/media-target.test.ts`：阅读任务无子 frame 时保留 owner、兜底过滤残留 frame；
- `tests/unit/catalog.test.ts`：真实章节树结构、跳过已完成/无待完成、目录结束；
- `tests/unit/autoturn.test.ts`：阅读任务下发一次、未完成不误判、完成后才翻页；
- `tests/unit/reader-agent.test.ts`：文档页/文档模块外层/PPT/正文滚动目标、jobid 匹配；
- `npm run typecheck`、`npm run test:sandbox`、`npm run build`。

## 5. 风险

- 学习通可能改版 `#coursetree` 或阅读器结构；已保留旧按钮回退与 DOM 兜底，失败时暂停而不是误跳；
- 文档页跨域（pan-yz）只能通过逐层 postMessage，若平台改成 closed shadow DOM/Canvas 阅读器则无法滚动，需要人工；
- 阅读任务自动滚动速度/时长需要在真实页面回归；10 分钟超时是保护值，可按日志调整；
- `mArg`/`attachments` 是平台内部全局变量，读取失败时自动降级到 DOM，不写入、不依赖它发请求。
