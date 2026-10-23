# 学习助手 userscript 代码审计报告（只读审计）

- 审计日期：2026-10-24
- 代码基线：`master` @ `bbfd530`（审计开始时 `git status --short` 为空；结束时仅 `docs/research/` 未跟踪，无 `src/`、`dist/`、`package.json` 改动）
- 审计范围：`src/**`、`tests/**`、`vite.config.ts`、`vitest.config.ts`、`tsconfig.json`、`package.json`、`README.md`、`docs/superpowers/specs/*`
- 审计方式：逐文件阅读 + 基线命令验证 + 构建产物统计；未修改任何源码，本次审计的唯一交付物是本文件（同目录 `oss-survey.md` 为并行调研产出，与本报告无关）
- 环境：Windows / Node v24.20.0 / npm 11.19.0

> 说明：任务要求只运行 `typecheck` 与 `test:sandbox`，未运行 `npm test`（该命令在本环境会因管道 spawn EPERM 失败），也未修改 `package.json`。

---

## 1. 基线状态

### 1.1 类型检查

```text
> study-helper@0.1.0 typecheck
> tsc --noEmit
```

**通过，无诊断输出**（exit 0）。`tsconfig.json` 启用了 `strict`，但未启用 `noUnusedLocals` / `noUncheckedIndexedAccess`，这也是下文中若干死代码与越界读取没有被发现的原因（见 DX-02）。

### 1.2 测试（沙箱 workaround）

```text
npm run test:sandbox
Test Files  23 passed (23)
     Tests  251 passed (251)
  Duration  3.05s
```

**全部通过。** 其中 `tests/unit/bank-perf.test.ts` 输出的实测值可作为性能基线：

| 指标 | 实测 |
| --- | --- |
| 导入 1 万条题库 | 293.8 ms |
| 精确检索 | 0.01 ms |
| 模糊检索（1 万条） | 10.32 ms |

### 1.3 构建产物（已有 `dist/`，本次未重新构建）

| 项 | 数值 |
| --- | --- |
| `dist/study-helper.user.js` 原始大小 | 820,920 B |
| 同文件 gzip | 270,336 B |
| `src/platform/chaoxing/font/table.json` | 355,427 B / 20,906 条 |
| 该 JSON 单次 `JSON.parse` | ≈ 3.9 ms |

### 1.4 结论摘要

- 工程基础是健康的：类型检查、251 个测试全部通过，模块划分（core/platform/bank/ai/solver/app/ui）与设计文档一致，考试门禁、Key 掩码、日志脱敏、无 XSS sink 等安全默认值基本落实。
- 最高风险不在“功能缺失”，而在 **状态生命周期**：iframe 重载/切页后的旧 `children`/媒体状态没有及时清理，叠加“填入超时静默成功”，会把用户引向 **对错误/空白页面执行不可逆提交**（R-01、R-02、R-04 构成完整失败链）。
- 其次是 **性能路径上的常态开销**：media-preferences 在无媒体页面每次 DOM 变化做全文档+Shadow DOM 扫描；`nextPage` 文本兜底对全文档元素逐个读 `innerText`；验证检测 1.2s 一次 `body.innerText`。
- 测试覆盖了采集/填答/提交/题库/AI/媒体偏好，但 **完全没有覆盖 FrameAgent 与 host↔frame 消息协议**，也没有导航清理、会话恢复、提示模式提交等最关键的生命周期行为。

---

## 2. 问题清单

严重度定义：**P0** 可导致不可逆的用户可见破坏；**P1** 高概率错误行为/明显安全或性能风险；**P2** 局部问题、可维护性或体验问题。
工作量：**S** < 2 小时；**M** 0.5–2 天；**L** > 2 天。

### 2.1 正确性 / 健壮性

#### R-01 [P0][S] 提交前不校验“是否已填入/是否仅提示”，可提交空白作业

- 位置：`src/app/host.ts:410-463`（`submit`；未答题判断在 417-422，`autoConfirm` 硬编码在 437/445）、`src/app/host.ts:330-346`（只有 `fillAll` 检查 `hint`）、`src/ui/pages/Solve.tsx:89-96`、`src/ui/pages/Home.tsx:215-223`
- 现象/原因：
  - `HostController.submit()` 只看 `solving.mode` 之外的状态，**没有** `mode === "hint"` 拦截，也不检查 `fillAll()` 是否成功；`state.results[question.id]?.answer` 只代表“解出了答案”，不代表“已经填入页面”。
  - 「仅提示」模式下结果里有答案，`unanswered` 为 0，因此不会触发 420 行的告警，直接调用提交。
  - UI 的「提交」按钮只判断 `busy / 题目数 / examBlocked`（`Solve.tsx:92`、`Home.tsx:219`），不禁用提示模式，也不要求先「全部填入」。
- 建议修复：
  1. `submit()` 前置：`mode === "hint"` 直接拒绝并提示；`state.filledQuestionIds`（由 `fillAll` 成功结果写入）为空或覆盖率不足时要求二次确认（Modal），确认文案明确“仍有 N 题未填入”。
  2. UI 同步禁用/降级「提交」按钮，并在按钮旁显示“已填入 N/M”。
  3. 将 `autoConfirm` 改为由显式确认开关传入，避免恒为 `true`（437/445）。
- 影响范围：所有作业/测验/考试页的提交动作；不可逆，可能造成 0 分或错误提交。
- 工作量：S

#### R-02 [P1][S] iframe 重载/切页后旧 `children` 条目保留最长 60s，旧题目继续参与合并，FILL 发往新文档被丢弃

- 位置：`src/app/host.ts:780-807`（HELLO 注册）、`src/app/host.ts:735-746`（`rebuildQuestions` 合并所有 child）、`src/app/host.ts:1205-1222`（`sweepFrames`，60s / 10s 扫描）、`src/app/frames.ts:24-37`（frameId 每文档随机生成）、`src/app/agent.ts:148`（token 不匹配直接 return）、`src/app/host.ts:874-887`（`waitForFill`）
- 现象/原因：
  - `children` 以 `frameId` 为键；iframe 导航后新文档里的脚本会生成**新的随机 frameId**，因此旧条目不会被新 HELLO 覆盖，只能等 `sweepFrames` 在 60s 后删除。
  - 这 60s 内 `rebuildQuestions()` 仍把旧 child 的 `questions` 合并进 `state.questions`：UI 显示旧页题目、题数虚高，`fillAll()` 也会把旧题按旧 `frameId` 分组。
  - 旧条目的 `source` 仍指向同一个 iframe 的 `WindowProxy`，host 会把 `FILL` 发过去；但新文档 agent 的 `token` 不同，消息被丢弃，`waitForFill` 于是空等 30s，随后走 R-04 的“假成功”。
  - 此外，HELLO 在 `!sameSource` 时执行 `this.childMedia.clear()`（785-788），会**一次性清掉所有 frame** 的媒体状态（包括正在播放的另一个任务点），造成短暂失联。
- 建议修复：
  1. HELLO 时按 `source` 找到并替换同源旧条目（`source` 相同即视为同一 browsing context），而不是只按 `frameId`。
  2. `onNavigation()` / 任务签名变化时清空非 top 的 `children`、`childMedia`、`activeMediaFrameId`。
  3. `sweepFrames` 的 60s 阈值降到 15–20s；`childMedia.clear()` 改为只清该 frame。
  4. 发送 `FILL` 前校验 `child.url` 与当前页面/题目所属 frame，避免向已导航的 frame 发指令。
- 影响范围：章节页 iframe 切换、作业页翻页、同页多任务点；会导致旧题混入、填入假成功、后续误提交。
- 工作量：S

#### R-03 [P1][S] 跨 frame 媒体状态未统一按“当前章节”过滤，旧 frame 可让自动翻页跳过视频

