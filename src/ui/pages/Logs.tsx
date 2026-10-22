import { useState } from "preact/hooks";
import { Badge, Button, Card, EmptyState, Segmented } from "@/ui/components";
import { downloadText, formatDateTime } from "@/ui/tabs";
import type { LogLevel } from "@/core/logger";
import type { PageProps } from "./shared";

type Filter = "all" | LogLevel;

export function LogsPage({ controller, state }: PageProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const logs = [...state.logs].reverse();
  const visible = filter === "all" ? logs : logs.filter((entry) => entry.level === filter);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(controller.exportLogs());
    } catch {
      /* clipboard may be unavailable */
    }
  };

  return (
    <div class="sh-stack">
      <Card
        title="运行日志"
        hint={`${state.logs.length} 条记录 · 已自动脱敏 Key / Authorization`}
        action={<Badge tone={state.logs.length ? "info" : "muted"}>{visible.length} 显示</Badge>}
      >
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "全部" },
            { value: "info", label: "信息" },
            { value: "warn", label: "警告" },
            { value: "error", label: "错误" },
            { value: "debug", label: "调试" },
          ]}
        />
        <div class="sh-actions" style="margin-top:9px">
          <Button size="sm" icon="download" onClick={() => downloadText(`study-helper-logs-${Date.now()}.txt`, controller.exportLogs(), "text/plain")}>
            导出
          </Button>
          <Button size="sm" icon="copy" onClick={() => void copyAll()}>
            复制
          </Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={() => controller.clearLogs()}>
            清空
          </Button>
        </div>
      </Card>

      {visible.length === 0 ? (
        <EmptyState icon="bug" title="没有日志" description="操作、AI 请求与错误信息会记录在这里。" />
      ) : (
        <div class="sh-stack" style="gap:2px">
          {visible.map((entry) => (
            <div class="sh-log" data-level={entry.level} key={entry.id}>
              <span class="sh-log__time">{formatDateTime(entry.ts).slice(-8)}</span>
              <span class="sh-log__level">{entry.level}</span>
              <span class="sh-log__msg">
                <span class="sh-faint">[{entry.scope}]</span> {entry.message}
              </span>
            </div>
          ))}
        </div>
      )}

      <div class="sh-hint" style="text-align:center;padding:2px 0 6px">
        日志最多保留 500 条
      </div>
    </div>
  );
}
