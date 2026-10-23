# 学习通 / 超星自动化脚本开源生态调研

- 调研日期：2026-10-24
- 调研对象：本项目（`E:\Code\Script`，MIT，Tampermonkey + Preact Shadow DOM）
- 调研方式：`api.github.com` 元数据（star / license / pushed_at）+ `raw.githubusercontent.com` 源码与 README 实读；**所有结论都标注了可点开的出处**
- 约束：本次只读代码与文档，未运行任何第三方脚本，未修改 `src/`

> 文中 `../../src/...` 链接指向本仓库源码，`README.md` 指项目根 README。

---

## 0. 摘要（先看这 8 条）

1. **生态里真正"工程化"的只有两家**：`ocsjs/ocsjs`（MIT，3.9k star，2026-10 仍活跃）和 `zhu-hailin/chaoxing-ai-assistant`（MIT，2026-10 建仓即高频迭代到 v1.30）。其余多为单文件脚本或已归档项目。
2. 我们最该补的**不是"更多功能"，而是三个结构性缺口**：(a) 没有"章节树 + 完成状态"这一层模型，翻页只能线性点"下一节"；(b) 任务点识别只依赖 `.ans-job-icon` 一个类名，没有 `attachments/jobid` 这一层权威数据；(c) 没有多标签互斥，两个标签页会同时跑自动翻页。
3. **防暂停**在成熟项目里是"事件驱动 + 有界重试"，不是轮询：OCS 直接 `media.addEventListener('pause', playFunction)`，zhu-hailin 用"强制连续播放 + 脚本自身暂停/继续"区分人工暂停，并做**进度连续性校验**防止把 seek 误判为正常播放。
4. **倍速**不应只写 `playbackRate`：zhu-hailin v1.20/v1.27 改为**优先调用播放器原生档位 API，取平台允许的最高 ≤2x，并回读实际速率**；OCS 另用 `rateHack()` 解除 `/ananas/modules/video/` 的倍速菜单限制。我们目前是纯属性写入 + 监听补回（`media-preferences.ts` L240-297），在"平台锁定档位"的播放器上会静默失效。
5. **字体反爬有代际差**：我们和 ChaoXing-AutoAnswer、zhu-hailin 都是"字形 MD5 → Unicode 表"，平台换字体即失效（README 已列为已知限制）；OCS 已改为**离线生成的参考位图特征表（FRB2）+ 形状匹配 + 增量破解 + Worker**，与平台换字体解耦（[index.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/font-decrypt/index.ts)、[ref-table.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/font-decrypt/ref-table.ts)）。
6. **题库匹配**我们只有"哈希 + n-gram 余弦 + 选项 Jaccard"；OCS 的单选题是**四阶段自适应匹配**（归一化精确 → 相似度>0.6 → 纯字母兜底 → 多片段合并递归），ChaoXing-AutoAnswer 是"精确 → Levenshtein → 字母回退"三级。我们的模糊匹配在"题库只存答案文本、没存选项"时几乎必然未命中。
7. **AI 侧**：zhu-hailin 用**逐题请求 + 1~7 路并发（默认 3）+ 错误分类（transient/format/fatal）+ Retry-After + 连续失败闸门暂停**（[analysis-scheduler.js](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/sources/analysis-scheduler.js)）；OCS 用 `thread` 参数 + 题库 `period` 限速 + 结果缓存。我们现在是"≤50 题一批、并发 2"，单批失败即整批转人工。
8. **许可**：OCS、zhu-hailin、cxmooc-tools、ChaoXing-AutoAnswer 均为 MIT，可复用代码但必须署名；`pang-qin/chaoxing-toolkit` **无 license**，`chenhuilin2/chaoxing-work-export` 是 **GPL-3.0**、`Cooanyh/chaoxing-list` 是 **AGPL-3.0** —— 这三个只能看思路。

---

## 1. 项目清单

### 1.1 总表

