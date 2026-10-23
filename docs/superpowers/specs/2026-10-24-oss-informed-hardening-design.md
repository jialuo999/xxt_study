# 借鉴开源项目的稳定性、可观测性与工程质量优化 — 设计文档

> 后续审查修复：`docs/superpowers/specs/2026-10-24-review-hardening-fixes.md`（播放守卫只跟随当前任务点、提交手动/自动确认、锁释放、frame 过期阈值等）。

- 日期：2026-10-24
- 状态：已实现（2026-10-24）
- 依据：
  - 开源生态调研：[`docs/research/oss-survey.md`](../../research/oss-survey.md)
  - 只读代码审计：[`docs/research/code-audit.md`](../../research/code-audit.md)
- 触发：用户要求「结合网络开源项目对本项目进行优化」，并选择「稳定性 / 可观测性 / 工程质量」三个方向。

## 1. 问题与目标

调研结论：`ocsjs/ocsjs`、`zhu-hailin/chaoxing-ai-assistant` 等活跃项目在三个结构性能力上领先：

1. **播放保活是事件驱动**（`media.addEventListener("pause", play)`）并区分「脚本暂停 / 人工暂停」，而不是只靠上层轮询；玩家藏在 Shadow DOM 时也会被发现。
2. **结构化诊断**（版本、页面枚举、选择器命中、错误码、脱敏日志）已经产品化；本项目只有纯文本日志，且 README 承诺的「复制页面结构」尚未实现。
3. **失败语义清晰**：填入超时、提交结果未知、多标签同时运行都有明确状态；本项目存在「已填入 0 题」成功假象、iframe 重载后旧题混入、多标签同时点「下一节」等问题。

审计另外确认了一个 **P0**：`host.submit()` 不拦截「仅提示」模式、不校验是否已填入，且 `autoConfirm` 恒为 `true`，可能直接提交空白/部分作答。该问题不可逆，必须本轮一并修复。

本轮目标：

- 自动翻页期间播放器被平台/失焦暂停后能可靠恢复，且不抢用户的主动暂停；
- 播放器在 Shadow DOM / 多层 iframe 中也能被静音、倍速、等待；
- 同一课程只允许一个标签页自动翻页；
- 一键复制脱敏诊断包，替代「靠猜」排查真实页面差异；
- 提交、填入、iframe 生命周期不再出现静默成功/旧状态污染；
- 代码结构更适合维护：媒体等待、播放目标选择从超大文件中拆出，版本号单一来源。

## 2. 方案选择

- **方案 A（采用）**：在现有架构上增量加固；新能力做成独立模块（`playback-guard`、`tab-lock`、`diagnostics`），通过显式接口接入 `host/agent`；同时修 P0/P1 缺陷。风险可控、每项都能用 jsdom 单测覆盖。
- 方案 B（不采用）：重写媒体层为集中状态机。长期更干净，但会与现有任务点顺序播放逻辑大面积冲突，回归风险高。
- 方案 C（不采用）：只交付调研/审计报告。无法满足「优化项目」的诉求。

## 3. 改动范围

### 3.1 播放保活守卫（P1）

新增 `src/app/playback-guard.ts`：

- 只在自动翻页运行期间启用（顶层 + 子 frame 各自启动），默认跟随 `settings.video.resumeOnPause`；
- 监听 `pause` / `play` / `ended` / `visibilitychange`，并用 1.2s 低频轮询兜底；
- **脚本暂停记账**：脚本自己 `pause()`（停止翻页 / 暂停非目标任务点）前调用 `suspend()`，恢复目标时调用 `resume()`，避免自己把自己恢复；
- **人工暂停识别**：暂停前 1.5s 内用户在播放器/页面内发生过 `pointerdown` / `keydown` 时，视为人工暂停，尊重 30s 或直到再次 `play`；
- 恢复有界：同一媒体连续失败 3 次后退避 30s，只提示一次，不无限刷 `play()`；
- 恢复后做 2s 进度连续性检查：`currentTime` 不增长记录 `stalled`；出现明显 seek（>10s 跳变）记录日志并提示，**不 seek、不改进度、不伪造观看记录**；
- 不处理 `ended`，不处理跨域 iframe（由该 frame 内 agent 处理）。

接入：

- `src/core/messages.ts` 增加 `GUARD_START` / `GUARD_STOP` / `GUARD_NOTICE`；
- `host.startAutoTurn()` / `restore()` 启动守卫并向子 frame 广播 `GUARD_START`；`stop()` → `onStopped` 停止守卫并广播 `GUARD_STOP`；
- `agent.ts` 收到指令后启动/停止本地守卫；`PAUSE_MEDIA` 先 `suspend()` 再暂停，`RESUME_MEDIA` 再 `resume()`；
- 子 frame 守卫失败提示通过 `GUARD_NOTICE` 上报，host 限频 toast + 日志。

### 3.2 播放器发现增强（P2）

`src/app/media-preferences.ts`：

