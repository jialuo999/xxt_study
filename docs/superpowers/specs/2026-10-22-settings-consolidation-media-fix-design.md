# 设置板块合并与媒体行为修复 — 设计文档

- 日期：2026-10-22
- 状态：已批准并实现
- 范围：`src/ui`、`src/app/media-preferences.ts`、`src/app/autoturn.ts`、`src/app/agent.ts`（只读核对）、README
- 前置：`docs/superpowers/specs/2026-10-22-ui-layout-refactor-design.md`

## 1. 目标

在上一轮布局重构基础上继续精简设置页，并修复媒体偏好对用户手动操作的干扰：

1. 「答题模式」与「题库与缓存」合并为设置页「答题」板块。
2. 「媒体播放」合并进「自动翻页」板块。
3. 设置页所有 hint / description 改为简短明确的短句。
4. 修复关闭「默认静音」「自动翻页时暂停后恢复」后，用户手动调整视频仍被覆盖的问题。
5. 修复拖动悬浮窗/面板松手瞬间的位置抖动。

## 2. 设置页结构（7 个板块）

| 板块 | 内容 |
| --- | --- |
| 答题 | 答题模式 + 最低置信度；子标题「题库与缓存」：模糊阈值、缓存天数、远程题库 |
| AI 接口 | 启用、预设、Base URL、Key、模型、测试连接 |
| 自动翻页 | 4 个翻页开关；子标题「媒体播放」：默认静音、暂停后恢复；倍速提示指向主页 |
| 高级与通用适配器 | 调试模式、通用适配器 JSON |
| 外观与快捷键 | 主题、快捷键 |
| 数据与隐私 | 恢复默认设置、Key / 题库统计 |
| 运行日志 | 筛选、导出、复制、清空（二次确认） |

`sectionStates` 仅保留上述 7 个 key；旧的 `bank` / `media` 展开状态被忽略。折叠状态与默认展开不变（答题、AI 默认展开）。

注释精简原则：每条 description / hint 只保留一个动作或限制，例如「媒体播完再翻页」「缓存命中不重复请求」「建议 0.84–0.90」「如 Alt+Shift+S」。

## 3. 媒体行为修复

问题根因（修复前）：

- `startMediaPreferences` 在 `loadedmetadata` / `canplay` / `play` 和**任意设置变更**时调用 `applyToMedia`，无条件写入 `muted` 与 `playbackRate`。
- `playbackRate` 为 1 时也会写回，覆盖用户在播放器里手动调整的倍速。
- `resumeOnPause` 关闭时，`waitForMedia` 仍把暂停判定为 `blocked`，自动翻页会停止。

修复后：

- 默认静音只在新媒体第一次出现时应用一次；用户手动静音/取消静音通过 `volumechange` 记录，之后不再覆盖。
- 配置为 1x 时完全不写 `playbackRate`；非 1x 才在平台重置后由 `timeupdate` / 定时器补回。
- 设置变更只在 `defaultMuted` 或 `playbackRate` 真正变化时应用；主题、折叠板块等普通变更不再重置媒体。
- 关闭默认静音时不强制取消静音，保持用户当前状态。
- `resumeOnPause` 关闭时：不自动 `play()`，不把暂停判定为阻塞；自动翻页等待用户手动恢复。
- `agent.resumeMedia` 仍在 `resumeOnPause` 开启时才恢复子 frame 媒体。

## 4. 拖动抖动修复

修复前：松手时先 `setPosition` 更新 left/top，但 transform 仍保留到两个 rAF 后才清除，导致位置短暂叠加、视觉上抖一下。

修复后：松手时同一帧内先同步写入最终 `left/top`，再清除 `transform` / `will-change`；下一帧恢复 transition。位置与状态保持一致，不再抖动。

## 5. 验证

- `npm run typecheck`
- `npm run test:sandbox`：新增/更新媒体行为测试（手动静音不被覆盖、手动倍速不被重置、关闭暂停恢复不自动播放/不误判阻塞）、设置合并与拖动测试。
- `npm run build:sandbox`
- 截图核对 7 个板块与合并后的子标题布局。
