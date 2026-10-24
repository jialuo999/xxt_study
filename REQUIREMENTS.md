# 学习助手 · 需求与回归清单

> 这份文件记录用户提出过的所有要求。每次改代码前后都对照本表检查，避免修一个功能把另一个功能弄坏。
> 状态更新时间：2026-10-24。

## 使用方式

1. 改动前：找到对应需求，确认现有实现与测试；
2. 改动后：至少运行 `npm run typecheck`、`npm test`、`npm run build`；
3. 涉及媒体/翻页的改动，还要检查「多任务点顺序」「跳过已完成」「不抖动」三条；
4. 修完在提交信息里写清楚影响的需求编号。

## 需求清单

### R1. 功能与设置同区（已实现）

- 答题/AI 设置放在「答题」；自动翻页/媒体设置放在「主页」；题库设置放在「题库」；
- 「设置」只保留外观、快捷键、高级适配器、数据隐私、运行日志；
- 示例要求：设置里的「答题」必须放进答题 Tab，不能两处都能改。

实现：`src/ui/pages/*`、`src/ui/sections.ts`、`src/ui/panels/*`、`tests/dom/ui-layout.test.ts`。

### R2. 字体反爬解码（已实现）

- 题干/选项在 DOM 里是乱码（`font-cxsecret`）时，必须还原后再送题库/AI；
- 支持内联 base64、CSSOM `@font-face`、同源父页面/子 iframe 字体；
- 字体晚加载时重新采集。

实现：`src/platform/chaoxing/font/*`、`tests/unit/font-decoder.test.ts`。

### R3. 人机验证（9010）只在实际出现时提示（已实现）

- 正常页面不得提示“需要人机验证”；
- 只读取可见 light DOM，排除隐藏弹层、`script/style`、Shadow DOM 面板；
- 必须同时看到可见验证码输入框/图片，`【9010】` 是强特征；
- 检测到后暂停自动翻页，不识别/不绕过验证码；
- 日志带 `[verify]` 和命中原因。

实现：`src/platform/chaoxing/verification.ts`、`src/app/host.ts`、`src/ui/App.tsx`、`tests/unit/verification.test.ts`。

### R4. 同页多个媒体/任务点（核心，持续回归）

用户原话：“单个页面多个媒体的时候视频播放还是有问题……直接一个一个从上到下不行吗，同时结合是否完成任务点判断。”

必须满足：

1. **按任务点从上到下播放**，不能按“正在播放/可见面积”在主播放器之间来回跳；
2. **跳过已完成任务点**（`.ans-job-finished`），不要再播已完成的视频；
3. 同一时间只恢复/播放当前任务点，其他任务点暂停；
4. 当前任务点视频播完且任务点标记完成后，才切下一个；
5. 全部任务点完成/没有媒体后才翻页；
6. **切换任务点时视频不抖动**：不能高频 `play()/pause()`、不能 `video.click()`、不能目标 frame 来回跳；
7. 任务点信息缺失/iframe URL 匹配失败时，按子 frame 顺序兜底，仍不能一起播放；
8. 阅读类任务点没有媒体时不能卡死，也不能把后面的视频顺序打乱；
9. **优先用权威任务点数据**：知识卡片页的 `window.mArg.attachments` / `window.attachments`，按 iframe `data` 的 `jobid`/`_jobid`/`mid` 对齐，读取 `job`/`isPassed`/`property.module`；DOM `.ans-attach-ct` + `.ans-job-finished` 与 `.ans-job-icon` 只做兜底；
10. **跳过上一章节残留 frame**：只看当前任务点快照里出现过的 iframe，已完成的 iframe 不再激活/恢复；
11. **阅读/文档任务不能被 3 秒默认等待跳过**：识别到 `insertdoc`/`insertbook`/`insertflash` 时必须进入阅读等待分支。

实现：

- `src/app/task-points.ts`：优先解析 `attachments`（job/isPassed/module），再解析 `.ans-attach-ct` + iframe data，最后 `.ans-job-icon` 兜底；输出 `tasks`、`nextTaskUrl`、`nextTaskId`、`nextTaskKind`、`nextTaskName`；
- `src/app/agent.ts`：把任务点快照随 `MEDIA_STATE` 上报；
- `src/app/media-target.ts`：按任务点顺序选目标；阅读任务没有可握手 iframe 时返回 `ownerFrameId`；兜底按 `children` 顺序且只允许当前任务点快照中的 URL；
- `src/app/autoturn.ts`：`waitForTaskMedia` 按目标播放/阅读，目标不变不重复 `RESUME` 或重复下发阅读指令，暂停重试限频；阅读任务未完成时不会 10 秒后误判完成；
- `src/app/host.ts`：`pinActiveMediaTarget` 在当前视频未播完且任务点未完成时固定目标；任务点已完成或已不在当前快照时立即放开；
- `src/app/media-wait.ts`：同文档多媒体跳过已完成任务点，只等待未完成媒体。

