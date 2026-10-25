[English](README.md) | **简体中文**

# 学习助手 · Study Helper

为学习平台页面提供 **自动翻页**、**题目识别与作答**、**本地题库检索**、**AI 解题**。

![面板预览](dev/preview.png)

## 功能

- **自动翻页**

- **章节树跳转**

- **多任务点顺序播放**

- **阅读/PDF/文档/PPT 任务**

- **字体反爬解码**

- **本地题库匹配**

- **AI 解题**（需用户自行接入api）

- **界面语言**：中文 / English，默认跟随浏览器语言。

## 安装

```bash
npm install
npm run build
```

构建产物：`dist/study-helper.user.js`。

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 打开 Tampermonkey 管理面板 → 实用工具 → 从文件导入 `dist/study-helper.user.js`。
3. 打开学习通页面，右下角出现悬浮球；点击或按 `Alt+Shift+S` 展开。

开发调试：

```bash
npm run dev          # Vite 开发服务器 + 用户脚本注入
npm test             # 单元 / DOM / 集成测试
npm run test:sandbox # 受限 Windows 沙箱内的测试 workaround
npm run typecheck    # TypeScript
```

构建后可打开 `dev/preview.html` 查看本地模拟作业页与悬浮面板（直接以 `file://` 打开即可，不需要真实账号）。 

## 题库

示例见 [`examples/questions.sample.csv`](examples/questions.sample.csv)。

##### CSV / TSV

```csv
type,question,optionA,optionB,optionC,optionD,answer,source
single,下列哪个是质数？,2,4,6,8,A,自建题库
multiple,以下属于编程语言的有？,Python,HTML,Java,CSS,"A,C",自建题库
judge,地球是圆的。,正确,错误,,,对,自建题库
fill,中国的首都是____。,北京,,,,,北京,自建题库
```

也支持通用列：

```csv
type,question,options,answer,source
single,下列哪个是质数？,"2|4|6|8",A,自建题库
```

##### JSON

```json
[
  {
    "type": "single",
    "question": "下列哪个是质数？",
    "options": ["2", "4", "6", "8"],
    "answer": "A",
    "source": "自建题库"
  },
  {
    "type": "judge",
    "question": "地球是圆的。",
    "answer": "对"
  }
]
```

##### TXT

每行 `题干<TAB>答案` 或 `题干==答案`。

##### 答案写法

- 选择题：`A`、`AC`、`A,C`、`A、C`，或选项全文；
- 判断题：`对/错`、`正确/错误`、`√/×`、`T/F`、`true/false`；
- 填空题：多个空用 `|`、`；`、`;` 或换行分隔；
- 简答题：直接写文本。

`.xlsx` 请先另存为 CSV（UTF-8）。

#### 远程题库

在 **题库 → 题库设置** 中启用后，脚本会向配置的 URL 发送：

```json
{
  "question": "题干",
  "type": "single",
  "options": [{ "key": "A", "text": "选项 1" }]
}
```

期望响应：

```json
{ "answer": ["A"], "confidence": 0.92 }
```

`answerPath` / `confidencePath` 支持点路径（如 `data.answer`）。没有内置任何第三方题库密钥；接口失败会自动回退 AI。

## 支持的页面

| 页面                                      | 能力                  |
| --------------------------------------- | ------------------- |
| `/mycourse/studentstudy` 章节学习           | 自动翻页、恢复             |
| `/knowledge/cards` 知识卡片                 | 卡片内翻页、视频等待、任务点跳过已完成 |
| `ananas/modules/video/` 视频              | 等待播放结束              |
| `pan-yz.chaoxing.com/screen/...` 文档预览   | 自动滚动到文末（阅读/文档任务点）   |
| `ananas/modules/pdf/`、`/readsvr/` 文档/阅读 | 自动滚动/翻页（能识别到任务点时）   |
| `/work/doHomeWorkNew` 等作业页              | 采集、填答、提交            |
| `/exam-ans/exam/test/...` 考试            | 采集/填答/提交（默认禁用）      |

## 接入其他平台

首版 `@match` 只包含学习通。若要适配其他平台：

1. 在 `vite.config.ts` 的 `userscript.match` 里加入目标域名（例如 `*://*.example.com/*`），重新构建并安装；
2. 在面板 **设置 → 高级与通用适配器** 填入选择器 JSON，例如：

```json
{
  "name": "作业",
  "matches": ["example.com"],
  "questionContainer": ".question",
  "stem": ".stem",
  "options": ".option",
  "typeLabel": ".type",
  "nextButton": ".next",
  "submitButton": ".submit"
}
```

3. 保存后刷新页面。通用适配器是实验性能力，复杂页面仍建议实现专用 `PlatformAdapter`。

## 关于

由 jialuo 开发 · https://github.com/jialuo999/xxt_study

## 许可与致谢

本项目以 MIT 许可发布，详见 [LICENSE](LICENSE)。选择器与页面结构参考了 MIT 项目 [CodFrm/cxmooc-tools](https://github.com/CodFrm/cxmooc-tools)，完整出处与许可文本见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

其他项目的功能灵感仅用于产品设计，具体列表与许可状态同样记录在 THIRD_PARTY_NOTICES.md。

---

**免责声明**：本工具仅供个人学习辅助与自动化效率研究。使用本工具造成的成绩、账号、学术诚信或平台规则后果由使用者自行承担。请勿用于代考、刷课、伪造学习记录或任何违规用途。
