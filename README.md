**English** | [简体中文](README.zh-CN.md)

# Xxt Study

Brings **automatic page turning**, **question recognition and answering**, **local question-bank lookup**, and **AI solving** to study-platform pages.



## Features

- **Automatic page turning**

- **Chapter tree navigation**

- **Sequential playback of multiple task points**

- **Reading / PDF / document / PPT tasks**

- **Font-based anti-scraping decoding**

- **Local question-bank matching**

- **AI solving** (requires you to connect your own API)

- **UI language**: Chinese / English, follows the browser language by default.

## Installation

```bash
npm install
npm run build
```

Build output: `dist/study-helper.user.js`.

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Open the Tampermonkey dashboard → Utilities → Import from file, and select `dist/study-helper.user.js`.
3. Open a Chaoxing (学习通) page; a floating ball appears in the bottom-right corner. Click it or press `Alt+Shift+S` to expand the panel.

Development and debugging:

```bash
npm run dev          # Vite dev server + userscript injection
npm test             # Unit / DOM / integration tests
npm run test:sandbox # Test workaround inside a restricted Windows sandbox
npm run typecheck    # TypeScript
```

After building, open `dev/preview.html` to view the local mock assignment page and the floating panel (just open it via `file://`; no real account is required).

## Question bank

See [`examples/questions.sample.csv`](examples/questions.sample.csv) for an example.

##### CSV / TSV

```csv
type,question,optionA,optionB,optionC,optionD,answer,source
single,下列哪个是质数？,2,4,6,8,A,自建题库
multiple,以下属于编程语言的有？,Python,HTML,Java,CSS,"A,C",自建题库
judge,地球是圆的。,正确,错误,,,对,自建题库
fill,中国的首都是____。,北京,,,,,北京,自建题库
```

Generic columns are also supported:

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

One question per line: `question<TAB>answer` or `question==answer`.

##### Answer formats

- Choice questions: `A`, `AC`, `A,C`, `A、C`, or the full option text;
- True/false questions: `对/错`, `正确/错误`, `√/×`, `T/F`, `true/false`;
- Fill-in-the-blank questions: separate multiple blanks with `|`, `；`, `;`, or newlines;
- Short-answer questions: just write the text.

For `.xlsx` files, save the sheet as CSV (UTF-8) first.

#### Remote question bank

Once enabled under **Question bank → Bank settings**, the script sends the following to the configured URL:

```json
{
  "question": "题干",
  "type": "single",
  "options": [{ "key": "A", "text": "选项 1" }]
}
```

Expected response:

```json
{ "answer": ["A"], "confidence": 0.92 }
```

`answerPath` / `confidencePath` support dot paths (e.g. `data.answer`). No third-party question-bank keys are bundled; if the request fails, the script automatically falls back to AI.

## Supported pages

| Page                                                  | Capability                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `/mycourse/studentstudy` chapter study                | Automatic page turning, resume                             |
| `/knowledge/cards` knowledge cards                    | In-card paging, wait for video, skip completed task points |
| `ananas/modules/video/` video                         | Wait for playback to finish                                |
| `pan-yz.chaoxing.com/screen/...` document preview     | Auto-scroll to the end (reading / document task points)    |
| `ananas/modules/pdf/`, `/readsvr/` document / reading | Auto-scroll / page turning (when a task point is detected) |
| `/work/doHomeWorkNew` and other assignment pages      | Collect, fill in, submit                                   |
| `/exam-ans/exam/test/...` exam                        | Collect / fill in / submit (disabled by default)           |

## Adding other platforms

The first version's `@match` covers Chaoxing (学习通) only. To support another platform:

1. Add the target domain (e.g. `*://*.example.com/*`) to `userscript.match` in `vite.config.ts`, then rebuild and reinstall.
2. In the panel, open **Settings → Advanced & generic adapter** and enter the selector JSON, for example:

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

3. Save and refresh the page. The generic adapter is experimental; for complex pages, implementing a dedicated `PlatformAdapter` is still recommended.

## About

Developed by jialuo · https://github.com/jialuo999/xxt_study

## License and acknowledgments

This project is released under the MIT License; see [LICENSE](LICENSE). The selectors and page structures take inspiration from the MIT-licensed project [CodFrm/cxmooc-tools](https://github.com/CodFrm/cxmooc-tools); full attribution and license texts are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Feature inspiration from other projects is used for product design only; the concrete list and license status are likewise recorded in THIRD_PARTY_NOTICES.md.

---

**Disclaimer**: This tool is intended only for personal study assistance and automation-efficiency research. Any consequences for grades, accounts, academic integrity, or platform rules caused by using this tool are borne by the user. Do not use it for exam proxy, course farming, falsifying study records, or any other rule-violating purpose.