- 位置：`src/app/host.ts:1103-1145`（`getChildMediaState`；`allTasksFinished` 在 1114-1135 做章节过滤，但 1109-1110 的 `media` 列表没有过滤）、`src/app/host.ts:952-998`（`getMediaPlaybackTarget`，完全没有章节校验）、`src/app/host.ts:954/1106`（3.5s 新鲜度窗口）
- 现象/原因：
  - `allEnded` / `anyPaused` 由**所有** frame 的媒体状态汇总，不看是否属于当前 `chapterId`；上一个任务点/上一页的 `allEnded` 在 3.5s 内仍为 true 时，`waitForExternalMedia` 会在稳定 1.5s 后判定“播放结束”。
  - `getMediaPlaybackTarget()` 只按“最近 3.5s 内带任务字段的 frame，按时间倒序”取一个，不校验章节；旧内容 frame 的 `allTasksFinished: true` 会让 `waitForTaskMedia` 直接 `return "done"`，跳过新章节的视频等待。
- 建议修复：
  1. 复用 `getChildMediaState` 的 `currentChapterId()` + `taskUrlKey` 逻辑，对 `media` 与 target 都做章节/URL 过滤。
  2. 在媒体状态里保存上报时的 `url/chapterId` 快照，过滤时校验快照而不是当前 `child.url`。
  3. 把“目标 frame 必须属于当前内容 frame”作为不变量，不满足时回退到通用等待（但不要使用旧 `allEnded`）。
- 影响范围：章节多任务点、知识卡片、跨章节切换时的视频等待。
- 工作量：S

#### R-04 [P1][S] `waitForFill` 30s 超时返回空数组，被当成“成功填入 0 题”

- 位置：`src/app/host.ts:874-887`（超时 `resolve([])`）、`src/app/host.ts:394-407`（`ok=0`、`failed=0` → `toast("success", "已填入 0 题")`）
- 现象/原因：超时路径与“子 frame 返回空结果”无法区分；`failed === 0` 使调用方认为全部成功，UI 显示成功色 toast，日志写“成功 0，失败 0”。R-02 的旧 frame 场景会稳定触发该路径。
- 建议修复：
  1. `waitForFill` 返回 `{ results, timedOut: boolean }`，或超时时补一条 `{ questionId, ok:false, message:"子页面响应超时" }`。
  2. `fillAll` 在 `timedOut` 时 `toast("error")`、`statusText` 显示“填入超时”，返回 `false`。
  3. 记录期望的 `frameId` 与题目数，便于日志排查。
- 影响范围：所有跨 frame 填入；会误导用户以为已填写。
- 工作量：S

#### R-05 [P1][S] 提交成功判定仅凭“URL 变化”，登录跳转也会被判成功

- 位置：`src/platform/chaoxing/submit.ts:161-191`（`waitForOutcome` 在 168-173 先判 URL 变化并直接 `ok:true`）、`src/platform/generic/config-adapter.ts:484-515`（同样只看 URL 变化）
- 现象/原因：点击提交后若会话过期/被风控，页面可能跳转到 `passport`/登录页；URL 变了，脚本返回“提交后页面已跳转”，host 显示“提交成功”、自动流程继续并停止翻页。`comparableUrl` 只去掉 hash，不校验目标域/路径。
- 建议修复：
  1. URL 变化必须同时满足：非登录/验证页（复用 `detectVerificationChallenge` / passport 路径判断），且命中结果页特征（`/work/...` 结果页、`/exam-...`、或页面含 `RESULT_TEXT_KEYWORDS`）。
  2. 仅 URL 变化但无法确认时返回 `ok:false, message:"页面已跳转但未检测到提交结果，请人工确认"`（与 15s 超时语义一致）。
  3. 日志记录 `beforeUrl → afterUrl`（已脱敏）。
- 影响范围：作业/考试提交结果判断、全自动流程的停止条件。
- 工作量：S

#### R-06 [P1][S] 填空题只填 `min(values, blanks)`，少填仍返回 `ok: true`

- 位置：`src/platform/chaoxing/fill.ts:285-325`（`limit` 在 310，`ok` 只校验 `actualValues` 在 317）、`src/platform/generic/config-adapter.ts:347-377`（同样的 364-373）
- 现象/原因：若答案有 3 个空但页面只识别到 2 个输入框（或答案本身少于空数），只填前 2 个，`ok` 仍为 true；第 3 个空保留原值/为空，提交后失分。反向（`values` 多于 `blanks`）则静默丢弃多余答案。
- 建议修复：
  - 显式比较 `values.length` 与 `blanks.length`：数量不一致 → `ok:false`，message 说明“答案 N 空 / 页面 M 空”；
  - 回读所有 blank（含未填项），并检查未填项是否为空；
  - 多余答案记录 warn，便于题库格式问题定位。
- 影响范围：填空题（含 `kind:"text"` 经 `splitFillValues` 的路径）。
- 工作量：S

#### R-07 [P2][S] `refresh()` 固定 `sleep(450)` 等子 frame，慢 frame 漏题且状态文案不回正

- 位置：`src/app/host.ts:250-270`（`await sleep(450)` 在 260，状态写在 263-268）
- 现象/原因：子 frame 采集受字体预加载（`primeFontDecoder`）与 DOM 就绪影响，450ms 内未回 `QUESTIONS` 时 `refresh` 会写“未发现题目”；之后 `QUESTIONS` 到达只 `rebuildQuestions()`，不会更新 `statusText`，UI 仍显示“未发现题目”。同时 `refreshSeq` 只防止旧重建，不取消等待。
- 建议修复：为每个 child 维护 pending collect Promise（超时 1.5–2s），`refresh` 等待实际响应或超时后再汇总；`QUESTIONS` 处理里在题数变化时更新 `statusText`。
- 影响范围：首次进入作业/章节页、网络慢或字体解析慢时的采集可靠性。
- 工作量：S

#### R-08 [P1][S] `boot()`/`init()`/定时器回调缺少异常兜底，配置损坏会让面板永久“初始化…”

- 位置：`src/main.ts:3-7`（`void boot()`）、`src/app/boot.ts:10-33`、`src/app/host.ts:694-696`（`getAdapter` 不在 try 内）、`src/app/host.ts:227-234`（`void this.onNavigation()`）、`src/platform/registry.ts:16-25`（`generic.matches.some`）
- 现象/原因：`settings.advanced.genericConfig.matches` 若被手工编辑/旧版本写成非数组，`getAdapter()` 内 `generic.matches.some` 直接抛错；`host.detectPage()` 在 696 行调用它且无 try，`init()` reject，`ready` 永远 false，`main.ts` 的 `void boot()` 只留下一个未处理拒绝；`setInterval` 里的 `void this.onNavigation()` 同理。
- 建议修复：
  1. `boot()` 外层 try/catch + `logger.error("boot", …)`，失败时仍给 UI 一个 error 状态。
  2. `getAdapter()` 内对 genericConfig 做类型守卫（`Array.isArray(matches)` 且元素为 string）。
  3. `onNavigation` / interval 回调包 try/catch；`init` 失败设置 `status:"error"` 而不是停留在“初始化…”。
- 影响范围：整个脚本的启动可靠性；任何一个设置字段损坏即可让功能全失效。
- 工作量：S

#### R-09 [P1][M] 子 frame 没有 URL/路由变化检测，任务点仅换 iframe URL 时会被误判“页面没有变化”

- 位置：`src/app/agent.ts:439-456`（只有 DOM MutationObserver）、`src/app/agent.ts:128-134`（只有 15s PING，无 URL 检测）、`src/app/autoturn.ts:346-354`（4s 签名轮询）、`src/app/host.ts:1151-1165`（签名依赖 `state.frames`）
- 现象/原因：设计文档声称“URL 轮询 + MutationObserver 双重感知”，但**只有 host 轮询自己的 `location.href`**；子 frame 没有 `popstate`/`hashchange`/定时 URL 检查，也没有在 URL 变化时重发 `HELLO/STATE`。如果平台切换任务点只改 iframe 的 URL/内部路由而不触发宿主文档 DOM 变化，host 的 `getTaskSignature()` 不会变，`waitForTaskChange` 4s 后判定未变化，最多重试 2 次后停止自动翻页。
- 建议修复：agent 增加 `popstate/hashchange` 监听 + 1.5s URL 轮询；URL 变化时重置 `lastSignature` 并立即 `collectAndSend(true)` + `STATE`；host 签名直接读取实时 `children` 的 URL（而不仅是上次 STATE 快照）。
- 影响范围：学习通章节任务点切换、知识卡片 iframe 内路由；自动翻页的核心判定。
- 工作量：M

