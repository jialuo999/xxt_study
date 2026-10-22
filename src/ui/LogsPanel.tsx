import { useState } from "preact/hooks";
import { Button, EmptyState, Modal, Segmented } from "@/ui/components";
import { downloadText, formatDateTime } from "@/ui/tabs";
import type { LogLevel } from "@/core/logger";
import type { PageProps } from "./pages/shared";

type Filter = "all" | LogLevel;

export function LogsPanel({ controller, state }: Pick<PageProps, "controller" | "state">) {
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmClear, setConfirmClear] = useState(false);
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
    <div class="sh-stack" style="gap:8px">
      <div class="sh-row sh-row--between">
        <span class="sh-small sh-faint">{state.logs.length} 条记录</span>
        <div class="sh-actions">
          <Button
            size="sm"
            icon="download"
            onClick={() =>
              downloadText(
                `study-helper-logs-${Date.now()}.txt`,
                controller.exportLogs(),
                "text/plain",
              )
            }
          >
            导出
          </Button>
          <Button size="sm" icon="copy" onClick={() => void copyAll()}>
            复制
          </Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirmClear(true)}>
            清空
          </Button>
        </div>
      </div>

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

      <div class="sh-hint" style="text-align:center;padding:2px 0 2px">
        日志最多保留 500 条
      </div>

      <Modal
        open={confirmClear}
        title="清空运行日志？"
        onClose={() => setConfirmClear(false)}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                controller.clearLogs();
                setConfirmClear(false);
              }}
            >
              确认清空
            </Button>
          </>
        }
      >
        将清空当前会话的全部日志记录，无法撤销。导出的日志文件不受影响。
      </Modal>
    </div>
  );
}
