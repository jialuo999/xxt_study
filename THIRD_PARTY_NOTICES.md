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

## 产品功能灵感（未使用代码）

以下项目没有声明开源许可（或未声明许可），因此**仅阅读其功能描述作为产品灵感，没有复制任何代码、选择器常量或资源**：

- pang-qin/chaoxing-toolkit — https://github.com/pang-qin/chaoxing-toolkit
- kukuqi666/chaoxing-script-ai — https://github.com/kukuqi666/chaoxing-script-ai
- Z-Fovik-RT/chaoxing-ai — https://github.com/Z-Fovik-RT/chaoxing-ai
- WN14755303413/xuexiaoyi-to-xuexitong-tampermonkey-proxy — https://github.com/WN14755303413/xuexiaoyi-to-xuexitong-tampermonkey-proxy

## 依赖

- Preact（MIT）— https://preactjs.com
- Vite（MIT）— https://vite.dev
- vite-plugin-monkey（MIT）— https://github.com/lisonge/vite-plugin-monkey
- Vitest（MIT）— https://vitest.dev
- jsdom（MIT）— https://github.com/jsdom/jsdom
- TypeScript（Apache-2.0）— https://www.typescriptlang.org