#### R-10 [P2][S] 自动翻页会话无过期、无 URL 校验，之后任意章节页刷新都可能自动开始

- 位置：`src/app/autoturn.ts:10-18`（`lastUrl` 字段）、`src/app/autoturn.ts:67-81`（`restore`）、`src/app/autoturn.ts:99-116`（未运行分支提前 return，不写 `persist(false)`）、`src/app/autoturn.ts:534-557`（`persist` 无时间戳）、`src/app/host.ts:225`（任一自动翻页页都会 `restore()`）
- 现象/原因：`sessionStorage` 在标签页生命周期内一直存在；`lastUrl` 从未被使用；`restore()` 只检查 `running`。如果上次在章节页运行时页面被直接关闭/跳转（未来得及 `persist(false)`），之后在同一 tab 打开任意章节页并刷新，就会恢复自动翻页并开始点击。
- 建议修复：会话增加 `savedAt` 与最大有效期（如 2h）；`restore()` 校验 `lastUrl` 与当前 URL 的主路径/chapterId；`stop()` 无论是否 running 都 `persist(false)`；恢复时在 UI 上明确提示并给出“取消恢复”。
- 影响范围：自动翻页的启动时机；可能造成“自己动起来”的意外点击。
- 工作量：S

#### R-11 [P2][S] `stop()` 无条件 `pauseMedia()`，重复停止/卸载也会暂停用户媒体

- 位置：`src/app/autoturn.ts:99-116`（`pauseMedia` 在 101-105，早于 `if (!this.running)`）、`src/app/host.ts:456`（提交成功）、`src/app/host.ts:1191-1203`（导航离开）、`src/app/host.ts:503-508`（dispose）
- 现象/原因：即使用户从未启动自动翻页，`onNavigation()` 离开章节页或 `submit()` 成功都会调用 `stop()`，进而暂停当前文档与所有子 frame 的媒体；重复调用也会再次暂停用户刚恢复播放的视频。
- 建议修复：只在 `running === true` 的停止转换中暂停媒体；未运行时的 `stop(reason)` 只更新提示，不碰媒体。
- 影响范围：用户手动播放的音视频、其他标签/子 frame 的播放器。
- 工作量：S

#### R-12 [P2][S] IndexedDB 事务 Promise 在请求失败路径未被处理，产生 unhandled rejection

- 位置：`src/platform/../bank/db.ts:141-148`（`readAll`），同样的 `done` + `requestAsPromise` 模式见 152-157、159-168、170-180、196-209 等
- 现象/原因：`const done = transactionAsPromise(tx)` 先创建，随后 `await requestAsPromise(request)`；若请求报错，函数直接抛出，`done` 的 rejection 没有 handler（事务随后 abort），控制台出现 unhandled promise rejection，且事务状态不明确。
- 建议修复：统一 `await Promise.all([requestAsPromise(req), done])`，或在请求失败时 `void done.catch(() => undefined)`；封装 `runTx` helper 供所有方法复用。
- 影响范围：题库读写失败时的错误语义与日志噪声。
- 工作量：S

#### R-13 [P2][S] `resumeOnPause=false` 且媒体暂停时，`waitForMedia` 无提示空转至 45 分钟

- 位置：`src/app/autoturn.ts:575-737`（`while` 在 690，暂停分支只在 712-731 且受 `resumeOnPause` 控制）、`src/app/autoturn.ts:11`（`MEDIA_WAIT_TIMEOUT = 45min`）
- 现象/原因：关闭“自动翻页时暂停后恢复”后，用户暂停视频，循环既不 `play()`、也不返回 `blocked`、也不提示，只是每秒轮询直到 45 分钟超时；同一场景在跨 frame 路径（`waitForExternalMedia`）却有 8s/15s 的提示，两个路径行为不一致。
- 建议修复：主文档路径也按“暂停超过 8s”emit 一次“请手动播放”的提示；把等待超时改为可配置（或 10–15 分钟），并在自动翻页 UI 显示已等待时长。
- 影响范围：自动翻页的等待体验与可观测性。
- 工作量：S

#### R-14 [P2][S] `.jsonl` 被接受但解析器必然失败

- 位置：`src/bank/index.ts:455-461`（`.jsonl` → `"json"`）、`src/bank/parser.ts:280-292`（整段 `JSON.parse`）、`src/ui/pages/Bank.tsx:131`（accept 含 `.jsonl`）
- 现象/原因：JSONL 是逐行 JSON，整段解析失败，导入返回“JSON 解析失败”，但 UI/README 暗示支持该扩展名。
- 建议修复：二选一——从 `detectBankFormat` 与 `accept` 移除 `.jsonl`；或在 `parseJsonRows` 解析失败时按行重试（跳过空行，累计错误）。
- 影响范围：题库导入可用性。
- 工作量：S

#### R-15 [P2][S] 任务点 URL 归一化丢失 id/nodeId/cardId，同路径 iframe 可能匹配错 frame

- 位置：`src/app/host.ts:61-87`（`TASK_URL_KEYS` 只保留 jobid/knowledgeId/chapterId/objectId/clazzid/courseid）、`src/app/host.ts:1068-1100`（`findChildForTask`）
- 现象/原因：`taskUrlKey` 丢弃 `id`、`nodeId`、`cardId` 等参数；知识卡片的多个 iframe 常共用 `/knowledge/cards` 路径，归一化后 key 相同，`findChildForTask` 会返回最近活跃的**任意**同路径 frame。`activateMediaFrame` 于是恢复错误的播放器，等待 20s 后 `stalled` 停止。
- 建议修复：补充卡片/节点相关参数（`nodeId`、`cardId`、`id`、`ut` 等）到 key；匹配失败时不要用“同 path 第一个”兜底，改为记录日志并按 frame 连接顺序/任务序号回退。
- 影响范围：知识卡片、同页多任务点视频。
- 工作量：S

#### R-16 [P2][S] SPA 同文档换题后 `submittedDocuments` 守卫不重置，无法再次提交

- 位置：`src/platform/chaoxing/submit.ts:27-38`（`resetSubmitGuard`）、`src/platform/chaoxing/submit.ts:198-204`（guard 判断）、全仓库无 `resetSubmitGuard` 调用（grep 仅定义与测试）
- 现象/原因：提交后若页面不换 `Document`（SPA 换题/分页），守卫永远命中，用户只能刷新页面才能提交下一份。
- 建议修复：在 host 检测到题目集合变化 / URL（去 hash）变化 / 新页面 kind 变化时调用 `resetSubmitGuard()`；或把守卫 key 改为 `document + 题目签名`。
- 影响范围：同一标签页连续做多份作业/测验。
- 工作量：S

#### R-17 [P2][S] `dispose()` 在生产路径从未调用，定时器/监听器无页面生命周期清理

- 位置：`src/app/boot.ts:10-33`（FrameAgent 未保存引用）、`src/app/host.ts:490-509`（`dispose`）、`src/app/agent.ts:458-481`（`dispose`）、`src/app/media-preferences.ts:160-311`（返回 disposer 但 boot 忽略）、`src/ui/App.tsx:157-162`（拖拽期间在 `window` 上挂 `pointermove/pointerup`，组件若被卸载不会移除）
- 现象/原因：没有 `pagehide`/`beforeunload` 调用；host 的 1.2s/10s 定时器、agent 的 observer/媒体监听、media 的 1.5s 同步定时器都只在页面销毁时被动回收。SPA 场景下若脚本被重复注入或页面框架替换，旧实例仍会运行；拖拽中面板被收起/卸载时 pointer 监听可能残留。
- 建议修复：`pagehide` 时调用 `host.dispose()` / `agent.dispose()` / media disposer；`boot` 保存 agent 引用；至少清理所有 interval。
- 影响范围：长时间挂机、SPA 页面、脚本重载。
- 工作量：S

#### R-18 [P2][S] 设置写入整对象、range 每次 input 都写 GM，失败无 UI 提示、多标签最后写入覆盖

