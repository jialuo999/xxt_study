# 停止暂停媒体、多播放器兼容与字体反爬解码 — 设计文档

- 日期：2026-10-23
- 状态：已批准并实现
- 范围：`src/app/agent.ts`、`src/app/host.ts`、`src/app/autoturn.ts`、`src/app/media-preferences.ts`、`src/core/messages.ts`、`src/platform/chaoxing/question.ts`、`src/platform/chaoxing/font/*`、THIRD_PARTY_NOTICES、README

## 1. 停止自动翻页后自动暂停媒体

- 新增 `PAUSE_MEDIA` 跨 frame 消息；
- `AutoTurnRunner.stop()` 在停止/自动停止时调用 host `pauseMedia()`：暂停顶层文档媒体，并向所有子 frame 发送 `PAUSE_MEDIA`；
- 子 frame agent 收到后暂停当前文档内的所有 `video/audio`；
- 停止原因包括手动结束、达到最大步数、页面无变化、等待超时等，都会在停止时暂停，避免声音继续播放。

## 2. 同页多个视频/音频

原逻辑对所有 media 一起判断/一起 `play()`，隐藏的预加载或广告元素会导致：

- `allEnded` 永远不成立，等待卡死；
- 恢复播放时同时 `play()` 多个媒体，互相抢播放/声音。

修复：

- `pickPrimaryMedia()`：优先正在播放、其次可见面积最大的媒体；
- 子 frame 的媒体状态上报、恢复播放只针对主播放器；
- 主 frame `waitForMedia` 每轮重新选择主播放器，支持播放器切换/分段；
- `waitForExternalMedia` 只把仍有未结束媒体的 frame 纳入等待；
- 停止时仍暂停所有媒体（用户明确要停止声音）。

## 3. 学习通字体反爬乱码

现象：页面显示正常，但 DOM `textContent` 是乱码；题目/选项送入 AI 后置信度低。

学习通使用 `font-cxsecret` 内嵌自定义 TTF，把真实字符映射到伪字符。修复：

1. 在 `src/platform/chaoxing/font/typr-md5.ts` 内置 Typr.js + blueimp-md5（均为 MIT，见 THIRD_PARTY_NOTICES）；
2. 在 `src/platform/chaoxing/font/table.json` 内置公开的字形轮廓 MD5 → Unicode 映射表；
3. `decoder.ts` 从页面 `<style>` 中提取 `font-cxsecret` 的 base64 字体，用 Typr 解析字形路径，MD5 后查表还原字符；
4. 题目采集阶段在题干、选项、题型标签上调用 `decodeObfuscatedText()`，再进入题库/AI；
5. 无字体、纯 ASCII 或映射缺失时原样返回，不影响普通页面。

## 4. 验证

- 新增字体解码测试（内置 md5、无字体回退、ASCII 原样）。
- 新增多视频主播放器测试。
- 停止翻页的 `pauseMedia()` 调用测试。
- `npm run typecheck`、`npm run test:sandbox`（21 文件 / 232 测试）、`npm run build:sandbox` 均通过。
- 构建体积因内置字形表增至约 800 KB（gzip 约 274 KB），属于一次性映射数据。

## 5. 风险与后续

- 字形映射表来源未声明许可，仅作为数据表内置；若学习通更新字体，表可能需要更新。
- 未拿到真实页面字体样本，解码逻辑按公开脚本实现；建议在真实测验页开启调试模式确认日志 `font: 已解析学习通加密字体` 出现且题干正常。
- 多播放器选择基于“正在播放/可见面积”启发式；极端页面可继续按真实 DOM 调整。
