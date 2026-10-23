# 0.2.0 审查问题修复 — 设计文档

- 日期：2026-10-24
- 状态：已实现
- 基线：`9a63a42`（0.2.0）
- 触发：对 0.2.0 的代码审查结论，修复播放保活与任务点顺序冲突、提交门槛误伤手动填写、多标签锁泄漏、frame 心跳竞态等问题

## 1. 播放保活与多任务点顺序冲突

修复前：

- 自动翻页开始时向所有子 frame 广播 `GUARD_START`；
- 每个子 frame 的守卫每 1.2 秒恢复暂停媒体；
- 新 frame 的 `HELLO` 先发 `PAUSE_MEDIA` 再发 `GUARD_START`，新守卫不知道这次暂停是脚本主动做的，会把非目标任务点重新播放。

修复后：

- 0.2.0 的播放守卫暂不接入自动翻页主流程（保留模块/消息/单测，待真实页面验证后再启用），避免与播放器自身的暂停策略互相拉扯造成抖动；
- `activateMediaFrame()` 只暂停旧目标、恢复新目标，不再发送守卫消息；
- `HELLO` 不再给新 frame 启动守卫，避免预加载视频被自动播放。

## 2. 提交门槛与手动填写

修复前：

- `filledQuestionIds` 只由脚本 `fillAll()` 写入；
- `filled === 0` 直接拒绝提交，UI 也禁用提交按钮；
- 用户手动填写、刷新后手动填写、考试页手动作答都会被误伤。

修复后：

- `filled === 0` 不再硬拦截，改为“首次点击提示 + 15 秒内二次点击确认”；
- UI 不再因 `filledCount === 0` 禁用提交，提示改为“手动填写后首次提交会要求二次确认”；
- `autoConfirm` 不再恒为 true：
  - 复核模式下即使 100% 覆盖也传 `false`，保留平台原生确认框；
  - 只有用户二次确认，或全自动模式且覆盖率 100% 时才传 `true`。

## 3. 多标签锁泄漏

修复前：

- `init()` 先抢锁，再 `restore()`；
- `restore()` 因会话 URL 不一致/过期直接返回时，锁仍被持有并持续心跳。

修复后：

- `AutoTurnRunner.restore()` 返回 `boolean`；
- Host 只有在真正恢复时才保留锁，否则立即 `releaseAutoTurnLock()`。

## 4. frame 心跳与 sweep 竞态

修复前：

- 子 frame 心跳 15 秒，Host sweep 阈值也是 15 秒；
- 后台节流/定时器抖动会先删掉健康 frame；
- `PING` 只更新已存在 child，删除后无法重新建连。

修复后：

- `FRAME_STALE_MS = 120_000`（保留 15s heartbeat 的 8 个周期余量）；
- 旧 frame 仍由 `source.closed` 与章节过滤清理。

## 5. 顺序兜底与导航状态

- `fallbackMediaTarget` 改为按 `children` 顺序遍历，不再按 `childMedia` 上报顺序；
- 同一 iframe SPA 换 URL 时，`HELLO` 清空旧 questions/媒体状态；
- `onNavigation()` 清空子 frame 的旧题目与全部 childMedia、activeMediaFrameId；
- 顶层 URL 变化后子 frame 会在 1 秒内重新上报。

## 6. bfcache

- `pagehide` 事件 `persisted === true` 时不再 `dispose()`：
  - 顶层 HostController 不解绑监听；
  - 子 frame agent、媒体偏好不销毁；
  - 用户按浏览器“后退”恢复页面后功能仍可用。

## 7. 诊断包与消息

- 诊断包额外脱敏 `ai.baseUrl` 的 query/hash、`bank.remote.bodyTemplate`；frame title 也走 `redact`；
- 跨 frame 文本上限从 4000 放宽到 20000，避免长题干导致整条 `QUESTIONS` 被拒绝。

## 8. 媒体偏好性能与播放器事件

- `syncTimer` 在 1x 时从每 1.5 秒全文档 + Shadow 扫描降为每 6 秒一次；
- 非 1x 时仍每 1.5 秒补回倍速；
- 播放守卫为 Shadow DOM 内的媒体补挂 `pause/play/ended` 监听（这些事件不会 composed 冒泡到 document），并用 `composedPath`、宿主 `shadowRoot` 与系统媒体键识别人工暂停；
- 守卫启动前已暂停且有播放进度的媒体视为用户暂停，先尊重 30 秒。

## 9. 播放抖动

- `waitForTaskMedia` 不再每 500ms 无条件 `activateMediaFrame`：只在目标切换时激活；
- 目标暂停时最多每 5 秒重试一次 `RESUME`，不再高频 `play()`；
- `waitForExternalMedia` 的 `resumeChildMedia()` 从每 500ms 降到最多每 3 秒一次；
- 移除所有 `video.click()` 兜底（`media-wait` / `agent` / `playback-guard`）：点击 video 会切换播放/暂停，连续重试就是抖动的直接来源；现在只做 focus + `play()`，失败后交给 blocked/手动提示；
- 0.2.0 播放守卫不接入主流程，避免 1.2s 一次的自动恢复与平台暂停策略互相拉扯。

## 10. 提交结果 URL

- 结果页判定只看 `pathname`，避免把 `?success=0` 等失败 query 当成成功；
- 补充 `/work/selectWorkQuestion` 结果路由。

## 11. 验证

- 新增/更新：任务点兜底顺序、restore 返回 false、锁释放、目标 frame 守卫消息顺序、手动填写二次确认、复核模式 autoConfirm=false、长题干、诊断 baseUrl/模板脱敏、Shadow DOM 媒体、系统媒体键、启动前暂停；
- `npm run typecheck` 通过；
- `npm test`：28 文件 / 340 条通过；
- `npm run test:sandbox` 通过；
- `npm run build` 通过。