- `collectDocumentMedia` 改为「light DOM + 所有 open Shadow Root」合并，`WeakSet` 去重、深度 ≤3、元素上限沿用 800；
- 不再只有在「顶层一个媒体都没有」时才进 Shadow DOM；
- MutationObserver 只处理 `addedNodes` 中新增的 `video/audio` 或包含它们的子树（PERF-02）；1.5s 定时器只在「曾发现媒体」或 `playbackRate !== 1` 时运行；
- 导出 `collectDocumentMedia` 供守卫复用；
- 不改变「默认静音只应用一次、1x 不写倍速」的现有约定。

### 3.3 多标签互斥（P11）

新增 `src/app/tab-lock.ts`：

- 锁 key = `courseId:clazzId`（从 URL 参数取，缺失时用 `hostname + pathname` 前缀）；
- 存储使用 `localStorage`（跨标签同源），值 `{ tabId, heartbeatAt, label }`；
- 抢锁：无锁或心跳超过 15s 视为可接管；失败返回持有者信息；
- 心跳 5s；`stop` / `pagehide` 释放；`dispose` 释放；
- `host.startAutoTurn()` 抢锁失败时 toast「另一个标签页正在自动翻页」并拒绝启动，不停止对方；
- 抢锁成功后若心跳发现锁被接管，停止本页自动翻页并提示；
- 不引入设置项，避免默认行为复杂化。

### 3.4 诊断包（P12）

新增 `src/app/diagnostics.ts`：

```ts
interface DiagnosticsReport {
  scriptVersion: string;
  generatedAt: string;
  userAgent: string;
  url: string;            // 只保留 path + 白名单参数
  page: { kind; supported; reason };
  frames: FrameSummary[];
  questions: { total; byType; withImage; samples: Array<{ type; stem: string; options: number }> };
  selectors: Array<{ name: string; selector: string; hits: number }>;
  media: MediaState | null;
  autoTurn: AutoTurnView;
  tabLock: { holder: boolean; heartbeatAt: number | null };
  settings: unknown;      // apiKey → "已设置/未设置"；headers/URL query 脱敏
  logs: LogEntry[];        // 最近 100 条（logger 已脱敏，导出前再 redact 一次）
}
```

- 文案样本截断 40 字、最多 10 条；不含答案文本；
- 选择器命中矩阵复用 `platform/chaoxing/selectors.ts` 常量；
- `UiController` 增加 `copyDiagnostics(): Promise<boolean>`；`HostController` 实现（`navigator.clipboard`，失败回退 textarea + `document.execCommand("copy")`）；
- 设置页「运行日志」卡片增加「复制诊断包」按钮，成功后 toast；失败提示手动导出日志；
- 支持 `GM_registerMenuCommand("复制诊断信息", ...)` 作为后备入口（可选）。

### 3.5 提交与填入安全（审计 R-01/R-04/R-06）

- `HostController.submit()`：
  - `solving.mode === "hint"` 直接拒绝并提示「仅提示模式不会提交」；
  - 新增 `filledQuestionIds` 状态：`fillAll()` 成功结果写入；提交前计算覆盖率，低于 100% 时弹二次确认（「还有 N 题未填入，仍要提交？」），确认后才继续；
  - `autoConfirm` 只在显式确认或全自动模式且覆盖率 100% 时为 true；
  - UI（`Solve.tsx` / `Home.tsx`）在 hint 模式禁用「提交」，并显示「已填入 N/M」。
- `waitForFill` 返回 `{ results, timedOut }`：超时补一条 `ok:false` 结果；`fillAll` 超时 toast error、状态「填入超时」、返回 false。
- 填空：`values.length` 与页面 `blanks.length` 不一致时 `ok:false`，message 写明「答案 N 空 / 页面 M 空」；回读全部空位；多余答案记 warn（`chaoxing/fill.ts` 与 `generic/config-adapter.ts` 同步）。

### 3.6 iframe 生命周期与媒体归属（审计 R-02/R-03）

- `HELLO` 时先按 `event.source` 找同源旧条目并替换，不再只按随机 `frameId`；只清该 frame 的媒体状态，不 `clear()` 全部；
- `onNavigation()` / 任务签名变化时清空非 top 的 `children` / `childMedia` / `activeMediaFrameId`；
- `sweepFrames` 过期阈值 60s → 15s；
- `getChildMediaState()` 与 `getMediaPlaybackTarget()` 统一按当前 `chapterId` / `taskUrlKey` 过滤，旧 frame 的 `allEnded`/`allTasksFinished` 不能跳过新章节视频；
- 发送 `FILL` 前校验 child 仍指向当前题目所属 frame，失败直接报错而不是等 30s。

### 3.7 启动韧性与消息安全（审计 R-08/SEC-01/SEC-02 类型部分）