- 位置：`src/core/settings-store.ts:104-115`（`persist` 写整个 `Settings`）、`src/core/settings-store.ts:71-95`（`refreshSettings`）、`src/ui/panels/SolvingPanel.tsx:53-63` 与 `src/ui/panels/BankPanel.tsx:16-24`（range `onInput` 直接 `save`）
- 现象/原因：拖动阈值滑块每个刻度都 `GM_setValue` 全量设置；写失败只 `logger.warn`，UI 不提示；多标签各自基于缓存合并后整对象写入，后写覆盖先写（没有基于存储的重新合并）。
- 建议修复：滑块用 `onChange` 或 200ms debounce；写失败 patch 一个“设置未保存”提示；`updateSettings` 在多标签场景写前 `refreshSettings()` 再合并（或使用 GM 存储的冲突检测）。
- 影响范围：设置持久化可靠性、GM 存储写入频率。
- 工作量：S

#### R-19 [P2][M] 设置无 schema 校验/迁移，损坏字段会进入运行路径

- 位置：`src/core/settings-store.ts:28-38`（`normalize` 只补 `includeTypes`/`remote.headers`，`version` 硬写 1）、`src/core/settings.ts:102-115`（`Settings` 接口）、`src/platform/registry.ts:16-18`
- 现象/原因：`merge` 只做对象深合并，不校验类型/范围：`minDelayMs` 可为字符串、`ui.width` 可为 NaN、`sectionStates` 可为数组、`genericConfig.matches` 可为字符串（进而触发 R-08 的抛错）。`version` 被强制写 1，未来 schema 变更没有迁移入口。
- 建议修复：增加轻量 `validateSettings`（数值 clamp、枚举校验、`matches` 数组元素 string、`sectionStates` 为 plain object），非法字段回退默认并 `warn`；建立 `version → migrate` 表，未知字段在迁移时丢弃或保留策略明确。
- 影响范围：升级/手工编辑/跨版本同步后的稳定性。
- 工作量：M

#### R-20 [P1][S] IndexedDB 降级为内存题库后 UI 完全不可见，刷新即丢数据

- 位置：`src/bank/db.ts:374-398`（3s 超时/失败 → `MemoryBankStore`，只 warn）、`src/bank/index.ts:91-102`（`BankStats` 已含 `storage`/`indexedDbAvailable`）、`src/app/host.ts:642-651`（`syncBankStats` 只取 `total`/`newestUpdatedAt`）、`src/ui/contract.ts:36-39`（`BankStatsView` 只有 total/lastUpdated）、`src/ui/pages/Bank.tsx:259-261`（仍显示“题库仅保存在本机 IndexedDB”）
- 现象/原因：隐私模式、IDB 被策略禁用或打开超时后，导入会显示成功、统计正常，但数据只在本页内存；刷新后“题库为空”。用户没有任何提示。
- 建议修复：把 `storage`/`indexedDbAvailable` 透传到 `UiState`，在题库页顶部显示持久化状态警示（“当前为内存模式，刷新会丢失，请导出备份”），并考虑在内存模式下禁止“清空”或导入前二次确认。
- 影响范围：题库数据持久性；用户对“已导入”的信任。
- 工作量：S

#### R-21 [P2][S] 子 frame 采集在未收到 WELCOME 前就执行并发送空 token 消息

- 位置：`src/app/agent.ts:47-74`（`start` 里 600ms 后 `collectAndSend(true)`）、`src/app/agent.ts:308-352`（无 token 也发送 `QUESTIONS/STATE`）
- 现象/原因：启动 600ms 后无条件做一次完整采集（`detectPage` + `collectQuestions` + 字体解码）；若此时 WELCOME 尚未到达（host 未就绪、消息延迟），消息因 token 为空被 host 丢弃，等于纯浪费，且与 host 随后的 COLLECT 重复。
- 建议修复：`collectAndSend` 在 `!this.token` 时只做页面识别/不采集，或收到 WELCOME 后再统一采集。
- 影响范围：每个 iframe 的启动成本。
- 工作量：S

### 2.2 安全 / 隐私

#### SEC-01 [P1][M] 子 frame agent 不校验消息 origin，恶意父页面可驱动填入/提交并获取题目

- 位置：`src/app/agent.ts:136-148`（只校验 `event.source === hostWindow || window.parent`，不校验 `event.origin`）、`src/app/agent.ts:107-119`（HELLO 发往 `window.top`）、`src/core/messages.ts:71-83`（`postMessage(..., "*")`）
- 现象/原因：`findUiHost()` 返回 `window.top`；若学习通页面被第三方站点用 iframe 嵌入（平台未强制 `X-Frame-Options`/`frame-ancestors`），攻击者父页面可以收到 HELLO 中的 URL/标题，回一个任意 token 的 WELCOME，随后下发 `FILL`/`SUBMIT`（agent 只在 `handleSubmit` 检查考试页），并把 `QUESTIONS` 回传给攻击者。`window.top` 跨域时仍可 `postMessage`，脚本没有拒绝非同源 top。
- 建议修复：
  1. WELCOME 与所有指令校验 `event.source === window.parent/top` **并且** `event.origin` 属于 `chaoxing.com`/`edu.cn` 白名单（或与 `location.ancestorOrigins` 比对）；
  2. HELLO 携带随机 nonce，host 的 WELCOME 回显 nonce，避免任意父页面截获；
  3. 敏感消息（题目、答案）使用具体 `targetOrigin`，至少不要用 `"*"`；
  4. 子 frame 检测到 top 非同源/非白名单时直接不启动 agent（记录 debug 日志）。
- 影响范围：所有 iframe 内的采集/填答/提交能力；属于“被嵌入时”的越权自动化。
- 工作量：M

#### SEC-02 [P1][M] 消息协议无载荷校验，`createMessage` 类型约束退化；HELLO 可冒用/占用 frameId

- 位置：`src/core/messages.ts:51-59`（`createMessage` 的 `T extends Omit<FrameMessage, "sh" | "v">`）、`src/core/messages.ts:55-59`（`isFrameMessage` 只查 `sh/v/t`）、`src/app/host.ts:780-807`（frameId 完全信任对方）、`src/app/host.ts:843-857`（MEDIA_STATE 只校验三个布尔）
- 现象/原因：
  - TS 已实测：`Omit` 作用于联合类型会退化为公共字段（本处只剩 `t`），并且泛型调用不做 excess property 检查，因此 **`createMessage({ t: "FILL", token })` 这种缺少 `answers` 的调用可以编译通过**；`isFrameMessage` 也不校验任何必填字段。
  - host 用对方提供的 `frameId` 注册；任意 `.chaoxing.com`/`.edu.cn` iframe 只要发一个 HELLO 就能拿到 token，然后可为该 frameId 伪造 `QUESTIONS`、`MEDIA_STATE`（例如 `allTasksFinished: true`），干扰题目列表与自动翻页；不同来源的 frame 也可以占用同一 frameId，使真实 frame 的 PING 不再匹配、60s 后被 sweep。
- 建议修复：
  1. 分布式 Omit：`type MsgPayload<T> = T extends unknown ? Omit<T, "sh" | "v"> : never;`，让 `createMessage` 真正要求对应分支的字段。
  2. `isFrameMessage` 之外增加按 `t` 的 schema 校验（必填字段、类型、数组长度上限）。
  3. HELLO 校验来源是当前文档中可达的 iframe：遍历 `document.querySelectorAll("iframe")` 比较 `contentWindow === event.source`（跨域可比较 WindowProxy 身份），不在列表中拒绝。
  4. 同一 frameId 只允许同 source 更新；不同 source 注册时分配内部 id，不信任外部 frameId。
- 影响范围：host 状态可信度、跨 frame 指令正确性；安全上属于伪造/DoS。
- 工作量：M

#### SEC-03 [P2][S] AI/远程题库 URL 无协议校验，允许明文 HTTP 携带 Key；`fetch` 回退无超时