| 项目 | 许可 | Star | 最近活动 | 技术栈 | 关键能力 | 代码可复用性 |
| --- | --- | --- | --- | --- | --- | --- |
| [ocsjs/ocsjs](https://github.com/ocsjs/ocsjs) | **MIT** | 3,923 | 2026-10-23（v5.2.3，分支 `5.0`） | TypeScript monorepo（core / scripts / utils） | 多平台适配（`projects/` 下 7 个平台：超星/智慧树/职教云/智慧职教/雨课堂/iCourse 等）、任务点调度、题库协议与一键配置、字体位图破解、Worker/并发 | ✅ 可复用，需署名 |
| [zhu-hailin/chaoxing-ai-assistant](https://github.com/zhu-hailin/chaoxing-ai-assistant) | **MIT** | 93 | 2026-10-23（v1.30，日更） | 单文件 JS（sources/*.js 模块化） | 防暂停/原生倍速、章节树侧栏、逐题并发 AI、视频抽帧 OCR、守卫式更新 | ✅ 可复用，需署名 |
| [CodFrm/cxmooc-tools](https://github.com/CodFrm/cxmooc-tools) | **MIT** | 2,718 | **已归档**，最后 push 2022-02-07 | TypeScript | 早期选择器体系、题库、视频"秒过"、验证码打码 | ⚠️ 可复用但已停更；"秒过/打码"不要学 |
| [Khihl-lucky/ChaoXing-AutoAnswer](https://github.com/Khihl-lucky/ChaoXing-AutoAnswer) | **MIT** | 11 | 2026-10-20（v2.7.0） | 单文件 JS（~5600 行） | 视觉模型路由、多标签互斥锁、更新多端点、三级答案匹配 | ✅ 可复用 |
| [pang-qin/chaoxing-toolkit](https://github.com/pang-qin/chaoxing-toolkit) | **无 license** | 58 | 2026-06-01 | JS + FastAPI + Vue3 | 自建题库服务器（精确匹配 + 待处理题）、任务点跳转 | ❌ 仅思路，禁止复制 |
| [chenhuilin2/chaoxing-work-export](https://github.com/chenhuilin2/chaoxing-work-export) | **GPL-3.0** | 35 | 2026-10-19 | TypeScript | 作业题目一键导出 .docx（期末复习） | ❌ 仅思路（GPL 传染） |
| [Cooanyh/chaoxing-list](https://github.com/Cooanyh/chaoxing-list) | **AGPL-3.0** | 16 | 2026-09-19 | JavaScript | 作业/考试列表优化、待办与课程任务汇总 | ❌ 仅思路（AGPL 更严） |
| [stoneorwater/baka-helper](https://github.com/stoneorwater/baka-helper) | **MIT** | 5 | 2026-10-11 | JavaScript | 全流程辅助（视频 + AI 答题 + 阅读） | ✅ 可复用（体量小） |

> 文档站：OCS 官方文档 <https://docs.ocsjs.com>（本仓库中的用法说明与配置项命名均以其 repo 内源码为准，文档站为入口）。

### 1.2 逐项目要点

**ocsjs/ocsjs（MIT，最完整的工程参考）**
- 用"Project + Script + matches 声明"组织平台适配：`CXProject = Project.create({ name:'超星学习通', domains:[...], scripts:{...} })`，每个 script 声明 `matches: [['任务点页面','/knowledge/cards']]` 和 `configs`，框架负责路由与配置持久化（[cx.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/projects/cx.ts)）。支持 `chaoxing.com / xueyinonline.com / xuexi365.com` 等 20+ 域名，本质是"域名清单 + 路径路由"而不是硬编码单域。
- 任务点用 `window.attachments`（平台全局数据）+ iframe 的 `data` 属性里的 `jobid` 对齐，再按 `module`（`insertvideo/insertaudio/work/insertdoc/insertbook/insertflash`）分流到 `JobRunner.media/chapter/read/readPPTWithAudio/hyperlink/timereader`。
- `searchIFrame(root)` 递归遍历**同源** iframe 直到找到承载任务点的文档；跨域则靠"在该 iframe 内也注入脚本"解决。
- 字体：`crackFont / collectChars / decryptElements / extractFontFromStyle` + CDN 参考表 `font_ref_cx.bin`（[cx.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/projects/cx.ts) 顶部常量）。
- 题库：`AnswererWrapper[]`（多源、可配 method/type/contentType/data/handler），`defaultAnswerWrapperHandler` 并发请求全部题库并合并结果（[answer.wrapper.handler.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/core/src/core/answer-wrapper/answer.wrapper.handler.ts)）。

**zhu-hailin/chaoxing-ai-assistant（MIT，最贴近"产品化"的参考）**
- 章节侧栏：读 `#content1 #coursetree` 的 `.posCatalog_select` / 旧版 `h4[id^=cur]`，得到章节树 + 完成态 + 待完成数 + 解锁状态；跳转**委托给平台原生 `getTeacherAjax(...)` 的点击**，不自己拼请求（[course_catalog.js](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/course_catalog.js)）。
- 播放：`强制连续播放`、`脚本暂停/继续`、有界暂停恢复、**进度连续性校验**（区分重播/前跳/真实进展），原生倍速档位 + 回读（[CHANGELOG.md](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/CHANGELOG.md) v1.08/v1.09/v1.20/v1.27）。
- AI：逐题独立请求，默认 3 路（1–7 可配），有界队列、材料预读并发 2、错误码分类、`Retry-After`、连续 5 次失败暂停闸门（[analysis-scheduler.js](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/sources/analysis-scheduler.js)）。
- 视频画面 OCR：canvas 抽帧 → 视觉模型 → 严格 JSON（`frameId` 白名单）→ 转写片段带时间戳；队列上限 12、批 4、同帧去重、`seeking` 时跳过（[course-video-info.js](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/sources/course-video-info.js)）。

**CodFrm/cxmooc-tools（MIT，已归档）**
- 历史价值：作业/考试 DOM 结构（`.TiMu/.Zy_TItle/.Zy_ulTk/.answerBg`）与 `#video_html5_api`，这些我们已在用并在 `THIRD_PARTY_NOTICES.md` 标注。
- **明确不要学**：视频"倍速秒过"、验证码自动打码（repo 描述自述），这与我们 README 的安全边界直接冲突。

**Khihl-lucky/ChaoXing-AutoAnswer（MIT）**
- 更新机制最完整：`@updateURL/@downloadURL` + 多端点回退（ghproxy → gh-proxy → raw → GitHub API）+ `?ts=` 绕缓存 + 频率节流 + "忽略此版本"（[README](https://github.com/Khihl-lucky/ChaoXing-AutoAnswer/blob/main/README.md) v2.6.1–v2.6.6）。
- 多标签互斥锁：按任务链分键、10s 心跳、停止/关页释放、冲突时"接管并开始"（v2.7.0）。
- 图片题：`自动路由`（文本模型 vs 视觉模型）、`detail:"high"`、图片只能放 user 消息、400 自动改道（README「图片参数细节」）。

**pang-qin/chaoxing-toolkit（无许可）**
- 形态是"油猴脚本 + 自建 FastAPI 题库服务"，题库 API 为 `POST /api/search {question,type,key}`，答案用 `#` 分隔多选、`|` 分隔填空，未命中题进入"待处理"队列由人工补录（[README](https://github.com/pang-qin/chaoxing-toolkit)）。
- 思路值得借鉴（尤其是"待处理题闭环"），但 **repo 无 LICENSE，任何代码/常量/文案都不可复制**。

---

## 2. 技术点对比表

图例：✅ 已有且较完善 ｜ 🟡 有但明显不足 ｜ ❌ 没有

### 2.1 视频 / 音频

| 技术点 | 采用项目（出处） | 实现要点 | 我们的现状 | 许可风险 |
| --- | --- | --- | --- | --- |
| 防暂停（pause 即恢复） | OCS [cx.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/projects/cx.ts) `JobRunner.media` | `media.addEventListener('pause', playFunction)`，`playFunction` 内先查人脸识别再 `play()`；`ended` 时移除监听并 resolve；`currentTime=0` 重播；`setTimeout(…,200)` 规避 "play() interrupted by pause()" | 🟡 子帧只在 `pause` 时**上报**状态（`agent.ts` L178），恢复靠上层 500ms 轮询 `RESUME_MEDIA`/`activateMediaFrame`（`autoturn.ts` L451-476） | MIT，可复用 |
| 强制连续播放 + 人工暂停区分 | zhu-hailin CHANGELOG v1.30/v1.15/v1.12 | 脚本自身发起的 pause 与用户手动 pause 分开记账；"强制连续播放"默认开；人工暂停才等待 | 🟡 只区分"暂停超时 8s 提示"，无法区分是谁暂停的 | MIT，可复用 |
| 进度连续性校验（防 seek 误判） | zhu-hailin CHANGELOG v1.08/v1.09 | 恢复播放后等待数据稳定，比较 `currentTime` 是否连续增长；明显前跳/回退/超时分别处理 | ❌ 只有"结束前 1s 容差"判定（`autoturn.ts` L614-630） | MIT，可复用 |
| 倍速重断言 watchdog | OCS `top.currentMedia.playbackRate = …`；本项目 `media-preferences.ts` | 事件 + 定时器补回 | ✅ 已有 `timeupdate`/`ratechange` + 1.5s 定时（L240-276） | — |
| 原生倍速档位 + 回读 | zhu-hailin CHANGELOG v1.20/v1.27 | 不直接写 `playbackRate`，而是点播放器原生菜单选"平台允许的最高 ≤2x"，再回读实际值；不可确认则保持原速 | ❌ 纯属性写入，平台锁定档位时静默失败 | MIT，可复用 |
| 倍速菜单解锁 | OCS `rateHack()`（`/ananas/modules/video/`） | 在视频模块页解除播放器对倍速菜单的限制 | ❌ 未实现（且涉及风控，需评估） | MIT，但**建议不做**（见 §4.3） |
| 播放器发现（多层 iframe） | OCS `searchIFrame`；zhu-hailin `course-document-bridge.js` | 递归遍历同源 iframe，取 `contentWindow.document` 查 `#video,#audio` | 🟡 `collectMedia` 递归同源 iframe（≤3 层，`media-preferences.ts` L43-55），但 `applyAll`/定时同步只用 `collectDocumentMedia`（不含 iframe） | MIT，可复用 |
| Shadow DOM 播放器 | 本项目已覆盖；`Minnjee/course-helper` 思路（见 NOTICES） | 遍历 `shadowRoot` 找 `video/audio` | 🟡 仅在**顶层文档一个媒体都没有**时才进 Shadow DOM（L29-41）；页面上同时有 1 个普通 video + 1 个 Shadow video 时后者被漏掉 | — |
| 多播放器选择 | 本项目 `pickPrimaryMedia`；OCS 只处理 `#video,#audio` | 可见面积 + 是否在播 + 进度打分 | ✅ 已有（L57-86），但子帧 `agent.ts` 只上报"主播放器"，丢掉了多播放器信息 | — |
| 任务点识别（权威数据） | OCS `searchJob` | 从 iframe `data` 属性取 `jobid` → 在 `window.attachments` 里找 `property.mid/_jobid/module/job/isPassed` | 🟡 只读 DOM：`.ans-job-icon` 父级 + `.ans-job-finished`（`task-points.ts` L22-58），拿不到 `module` 类型与"非任务点"身份 | MIT，可复用 |
| 任务点类型分流 | OCS `JobRunner.*` | 视频/音频、章节测验、阅读、带音频 PPT、链接、计时阅读分别处理 | ❌ 除媒体外一律按"无媒体等 3s"（README 已知限制） | MIT，可复用 |
| 同页多任务点顺序播放 | 本项目 `waitForTaskMedia`（L391-484） | 按 DOM 顺序只激活当前任务点 frame，其余 `PAUSE_MEDIA` | ✅ 已有，且比 OCS 的"递归找第一个可跑任务"更严格 | — |
| 视频加载失败检测 | OCS 轮询 `.vjs-modal-dialog-content` 文案（"视频文件损坏/网络错误…"）→ 跳过 | 3s 轮询 + 关键词 | ❌ 只在"等待超时/暂停"时停，无法区分"视频坏了" | MIT，可复用 |
| 视频内弹题 | OCS `#videoquiz-submit` 随机作答 + 隐藏容器；zhu-hailin v1.14 用 AI 作答 + 原生确认 | 检测 `#video .ans-videoquiz`，答题后隐藏 | ❌ 完全不处理（弹题会阻塞播放，我们只会判定"暂停无法恢复"并停机） | MIT（OCS 随机作答不建议学，AI 作答思路可借鉴） |
| 人脸识别检测 | OCS `#fcqrimg`（src 非空）/`.chapterVideoFaceMaskDiv`（display≠none）；ChaoXing-AutoAnswer README「智能防卡死」 | 出现即暂停 + 通知，等待用户完成 | ❌ 只有 9010/验证码检测（`verification.ts`） | MIT，可复用 |
| 进度条常显 | OCS `fixedVideoProgress()`（`.vjs-control-bar` opacity=1） | 样式覆盖 | ❌ | MIT，低价值 |

### 2.2 自动翻页 / 章节导航

| 技术点 | 采用项目（出处） | 实现要点 | 我们的现状 | 许可风险 |
| --- | --- | --- | --- | --- |
| 章节树读取 | zhu-hailin [course_catalog.js](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/course_catalog.js) | `#coursetree` → `.posCatalog_select`（新版）/`h4[id^=cur]`（旧版）；行 id 去 `cur` 前缀得 `chapterId`；`.orangeNew` 数字=待完成数、`.icon_Completed`=已完成、`.posCatalog_active`=当前 | ❌ 无（只有 `.currents` 文本做签名，`host.ts` L1156-1164） | MIT，可复用 |
| 跳到"第一个未完成章节" | OCS `studyDispatcher`：`getTeacherAjax(courseId, classId, chapterId)`；zhu-hailin：`entry.target.click()` | 先扫描过滤 `unFinishCount!==0`，再调平台原生跳转 | ❌ 只能从当前页线性点"下一节" | MIT，可复用 |
| "下一节"的稳健点击 | OCS `top.PCount.next(count, chapterId, courseId, clazzId, '')`；zhu-hailin `getTeacherAjax` 委托 | 调平台原生函数，而不是猜 DOM 按钮 | 🟡 选择器候选 + 文本兜底 + leaf 判定 + 10s 去重（`next.ts`） | MIT，可复用 |
| 解锁（闯关）检测 | zhu-hailin v1.28：`sequence-locked` / `navigation-unavailable`，前置完成后再每 500ms 检测最多 15s | 把"未解锁"作为独立状态而不是失败 | ❌ 点不动就 `stop("点击下一节后页面没有变化")`（`autoturn.ts` L325-328） | MIT，可复用 |
| 到达最后一章 / 循环重学 | OCS `backToFirstWhenFinish`；zhu-hailin 同上 | 提示 + 可选回到第一章 | 🟡 靠"签名重复 3 次"判定（L330-335），不区分"到最后一章"和"卡住" | MIT，可复用 |
| 刷新后恢复 | 本项目 `AutoTurnRunner.restore()`（L67-81，sessionStorage）+ `resumeOnReload` | 记录 running/steps/visited/lastUrl | ✅ 已有 | — |
| 跨任务点/跨页"未完成清单" | zhu-hailin「待处理清单」；ChaoXing-AutoAnswer「跳过任务」 | 记录未完成项，供人工复核 | ❌ 只有日志 | MIT，可复用 |
| 失败保护性停止 | zhu-hailin「连续三个章节超时后保护性停止」；OCS 闯关重复进入检测 | 计数 + 阈值 + 独立提示 | 🟡 单点失败即停（无跨章节累计） | MIT，可复用 |
| 跨帧协调 | 本项目 `host.ts`（token + HELLO/WELCOME + 10s sweep）；OCS `cors.defineTopFunction` | 顶层持有状态，子帧执行 | ✅ 已有，且带 origin 校验（`messages.ts`） | — |
| 顶层窗口定位 | OCS `env` 脚本：向上找 `location.href.includes('/mycourse/studentstudy')` 的窗口当 top | 解决"套壳页面 top 跨域" | ❌ 直接用 `window.top`（`frames.ts` L8-14），套壳站点会失配 | MIT，可复用 |

### 2.3 题库 / 匹配

| 技术点 | 采用项目（出处） | 实现要点 | 我们的现状 | 许可风险 |
| --- | --- | --- | --- | --- |
| 单选题四级匹配 | OCS [single.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/core/src/core/worker/resolvers/single.ts) | ①归一化精确 ②相似度>0.6 取最优 ③纯 `A/B/C/D` 字母回退 ④多片段答案合并后递归 | 🟡 哈希精确 + n-gram 余弦 + 选项 Jaccard（`bank/index.ts` L536-557） | MIT，可复用 |
| 答案文本 → 选项映射 | OCS `answerNormalizedMatch/answerSimilar`；ChaoXing-AutoAnswer「精确→Levenshtein→字母」 | 答案可能是文本/字母/混合，逐级降级 | 🟡 依赖 `answerFromUnknown` 解析（`bank/answer.ts`），模糊命中后**不做**"答案文本 vs 选项文本"二次对齐 | MIT，可复用 |
| 多选/填空/判断专用解析 | OCS `resolveMultiple/resolveCompletion/resolveJudgement` + `isJudgementOptions` | 判断题选项是"对/错/√/×/True/False"时自动走判断逻辑；填空按 `answerSeparators` 切 | 🟡 判断题靠 `answerFromUnknown`，选项乱序靠文本匹配（README L15） | MIT，可复用 |
| 多源题库聚合 | OCS `defaultAnswerWrapperHandler` | 所有 provider 并发、结果合并成 `SearchInformation[]`，面板逐源展示命中/报错 | ❌ 单 URL 单协议（`settings.ts` L178-188） | MIT，可复用 |
| 题库请求模板 | OCS `${title}/${options}/${type}/${images}` 占位符 + GET/POST + 自定义 `handler` | 模板递归替换、GET 时拼到 query、POST 默认 JSON | 🟡 `bodyTemplate` 只支持 `{{question}}/{{type}}/{{options}}`，且**只支持 POST**（`remote.ts` L42-53） | MIT，但 `handler` 用 `new Function` —— **不要照抄**（见 §4.3） |
| 题库响应解析 | OCS `handler` 返回 `[question, answer]` 或二维数组 | 可配 `answerPath` | ✅ 已有 `answerPath/confidencePath` 点路径（`remote.ts` L56-80） | — |
| 搜题缓存 | OCS `searchAnswerInCaches(title, cb)`；本项目 `putCache/getCachedSolve` | 按题干缓存，TTL | ✅ 已有（`bank/index.ts` L669-710） | — |
| 搜题限速 | OCS `period`（默认 3s）；zhu-hailin 并发闸门 | 每次请求前 sleep | ❌ 远程题库串行但无间隔控制，AI 也无 | MIT，可复用 |
| 题库一键配置 | OCS [answerer-connect.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/answerer-connect.ts) | `window.open` 小窗 → 题库站 `postMessage` → **三重校验**（source/origin/version）→ 解析保存 | ❌ 手动填 URL+模板（README L131-149） | MIT，可复用 |
| 未命中题闭环 | pang-qin「待处理题目」后台 | 未命中 → 入队 → 人工补录 | ❌ | ❌ 无许可，仅思路 |
| 题库性能 | 本项目内存索引 + 预计算 n-gram（L121-197） | 精确 <10ms / 模糊 <50ms（1 万条） | ✅ 已有；但**全表线性扫描**，5 万条时模糊检索会到百 ms 级 | — |

### 2.4 AI 解题 / 图片

| 技术点 | 采用项目（出处） | 实现要点 | 我们的现状 | 许可风险 |
| --- | --- | --- | --- | --- |
| 并发调度 | zhu-hailin [analysis-scheduler.js](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/sources/analysis-scheduler.js) | 有界并发（默认 3）+ 材料预备队列（≤2）+ `pump()` 补位 + 逐题状态机（pending/preparing/ready/running/retry-wait/failed/cancelled） | 🟡 批量 ≤50 + 固定并发 2（`ai/index.ts` L32-33、146-153） | MIT，可复用 |
| 错误分类与退避 | 同上 `analysisRetryPolicy` | transient（NET/429/502/503/504）重试 3 次，format（RES）2 次，其余 1 次；`2000 * 2^(n-1) * (1+rand*0.25)`；尊重 `retryAfterMs` | 🟡 429/5xx 指数退避 + 抖动（`provider.ts` L253-261），**不读 `Retry-After`**，不可重试错误也统一处理 | MIT，可复用 |
| 连续失败闸门 | 同上 `gate.failures>=5 → paused` | 全局暂停并提示"稍后重试未完成题目" | ❌ 单批失败直接转人工 | MIT，可复用 |
| 逐题隔离 | 同上；zhu-hailin v1.28.2 | 一题失败不影响其他题 | ❌ 一批解析失败 = 该批全部 pending（`ai/index.ts` L99-130） | MIT，可复用 |
| 结构化输出 | 本项目 `AI_SYSTEM_PROMPT` + `parseAiResponse` + 一次修复重试（`ai/prompt.ts`、`ai/index.ts` L106-122） | 严格 JSON + id 回填 + repair | ✅ 已有，较完善 | — |
| 截断续写 | ChaoXing-AutoAnswer v2.6.7/v2.7.0 | `finish_reason=length` → 追加续写（最多 4 段）并拼接 | ❌ 超长答案直接丢失 | MIT，可复用 |
| 思维链过滤 | ChaoXing-AutoAnswer v2.6.7 | 丢弃 `reasoning_content`，空回复重试 | ❌ 未处理（若用户接推理模型可能把思考当答案） | MIT，可复用 |
| 图片题视觉路由 | ChaoXing-AutoAnswer README；zhu-hailin `model-capability` | 按模型能力自动路由：图片走视觉模型、文本走文本模型；模型不支持视觉时 400 自动改道 | ❌ 含图题直接转人工（`solver/index.ts` L229-232） | MIT，可复用 |
| 图片素材管线 | OCS `buildAnswererEnv`/`createImageSuggestion`/`png-upscaler`；`extractTextWithImages` | 结构化遍历取 img URL（非 innerText）→ base64 → `[图片N]` 占位符 → 答案里回填 URL 以命中图片选项 | ❌ 只置 `hasImage` 标记 | MIT，可复用 |
| 视频抽帧 OCR | zhu-hailin [course-video-info.js](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/sources/course-video-info.js) | canvas 抽帧（≤1280px、JPEG 0.8）→ 批 4 → 严格 JSON `segments[{frameId,text}]` → 帧 ID 白名单 + 去重 + 长度预算 | ❌ 无 | MIT，可复用（注意成本/隐私） |
| 自带题库 vs AI 分工 | pang-qin README 对照表 | 有题库先题库，AI 兜底 | ✅ 我们的 `solver` 流水线顺序一致 | ❌ 无许可，仅思路 |

### 2.5 字体反爬

| 技术点 | 采用项目（出处） | 实现要点 | 我们的现状 | 许可风险 |
| --- | --- | --- | --- | --- |
| 字形哈希表 | 本项目 `font/table.json` + Typr 轮廓 MD5；zhu-hailin（内置 Typr+MD5）；ChaoXing-AutoAnswer（同） | `md5(JSON.stringify(glyphToPath)).slice(24)` → Unicode | ✅ 已有（`decoder.ts` L253-269） | 表来源 forestpolice **未声明许可**（NOTICES L58-62）—— 现存风险 |
| 参考位图特征表 | OCS [ref-table.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/font-decrypt/ref-table.ts) | 官方字体离线渲染 → 16²/24² 二值位图 → FRB2 位打包（单平台 ~0.76MB，gzip ~0.3MB）→ 运行时形状匹配 | ❌ | MIT（代码）；`font_ref_cx.bin` 是 CDN 数据文件，许可未明示 → **不要内置** |
| 增量破解 + 串行队列 | OCS [decryptor.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/font-decrypt/decryptor.ts) | 只破解"新出现的字"，累计 map；`queue` 串行；>20 字才用 Worker | 🟡 有 `decodedCache`（文本级，4000 条）但没有"字符级累计 map"和 idle 屏障 | MIT，可复用 |
| 解密就绪屏障 | 同上 `waitForIdle()` | 下游读文本前 `await decryptor.waitForIdle()` | 🟡 `primeFontDecoder().then(再采集一次)`（`agent.ts` L67-71），非严格屏障 | MIT，可复用 |
| 动态内容监听 | 同上 `watchElements()` | MutationObserver + 防抖 + 防重入 + 收敛保证 | 🟡 靠 `observe()` 全页 MutationObserver（`agent.ts` L439-456） | MIT，可复用 |
| 字体来源发现 | 本项目 `collectSources/candidateDocuments`（含父窗口/兄弟 iframe、CSSOM） | base64 / @font-face URL 双通道 | ✅ 较完善，甚至强于 OCS 的单文档取样式 | — |
| 未命中可观测 | 本项目 `missingLogged` debug 日志 | 只记一次 | 🟡 无"未解码字符率"指标，无法判断表是否过期 | — |

### 2.6 平台适配 / 工程化

| 技术点 | 采用项目（出处） | 实现要点 | 我们的现状 | 许可风险 |
| --- | --- | --- | --- | --- |
| 平台声明式适配 | OCS `Project.create({domains, scripts:[{matches, configs}]})` | 域名 + 路径正则 + 每脚本自动启停 | 🟡 `PlatformAdapter` 接口 + `registry.ts`（两个适配器：chaoxing、generic） | MIT，可复用 |
| 多域名兼容 | OCS 20+ 域名（含 `xuexi365.com`）；zhu-hailin v1.23 兼容 `xuexitong.com` | 白名单 | ❌ `@match` 只有 `*://*.chaoxing.com/*`（`vite.config.ts` L24） | MIT，可复用 |
| 多标签互斥 | ChaoXing-AutoAnswer v2.7.0 | 键 = 任务链；10s 心跳；停止/关页释放；冲突可"接管" | ❌ 无（两个标签会同时点"下一节"） | MIT，可复用 |
| 更新检查 | ChaoXing-AutoAnswer v2.6.x；zhu-hailin v1.21/1.24 | `@updateURL/@downloadURL` + 多端点 + `?ts=` + 节流 + 版本校验 | ❌ 元数据里没有 `updateURL/downloadURL`（`vite.config.ts` L17-37），用户只能手动重装 | MIT，可复用 |
| 网络声明收紧 | zhu-hailin v1.12「收紧网络声明」；ChaoXing-AutoAnswer 逐个 `@connect` | 只声明必要域名 | 🟡 `connect: ["*"]`（`vite.config.ts` L35）—— 权限过大，商店/审计不友好 | MIT，可复用 |
| 配置迁移 | OCS [config-migrate.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/config-migrate.ts) | 幂等：新 key 不存在才复制，迁完删旧 key；只迁"用户真正写过"的 key | 🟡 `normalize()` 只做默认值合并 + 硬写 `version=1`（`settings-store.ts` L28-38），无阶梯迁移 | MIT，可复用 |
| 错误码 + 诊断导出 | zhu-hailin v1.20「统一错误码、脱敏诊断」；v1.29「识别枚举汇总进入诊断导出」 | 分类错误码 + 可导出报告 | 🟡 有 `exportLogs()`（`host.ts` L597-599），无结构化快照/版本指纹 | MIT，可复用 |
| 面板内"复制页面结构" | README L175 自述"后续版本可补充" | 一键导出 DOM 结构给维护者 | ❌ | — |
| 导出 docx | chenhuilin2/chaoxing-work-export | 题目 → .docx | ❌ | ❌ GPL-3.0，仅思路 |

---

## 3. 建议引入的 12 个优化点

> 排序 = 建议落地顺序。工作量：**S**（≤0.5 天）、**M**（1–2 天）、**L**（3 天+，含测试与真实页回归）。
> 每一条都注明"只借鉴思路"还是"可直接复用 MIT 代码（需署名）"。

### P1. 播放保活升级：pause 事件驱动 + 有界恢复 + 进度连续性校验
- **目标模块**：`src/app/media-preferences.ts`、`src/app/agent.ts`、`src/app/autoturn.ts`
- **现状**：`agent.ts` 只在 `pause` 时上报；恢复靠 `autoturn.ts` 500ms 轮询 `activateMediaFrame`。平台暂停与脚本暂停不可区分，恢复失败 8s 后才提示。
- **借鉴**：OCS `media.addEventListener('pause', playFunction)`（[cx.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/projects/cx.ts)）的事件驱动 + `ended` 时摘监听；zhu-hailin 的"脚本暂停/人工暂停"记账与进度连续性校验（[CHANGELOG](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/CHANGELOG.md) v1.08/v1.09/v1.30）。
- **实现思路**：
  1. 在 `agent.ts` 维护 `scriptPauseDepth`（脚本自身调用 `pause()` 前 +1，`play()` 后 -1），`pause` 事件里 `depth===0` 才视为"外部暂停"，立刻 `play()`（带 1 次重试 + 200ms 延迟，规避 play/pause 竞态）。
  2. 恢复后记录 `currentTime` 基线，500ms 后校验增量 ∈ (0, 3s]，否则记 `seekDetected` 并停止自动恢复、提示人工（沿用现有 `blocked` 语义）。
  3. 把 `autoturn.ts` 的 500ms 轮询降级为"兜底"，主路径走事件。
- **预期收益**：平台"检测到切后台/失焦自动暂停"场景恢复成功率显著提升；减少误暂停导致的整轮停机。
- **风险**：与"停止翻页时 pauseMedia"冲突（需用 depth 记账避免自己把自己恢复）；`play()` 仍可能被自动播放策略拒绝。
- **工作量**：M

### P2. 播放器发现增强：Shadow DOM 不再"全有或全无"，同源 iframe 全覆盖
- **目标模块**：`media-preferences.ts`（`collectDocumentMedia` / `applyAll` / 定时同步）
- **现状**：只有顶层 `video,audio` 数量为 0 时才进 Shadow DOM（L29-41）；`applyAll` 与 1.5s 同步只用 `collectDocumentMedia`，不含 iframe。
- **借鉴**：OCS `searchIFrame` 的递归遍历（[cx.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/projects/cx.ts)）；本项目自己的 `collectMedia` 已有递归能力，只是没被复用。
- **实现思路**：`collectDocumentMedia` 改为"light DOM + Shadow DOM 合并"（带 `WeakSet` 去重、深度≤3、元素上限 800 已有），并让 `startMediaPreferences` 的 applyAll/定时器统一走 `collectMedia`。
- **预期收益**：修复"页面上有 1 个普通 video 时 Shadow video 永远不被静音/倍速"的静默缺陷；同步逻辑一致，减少一类"偶发不生效"。
- **风险**：遍历成本上升 → 用 250ms 防抖 + 上限保护；避免对 detached 元素调用 `play()`。
- **工作量**：S

### P3. 任务点模型升级：引入 `attachments` + `jobid` + `module` 类型
- **目标模块**：`src/app/task-points.ts`、`agent.ts`、`autoturn.ts`
- **现状**：只认 `.ans-job-icon` / `.ans-job-finished`（L22-58），拿不到任务点类型，也没有"非任务点"概念，非视频任务一律等 3s。
- **借鉴**：OCS `searchJob` 用 iframe `data` 里的 `jobid` 对齐 `window.attachments[].property.{mid,_jobid,module,job,isPassed}`，再按 `module` 分流（[cx.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/projects/cx.ts)）。
- **实现思路**：
  1. `collectTaskPointState` 增加"若能读到 `top.attachments`，优先用 `attachments` 顺序 + `jobid` 匹配"，DOM 结果作为 fallback（保留现有行为不变）。
  2. 输出增加 `kind: 'media' | 'quiz' | 'read' | 'ppt' | 'link' | 'unknown'`，`autoturn` 对非 media 类型走"页面级完成判定"而不是固定 3s 等待。
  3. 保留"完成但非任务点/已通过"的区分（`job/isPassed`），为 P4 的"复习模式"留钩子。
- **预期收益**：PPT/阅读/链接任务不再固定空等；任务点顺序更可靠；为后续"按类型限速"打基础。
- **风险**：`attachments` 是平台内部全局变量，可能改名/跨域不可读 → 必须 try/catch + 降级；不要依赖它写任何请求。
- **工作量**：M

### P4. 章节树导航：从"线性下一节"升级为"跳到首个未完成章节"
- **目标模块**：新增 `src/platform/chaoxing/catalog.ts`；改 `next.ts`、`autoturn.ts`、`host.ts`
- **现状**：`next.ts` 只点候选按钮 + 文本兜底；点不动就停（`autoturn.ts` L325-328）。
- **借鉴**：zhu-hailin [course_catalog.js](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/course_catalog.js) 的目录模型（`.posCatalog_select` / `h4[id^=cur]`、`chapterId` 由行 id 去 `cur` 前缀、`.orangeNew` 待完成数、`.icon_Completed` 完成态、`posCatalog_active` 当前章节）+ 跳转**委托原生 `getTeacherAjax` 点击**；OCS `studyDispatcher` 的"过滤 `unFinishCount!==0` 后跳第一个"。
- **实现思路**：
  1. `readCatalog(doc)`：在**同源父窗口**里找 `#content1 #coursetree`（`resolveCourseCatalog` 的祖先遍历思路），返回 `{chapterId, number, title, parentId, completed, pending, active, navigationStatus}`。
  2. `nextPage` 优先策略：当前章节 `pending===0` 且存在下一个 `pending>0` → 直接跳该章节；否则回退到现有"下一节"按钮。跳转只 `element.click()`，绝不自己拼 URL（原生 handler 需要平台参数）。
  3. 解锁态（`disabled`/`aria-disabled`/无原生 handler）→ 返回 `sequence-locked`，`autoturn` 进入"每 500ms 轮询最多 15s"的等待分支，而不是停机。
  4. 把 `getTaskSignature` 的"当前章节"来源从 `.currents` 文本改为 `chapterId`（更稳定）。
- **预期收益**：跳过已完成章节（这是当前最耗时的浪费）；闯关课不再"点不动就停"；刷新后能真正"接着上次未完成的章节"。
- **风险**：目录页与新学习页不同源/不同版本；`posCatalog_*` 类名可能改版 → 保留旧版 `h4` 分支 + `structure:'unrecognized'` 状态；**不要**用目录的"颜色"推断完成态。
- **工作量**：L（建议加 fixture 单测 + `dev/preview.html` 模拟目录）

### P5. 统一"守门人"：人脸识别 / 验证码 / 视频加载失败 / 卡死 集中处置
- **目标模块**：`src/platform/chaoxing/verification.ts` → 泛化为 `guards.ts`；`agent.ts`、`autoturn.ts`、`host.ts`
- **现状**：只有 9010/验证码检测（`verification.ts`），且只在顶层 `document` 上查。
- **借鉴**：OCS `hasFaceRecognition()`（`#fcqrimg` src 非空）+ `hasNewFaceRecognition()`（`.chapterVideoFaceMaskDiv` display）+ `waitForFaceRecognition()`（3s 轮询、只通知一次）；视频错误文案轮询 `.vjs-modal-dialog-content`（[cx.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/projects/cx.ts)）；ChaoXing-AutoAnswer「智能防卡死」（完成态轮询 3×5s、文档 45s 超时、跨域降级、手动跳过）。
- **实现思路**：定义 `Guard { id, detect(doc): boolean, severity: 'pause'|'skip'|'stop', message }`，agent 每 2s 在本地文档评估并把命中项随 `MEDIA_STATE` 上报；host 聚合后统一 `autoTurn.stop(reason)` 并展示横幅。首批实现 `face-recognition`、`captcha-9010`（迁移现有）、`video-load-error`、`stall`（时长 45min 已有常量）。
- **预期收益**：把"莫名停住"变成"可解释的暂停 + 明确指引"；减少用户误以为脚本坏了。
- **风险**：误报（例如广告 iframe 里的 canvas）→ 全部检测必须限制在"当前任务点 frame"内；不要检测人脸结果、不要上传任何图像。
- **工作量**：M

### P6. 题库匹配：四阶段自适应 + 答案↔选项二次对齐
- **目标模块**：`src/bank/index.ts`（新增 `match/` 子模块）、`src/utils/text.ts`
- **现状**：哈希精确 → n-gram 余弦（0.45/0.55 + 长度比）→ 选项 Jaccard 0.25，阈值 0.86（L536-557）。模糊命中后直接信任 `entry.answer`，不校验它和"当前选项文本"是否对得上。
- **借鉴**：OCS [single.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/core/src/core/worker/resolvers/single.ts) 的四阶段（归一化精确 → 相似 >0.6 → 纯字母 `charCode-65` → 多片段合并后递归）；`resolveMultiple` 的 `plainOptions` 兜底（[question.resolver.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/core/src/core/worker/question.resolver.ts)）；ChaoXing-AutoAnswer 的"Levenshtein 回退"。
- **实现思路**：
  1. 抽出纯函数 `matchChoice(answerTexts, optionTexts, separators)`，按四阶段实现；相似阶段复用现有 `preparedTextSimilarity`。
  2. 命中后做"答案→选项"映射：若 `entry.answer` 是字母，按当前题目选项顺序映射；若是文本，先精确再模糊（阈值 0.6）对齐到选项 key，对不上就降 confidence 到 `pending`。
  3. 阈值分层：精确 0.99 / 文本映射 0.9 / 相似 0.75（现有 `fuzzyConfidence` 保留）。
  4. 给 5 万条题库加前缀倒排（2-gram → 候选集），把全表扫描改成候选集打分。
- **预期收益**：题库"只存答案不存选项"的历史数据可用；选项乱序/轻微改写不再直接失效；大题量下检索不再变慢。
- **风险**：相似阈值放宽会引入错答 → 必须保持"低置信度进 pending"的现有闸门；需要一组真实错例做回归。
- **工作量**：M（算法）+ S（倒排）

### P7. 远程题库：多源 provider + 限速 + 结果缓存 + 一键配置
- **目标模块**：`src/bank/remote.ts`、`src/core/settings.ts`、`src/ui/pages/Bank.tsx`
- **现状**：单 URL、POST、`{{question}}/{{type}}/{{options}}`、15s 超时、无重试/无限速/无多源（L93-155）。
- **借鉴**：OCS `AnswererWrapper[]` 的字段设计（name/method/type/headers/data/answerPath）与"并发全部源 + 逐源展示结果/错误"（[answer.wrapper.handler.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/core/src/core/answer-wrapper/answer.wrapper.handler.ts)）；`period` 限速；一键配置的 postMessage 三重校验协议（[answerer-connect.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/answerer-connect.ts)）。
- **实现思路**：
  1. `bank.remote.providers: RemoteBankProvider[]`（保留旧单对象字段并自动迁移成一项，见 P12）。
  2. 每个 provider 独立 `enabled/method/timeout/periodMs/answerPath/confidencePath/headers/bodyTemplate`；查询时 `Promise.allSettled`，按"置信度 × 源优先级"取最优，UI 显示每源命中/耗时/错误。
  3. 全局最小间隔（默认 1500ms）+ 429 退避；同一题干在 60s 内只打一次（复用现有 `putCache`）。
  4. 可选"一键导入"：`window.open` 小窗 + `postMessage`，校验 `event.source === win && event.origin === expectedOrigin && data.version === 1`。
- **预期收益**：题库不可用时不再"静默回退 AI 烧钱"；多源提升命中率；配置体验接近 OCS。
- **风险**：多源并发可能触发平台/题库风控 → 默认串行+间隔；**必须限制 `headers` 里不能放任意脚本**（不要做 OCS 的 `new Function(handler)`）。
- **工作量**：M（协议）+ S（一键配置可后置）

### P8. AI 调度器：逐题/小批 + 错误分类 + Retry-After + 失败闸门
- **目标模块**：`src/ai/index.ts`、`src/ai/provider.ts`、`src/solver/index.ts`
- **现状**：`chunk(≤50)` + 固定并发 2；一批失败整批转人工；不读 `Retry-After`；无全局暂停。
- **借鉴**：zhu-hailin [analysis-scheduler.js](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/sources/analysis-scheduler.js) 的 `runAnalysisQueue`（状态机 + 补位 + transient/format/fatal 三类重试策略 + `gate.notBefore` 全局闸门 + `failures>=5` 暂停）；ChaoXing-AutoAnswer 的"截断续写""丢弃 reasoning_content"。
- **实现思路**：
  1. 把 `solveBatch` 拆成"单题任务"，默认 `concurrency=3`（可配 1–7），批大小仅作为"一次请求带几题"的聚合适配（图片题强制单题）。
  2. `classifyError()`：429/5xx/网络 → transient（3 次，指数退避 + 抖动，读 `Retry-After`）；JSON 解析/结构不符 → format（2 次，走现有 repair）；401/403/配置错 → fatal（停整轮并提示）。
  3. 全局 `gate`：连续 5 次 transient 失败 → 暂停 30s 并提示"稍后重试未完成题"；保留已成功结果（现在已是按题记录，只需不整批丢）。
  4. `finish_reason === 'length'` → 追加一次"继续输出"请求并拼接；`reasoning_content` 永不作为答案。
- **预期收益**：单题失败不再拖垮一批；429 场景不再连续撞墙；长答案不丢。
- **风险**：逐题请求 token 成本与延迟上升 → 文本题仍可小批（3–6），只有解析失败才降级逐题重试。
- **工作量**：M

### P9. 图片题：视觉路由 + 素材管线（可选，默认关）
- **目标模块**：`src/solver/index.ts`、`src/ai/prompt.ts`、新增 `src/ai/vision.ts`
- **现状**：`question.hasImage` → 直接 pending"需人工查看"（L229-232）。
- **借鉴**：ChaoXing-AutoAnswer「自动路由/总是用多模态/只用文本」三态 + `detail:"high"` + 图片只能在 user 消息 + 400 自动改道（[README](https://github.com/Khihl-lucky/ChaoXing-AutoAnswer/blob/main/README.md)）；OCS `extractTextWithImages`（结构化遍历取 img URL，跳过 `display:none`）+ `[图片N]` 占位符回填答案以命中图片选项（[work.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/work.ts)）。
- **实现思路**：
  1. `collectQuestionImages(container)`：DOM 遍历收集 `img.src`（按文档顺序、去重、排除图标/按钮类），题干图与选项图分开。
  2. 选项图 → 用 `[图片N]` 占位符替换，保留"选项→图片 URL"映射；AI 返回含 `[图片N]` 或图片 URL 时回填到选项匹配（配合 P6）。
  3. 视觉请求：`content: [{type:'text'},{type:'image_url', image_url:{url, detail:'high'}}]`；模型不支持视觉（400/`model_not_support`）→ 该题回退 pending，并记一次"模型不支持图片"提示。
  4. **默认关闭**，UI 明确"会把题目图片发给你配置的模型服务"，并显示预估图片数。
- **预期收益**：公式/图表/选项为图片的题从"必然人工"变成"可解"；与 P6 配合能真正命中图片选项。
- **风险**：隐私（题目图上传）、CORS 取图失败、base64 体积上限、成本。必须逐项显式开关 + 失败降级。
- **工作量**：L

### P10. 字体解码自愈：增量 map + 未命中率指标 + 可替换参考表接口
- **目标模块**：`src/platform/chaoxing/font/decoder.ts`、`font/table.json`
- **现状**：整段文本解码依赖静态 `table.json`（L253-269），平台换字体即大面积乱码；只有 `missingLogged` 一次 debug 日志，没有指标。
- **借鉴**：OCS 的 `FontDecryptor`（字符级累计 map + 串行队列 + `>20` 字才 Worker + `waitForIdle()`）+ `watchElements`（防抖/防重入/收敛）+ FRB2 参考表（[decryptor.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/font-decrypt/decryptor.ts)、[ref-table.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/font-decrypt/ref-table.ts)）。
- **实现思路（分两步，先小后大）**：
  1. **S**：把解码改成"字符级缓存 + 未命中计数"，导出 `fontStats {total, hit, miss, missRate}` 到诊断（P12）；`missRate > 5%` 时 UI 提示"字形表可能过期"并给出反馈入口。
  2. **L（可选）**：抽象 `GlyphMatcher` 接口，内置实现仍是 hash 表；另做"参考特征表"实现（自建离线脚本用**开源字体**生成，如 Source Han Sans / OFL，**不复用 OCS 的 CDN bin**）。
- **预期收益**：从"用户看到乱码才知道坏了"变成"可观测 + 可告警"；为将来换字体形态留接口。
- **风险**：参考表体积（~0.3MB gzip）与首屏成本；离线生成脚本需自建，工作量在数据侧。
- **工作量**：S（第 1 步）/ L（第 2 步）

### P11. 多标签互斥 + 单实例
- **目标模块**：`src/app/boot.ts`、`src/core/gm.ts`（或 `settings-store.ts`）
- **现状**：无。两个标签页各自 `AutoTurnRunner`，会同时点"下一节"、同时改倍速。
- **借鉴**：ChaoXing-AutoAnswer v2.7.0「多标签互斥锁：按任务链分键、10s 心跳、停止/完成/关页释放、冲突时一键接管」（[README](https://github.com/Khihl-lucky/ChaoXing-AutoAnswer/blob/main/README.md)）。
- **实现思路**：
  1. 锁 key = `courseId:clazzId`（从 URL 参数取，`host.ts` 已有 `TASK_URL_KEYS` 类似逻辑）；value = `{tabId, startedAt, heartbeat}`。
  2. 抢锁：GM 存储读 → 无锁或心跳 >15s 过期 → 写入；失败则把 UI 置为"另一标签正在运行"并禁用开始按钮。
  3. 每 5s 心跳；`pagehide`/停止时释放；提供"强制接管"。
  4. 无 GM 存储时降级为 `localStorage` + `storage` 事件。
- **预期收益**：消除最容易被平台判定"异常操作"的场景；用户不会莫名其妙看到两倍速跳章。
- **风险**：浏览器崩溃会留下僵死锁 → 必须有心跳过期；不要锁"整个域名"（同一课程多标签才需要互斥）。
- **工作量**：S

### P12. 工程化收尾：更新元数据 / 配置迁移 / 诊断导出
- **目标模块**：`vite.config.ts`、`src/core/settings-store.ts`、`src/ui/LogsPanel.tsx`、`src/app/host.ts`
- **现状**：`vite.config.ts` 无 `updateURL/downloadURL`，`connect: ["*"]`；`normalize()` 无阶梯迁移；诊断只有文本日志。
- **借鉴**：ChaoXing-AutoAnswer 的更新多端点 + `?ts=` + 节流 + 忽略版本（v2.6.1–2.6.6）；OCS [config-migrate.ts](https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/config-migrate.ts) 的幂等迁移；zhu-hailin 的"统一错误码 + 脱敏诊断导出"。
- **实现思路**：
  1. 元数据补 `updateURL`/`downloadURL`（指向 release 的 `.user.js`）、`supportURL`；`connect` 收紧为 `api.deepseek.com` 等具体域名 + 用户自定义（用 `@connect *` 仅在用户开启自定义 Base URL 时由文档说明）。
  2. `migrate(raw)`：按 `version` 升序执行迁移函数数组，每步幂等（"新字段不存在才写"），迁完写回。
  3. 诊断包：`{scriptVersion, buildHash, pageKind, url(去参数), settings(脱敏), fontStats, counters{scan/fill/submit/autoturn}, lastErrors[]}` → 一键复制/下载；顺带实现 README 里承诺的"复制页面结构"（仅 structure + 选择器命中率，不含文本）。
- **预期收益**：用户能自助升级（不再手动重装）；设置改版不炸老用户；issue 从"不能用"变成可定位数据。
- **风险**：诊断包必须脱敏（`apiKey`/cookie/题干原文默认不含）；`@connect` 收紧可能让自定义 Base URL 失效，需在文档与 UI 提示。
- **工作量**：M

---

## 4. 许可红线：哪些能抄代码，哪些只能抄思路

### 4.1 ✅ 可直接复用（MIT），但必须履行义务

| 项目 | 可复用的具体资产（举例） | 义务 |
| --- | --- | --- |
| ocsjs/ocsjs | `resolveSingle/resolveMultiple` 匹配算法、`AnswererWrapper` 协议与 handler 结构、`waitFor/waitForMedia`、`config-migrate` 迁移写法、`FontDecryptor` 增量+队列设计 | 保留 MIT 版权与许可声明；在 `THIRD_PARTY_NOTICES.md` 新增条目（含 Copyright 行）；文件头注明出处（与我们现有 cxmooc 做法一致） |
| zhu-hailin/chaoxing-ai-assistant | 目录读取的选择器集合与状态字段、`analysis-scheduler` 的状态机/错误码分类、抽帧 OCR 的帧白名单校验 | 同上 |
| Khihl-lucky/ChaoXing-AutoAnswer | 多标签锁协议、更新多端点策略、视觉路由三态、`detail:'high'` 用法 | 同上 |
| CodFrm/cxmooc-tools | 选择器（我们已在用） | 同上；注意项目已归档，不再更新 |

> MIT 允许商用与闭源分发，但**必须保留版权声明与许可全文**。建议每个新引用的文件顶部写：
> `// Portions adapted from ocsjs/ocsjs (MIT). Copyright (c) ocsjs contributors. See THIRD_PARTY_NOTICES.md.`

### 4.2 ❌ 只能借鉴思路，禁止复制任何代码/常量/文案/资源

| 项目 | 许可 | 允许 | 禁止 |
| --- | --- | --- | --- |
| [pang-qin/chaoxing-toolkit](https://github.com/pang-qin/chaoxing-toolkit) | **无 LICENSE**（GitHub API `license: null`） | 阅读 README 理解"自建题库 + 待处理题闭环"的产品形态 | 复制脚本/后端代码、选择器常量、API 字段名照搬、README 文案 |
| [chenhuilin2/chaoxing-work-export](https://github.com/chenhuilin2/chaoxing-work-export) | **GPL-3.0** | 理解"题目导出 docx"的可行性 | 复制任何代码（GPL 传染：引入即需整体 GPL 化，与本项目 MIT 不兼容） |
| [Cooanyh/chaoxing-list](https://github.com/Cooanyh/chaoxing-list) | **AGPL-3.0** | 同上 | 同上，且 AGPL 对网络分发更严格 |
| 字形映射表来源 `forestpolice.org/ttf/2.0/table.json`（见 `THIRD_PARTY_NOTICES.md` L58-62） | **未声明** | 现状使用（数据表） | 继续扩散/再分发；建议按 P10 替换为自建数据 |
| OCS 参考表 `https://cdn.ocsjs.com/resources/font/font_ref_cx.bin` | 代码 MIT，**数据文件许可未明示** | 理解 FRB2 格式（格式本身是公开描述） | 直接内置/镜像该 bin；如需参考表，用 OFL 字体自行离线生成 |

### 4.3 ⚠️ 明确"不要引入"的做法（即使代码是 MIT）

1. **视频"秒过"/伪造进度**：cxmooc-tools 的核心卖点，直接违反本项目 README 的安全声明（L7、L183、L189）。
2. **验证码识别/打码**：cxmooc-tools 有实现；我们只做"检测并暂停"（`verification.ts`），不要越界。
3. **`new Function(handler)` 执行远程题库返回的代码**：OCS `answer.wrapper.handler.ts` 允许 `handler` 与 `data[key].handler` 为字符串并被 `Function()` 执行 —— 这等于把用户配置的远程服务变成任意代码执行入口。若要支持自定义解析，请用**受限 DSL**（点路径 / JSONPath 子集 / 少量内置 formatter 枚举），不要 `eval`。
4. **`rateHack()` 解除播放器倍速限制**：与平台风控直接对抗，收益（快一点）远小于"进度被清空"的风险（OCS 自己在 UI 里挂了"高倍速可能导致学习记录清空/回退"的警告）。
5. **"打码/过人脸"类自动化**：zhu-hailin 与 OCS 都是"检测到就暂停等人工"，这点与我们一致，不要越界。
6. **`@connect *`**：我们当前就是（`vite.config.ts` L35），属于权限过宽，建议按 P12 收紧。

### 4.4 我们自身需要修的许可/合规瑕疵

1. `src/platform/chaoxing/font/table.json` 来源未声明许可，且是"再分发数据"——已在 NOTICES 标注，但**建议**：要么联系来源取得许可，要么按 P10 改为自建（离线用 OFL 字体生成参考表），要么在 README 明确"仅本地使用，不再分发"。
2. `THIRD_PARTY_NOTICES.md` 的"产品功能灵感"清单可以补上本次新增的 OCS / zhu-hailin / ChaoXing-AutoAnswer 三个 MIT 项目（若采纳任何代码，必须从"灵感"升级为"代码参考"并附许可全文）。
3. README L208 写着"选择器与页面结构参考了 MIT 项目 cxmooc-tools"，但我们实际也参考了 OCS 的路径（`/knowledge/cards` 等）——若采纳 P4/P6 的代码，需同步更新致谢。

---

## 5. 建议落地顺序与验证

| 阶段 | 内容 | 理由 |
| --- | --- | --- |
| 第 1 批（低风险、立刻可验证） | P2、P11、P12（元数据部分） | 纯工程改进，不改判定逻辑，可用现有 fixture 回归 |
| 第 2 批（核心体验） | P1、P3、P6 | 直接决定"能不能跑完一章"和"题库命中率" |
| 第 3 批（结构性） | P4、P5、P8 | 需要新增模块与真实页面回归，工作量最大 |
| 第 4 批（可选/增值） | P7、P9、P10 第 2 步 | 涉及第三方服务/成本/隐私，默认关闭 |

**验证建议**
- 所有新判定都要能在 `dev/preview.html` 的本地 fixture 上跑（目录树、任务点、多播放器各加一份静态 DOM）。
- 对 P1/P3/P4 增加"状态机级"单测（不依赖真实网络）：给定一串事件序列，断言最终状态与停机原因。
- 真实页回归清单（人工）：新版 `mooc2` 章节页、旧版 `h4` 目录页、知识卡片页、带弹题视频页、含人脸识别视频页、多任务点页。
- 每批改动后跑 `npm run typecheck && npm test && npm run build`（README L204 的约定），不要只跑 build。

---

## 6. 参考链接汇总

**项目主页**
- <https://github.com/ocsjs/ocsjs> ｜ 文档 <https://docs.ocsjs.com>
- <https://github.com/zhu-hailin/chaoxing-ai-assistant>
- <https://github.com/CodFrm/cxmooc-tools>
- <https://github.com/Khihl-lucky/ChaoXing-AutoAnswer>
- <https://github.com/pang-qin/chaoxing-toolkit>（无许可）
- <https://github.com/chenhuilin2/chaoxing-work-export>（GPL-3.0）
- <https://github.com/Cooanyh/chaoxing-list>（AGPL-3.0）
- <https://github.com/stoneorwater/baka-helper>

**被引用的具体文件**
- OCS 学习通适配：<https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/projects/cx.ts>
- OCS 题库协议：<https://github.com/ocsjs/ocsjs/blob/5.0/packages/core/src/core/answer-wrapper/answer.wrapper.handler.ts>
- OCS 单选匹配：<https://github.com/ocsjs/ocsjs/blob/5.0/packages/core/src/core/worker/resolvers/single.ts>
- OCS 题目解析器：<https://github.com/ocsjs/ocsjs/blob/5.0/packages/core/src/core/worker/question.resolver.ts>
- OCS 字体框架：<https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/font-decrypt/index.ts>
- OCS 参考表格式：<https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/font-decrypt/ref-table.ts>
- OCS 增量解密器：<https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/font-decrypt/decryptor.ts>
- OCS 等待工具：<https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/study.ts>
- OCS 配置迁移：<https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/config-migrate.ts>
- OCS 题库一键配置：<https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/answerer-connect.ts>
- OCS 作业通用层：<https://github.com/ocsjs/ocsjs/blob/5.0/packages/scripts/src/utils/work.ts>
- zhu-hailin 目录读取：<https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/course_catalog.js>
- zhu-hailin AI 调度：<https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/sources/analysis-scheduler.js>
- zhu-hailin 抽帧 OCR：<https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/sources/course-video-info.js>
- zhu-hailin 更新记录（技术演进证据）：<https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/main/CHANGELOG.md>
- ChaoXing-AutoAnswer 说明（更新/多标签/视觉路由）：<https://github.com/Khihl-lucky/ChaoXing-AutoAnswer/blob/main/README.md>

**本项目内被对照的源码**
- [README.md](../../README.md) ｜ [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)
- [vite.config.ts](../../vite.config.ts)（元数据/`@connect`）
- [src/app/autoturn.ts](../../src/app/autoturn.ts) ｜ [src/app/task-points.ts](../../src/app/task-points.ts) ｜ [src/app/media-preferences.ts](../../src/app/media-preferences.ts) ｜ [src/app/agent.ts](../../src/app/agent.ts) ｜ [src/app/host.ts](../../src/app/host.ts)
- [src/platform/chaoxing/next.ts](../../src/platform/chaoxing/next.ts) ｜ [src/platform/chaoxing/video.ts](../../src/platform/chaoxing/video.ts) ｜ [src/platform/chaoxing/verification.ts](../../src/platform/chaoxing/verification.ts) ｜ [src/platform/chaoxing/font/decoder.ts](../../src/platform/chaoxing/font/decoder.ts)
- [src/bank/index.ts](../../src/bank/index.ts) ｜ [src/bank/remote.ts](../../src/bank/remote.ts) ｜ [src/ai/index.ts](../../src/ai/index.ts) ｜ [src/ai/provider.ts](../../src/ai/provider.ts) ｜ [src/solver/index.ts](../../src/solver/index.ts) ｜ [src/core/settings.ts](../../src/core/settings.ts) ｜ [src/core/settings-store.ts](../../src/core/settings-store.ts)
