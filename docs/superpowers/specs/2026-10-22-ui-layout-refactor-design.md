# 学习助手 UI 布局重构 — 设计文档

- 日期：2026-10-22
- 状态：已批准并实现
- 范围：`src/ui`、`src/core/settings.ts`、README；不改变自动翻页与媒体运行的既有行为

## 1. 目标

当前面板信息密度过高：设置页 8 张长卡片全部展开、自动翻页卡片有 5 个数值输入、日志单独占一个 Tab、主页还重复展示最近日志。本次重构目标：

- 设置页每个板块可折叠/展开，降低一次性可见信息量。
- 自动翻页设置只保留开关，删除延迟与步数输入（后台默认值不变）。
- 取消「默认倍速」设置项，默认 1x；倍速改到主页自动翻页卡片调节。
- 日志折叠进设置页，取消独立日志 Tab。
- 「概览」改名「主页」，删除主页最近日志板块。
- 顺手补齐状态摘要、展开记忆等可用性细节。

## 2. 非目标

- 不改变自动翻页算法、延迟默认值（起步 1.5s、翻页 2–5s 随机、无媒体等待 3s、上限 200 步）。
- 不改变媒体静音/倍速的应用方式，不新增媒体进度伪造等能力。
- 不改动题库、AI、答题流程（除倍速控件位置外）。
- 不引入新的运行时依赖。

## 3. 方案

### 3.1 导航

Tab 从 5 个减为 4 个：`主页 / 答题 / 题库 / 设置`。`TabId` 由 `overview | solve | bank | settings | logs` 变为 `home | solve | bank | settings`；`readInitialTab` 默认 `home`，旧 hash（如 `#overview`）回退到 `home`。独立日志页面删除。

### 3.2 可折叠卡片

在 `components.tsx` 新增 `CollapsibleCard`：

- 头部左侧为展开按钮（chevron + 标题 + 摘要），右侧为可选 `action`（徽标等），二者为兄弟节点，避免按钮嵌套。
- `aria-expanded` / `aria-controls`，支持键盘 Enter / Space。
- 收起时显示一句话状态摘要，展开时显示原 `hint`。
- 展开状态持久化到 `settings.ui.sectionStates: Record<string, boolean>`；缺省值在设置页定义：答题模式、AI 接口默认展开，其余默认收起。

### 3.3 设置页板块（9 个）

1. 答题模式：模式、自动提交、简答题、考试允许、最低置信度。
2. AI 接口：启用、预设、Base URL、Key、模型、测试连接。
3. 自动翻页：仅保留 4 个开关（启用、等待视频结束、遇未答题目暂停、刷新后恢复）。
4. 媒体播放：默认静音、自动翻页时暂停后恢复；删除默认倍速下拉。
5. 题库与缓存：模糊阈值、缓存天数、远程题库配置。
6. 高级与通用适配器：调试模式、通用适配器 JSON。
7. 外观与快捷键：主题、快捷键。
8. 数据与隐私：恢复默认设置、Key 与题库统计（清空日志按钮移到日志板块）。
9. 运行日志：内嵌 `LogsPanel`（筛选、导出、复制、清空、列表）；清空加二次确认；标题摘要显示条数与错误数。

设置页顶部增加「全部展开 / 全部收起」按钮，一次写入 `sectionStates`。

### 3.4 主页

- 标题「主页」，删除「最近日志」卡片及相关导入。
- 自动翻页卡片：
  - 删除 `X/200 步` 进度条与步数文案，改为「已翻 N 页」。
  - 增加倍速选择（0.5x–3x，来自 `VIDEO_RATES`），直接写 `video.playbackRate`，立即生效。
  - 保留运行状态、开始/结束、重新扫描、翻页设置入口。
- 其余统计、快捷操作保持不变。

### 3.5 日志

`pages/Logs.tsx` 改为 `src/ui/LogsPanel.tsx`，导出无卡片包裹的 `LogsPanel`，由设置页第 9 个板块渲染。保留原有筛选、导出、复制、清空能力；清空改为确认弹窗。

### 3.6 样式

新增 `.sh-card--collapse`、`.sh-collapse-head/toggle/chevron/copy/body/action`、`.sh-select--compact`、`.sh-settings-toolbar`。沿用现有设计令牌与动效；遵循 `prefers-reduced-motion`。折叠不做高度动画，避免滚动抖动。

## 4. 数据与兼容

- 新增 `ui.sectionStates`（默认 `{}`，UI 读取时与内置默认合并）。旧设置缺少该字段时由 `settings-store.normalize` 自动补全。
- 保留 `autoTurn.startDelayMs / contentWaitMs / minDelayMs / maxDelayMs / maxSteps` 字段与默认值，仅从 UI 移除。
- 保留 `video.playbackRate` 字段；默认仍为 1，倍速控件迁移到主页。
- 旧 hash `#overview` / `#logs` 回退到 `home`，不报错。

## 5. 验收

- `npm run typecheck`、`npm test`、`npm run build` 通过。
- `dev/preview.html` 本地预览：主页 4 个 Tab、无最近日志卡、自动翻页卡有倍速与已翻页数。
- 设置页 9 个板块可独立折叠，刷新后保持展开状态；日志可筛选、导出、清空且需确认。
- README 与实际界面一致（Tab、设置、倍速位置）。
