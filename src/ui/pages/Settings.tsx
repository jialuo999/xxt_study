import { useEffect, useState } from "preact/hooks";
import {
  AI_PRESETS,
  VIDEO_RATES,
  type DeepPartial,
  type Settings,
  type ThemeMode,
} from "@/core/settings";
import {
  Badge,
  Button,
  Card,
  Field,
  IconButton,
  Modal,
  Segmented,
  Select,
  TextInput,
  Toggle,
} from "@/ui/components";
import { MODE_DESC, MODE_LABEL } from "@/ui/labels";
import type { AiTestView } from "@/ui/contract";
import type { PageProps } from "./shared";

export function SettingsPage({ controller, state }: PageProps) {
  const settings = state.settings;
  const [aiDraft, setAiDraft] = useState({
    baseUrl: settings.ai.baseUrl,
    model: settings.ai.model,
    apiKey: settings.ai.apiKey,
  });
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestView | null>(null);
  const [examConfirm, setExamConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [genericDraft, setGenericDraft] = useState(() =>
    settings.advanced.genericConfig ? JSON.stringify(settings.advanced.genericConfig, null, 2) : "",
  );
  const [genericError, setGenericError] = useState<string | null>(null);

  useEffect(() => {
    setAiDraft({
      baseUrl: settings.ai.baseUrl,
      model: settings.ai.model,
      apiKey: settings.ai.apiKey,
    });
  }, [settings.ai.baseUrl, settings.ai.model, settings.ai.apiKey]);

  useEffect(() => {
    setGenericDraft(
      settings.advanced.genericConfig ? JSON.stringify(settings.advanced.genericConfig, null, 2) : "",
    );
  }, [settings.advanced.genericConfig]);

  const saveGenericConfig = () => {
    const text = genericDraft.trim();
    if (!text) {
      setGenericError("请粘贴配置 JSON；清空请使用「恢复默认设置」");
      return;
    }
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (
        typeof parsed.name !== "string" ||
        !Array.isArray(parsed.matches) ||
        typeof parsed.questionContainer !== "string" ||
        typeof parsed.stem !== "string"
      ) {
        setGenericError("至少需要 name / matches / questionContainer / stem 四个字段");
        return;
      }
      save({
        advanced: {
          genericConfig: parsed as unknown as Settings["advanced"]["genericConfig"],
        },
      });
      setGenericError(null);
    } catch {
      setGenericError("JSON 格式错误，请检查逗号、引号与括号");
    }
  };

  const save = (patch: DeepPartial<Settings>) => controller.saveSettings(patch);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      save({
        ai: {
          baseUrl: aiDraft.baseUrl.trim(),
          model: aiDraft.model.trim(),
          apiKey: aiDraft.apiKey.trim(),
        },
      });
      const result = await controller.testAi();
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div class="sh-stack">
      <Card title="答题模式" hint={MODE_DESC[settings.solving.mode]}>
        <Segmented
          value={settings.solving.mode}
          onChange={(mode) => save({ solving: { mode } })}
          options={[
            { value: "hint", label: MODE_LABEL.hint },
            { value: "review", label: MODE_LABEL.review },
            { value: "auto", label: MODE_LABEL.auto },
          ]}
        />
        <div style="margin-top:8px">
          <Toggle
            checked={settings.solving.autoSubmit}
            onChange={(autoSubmit) => save({ solving: { autoSubmit } })}
            label="自动提交"
            description="仅在全自动模式生效；低置信题会暂停等待人工处理。"
          />
          <Toggle
            checked={settings.solving.includeTypes.short}
            onChange={(enabled) =>
              save({ solving: { includeTypes: { ...settings.solving.includeTypes, short: enabled } } })
            }
            label="作答简答题"
            description="简答题由 AI 生成文本，建议复核后再提交。"
          />
          <Toggle
            checked={settings.solving.allowExam}
            onChange={(enabled) => {
              if (enabled) setExamConfirm(true);
              else save({ solving: { allowExam: false } });
            }}
            label="允许在考试页面自动作答"
            description="高风险选项：可能违反平台规则，默认关闭。"
          />
        </div>
        <div class="sh-divider" style="margin:9px 0" />
        <Field label={`最低置信度：${Math.round(settings.solving.minConfidence * 100)}%`} hint="低于该值的答案标记为待确认，不会自动提交。">
          <input
            class="sh-range"
            type="range"
            min="0.4"
            max="0.95"
            step="0.01"
            value={settings.solving.minConfidence}
            onInput={(event) =>
              save({ solving: { minConfidence: Number(event.currentTarget.value) } })
            }
          />
        </Field>
      </Card>

      <Card
        title="AI 接口"
        hint="OpenAI 兼容 /chat/completions，Key 只保存在本机"
        action={<Badge tone={settings.ai.enabled ? "success" : "muted"}>{settings.ai.enabled ? "启用" : "关闭"}</Badge>}
      >
        <Toggle
          checked={settings.ai.enabled}
          onChange={(enabled) => save({ ai: { enabled } })}
          label="启用 AI 解题"
          description="题库未命中时调用大模型，按接口用量计费。"
        />
        <div class="sh-stack" style="margin-top:8px">
          <Field label="服务预设">
            <Select
              value={presetValue(settings.ai.baseUrl)}
              onChange={(event) => {
                const preset = AI_PRESETS.find((item) => item.label === event.currentTarget.value);
                if (!preset || preset.label === "自定义") return;
                setAiDraft((draft) => ({ ...draft, baseUrl: preset.baseUrl, model: preset.model }));
                save({ ai: { baseUrl: preset.baseUrl, model: preset.model } });
              }}
              options={AI_PRESETS.map((preset) => ({ value: preset.label, label: preset.label }))}
            />
          </Field>
          <Field label="Base URL" hint="例如 https://api.deepseek.com/v1（不带 /chat/completions）">
            <TextInput
              value={aiDraft.baseUrl}
              placeholder="https://api.deepseek.com/v1"
              onInput={(event) =>
                setAiDraft((draft) => ({ ...draft, baseUrl: event.currentTarget.value }))
              }
              onBlur={() => save({ ai: { baseUrl: aiDraft.baseUrl.trim() } })}
            />
          </Field>
          <Field label="API Key">
            <div class="sh-row">
              <TextInput
                class="sh-grow"
                type={showKey ? "text" : "password"}
                value={aiDraft.apiKey}
                placeholder="sk-..."
                autocomplete="off"
                spellcheck={false}
                onInput={(event) =>
                  setAiDraft((draft) => ({ ...draft, apiKey: event.currentTarget.value }))
                }
                onBlur={() => save({ ai: { apiKey: aiDraft.apiKey.trim() } })}
              />
              <IconButton
                icon={showKey ? "eyeOff" : "eye"}
                label={showKey ? "隐藏 Key" : "显示 Key"}
                onClick={() => setShowKey((value) => !value)}
              />
            </div>
          </Field>
          <Field label="模型">
            <TextInput
              value={aiDraft.model}
              placeholder="deepseek-chat"
              onInput={(event) =>
                setAiDraft((draft) => ({ ...draft, model: event.currentTarget.value }))
              }
              onBlur={() => save({ ai: { model: aiDraft.model.trim() } })}
            />
          </Field>
          <div class="sh-row">
            <Button size="sm" icon="send" disabled={testing} onClick={() => void runTest()}>
              {testing ? "测试中…" : "测试连接"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAiDraft((draft) => ({ ...draft, apiKey: "" }));
                save({ ai: { apiKey: "" } });
                setTestResult(null);
              }}
            >
              清除 Key
            </Button>
          </div>
          {testResult ? (
            <div class="sh-hint" style={{ color: testResult.ok ? "var(--sh-success)" : "var(--sh-danger)" }}>
              {testResult.message}
              {testResult.latencyMs ? ` · ${testResult.latencyMs}ms` : ""}
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="自动翻页与计划" hint="只操作页面按钮，不伪造学习进度">
        <Toggle
          checked={settings.autoTurn.enabled}
          onChange={(enabled) => save({ autoTurn: { enabled } })}
          label="启用自动翻页"
          description="章节完成后点击下一节；检测到题目时默认暂停。"
        />
        <Toggle
          checked={settings.autoTurn.waitVideoEnd}
          onChange={(waitVideoEnd) => save({ autoTurn: { waitVideoEnd } })}
          label="等待视频/音频结束"
          description="播放结束后再翻页；无音视频时按下方的等待时间处理。"
        />
        <Toggle
          checked={settings.autoTurn.stopOnUnanswered}
          onChange={(stopOnUnanswered) => save({ autoTurn: { stopOnUnanswered } })}
          label="遇到未答题目时暂停"
          description="避免把测验/作业直接翻过去。"
        />
        <Toggle
          checked={settings.autoTurn.autoStart}
          onChange={(autoStart) => save({ autoTurn: { autoStart } })}
          label="打开页面自动开始"
          description="进入章节/视频页时直接开始，无需再点「开始翻页」。"
        />
        <Toggle
          checked={settings.autoTurn.resumeOnReload}
          onChange={(resumeOnReload) => save({ autoTurn: { resumeOnReload } })}
          label="刷新/跳转后自动恢复"
          description="恢复上次的步数；关闭后每次刷新都需要手动开始。"
        />

        <div class="sh-divider" style="margin:9px 0" />
        <div class="sh-card__title" style="margin-bottom:2px">
          开始 / 结束条件
        </div>
        <div class="sh-hint" style="margin-bottom:6px">
          时间窗按本机时间；留空表示不限制。开始时间晚于结束时间视为跨午夜。
        </div>
        <div class="sh-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <Field label="每天开始时间">
            <TextInput
              type="time"
              value={settings.autoTurn.dailyStart}
              onBlur={(event) =>
                save({ autoTurn: { dailyStart: event.currentTarget.value.trim() } })
              }
            />
          </Field>
          <Field label="每天结束时间">
            <TextInput
              type="time"
              value={settings.autoTurn.dailyEnd}
              onBlur={(event) =>
                save({ autoTurn: { dailyEnd: event.currentTarget.value.trim() } })
              }
            />
          </Field>
        </div>
        <div class="sh-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:8px">
          <Field label="开始前延迟 (ms)" hint="点击开始后等待多久进入第一步。">
            <TextInput
              type="number"
              min="0"
              step="100"
              value={settings.autoTurn.startDelayMs}
              onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value)) save({ autoTurn: { startDelayMs: Math.max(0, value) } });
              }}
            />
          </Field>
          <Field label="最大运行时长 (分钟)" hint="0 表示不限制。">
            <TextInput
              type="number"
              min="0"
              step="5"
              value={settings.autoTurn.maxRunMinutes}
              onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value)) save({ autoTurn: { maxRunMinutes: Math.max(0, value) } });
              }}
            />
          </Field>
        </div>
        <Field label="无音视频时等待 (ms)" hint="文档/PPT/阅读页没有媒体时，等待该时间再翻页。">
          <TextInput
            type="number"
            min="0"
            step="500"
            value={settings.autoTurn.contentWaitMs}
            onBlur={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value)) save({ autoTurn: { contentWaitMs: Math.max(0, value) } });
            }}
          />
        </Field>

        <div class="sh-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:8px">
          <Field label="最小延迟 (ms)">
            <TextInput
              type="number"
              min="500"
              step="100"
              value={settings.autoTurn.minDelayMs}
              onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value)) save({ autoTurn: { minDelayMs: Math.max(500, value) } });
              }}
            />
          </Field>
          <Field label="最大延迟 (ms)">
            <TextInput
              type="number"
              min="800"
              step="100"
              value={settings.autoTurn.maxDelayMs}
              onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value)) save({ autoTurn: { maxDelayMs: Math.max(800, value) } });
              }}
            />
          </Field>
        </div>
        <Field label="最大步数" hint="防止无限循环，默认 200。">
          <TextInput
            type="number"
            min="1"
            max="2000"
            value={settings.autoTurn.maxSteps}
            onBlur={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value)) save({ autoTurn: { maxSteps: Math.max(1, Math.min(2000, value)) } });
            }}
          />
        </Field>
      </Card>

      <Card title="视频 / 音频播放" hint="进入页面时应用；不会修改平台学习记录">
        <Toggle
          checked={settings.video.autoPlay}
          onChange={(autoPlay) => save({ video: { autoPlay } })}
          label="自动开始播放"
          description="媒体初始处于暂停时尝试播放；被浏览器拦截会暂停翻页并提示。"
        />
        <Toggle
          checked={settings.video.resumeOnPause}
          onChange={(resumeOnPause) => save({ video: { resumeOnPause } })}
          label="暂停后自动恢复"
          description="播放中途暂停时尝试继续；不想被打断可关闭。"
        />
        <Toggle
          checked={settings.video.defaultMuted}
          onChange={(defaultMuted) => save({ video: { defaultMuted } })}
          label="默认静音"
          description="打开媒体时自动静音，可随时在播放器里取消。"
        />
        <Field label="默认倍速" hint="播放器支持时生效，1x 为原始速度。">
          <Select
            value={String(settings.video.playbackRate)}
            onChange={(event) =>
              save({ video: { playbackRate: Number(event.currentTarget.value) || 1 } })
            }
            options={VIDEO_RATES.map((rate) => ({
              value: String(rate),
              label: `${rate}x`,
            }))}
          />
        </Field>
        <div class="sh-hint" style="margin-top:6px">
          只调整页面中 video / audio 元素的 muted 与 playbackRate，不伪造进度、不调用平台日志接口。
        </div>
      </Card>

      <Card title="题库与缓存">
        <Field label={`模糊匹配阈值：${settings.bank.fuzzyThreshold.toFixed(2)}`} hint="越高越严格；建议 0.84–0.90。">
          <input
            class="sh-range"
            type="range"
            min="0.7"
            max="0.98"
            step="0.01"
            value={settings.bank.fuzzyThreshold}
            onInput={(event) =>
              save({ bank: { fuzzyThreshold: Number(event.currentTarget.value) } })
            }
          />
        </Field>
        <Field label="缓存保留天数" hint="命中缓存的题目不再重复请求 AI。">
          <TextInput
            type="number"
            min="0"
            max="365"
            value={settings.bank.cacheTtlDays}
            onBlur={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value)) save({ bank: { cacheTtlDays: Math.max(0, value) } });
            }}
          />
        </Field>
        <div class="sh-divider" style="margin:9px 0" />
        <Toggle
          checked={settings.bank.remote.enabled}
          onChange={(enabled) => save({ bank: { remote: { enabled } } })}
          label="启用远程题库"
          description="按自定义 HTTP 接口检索，失败时自动回退 AI。"
        />
        {settings.bank.remote.enabled ? (
          <div class="sh-stack" style="margin-top:6px">
            <Field label="接口 URL">
              <TextInput
                value={settings.bank.remote.url}
                placeholder="https://example.com/api/search"
                onBlur={(event) => save({ bank: { remote: { url: event.currentTarget.value.trim() } } })}
              />
            </Field>
            <Field label="答案字段路径" hint="例如 data.answer；留空使用 answer。">
              <TextInput
                value={settings.bank.remote.answerPath}
                placeholder="answer"
                onBlur={(event) =>
                  save({ bank: { remote: { answerPath: event.currentTarget.value.trim() } } })
                }
              />
            </Field>
            <Field label="置信度字段路径">
              <TextInput
                value={settings.bank.remote.confidencePath}
                placeholder="confidence"
                onBlur={(event) =>
                  save({ bank: { remote: { confidencePath: event.currentTarget.value.trim() } } })
                }
              />
            </Field>
            <Field label="请求体模板" hint="支持 {{question}} / {{type}} / {{options}} 三个占位符。">
              <textarea
                class="sh-textarea"
                rows={4}
                value={settings.bank.remote.bodyTemplate}
                onBlur={(event) =>
                  save({ bank: { remote: { bodyTemplate: event.currentTarget.value } } })
                }
              />
            </Field>
          </div>
        ) : null}
      </Card>

      <Card title="高级 / 通用适配器" hint="为学习通之外的平台配置选择器（实验性）">
        <Toggle
          checked={settings.advanced.debug}
          onChange={(debug) => save({ advanced: { debug } })}
          label="调试模式"
          description="输出更详细的日志，便于排查页面适配问题；不会暴露 API Key。"
        />
        <Field
          label="通用适配器 JSON"
          hint="需要 name / matches / questionContainer / stem；可选 options、typeLabel、nextButton、submitButton。保存后刷新页面生效。"
        >
          <textarea
            class="sh-textarea"
            rows={7}
            spellcheck={false}
            value={genericDraft}
            placeholder={'{\n  "name": "作业",\n  "matches": ["example.com"],\n  "questionContainer": ".question",\n  "stem": ".stem",\n  "options": ".option",\n  "nextButton": ".next"\n}'}
            onInput={(event) => setGenericDraft(event.currentTarget.value)}
          />
        </Field>
        {genericError ? (
          <div class="sh-hint" style="color:var(--sh-danger);margin-top:4px">
            {genericError}
          </div>
        ) : null}
        <div class="sh-actions" style="margin-top:8px">
          <Button size="sm" icon="check" onClick={saveGenericConfig}>
            保存通用适配器
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setGenericDraft("");
              setGenericError(null);
            }}
          >
            清空编辑框
          </Button>
        </div>
      </Card>

      <Card title="外观与快捷键">
        <Field label="主题">
          <Segmented<ThemeMode>
            value={settings.ui.theme}
            onChange={(theme) => save({ ui: { theme } })}
            options={[
              { value: "auto", label: "跟随系统" },
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ]}
          />
        </Field>
        <Field label="快捷键" hint="格式示例：Alt+Shift+S；保存后立即生效。">
          <TextInput
            value={settings.ui.hotkey}
            onBlur={(event) => save({ ui: { hotkey: event.currentTarget.value.trim() || "Alt+Shift+S" } })}
          />
        </Field>
      </Card>

      <Card title="数据与隐私" hint="所有数据只保存在本机，不上传">
        <div class="sh-actions">
          <Button size="sm" variant="danger" icon="trash" onClick={() => setResetConfirm(true)}>
            恢复默认设置
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="bug"
            onClick={() => controller.clearLogs()}
          >
            清空日志
          </Button>
        </div>
        <div class="sh-hint" style="margin-top:8px">
          当前 Key：{settings.ai.apiKey ? mask(settings.ai.apiKey) : "未设置"} · 题库{" "}
          {state.bank.total} 条
        </div>
      </Card>

      <Modal
        open={examConfirm}
        title="确认开启考试作答？"
        onClose={() => setExamConfirm(false)}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setExamConfirm(false)}>
              保持关闭
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                save({ solving: { allowExam: true } });
                setExamConfirm(false);
              }}
            >
              我了解风险，开启
            </Button>
          </>
        }
      >
        在考试页面自动作答可能违反学校与平台规定，并可能触发风控。请确认你有权这样做，并自行承担后果。
      </Modal>

      <Modal
        open={resetConfirm}
        title="恢复默认设置？"
        onClose={() => setResetConfirm(false)}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setResetConfirm(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                controller.resetSettings();
                setResetConfirm(false);
              }}
            >
              确认恢复
            </Button>
          </>
        }
      >
        将重置 AI、答题模式、自动翻页、题库阈值与外观设置，但不会删除题库与日志。
      </Modal>
    </div>
  );
}

function presetValue(baseUrl: string): string {
  return AI_PRESETS.find((preset) => preset.baseUrl && preset.baseUrl === baseUrl)?.label ?? "自定义";
}

function mask(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}