- 位置：`src/ai/provider.ts:71-81`（`normalizeBaseUrl` 不校验 scheme）、`src/bank/remote.ts:93-112`、`src/core/gm.ts:99-105`（无 GM 时 `fetch` 无 timeout/abort）、`vite.config.ts:35`（`connect: ["*"]`）、`src/platform/chaoxing/font/decoder.ts:216`（用页面 CSS 中的 URL 直接 `fetch(..., {credentials:"include"})`，无超时/白名单）
- 现象/原因：用户可能误填 `http://` 或内网地址，API Key 以 `Authorization` 头明文发送；`@connect *` 使任何域都可请求；开发/回退路径的 `fetch` 没有超时，请求可能永久挂起（生产 GM 路径有 timeout）。字体 URL 来自页面 CSS，属于页面可控的外部请求，缺少超时。
- 建议修复：保存/使用前校验 `https:`（localhost 例外）并在 UI 警示；`gmRequest` 的 fetch 分支加 `AbortSignal.timeout(timeoutMs)`；字体 fetch 加超时并考虑只允许同源或已知 CDN；在 README/设置页说明 `@connect *` 的风险。
- 影响范围：API Key 传输安全、请求可靠性。
- 工作量：S

#### SEC-04 [P2][S] 日志脱敏的 `Error.stack` 未处理；console 输出可被页面脚本劫持读取

- 位置：`src/core/logger.ts:18-22`（`SECRET_PATTERNS`）、`src/core/logger.ts:32-43`（`safeData(Error)` 原样返回 `stack`）、`src/core/logger.ts:64-68`（非 debug 级别写 `console`）、`src/ai/index.ts:124-129`（日志含 AI 原始返回 preview）
- 现象/原因：`stack` 未过 `redact`；页面脚本可以覆盖 `console.log/warn/error` 读取脚本输出（Tampermonkey 默认与页面共享 console），当前 debug 关闭时仍会输出 info/warn/error，`preview` 可能包含题干/答案片段。
- 建议修复：`stack` 也做 `redact`；含题目/模型原文的 data 只在显式 debug 且用户开启时输出；增加 `logger.setConsoleEnabled()` 与设置项；导出前再跑一次 `redact` 兜底。
- 影响范围：日志/错误信息中的隐私与密钥边界。
- 工作量：S

### 2.3 性能

#### PERF-01 [P1][M] `nextPage` 文本兜底扫描全文档并对每个元素读 `innerText`

- 位置：`src/platform/chaoxing/next.ts:84-93`（`queryAll(["a","button","span","i","div","li"])` + 逐个 `textOf`）、`src/utils/dom.ts:39-43`（`textOf` 优先 `innerText`，会触发布局）、`src/platform/chaoxing/submit.ts:87-99`（提交按钮同样的兜底）
- 现象/原因：章节页侧边栏有大量 `li/a/div`，`queryAll` 可能返回数千元素；`textOf` 的 `innerText` 需要布局计算，`isLeafText` 还会再遍历子元素。每次自动翻页点击前都要执行一次，属于翻页主路径上的常态开销。
- 建议修复：文本兜底只扫描可见的导航容器（`#prevNextFocusNext` 的父级/`.prev_next`/`.orientationright` 等），限制候选数量（如 300）；先用 `textContent` 做关键字预筛，命中后再 `innerText`；用 `getClientRects().length` 先过滤不可见元素；把“下一节”按钮位置缓存到当前页面生命周期。
- 影响范围：每次自动翻页的 CPU/布局开销；页面越大越明显。
- 工作量：M

#### PERF-02 [P1][S] 无媒体页面上，media-preferences 每次 DOM 变化做全文档 + Shadow DOM 扫描

- 位置：`src/app/media-preferences.ts:13-41`（`collectShadowMedia` 最多 800 个元素的 `querySelectorAll("*")`）、`src/app/media-preferences.ts:190-217`（MutationObserver `subtree:true` → 250ms 防抖 `applyNew`）、`src/app/media-preferences.ts:271-276`（1.5s 定时 `collectDocumentMedia`）、`src/app/boot.ts:18-19`（**每个 frame** 都启动）
- 现象/原因：`collectDocumentMedia` 只有在“文档中没有 video/audio”时才走 `collectShadowMedia`；而绝大多数章节页/作业页恰好没有媒体，于是每次 DOM 变化（题目渲染、计时器文本、聊天/公告）都会在 250ms 后触发全文档 `*` 扫描 + 每个 open shadowRoot 的媒体查询。这个开销与页面动态程度成正比，且不能通过“关闭默认静音”避免。
- 建议修复：
  1. MutationObserver 只检查 `addedNodes` 中是否出现 `video/audio` 或包含它们的子树；
  2. 无媒体时把 Shadow 扫描降为一次性/5s 节流，或只在页面存在播放器容器时启用；
  3. 1.5s 定时器只在“曾发现过媒体”或“playbackRate != 1”时运行；
  4. 顶层 frame 无媒体时可停止该 frame 的 media-preferences（保留设置订阅）。
- 影响范围：所有页面的常驻 CPU；低端设备/长页面明显。
- 工作量：S

#### PERF-03 [P1][M] 子 frame 媒体状态 2Hz 上报，每次都做 `getBoundingClientRect` 布局与全量任务点查询

- 位置：`src/app/agent.ts:173-190`（1s 定时 + `timeupdate` 500ms 节流）、`src/app/agent.ts:238-266`（每次 `collectMedia` + `pickPrimaryMedia` + `taskPointState` + `postMessage`）、`src/app/media-preferences.ts:58-86`（`pickPrimaryMedia` 对每个媒体 `getBoundingClientRect`）、`src/app/task-points.ts:19-63`（`querySelectorAll` + 每个 iframe `getBoundingClientRect`/`getComputedStyle`）
- 现象/原因：视频播放时 `timeupdate` 约 4Hz，经 500ms 节流后每秒约 2 次完整上报；`pickPrimaryMedia` 需要布局信息（强制 reflow），`taskPointState` 每轮都重新查询并计算可见性。多任务点页面（3 个 iframe）时成本 ×3。
- 建议修复：只在状态签名变化时上报（`hasMedia/allEnded/anyPaused/taskUrlKey/taskTotal`），否则 2–3s 一次心跳；任务点状态缓存 1s 并在 DOM 变化时失效；`pickPrimaryMedia` 仅在 `resize`/媒体变化时重算，或使用 `IntersectionObserver` 维护可见性。
- 影响范围：视频页/章节页播放期间的 CPU 与主线程占用。
- 工作量：M

#### PERF-04 [P1][S] 验证检测 1.2s 一次 `body.innerText`，提交结果轮询 250ms 一次 `body.innerText`

- 位置：`src/app/host.ts:227-233`（1.2s 轮询 → `checkVerification`）、`src/platform/chaoxing/verification.ts:35-53`（每次跑 2 个 querySelectorAll + 正则）、`src/platform/chaoxing/verification.ts:106-119`（`body.innerText`，触发布局；jsdom 回退 light DOM 遍历）、`src/platform/chaoxing/submit.ts:161-185`（15s 内每 250ms `textOf(ctx.doc.body)` → `innerText`）
- 现象/原因：`innerText` 在真实浏览器需要布局/样式计算；对整页 body 每秒一次、提交时每秒 4 次，属于与用户无关的持续开销。
- 建议修复：验证检测加轻量前置：先检查 `document.title`/`location`/`#captchaImg` 等低成本信号，无命中直接返回；文本读取降到 3–5s 或仅在 DOM 变化后执行；提交结果用 MutationObserver + 2s 轮询，且只在文本变化时计算。
- 影响范围：所有页面的常驻开销；大页面提交时的卡顿。
- 工作量：S

#### PERF-05 [P1][M] 题库统计/导入/prune 全表扫描；首次检索同步构建全量 ngram 索引；模糊检索 O(N)

- 位置：`src/bank/index.ts:217-239`（`buildIndex` 一次性 `getAllEntries` + 同步 `createMemoryIndex`）、`src/bank/index.ts:288-321`（`getBankStats` 又 `getAllEntries` 全表）、`src/bank/index.ts:354-452`（导入先 `getAllEntries`，再 `count`，`prune` 内部再 `getAllEntries`）、`src/bank/index.ts:506-558` / `561-585`（逐条 cosine）、`src/bank/db.ts:196-209`（`prune` 全表 + 排序）
- 现象/原因：5 万条上限下，一次导入会产生 3 次全表读取和 3 份大数组；首次解题/搜索时在主线程同步构建 5 万个 item 的 2-gram/3-gram Map，可能造成明显长任务；模糊检索对每个候选计算 bigram+trigram cosine，30 题批量解题时会持续占用主线程。
- 建议修复：
  1. 统计用 `count()` + 轻量索引/cursor，避免 `getAllEntries`；
  2. 导入复用内存索引，`prune` 用 `updatedAt` 索引或 cursor 删除；
  3. 索引构建分片（每 500 条 `await yield`）并在 `requestIdleCallback` 预热；
  4. 模糊检索先按稀有 n-gram 倒排/长度过滤出候选（几十~几百条）再精确 cosine；
  5. 明确 5 万条上限下的性能预算并补 perf 测试。
