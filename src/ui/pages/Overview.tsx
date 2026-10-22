import { Badge, Button, Card, Confidence, EmptyState, Icon, Progress, Stat, formatRelative } from "@/ui/components";
import { MODE_LABEL, SOURCE_LABEL } from "@/ui/labels";
import { PAGE_KIND_LABEL, QUESTION_TYPE_LABEL } from "@/core/settings";
import type { PageProps } from "./shared";

export function OverviewPage({ controller, state, onNavigate }: PageProps) {
  const { page, questions, results, autoTurn, frames, settings, logs } = state;
  const solved = questions.filter((question) => results[question.id]?.status === "solved").length;
  const pending = questions.filter((question) => results[question.id]?.status === "pending").length;
  const busy = ["scanning", "solving", "filling", "submitting"].includes(state.status);
  const examBlocked = page.kind === "exam" && !settings.solving.allowExam;
  const recentLogs = [...logs].slice(-4).reverse();

  return (
    <div class="sh-stack">
      <div class="sh-hero">
        <div class="sh-hero__icon">
          <Icon name="layers" size={18} />
        </div>
        <div class="sh-grow">
          <div class="sh-row" style="gap:6px;flex-wrap:wrap">
            <span style="font-weight:700;font-size:12.5px">{PAGE_KIND_LABEL[page.kind]}</span>
            <Badge tone={page.supported ? "success" : "muted"}>
              {page.supported ? "已适配" : "未适配"}
            </Badge>
          </div>
          <div class="sh-faint sh-small sh-truncate" style="margin-top:2px">
            {safeHost(page.url)}
            {state.frames.length > 1 ? ` · ${state.frames.length} 个 frame` : ""}
          </div>
        </div>
        <Badge tone={state.status === "error" ? "danger" : busy ? "warn" : "accent"}>
          {state.statusText || "待命"}
        </Badge>
      </div>

      {examBlocked ? (
        <Card accent>
          <div class="sh-row" style="align-items:flex-start">
            <Icon name="shield" size={16} />
            <div class="sh-grow">
              <div class="sh-card__title">考试页面已保护</div>
              <div class="sh-card__hint">
                默认禁止在考试页自动作答。确需使用请在设置中显式开启，并自行承担平台规则风险。
              </div>
            </div>
          </div>
          <div style="margin-top:8px">
            <Button size="sm" variant="ghost" icon="settings" onClick={() => onNavigate("settings")}>
              前往设置
            </Button>
          </div>
        </Card>
      ) : null}

      {!settings.ai.apiKey && settings.ai.enabled ? (
        <Card>
          <div class="sh-row" style="align-items:flex-start">
            <Icon name="key" size={16} />
            <div class="sh-grow">
              <div class="sh-card__title">还差一个 API Key</div>
              <div class="sh-card__hint">填写 OpenAI 兼容接口的 Key 后即可使用 AI 解题。</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onNavigate("settings")}>
              配置
            </Button>
          </div>
        </Card>
      ) : null}

      <div class="sh-grid">
        <Stat value={questions.length} label="本页题目" />
        <Stat value={solved} label="已答" />
        <Stat value={pending} label="待确认" />
        <Stat value={frames.length || 1} label="已连接帧" />
      </div>

      <Card
        title="自动翻页"
        hint={
          autoTurn.running
            ? autoTurn.message || "正在等待页面完成"
            : settings.autoTurn.enabled
              ? "已启用，等待手动开始"
              : "未启用"
        }
        accent
        action={
          <Badge tone={autoTurn.running ? "success" : "muted"}>
            {autoTurn.running ? "运行中" : "已停止"}
          </Badge>
        }
      >
        <div class="sh-stack" style="gap:8px">
          <div class="sh-row sh-row--between">
            <span class="sh-small sh-muted">
              进度 {autoTurn.steps}/{autoTurn.maxSteps} 步
            </span>
            <span class="sh-small sh-faint">
              {settings.autoTurn.waitVideoEnd ? "等待视频结束" : "不等待视频"}
            </span>
          </div>
          <Progress value={autoTurn.steps} max={autoTurn.maxSteps || 1} />
          <div class="sh-actions">
            {autoTurn.running ? (
              <Button size="sm" icon="pause" onClick={() => controller.stopAutoTurn()}>
                结束翻页
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon="play"
                disabled={!page.supported || busy}
                onClick={() => controller.startAutoTurn()}
              >
                开始翻页
              </Button>
            )}
            <Button size="sm" icon="scan" disabled={busy} onClick={() => void controller.refresh()}>
              重新扫描
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onNavigate("settings")}>
              翻页设置
            </Button>
          </div>
        </div>
      </Card>

      <Card
        title="快捷操作"
        hint={`当前模式：${MODE_LABEL[settings.solving.mode]}`}
        action={
          <Button size="sm" variant="ghost" onClick={() => onNavigate("solve")}>
            查看题目
          </Button>
        }
      >
        <div class="sh-actions">
          <Button
            size="sm"
            icon="wand"
            disabled={busy || questions.length === 0 || examBlocked}
            onClick={() => void controller.solve()}
          >
            AI 解题
          </Button>
          <Button
            size="sm"
            icon="check"
            disabled={busy || solved === 0 || examBlocked}
            onClick={() => void controller.fillAll()}
          >
            全部填入
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="send"
            disabled={busy || questions.length === 0 || examBlocked}
            onClick={() => void controller.submit()}
          >
            提交
          </Button>
        </div>
        {questions.length > 0 ? (
          <div class="sh-hint" style="margin-top:8px">
            最近一题：
            {QUESTION_TYPE_LABEL[questions[0].type]} ·{" "}
            {results[questions[0].id]
              ? `${SOURCE_LABEL[results[questions[0].id].source]} · ${Math.round(
                  results[questions[0].id].confidence * 100,
                )}%`
              : "尚未解题"}
          </div>
        ) : null}
      </Card>

      <Card
        title="最近日志"
        action={
          <Button size="sm" variant="ghost" onClick={() => onNavigate("logs")}>
            全部
          </Button>
        }
      >
        {recentLogs.length === 0 ? (
          <EmptyState icon="bug" title="暂无日志" description="操作记录会显示在这里。" />
        ) : (
          <div class="sh-stack" style="gap:4px">
            {recentLogs.map((entry) => (
              <div class="sh-log" data-level={entry.level} key={entry.id}>
                <span class="sh-log__time">{formatRelative(entry.ts)}</span>
                <span class="sh-log__msg sh-truncate">{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div class="sh-hint" style="text-align:center;padding:2px 0 6px">
        默认人工复核 · 题库优先 · 不伪造视频进度
      </div>
    </div>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
