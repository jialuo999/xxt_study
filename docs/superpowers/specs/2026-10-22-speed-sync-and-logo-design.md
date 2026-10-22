# 倍速跨 frame 同步与 Logo 更新 — 设计文档

- 日期：2026-10-22
- 状态：已批准并实现
- 范围：`src/core/settings-store.ts`、`src/app/media-preferences.ts`、`src/ui`、README
- 前置：`docs/superpowers/specs/2026-10-22-settings-consolidation-media-fix-design.md`

## 1. 目标

1. 删除设置页里类似“倍速在主页「自动翻页」卡片调整，默认 1x；不伪造进度”的冗余注释。
2. 修复主页倍速选择仍然无法控制视频的问题。
3. 把 Logo 换成参考图里的“打开的书本”形状，配色继续使用强调色（紫→青渐变）。

## 2. 倍速失效根因

学习通常见结构是顶层 `mooc1.chaoxing.com` + 内容 iframe `mooc1-1.chaoxing.com`，两者跨域。每个 frame 各有一份脚本实例和 `settings-store` 缓存：

- 顶层修改倍速后，只更新顶层缓存并写入 GM 存储；
- 子 frame（视频真正所在处）不会收到通知，缓存仍是旧值，`startMediaPreferences` 继续按旧倍速/1x 处理；
- 因此主页选择倍速后，iframe 里的视频看起来“不受控制”。

此外，部分播放器会在 `ratechange` / 播放开始时把 `playbackRate` 重置为 1，普通 1–2 秒轮询不够及时。

## 3. 修复方案

### 3.1 跨 frame 设置同步

- `settings-store` 新增 `refreshSettings()`：从 GM 存储重新读取设置，与缓存比较，有变化时更新缓存并通知订阅者；读取失败/空值/非对象不覆盖当前缓存，本地写入失败时也不被旧存储回滚。
- 新增 `startExternalSettingsSync()`：通过 `GM_addValueChangeListener` 监听 `SETTINGS_KEY`，其他 frame/tab 写入时立即同步。`vite.config.ts` 增加 `GM_addValueChangeListener` / `GM_removeValueChangeListener` 授权。
- 媒体偏好模块同时保留 1.5 秒轮询作为兜底（用户脚本管理器不提供监听、或开发环境下 localStorage 同源共享时仍可工作）。
- GM 存储在 Tampermonkey 内跨 frame 共享；开发预览使用 localStorage 同源共享。

### 3.2 播放器重置倍速

- 新增 `ratechange` 捕获监听：当播放器把倍速改回 1 时立即补回配置值（200ms 节流，避免与播放器高频互相覆盖）。
- 保留 `timeupdate`（1 秒节流）与 1.5 秒定时兜底；配置为 1x 时所有路径都不写 `playbackRate`，不干扰手动调整。

## 4. Logo

- 新增 `bookOpen` 图标（打开的书本轮廓），替换顶部品牌 Logo 与悬浮球的 `spark` 图标。
- Logo 容器继续使用强调色渐变：`var(--sh-accent)` → `var(--sh-accent-2)`；悬浮球渐变也改为强调色变量，保证与主题强调色一致。
- 书本描边在 Logo 内加粗到 2.1，并加轻微 drop-shadow，改善白描边在渐变青端的对比度，贴近参考图的厚重图标风格。

## 5. 验证

- `settings-store` 测试：外部写入 GM 存储后 `refreshSettings()` 能同步；无变化时不重复通知；有 `GM_addValueChangeListener` 时立即同步；本地写入失败时不被旧存储回滚。
- 媒体测试：外层 frame 写入倍速后，子 frame 轮询在 1.5s 内生效；默认静音跨 frame 同步且尊重手动静音；播放器重置倍速时 `ratechange` 立即补回。
- 既有测试保持通过（媒体、拖动、设置合并）。
- 截图核对新 Logo 与设置页无冗余注释。