- 影响范围：大题库用户的导入等待与解题卡顿。
- 工作量：M

#### PERF-06 [P2][M] 355KB 字体表随 bundle 进入每个 frame，无法按需加载

- 位置：`src/platform/chaoxing/font/decoder.ts:13`（`import table from "./table.json"`）、`src/platform/chaoxing/question.ts:15`（静态导入 decoder）、`src/app/agent.ts:11`；产物 820,920 B / gzip 270,336 B（字体表 355,427 B / 20,906 条）
- 现象/原因：userscript 单文件、无 code splitting；每个匹配 frame（章节页常见 3–5 个）都加载/解析同一份表。对没有 `font-cxsecret` 的普通页面是纯浪费。
- 建议修复：把表改为压缩字符串（如只在首次 `decodeObfuscatedText` 命中字体后 `JSON.parse`）；或按 Unicode 分片（常用字/扩展）延迟加载；减少键长度（当前 MD5 后 8 位 + 十进制双键，可只保留一种）；评估表体是否能裁到 100KB 内。
- 影响范围：所有 frame 的内存与启动时间；安装包体积。
- 工作量：M

#### PERF-07 [P2][M] `UiState` 每次 patch 携带完整 Settings（含 API Key）与 500 条日志，触发全树重渲染

- 位置：`src/ui/contract.ts:67-84`（`settings: Settings`、`logs: readonly LogEntry[]`）、`src/app/host.ts:1237-1251`（每次 patch 重建 state 并通知所有 listener）、`src/app/host.ts:211-218`（settings/logs 订阅直接 patch）
- 现象/原因：日志每 push 一条就通知一次（`logger` 在 debug 打开时更频繁），每次 patch 都复制 500 条数组引用并让 `App` 全树 re-render；`settings` 中的 `ai.apiKey` 随之进入 UI 内存（虽然关闭的 Shadow DOM 阻止页面读取）。
- 建议修复：`UiState` 改为 `hasApiKey` + `maskedKey`，不携带真实 Key；logs 用“版本号 + 最近 N 条”或独立 hook 订阅；页面组件用 `memo`/细粒度 selector，避免每次日志/patch 全树渲染。
- 影响范围：UI 流畅度、Key 在内存中的暴露面。
- 工作量：M

#### PERF-08 [P2][S] 题目/选项容器两两 `contains` 的 O(n²) 去重，叠加 fill 重试时反复全量采集

- 位置：`src/platform/chaoxing/question.ts:96-106`（`keepInnermost`/`keepOutermost` 对每个元素与其余元素 `contains` 比较）、`src/platform/chaoxing/question.ts:120-126`、`src/platform/chaoxing/question.ts:363-384`、`src/platform/chaoxing/fill.ts:422-446`（每题最多 3 次重试，每次 `findQuestionEntry` 都重新 `collectQuestionEntries`）
- 现象/原因：题目容器/选项数量为 n 时去重是 O(n²)；更关键的是 `fillAnswer` 每次尝试都重新采集整页题目（`querySelectorAll` + `textOf`/`innerText` + 字体解码 + 选项归一化），20 题 × 3 次 = 60 次全量采集。选项文本匹配 `resolveChoiceTargets` 也对每个 text 遍历全部选项。
- 建议修复：容器去重用“选择器分组 + 父级归属”或 `closest`/`matches` 判断，避免两两比较；`fillAll` 一次采集后缓存 `QuestionEntry`（含元素引用），重试只重新定位目标容器；选项文本匹配建立 `normalizeOption -> option` 的 Map 前缀索引。
- 影响范围：大题量作业页的填入耗时与主线程占用。
- 工作量：S

### 2.4 架构 / 可维护性

#### ARCH-01 [P2][L] 超大文件与职责混杂

- 位置：`src/app/host.ts`（1,252 行）、`src/app/autoturn.ts`（737 行）、`src/bank/index.ts`（727 行）；其次 `src/platform/generic/config-adapter.ts`（545 行）、`src/platform/chaoxing/question.ts`（407 行）
- 现象/原因：`host.ts` 同时承担：UI 状态机、frame 注册表/协议、题库 IO、AI 测试、验证检测、自动翻页编排、toast；`autoturn.ts` 同时承担：session 持久化、媒体等待、任务点等待、翻页校验、UI 文案；`bank/index.ts` 同时承担索引、导入、检索、缓存、导出。
- 建议修复（不改行为）：`host` 拆 `frame-registry.ts`（children/childMedia/sweep）、`page-state.ts`（detect/nav）、`actions/{solve,fill,submit}.ts`、`verification-controller.ts`；`autoturn` 拆 `session.ts`、`wait-media.ts`、`wait-task.ts`、`navigator.ts`；`bank` 拆 `index-build.ts`、`import.ts`、`search.ts`、`cache.ts`。
- 影响范围：可读性、review 成本、后续测试隔离。
- 工作量：L

#### ARCH-02 [P2][M] 重复实现：chaoxing/generic 填答约 250 行、媒体锁存三处、工具函数多处

- 位置：`src/platform/chaoxing/fill.ts:83-448` vs `src/platform/generic/config-adapter.ts:249-482`（`applyChoice/applyJudge/applyFill/setChecked/readCheckedKeys/sameKeySet` 几乎同构）；媒体“是否播完”的判定在 `src/app/autoturn.ts:575-737`（锁存）、`src/app/agent.ts:208-231`（锁存）、`src/platform/chaoxing/video.ts:38-48`（瞬时判定）三处各一份；`TYPE_PATTERNS` 在 `src/platform/chaoxing/question.ts:71-77` 与 `config-adapter.ts:55-61` 重复；`mask` 在 `src/ui/pages/Settings.tsx:230-233` 与 `src/core/settings-store.ts:137-141` 重复。
- 建议修复：抽 `platform/shared/fill-core.ts`（选项匹配/点击/回读）、`media-completion.ts`（`isFinished` 锁存）、`question-type.ts`、`mask-key.ts`，平台适配器只提供选择器与特殊规则。
- 影响范围：同一 bug 需要修两遍（例如 R-06 在两条路径都存在）。
- 工作量：M

#### ARCH-03 [P2][S] 死代码与未接线设置项

- 位置：`src/utils/dom.ts:129-133`（`formatFrameId` 未使用）、`src/app/media-preferences.ts:134-149`（`applyMediaPreferences` 仅测试）、`src/platform/chaoxing/video.ts:66-129`（`waitForVideoEnd` 未接入自动翻页）、`src/core/gm.ts:168-180`（`notify` 未使用，`GM_notification` 授权多余）、`src/platform/chaoxing/submit.ts:31-38`（`resetSubmitGuard` 无调用方）、`src/core/settings-store.ts:137-141`（`maskApiKey` 无调用方）、`src/core/settings.ts:84,191`（`logLevel` 无读取）、`src/core/settings.ts:66`（`autoFillOnScan` 无 UI 入口）、`solving.includeTypes` 除 `short` 外无 UI（`SolvingPanel.tsx:31-38`）
- 建议修复：删除或接线；开启 `noUnusedLocals`/`noUnusedParameters` 让编译器兜底；同步删除 `vite.config.ts` 中未使用的 `GM_notification`。
- 影响范围：认知负担、误以为存在的功能。
- 工作量：S

#### ARCH-04 [P2][M] 缺少类型化消息契约与版本兼容策略

