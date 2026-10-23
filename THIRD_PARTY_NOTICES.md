# 第三方参考与许可说明

本项目为独立实现。开发过程中参考了以下开源项目与公开资料；除非特别说明，**没有复制其源代码**，仅借鉴页面结构、选择器思路与产品交互。所有引用均在此标注出处与许可。

## 代码/选择器参考

### CodFrm/cxmooc-tools

- 链接：https://github.com/CodFrm/cxmooc-tools
- 许可：MIT
- 参考内容：学习通作业/考试页的 DOM 结构（`.TiMu`、`.Zy_TItle`、`.Zy_ulTk`、`.answerBg` 等）、提交按钮与下一节按钮的候选选择器、视频元素 `#video_html5_api` 的监听方式。
- 使用方式：选择器名称与页面结构认知；本项目重新实现了采集、填答、校验与提交逻辑，未复制其源码。相关文件头注释已注明出处。

MIT License (CodFrm/cxmooc-tools)

```text
MIT License

Copyright (c) CodFrm

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### tchigher/cxmooc-tools

- 链接：https://github.com/tchigher/cxmooc-tools
- 许可：MIT（上游 fork）
- 参考内容：同上，作为 cxmooc-tools 的镜像/分支查阅。

### photopea/Typr.js

- 链接：https://github.com/photopea/Typr.js
- 许可：MIT
- 使用方式：以压缩后的 `Typr.js` + `Typr.U.js` 形式内置在 `src/platform/chaoxing/font/typr-md5.ts`，用于解析学习通页面内嵌的 TTF 字体、读取字形轮廓。

### blueimp-md5

- 链接：https://github.com/blueimp/JavaScript-MD5
- 许可：MIT
- 使用方式：以压缩形式与 Typr 一起内置，用于计算字形路径的 MD5 映射。

### 学习通字形映射表

- 来源：`https://www.forestpolice.org/ttf/2.0/table.json`（经 ScriptCat 脚本“超星学习通考试/测验题目提取”引用）
- 许可：未声明；本项目仅将其作为字体反爬解码用的字形 → Unicode 数据表内置，不包含可执行代码。
- 使用方式：`src/platform/chaoxing/font/table.json`，配合 Typr 字形轮廓 MD5 还原题目文字。

MIT License (Typr.js / blueimp-md5)

```text
MIT License

Copyright (c) 2014 photopea
Copyright (c) 2011-2023 blueimp

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 产品功能灵感（未使用代码）

以下项目没有声明开源许可（或未声明许可），因此**仅阅读其功能描述作为产品灵感，没有复制任何代码、选择器常量或资源**：

- pang-qin/chaoxing-toolkit — https://github.com/pang-qin/chaoxing-toolkit
- kukuqi666/chaoxing-script-ai — https://github.com/kukuqi666/chaoxing-script-ai
- Z-Fovik-RT/chaoxing-ai — https://github.com/Z-Fovik-RT/chaoxing-ai
- WN14755303413/xuexiaoyi-to-xuexitong-tampermonkey-proxy — https://github.com/WN14755303413/xuexiaoyi-to-xuexitong-tampermonkey-proxy
- Minnjee/course-helper — https://github.com/Minnjee/course-helper（参考了倍速播放的两个通用思路：定时重新断言 playbackRate、在直接查找不到时穿透 Shadow DOM 查 video；本项目为独立实现，未复制代码）
- BlairCode/NoStopVideo — https://github.com/BlairCode/NoStopVideo（「防止视频因鼠标移出窗口而暂停」的产品思路；本项目播放保活为独立实现，未复制代码，许可状态未核实，仅作灵感记录）

## 2026-10 稳定性优化参考（仅借鉴思路，未复制代码）

本轮「播放保活 / 多标签互斥 / 诊断导出」优化阅读了以下 MIT 项目的实现思路，但代码均为本项目独立实现；如后续直接复用其中代码，需在此补充对应 MIT 许可全文与版权行：

- ocsjs/ocsjs（MIT）— https://github.com/ocsjs/ocsjs：`media.addEventListener("pause", play)` 的事件驱动保活思路、同源 iframe 递归查找媒体、配置迁移与诊断字段设计。
- zhu-hailin/chaoxing-ai-assistant（MIT）— https://github.com/zhu-hailin/chaoxing-ai-assistant：脚本暂停/人工暂停记账、恢复后进度连续性校验、子 frame URL 变化重新握手的产品思路。
- Khihl-lucky/ChaoXing-AutoAnswer（MIT）— https://github.com/Khihl-lucky/ChaoXing-AutoAnswer：多标签互斥锁（按任务链分键、心跳、过期接管）的产品思路。

## 已知许可风险

- `src/platform/chaoxing/font/table.json` 的字形映射数据来源 `https://www.forestpolice.org/ttf/2.0/table.json` **未声明许可**。本项目目前仅将其作为字体反爬解码用的数据表内置；若用于再分发，请先确认数据来源许可，或替换为自行生成的字形表。

## 依赖

- Preact（MIT）— https://preactjs.com
- Vite（MIT）— https://vite.dev
- vite-plugin-monkey（MIT）— https://github.com/lisonge/vite-plugin-monkey
- Vitest（MIT）— https://vitest.dev
- jsdom（MIT）— https://github.com/jsdom/jsdom
- TypeScript（Apache-2.0）— https://www.typescriptlang.org
