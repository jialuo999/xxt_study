# 人机验证检测与自动暂停 — 设计文档

- 日期：2026-10-23
- 状态：已实现
- 范围：`src/platform/chaoxing/verification.ts`、`src/app/host.ts`、`src/app/autoturn.ts`、`src/ui/App.tsx`、`src/ui/contract.ts`、`src/ui/theme.css`、README
- 触发：用户截图「【9010】操作异常，请输入图片中的验证码」与日志 `study-helper-logs-1792768227714.txt`

## 1. 现象

自动翻页运行一段时间后，学习通返回 9010 验证页。旧版本没有识别该页面，面板仍显示章节状态，自动翻页逻辑可能继续点击或恢复播放；日志里也没有任何 `verify` 记录。

日志中可看到的触发背景：

- 15:08:48、15:09:14 连续翻过两个任务点已完成的章节；
- 15:09:34 重新开始翻页后，15:09:47 点击下一节，4 秒内页面签名未变化，脚本又尝试了下一个翻页候选；
- 15:09:51 因“页面没有变化”暂停。之后平台返回 9010 验证页。

平台判定细节无法从页面日志确定；能确定的是：频繁翻页/连续点击会提高触发概率，且验证码必须由用户手动完成。

## 2. 方案

### 2.1 识别

新增 `detectVerificationChallenge(doc)`：

- 命中 `【9010】`、`操作异常 + 验证码`、`请输入图片中的验证码`，或 `验证码` 文案 + 可见的 captcha 输入框/图片；
- 只读取**可见的 light DOM**：
  - 浏览器用 `body.innerText`（排除隐藏元素、script/style、Shadow DOM 中的面板 UI）；
  - jsdom 环境回退到 light DOM 遍历，跳过 `script/style/template/noscript` 与 `display:none` / `visibility:hidden` / `opacity:0` / `aria-hidden` 的节点；
- 必须同时看到可见的验证码输入框或图片，避免把隐藏登录弹层、脚本模板里的“验证码”文案当成真实验证页；
- 修复反馈「没弹出人机验证也提示」：旧版直接读取 `textContent`，会把学习通页面里的隐藏验证码模板/脚本字符串误判为验证页。

### 2.2 Host 行为

- `HostController.checkVerification()`：初始化、每次刷新、URL 轮询（1.2 秒）时检查；
- 检测到验证页时：
  - `autoTurn.stop()`，阻止继续点击；
  - 暂停当前页面与所有子 frame 的媒体；
  - `status = "error"`、`statusText = "需要手动验证"`；
  - 写 `UiState.verification`，日志记录 `[verify] 检测到平台人机验证…`；
  - 重置页后不再自动 `restore()` 自动翻页；
- 验证页消失（用户提交验证码，页面跳回）时清除状态，提示“验证已通过，可以重新开始自动翻页”，但不自动恢复翻页。

### 2.3 自动翻页

- `AutoTurnHost.hasVerificationChallenge()`；`AutoTurnRunner` 在进入循环、点击前、无变化重试前检查，命中即停止；
- 手动开始翻页时若仍在验证页，提示先完成验证。

### 2.4 UI

- 面板 Tab 下方新增固定在内容区上方的警示条（不随页面滚动）：
  「需要手动完成人机验证 / 自动翻页不会继续，请在页面中完成验证后重新开始。」
- 警示条只在 `verification.detected` 时出现；完成后自动消失。

## 3. 非目标

- 不识别、不提交验证码，不绕过平台风控；
- 不改变 9010 之外的页面识别逻辑。

## 4. 验证

- 单元测试：9010 验证页识别、普通验证页识别、普通章节页/提及验证码页面不误报；
- 自动翻页测试：检测到验证时不点击下一页并停止；
- UI 测试：`verification.detected` 时显示顶部警示条；
- `npm run typecheck`、`npm test`、`npm run build` 通过。

## 5. 风险与后续

- 如果 9010 页面只出现在跨域 iframe 内，顶层文档无法读取其 DOM；此时自动翻页会在签名不变后停止，不会无限点击。后续可由子 frame 上报验证状态。
- 识别文案依赖学习通当前页面文本；平台改文案时需要更新正则。
- 可见性判断不依赖布局矩形，避免 jsdom 与首屏未渲染时失效；如果平台把验证码表单用 `position:absolute; left:-9999px` 隐藏，仍可能被 `innerText` 计入，需要再补充视口/尺寸判断。