- 位置：`src/core/messages.ts`（全部协议）、`src/app/host.ts:772-872`、`src/app/agent.ts:136-171`
- 现象/原因：消息名与载荷是手写联合类型 + 两个 `switch`；`createMessage` 的类型约束退化（见 SEC-02），`MSG_VERSION` 只做相等判断，没有“旧版本消息忽略/迁移”策略；新增字段需要同时改三处且容易漏。
- 建议修复：用 `type Msg = { HELLO: {...}; WELCOME: {...}; ... }` 的映射 + `{ t: K; payload: Msg[K] }` 信封（或 zod/valibot 轻量 schema，但需引入依赖，和“除 Preact 外无运行时依赖”的约定冲突，可手写 validator）；集中 `encode/decode` 与 `MSG_VERSION` 兼容分支。
- 影响范围：跨 frame 协议演进、错误定位。
- 工作量：M

#### ARCH-05 [P2][M] `UiState` 与核心存储强耦合

- 位置：`src/ui/contract.ts:67-84`、`src/ui/useController.ts:4-10`
- 现象/原因：UI 直接消费 `Settings`/`LogEntry[]`/`SolveResult` 等核心类型，controller 同时是“状态容器 + 业务门面 + 数据源”；无法替换数据源、无法做局部状态订阅，也使 R-18/R-19 的存储细节泄漏到 UI。
- 建议修复：定义 UI 专用视图模型（`SettingsView`/`LogsView`），controller 只暴露命令与视图；settings/logs 用独立 store 订阅。
- 影响范围：UI 可测试性、后续多平台复用。
- 工作量：M

### 2.5 测试缺口

#### TEST-01 [P1][M] 关键生命周期与跨 frame 协议零覆盖

- 位置/现状：
  - `tests/` 中没有任何 `FrameAgent`、`postMessage`、`HELLO/QUESTIONS/FILL/SUBMIT/MEDIA_STATE`、token/origin 相关测试（grep 无匹配）。
  - `tests/integration/host.test.ts` 通过 `vi.mock` 替换 adapter/bank/solver，只覆盖 top frame 的“采集→解题→填入→提交”和考试门禁，**没有 iframe、没有子 frame 消息、没有导航**。
  - 无 `autoturn` 的 `restore/persist/session` 测试；无“提示模式提交/未填入提交”测试；无 IDB 失败降级可见性测试；无 `.jsonl` 测试；无设置 schema 损坏测试。
  - 现有 fixtures（17 个）：`single/multiple/judge/fill/short/shuffled/text-options/dedupe/mixed/next/submit/page-{chapter,cards,video,homework,quiz,exam}.html`，但**缺少**：多 iframe 任务点页（`.ans-job-icon` + 2 个视频 iframe）、9010 验证页、`font-cxsecret` 字体页、SPA 换页页。
- 建议新增（按优先级）：
  1. `tests/dom/frame-protocol.test.ts`：HELLO 注册、token 复用/不匹配丢弃、伪造 frameId、非白名单 origin 拒绝、MEDIA_STATE 校验；
  2. `tests/integration/navigation.test.ts`：iframe 重载/切页后 children/childMedia 清理、旧题不进入 `state.questions`、fill 超时不是 success；
  3. `tests/unit/autoturn-session.test.ts`：persist/restore、过期、lastUrl 不匹配、stop 写 false；
  4. `tests/integration/submit-guard.test.ts`：hint 模式拒绝、未填入二次确认、登录跳转判失败、SPA 换题后可再提交；
  5. `tests/unit/bank-storage-fallback.test.ts`：IDB 不可用 → 内存 → UI 状态 `storage` 暴露；
  6. fixtures 补齐上述 4 个页面。
- 影响范围：回归保护；当前最关键路径改错不会被测试发现。
- 工作量：M

#### TEST-02 [P2][S] jsdom 下 `innerText` 不存在，生产布局/可见性行为测不到

- 位置：`src/utils/dom.ts:39-43`（`innerText ?? textContent`）、`src/utils/dom.ts:45-58`（jsdom 布局兜底）、`tests/setup.ts`（无 `innerText` shim）
- 现象/原因：性能热点（PERF-01/03/04）与 `isVisible` 真实行为在测试中会走 `textContent`/兜底分支，测试全绿不能说明生产无布局开销；同样，`pickPrimaryMedia` 的 `getBoundingClientRect` 在 jsdom 永远为 0，主播放器选择逻辑只是“能跑”。
- 建议修复：为 jsdom 注入可配置的 `innerText`/`getBoundingClientRect` shim 并断言调用次数（可选 debug 计数）；增加一个基于 `dev/preview.html` 的 Playwright 冒烟（真实布局、无账号）验证翻页/媒体等待路径。
- 影响范围：性能与视觉相关回归的可测性。
- 工作量：S/M

### 2.6 构建 / DX

#### DX-01 [P2][S] 版本号双写、元数据不完整、授权过宽、无 sourcemap

- 位置：`vite.config.ts:18-40`（`version: "0.1.0"`、`connect: ["*"]`、`grant` 含未使用的 `GM_notification`）、`package.json:7-15`（`version` 也是 0.1.0）、README 的安装流程依赖手动“从文件导入”
- 现象/原因：版本号两处维护容易漂移；userscript 缺少 `@homepageURL`/`@supportURL`/`@updateURL`/`@downloadURL`/`@icon`；`@connect *` 是自定义 AI 端点必需，但缺少文档警示；构建无 sourcemap，线上排查只能看压缩代码。
- 建议修复：用 `define` 从 `package.json` 注入版本（单一来源）；补元数据（本地/占位 URL 也可）；生产构建保留 sourcemap 到独立文件（不随安装包分发）或在 README 说明；删除未用 grant。
- 影响范围：发布流程、问题排查。
- 工作量：S

#### DX-02 [P2][S] 无 lint/格式化/CI，严格选项未开，`npm test` 与沙箱 workaround 的边界未文档化到 CI

- 位置：`package.json:7-15`（只有 dev/build/test/typecheck，无 lint）、仓库无 eslint/prettier 配置（仅 json/md 文件）、`tsconfig.json:5-25`（无 `noUnusedLocals`/`noUncheckedIndexedAccess`）、`tests/dom/tools/vite-sandbox-patch.cjs`（仅测试用 patch，注释里给了 PowerShell 用法）
- 现象/原因：死代码（ARCH-03）与越界读取无法被静态检查；README 写了 `npm test`，但在受限沙箱会 EPERM，需要手动改用 `npm run test:sandbox`；没有 CI 配置说明用哪个命令。
- 建议修复：加 ESLint（`@typescript-eslint`，规则从 `recommended` 起步）+ prettier；开启 `noUnusedLocals`/`noUnusedParameters`；CI 使用 `npm run typecheck && npm run test:sandbox && npm run build:sandbox` 或在正常环境用 `npm test`；README 增加“沙箱环境”小节。
- 影响范围：代码质量闸门、贡献者体验。
- 工作量：S

#### DX-03 [P2][S] 单文件 820KB 无体积预算/告警

- 位置：`dist/study-helper.user.js`（820,920 B / gzip 270,336 B）、`vite.config.ts`（无 chunk/size 配置）
- 现象/原因：字体表占约 43% 原始体积，后续再加平台/功能容易突破 1MB；userscript 每次安装/更新都要下载全量。
- 建议修复：加 `scripts/check-size`（Node 读取 dist，超过阈值失败）；在 CI 记录 raw/gzip 大小；字体表压缩/裁剪（PERF-06）后设 600KB 目标。
- 影响范围：安装/更新成本、移动端解析时间。
- 工作量：S

---

## 3. Top 10 优先修复建议（按 impact / effort 排序）