- `main.ts` / `boot()` 外层 try/catch，失败时 logger.error + 面板 error 状态；
- `getAdapter()` 内部对 `genericConfig.matches` 做数组/字符串守卫；
- `host` 的 interval / `onNavigation` 回调 try/catch；
- `createMessage` 的 `Omit` 改为分布式形式，恢复按分支的字段检查；`isFrameMessage` 之外增加 `validateFrameMessage` 的必填字段/长度校验（不引入依赖）；
- `agent.ts` 处理 WELCOME/指令前校验 `event.origin` 属于 `chaoxing.com` / `edu.cn` 白名单；`HELLO` 附带随机 nonce，WELCOME 回显，nonce 不匹配忽略；
- 不改变现有 token 机制。

### 3.8 提交结果判定（审计 R-05）

`chaoxing/submit.ts` 与 `generic/config-adapter.ts`：

- URL 变化只有在「不是 passport/login/验证页」且「命中结果页特征（结果关键字/URL 规则）」时才判成功；
- 仅 URL 变化但无法确认 → `ok:false, message:"页面已跳转但未检测到提交结果，请人工确认"`；
- 记录 `beforeUrl → afterUrl` 到 debug 日志（脱敏）。

### 3.9 模块拆分与构建（工程质量）

- 新增 `src/app/media-wait.ts`：从 `autoturn.ts` 拆出 `waitForMedia`、`findMedia`、`MediaWaitResult`（约 200 行）；`autoturn.ts` 保留重新导出以兼容现有导入。
- 新增 `src/app/media-target.ts`：从 `host.ts` 拆出 `taskUrlKey`、`taskKeyParam`、`findChildForTask`、`selectMediaPlaybackTarget`、`summarizeChildMediaState`（纯函数，便于测试）。
- `vite.config.ts` 从 `package.json` 读取版本，userscript `@version` 与 `__APP_VERSION__` 单一来源；`package.json` 升到 `0.2.0`；
- 删除未使用的 `GM_notification` grant（若确认无调用）；
- 补 `src/env.d.ts` 声明 `__APP_VERSION__`。

## 4. 非目标

- 不做章节树导航（P4）、`attachments/jobid` 任务点模型（P3）、题库匹配算法（P6）、AI 调度器（P8）、图片题视觉路由（P9）、字体表自愈（P10）；
- 不自动识别/绕过验证码、人脸识别，不做视频秒过/进度伪造、不做 `rateHack`；
- 不引入新的运行时依赖；
- 不提供 `updateURL/downloadURL`（仓库尚无发布地址），只在 README 说明；
- 不修改 `@connect ["*"]`（自定义 AI/远程题库端点需要它），但补充安全说明。

## 5. 测试计划

新增/更新：

- `tests/unit/playback-guard.test.ts`：平台暂停自动恢复；用户按压后不抢；`suspend()` 时不恢复；连续失败退避；`ended` 不处理；进度停滞记录。
- `tests/unit/tab-lock.test.ts`：抢锁/冲突/心跳过期接管/释放/被接管回调。
- `tests/unit/diagnostics.test.ts`：版本/页面/选择器统计齐全；apiKey、headers、URL query 不出现；日志再脱敏；题目样本截断。
- `tests/unit/media-target.test.ts`：章节过滤、任务点 URL 匹配、旧 frame 不参与。
- `tests/unit/media-wait.test.ts`：改为从新模块导入，原有断言保持。
- `tests/unit/submit-safety.test.ts`（或扩展 `tests/integration/host.test.ts`）：hint 拒绝提交；未填入需确认；`fillAll` 超时返回 false；填空数量不一致失败；登录跳转不算成功。
- `tests/unit/frame-lifecycle.test.ts` / 扩展：iframe 重载后旧题不合并；导航清理；媒体状态章节过滤。
- 现有 251 个测试全部保持通过。

验收命令：`npm run typecheck && npm run test:sandbox && npm run build:sandbox`（受限沙箱环境；普通环境可用 `npm test` / `npm run build`）。

## 6. 风险与回滚

- **播放守卫与人工操作冲突**：用「用户手势 + 脚本暂停记账 + 30s 人工暂停窗口」三重保护；守卫只在上层显式启动时工作。
- **多标签锁误伤**：15s 心跳过期自动接管；停止/卸载释放；冲突只拒绝启动，不停止对方。
- **诊断包含题干**：截断 40 字且最多 10 条，不含答案；导出前再次 `redact`；用户主动点击才生成。
- **模块拆分回归**：纯搬迁 + 重新导出，行为不变；现有测试 + 新增测试兜底。
- **提交二次确认改变全自动流程**：仅在全自动模式且覆盖率 100% 时保持原行为；其余模式显式确认，符合「默认人工复核」的产品原则。

## 7. 交付物

- 代码：上述模块与接入改动；
- 测试：新增/更新测试；
- 文档：本设计、README（功能/限制/诊断/沙箱命令）、`THIRD_PARTY_NOTICES.md`（补充 MIT 参考项目，仅借鉴思路/算法，不复制代码时也标注灵感来源）；
- 验证：typecheck、test:sandbox、build:sandbox 全部通过，构建产物大小记录。