对应测试：`tests/unit/task-points.test.ts`、`tests/unit/media-target.test.ts`、`tests/unit/media-wait.test.ts`、`tests/unit/autoturn.test.ts`。

### R4.1. 章节树跳转与跳过已完成章节（已实现）

用户原话：“跳转功能还有问题，跳过已完成……就是下一个如果已完成就跳过，否则继续播放。”

- 从 `#content1 #coursetree` 读取 `.posCatalog_select`，按 `.orangeNew`（待完成数）和 `.icon_Completed`（已完成）判断；
- 当前章节完成后，直接点击下一个「未完成且待完成数 > 0」的章节原生入口；
- 整章已完成 / `.orangeNew=0` 的章节跳过，不进去空等；
- 目录不可用时回退原「下一节」按钮；目录没有待完成章节时明确返回 `catalog-end` 并停止。

实现：`src/platform/chaoxing/catalog.ts`、`src/platform/chaoxing/next.ts`；测试 `tests/unit/catalog.test.ts`。

### R4.2. 阅读/PDF/文档/PPT 任务自动完成（已实现，默认开启）

- 识别 `insertdoc` / `insertbook` / `insertflash` 任务点；
- 文档 iframe 不握手时，Host → 内容 frame → 文档模块 → 文档页逐层转发 `READER_TASK`；
- 只做真实滚动到文末/翻完最后一页（`#fileInfoNameInput` / `.fileBox` / `#panView` / `#ReadWeb` / `.swiper-container`），完成状态由平台写回；
- 不调用平台完成任务接口、不伪造进度、不碰验证码；
- 可在「主页 → 自动翻页设置」关闭；关闭后遇到阅读任务会暂停并提示人工完成。

实现：`src/app/reader-agent.ts`、`src/app/autoturn.ts`、`src/app/host.ts`、`src/core/messages.ts`、`src/ui/panels/AutoTurnPanel.tsx`；测试 `tests/unit/reader-agent.test.ts`、`tests/unit/autoturn.test.ts`。

### R5. 视频/音频行为（已实现）

- 默认静音、倍速在主页自动翻页卡片；1x 不写 playbackRate；
- 不伪造进度、不 seek、不 rateHack；
- 停止自动翻页时暂停当前视频/音频；
- 平台/失焦导致的暂停可以低频恢复，但不能连续 `play()` 或 `click()` 造成抖动；
- 用户手动暂停要被尊重。

实现：`src/app/media-preferences.ts`、`src/app/media-wait.ts`、`src/app/autoturn.ts`、`src/app/agent.ts`；测试 `tests/unit/media-wait.test.ts`、`tests/unit/video-preferences.test.ts`。

### R6. 提交安全（已实现）

- 默认「复核后提交」；「仅提示」模式禁止提交；
- 脚本未填入时不能直接提交空白作业；手动填写需二次确认；
- 复核模式不自动点掉平台原生确认框；全自动且 100% 覆盖才自动确认；
- 提交结果未知要明确提示，不能把登录跳转当成功。

实现：`src/app/host.ts`、`src/platform/chaoxing/submit.ts`、`src/platform/generic/config-adapter.ts`、`src/ui/pages/Solve.tsx`、`src/ui/pages/Home.tsx`；测试 `tests/integration/host.test.ts`。

### R7. 稳定性与可观测性（已实现）

- 多标签同课程互斥，锁失败释放；
- 一键复制脱敏诊断包，不含 API Key/headers/答案；
- 消息校验、nonce、iframe 生命周期清理；
- bfcache 返回不销毁面板；
- frame 心跳 15s 与 sweep 阈值不能竞态误删。

实现：`src/app/tab-lock.ts`、`src/app/diagnostics.ts`、`src/core/messages.ts`、`src/app/host.ts`、`src/app/boot.ts`。

## 每次改动必查

- [ ] R4.1 按从上到下顺序
- [ ] R4.2 跳过已完成
- [ ] R4.3 同一时间只播一个
- [ ] R4.4 播完且任务点完成才切
- [ ] R4.6 切换不抖动（无高频 play/pause、无 click、目标不来回跳）
- [ ] R4.9 优先用 attachments 判断任务点完成
- [ ] R4.1 章节树跳过已完成/无待完成章节
- [ ] R4.2 阅读/文档任务不会 3 秒后直接跳过
- [ ] R3 正常页面不误报验证码
- [ ] R6 手动填写/仅提示/复核提交
- [ ] typecheck + test + build

## 已知限制

- closed Shadow DOM / Canvas 播放器无法读取媒体元素；
- 任务点完成标记依赖学习通 `attachments` 与 `.ans-job-finished`，平台改 DOM 需要同步调整；
- 阅读/文档自动完成依赖页面真实结构（`#fileInfoNameInput` / `#panView` / `#ReadWeb` / `.swiper-container`），无法识别的第三方阅读器只记录日志并等待人工；
- 章节树跳转依赖 `#content1 #coursetree`；平台改版时回退「下一节」；
- 真实页面回归样本有限，媒体切换抖动需要实机日志确认目标是否来回变化。