| # | 编号 | 严重度 | 工作量 | 修复内容 | 为什么优先 |
| --- | --- | --- | --- | --- | --- |
| 1 | R-01 | P0 | S | 提交前拦截 `hint` 模式、校验“已填入”覆盖率、提交二次确认；`autoConfirm` 不再硬编码 | 唯一不可逆的 P0：一次误点即提交空白/部分答案，影响成绩 |
| 2 | R-02 | P1 | S | HELLO 按 source 替换旧 child，导航清理 children/childMedia，sweep 降到 15s | 它是“旧题混入 → 假填入 → 误提交”链的源头，也是 R-04 的触发器 |
| 3 | R-04 | P1 | S | `waitForFill` 超时返回显式失败并在 UI 报错 | 消除“已填入 0 题”的成功假象，改动极小、收益直接 |
| 4 | R-06 | P1 | S | 填空数量不一致直接 `ok:false`，回读全部空 | 防止“少填一个空仍算成功”的静默失分 |
| 5 | R-05 | P1 | S | 提交结果需“非登录/验证页 + 结果特征/关键字”，否则判未知 | 避免登录跳转被当成功，影响全自动流程的停止条件 |
| 6 | R-03 | P1 | S | 媒体状态与任务目标统一按当前章节/URL 过滤 | 防止旧 frame 的 `allEnded/allTasksFinished` 让自动翻页跳过视频 |
| 7 | R-08 | P1 | S | `boot/init/getAdapter/interval` 全部 try/catch，损坏配置回退 | 一个字段损坏即可让面板永久卡“初始化”，修复成本低 |
| 8 | SEC-01 | P1 | M | agent 校验 `event.origin`/祖先 origin，WELCOME 带 nonce，避免 `"*"` 发送敏感消息 | 阻断第三方页面嵌入时驱动填入/提交与题目外泄 |
| 9 | PERF-02 | P1 | S | media-preferences 只处理新增媒体节点，无媒体时停止 Shadow 全扫 | 常态开销最大、影响所有页面，改动局部 |
| 10 | PERF-01 | P1 | M | `nextPage` 文本兜底限制容器/候选数，先 `textContent` 预筛再 `innerText` | 每次翻页的主开销，直接决定长章节挂机的流畅度 |

紧随其后（第 11–14）：R-20（内存题库不可见）、SEC-02（消息 schema/帧冒用）、PERF-03（2Hz 媒体上报）、R-07（固定 450ms 刷新）。

---

## 4. 可直接落地的低风险改进清单（quick wins）

> 全部为局部改动、无数据结构变更，建议每项独立提交并补一个对应测试。

- [ ] **QW-1** `host.submit()` 加 `mode === "hint"` 拒绝 + “已填入/总题数”校验；UI 提交按钮同步禁用（`host.ts:410-463`、`Solve.tsx:89-96`、`Home.tsx:215-223`）
- [ ] **QW-2** `waitForFill` 超时补 `ok:false` 结果并 `toast("error")`；`fillAll` 用 `failed` 判断（`host.ts:874-887`、`394-407`）
- [ ] **QW-3** `applyFill` 比较 `values.length` 与 `blanks.length`，不一致 `ok:false`；回读全部空（`fill.ts:285-325`、`config-adapter.ts:347-377`）
- [ ] **QW-4** 提交结果判定加“非 passport/login/验证页 + 结果关键字”双条件（`submit.ts:161-191`、`config-adapter.ts:484-515`）
- [ ] **QW-5** HELLO 按 `source` 替换旧 child；`onNavigation` 清理非 top 的 `children/childMedia/activeMediaFrameId`；`sweepFrames` 60s → 15s（`host.ts:780-807`、`1191-1222`）
- [ ] **QW-6** `getChildMediaState` 的 `media` 与 `getMediaPlaybackTarget` 增加章节/URL 过滤（`host.ts:1103-1145`、`952-998`）
- [ ] **QW-7** `boot()` 外层 try/catch；`getAdapter` 内校验 `Array.isArray(generic.matches)`；interval 回调 catch（`boot.ts:10-33`、`registry.ts:16-25`、`host.ts:227-234`）
- [ ] **QW-8** 把 `BankStats.storage/indexedDbAvailable` 透传到 `UiState`，内存模式在题库页顶部警示（`db.ts:374-398`、`bank/index.ts:91-102`、`host.ts:642-651`、`contract.ts:36-39`）
- [ ] **QW-9** 调试开关接到 logger（`setMuted` 或 debug 不写入 500 条环形缓冲、不 console 输出），删除或接入 `logLevel`（`logger.ts:45-94`、`Settings.tsx:133-138`）
- [ ] **QW-10** 从 `accept`/`detectBankFormat` 移除 `.jsonl`，或在 `parseJsonRows` 失败时按行解析（`bank/index.ts:455-461`、`parser.ts:280-292`、`Bank.tsx:131`）
- [ ] **QW-11** `createMessage` 改分布式 `Omit`，`isFrameMessage` 增加必填字段校验；agent 的 WELCOME/指令校验 `event.origin`（`messages.ts:51-59`、`agent.ts:136-148`）
- [ ] **QW-12** media-preferences 的 observer 只检查 `addedNodes` 中的媒体，无媒体时 5s 节流/停用 Shadow 扫描；1.5s 定时器仅在 `playbackRate != 1` 或曾发现媒体时运行（`media-preferences.ts:190-217`、`271-276`）
- [ ] **QW-13** `db.ts` 统一 `await Promise.all([requestAsPromise(req), done])`，消除未处理拒绝（`db.ts:141-209`）
- [ ] **QW-14** 会话加 `savedAt` + 2h 过期 + `lastUrl` 校验；`stop()` 始终 `persist(false)`（`autoturn.ts:10-18`、`67-81`、`99-116`、`534-557`）
- [ ] **QW-15** `stop()` 只在 running→stopped 转换时 `pauseMedia()`（`autoturn.ts:99-116`、`host.ts:456/1191-1203/503-508`）
- [ ] **QW-16** 删除死代码与未用 grant，开启 `noUnusedLocals`；`Settings.tsx` 改用 `maskApiKey`（`ARCH-03` 各处、`vite.config.ts:25-34`、`tsconfig.json`）
- [ ] **QW-17** 滑块设置用 `onChange`/200ms debounce；写失败 patch UI 警示（`SolvingPanel.tsx:53-63`、`BankPanel.tsx:16-24`、`settings-store.ts:104-115`）
- [ ] **QW-18** agent 增加 1.5s URL 轮询 + `popstate/hashchange`，URL 变化重发 HELLO/STATE（`agent.ts:439-456`）
- [ ] **QW-19** `pagehide` 时调用 `host.dispose()`/`agent.dispose()`/media disposer（`boot.ts:10-33`、`host.ts:490-509`、`agent.ts:458-481`）
- [ ] **QW-20** 加 `noUnusedLocals`、ESLint（recommended）、`check-size` 脚本；README 补沙箱/CI 命令（`package.json`、`tsconfig.json`、`vite.config.ts`）

---

## 5. 已核实的正面项（避免过度修复）

- **考试门禁**在 `solve`/`fillAll`/`submit` 三处均有检查（`host.ts:272-276`、`330-334`、`410-414`），子 frame 提交也会二次检查（`agent.ts:403-404`）。
- **Key 处理**：密码输入框（`AiPanel.tsx:78-89`）、关闭的 Shadow DOM（`mount.tsx:27`）、日志 `redact` 覆盖 `sk-*`/`Authorization`/`apiKey`/`token`（`logger.ts:18-22`）；未发现把 Key 写入日志或导出文件的路径。
- **XSS**：全仓库没有 `dangerouslySetInnerHTML`；唯一的 `innerHTML` 在 `utils/text.ts:12` 的 `<textarea>` 实体解码，不进入渲染树；题目/选项/日志均以文本节点渲染，Shadow DOM 内未发现脚本注入点。
- **无遥测**：除用户配置的 AI/远程题库地址与页面 CSS 指定的字体 URL 外，没有硬编码的外部请求。
- **题库降级**本身有实现（`db.ts:374-398`）且会 `warn`，只是 UI 不可见（R-20）。
- **媒体偏好**的“只应用一次静音、1x 不写倍速、跨 frame 设置同步”逻辑与设计文档一致，并有 `video-preferences` 测试覆盖。

## 6. 未覆盖 / 限制

- 未在真实学习通账号页面验证：iframe 结构、任务点 DOM、`font-cxsecret` 字体、9010 页面文案均以 fixture/公开结构为准；R-02/R-03/R-09 的实际触发频率取决于平台是否整页刷新/iframe 是否复用。
- 未做真实网络/IndexedDB 配额实验；“内存题库丢数据”“远程超时”的结论来自代码路径与测试替身。
- 未运行 `npm test`（沙箱 EPERM），也未重新构建；体积数据来自既有 `dist/`（与源码版本一致，git clean）。
- 性能建议中的耗时均为静态分析/既有 perf 测试推断，未在真实浏览器 profile；建议修复后用 `dev/preview.html` 做一次 Performance 录制对比。
