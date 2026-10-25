import { useState } from "preact/hooks";
import { t } from "@/core/i18n";
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
        <span class="sh-small sh-faint">{t("common.recordCount", { count: state.logs.length })}</span>
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
            {t("logs.export")}
          </Button>
          <Button size="sm" icon="copy" onClick={() => void copyAll()}>
            {t("logs.copy")}
          </Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirmClear(true)}>
            {t("logs.clear")}
          </Button>
        </div>
      </div>

      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: t("logs.filter.all") },
          { value: "info", label: t("logs.filter.info") },
          { value: "warn", label: t("logs.filter.warn") },
          { value: "error", label: t("logs.filter.error") },
          { value: "debug", label: t("logs.filter.debug") },
        ]}
      />

      {visible.length === 0 ? (
        <EmptyState
          icon="bug"
          title={t("logs.emptyTitle")}
          description={t("logs.emptyDesc")}
        />
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
        {t("logs.limit")}
      </div>

      <Modal
        open={confirmClear}
        title={t("logs.clearTitle")}
        onClose={() => setConfirmClear(false)}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                controller.clearLogs();
                setConfirmClear(false);
              }}
            >
              {t("logs.clearConfirm")}
            </Button>
          </>
        }
      >
        {t("logs.clearBody")}
      </Modal>
    </div>
  );
}
