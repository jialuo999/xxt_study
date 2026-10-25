import { useRef, useState } from "preact/hooks";
import {
  Badge,
  Button,
  Card,
  CollapsibleCard,
  EmptyState,
  Icon,
  Modal,
  Spinner,
  TextInput,
} from "@/ui/components";
import { questionTypeLabel } from "@/ui/labels";
import { applyLanguage, t } from "@/core/i18n";
import { formatAnswer } from "@/utils/text";
import type { BankEntry } from "@/core/types";
import { downloadText, formatDateTime } from "@/ui/tabs";
import { BankPanel } from "@/ui/panels/BankPanel";
import { SECTION_KEYS, isSectionOpen, toggleSection } from "@/ui/sections";
import type { PageProps } from "./shared";

export function BankPage({ controller, state }: PageProps) {
  applyLanguage(state.settings.ui.language);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<BankEntry[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await controller.importBankFile(file);
      setImportResult(result.message);
    } catch (error) {
      setImportResult(
        t("bank.importFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doSearch = async () => {
    const text = query.trim();
    if (!text) {
      setFound([]);
      return;
    }
    setSearching(true);
    try {
      setFound(await controller.searchBank(text));
    } finally {
      setSearching(false);
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const text = await controller.exportBank();
      downloadText(
        `study-helper-bank-${new Date().toISOString().slice(0, 10)}.json`,
        text,
      );
    } finally {
      setExporting(false);
    }
  };

  const sectionStates = state.settings.ui.sectionStates ?? {};

  return (
    <div class="sh-stack">
      {state.bank.storage === "memory" ? (
        <Card accent>
          <div class="sh-row" style="align-items:flex-start">
            <Icon name="alert" size={16} />
            <div class="sh-grow">
              <div class="sh-card__title">{t("bank.memoryTitle")}</div>
              <div class="sh-card__hint">{t("bank.memoryDesc")}</div>
            </div>
          </div>
        </Card>
      ) : null}
      <div class="sh-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <Card>
          <div class="sh-stat">
            <div class="sh-stat__value">{state.bank.total}</div>
            <div class="sh-stat__label">{t("bank.statEntries")}</div>
          </div>
        </Card>
        <Card>
          <div class="sh-stat">
            <div class="sh-stat__value" style="font-size:15px">
              {formatDateTime(state.bank.lastUpdated)}
            </div>
            <div class="sh-stat__label">{t("bank.statUpdated")}</div>
          </div>
        </Card>
      </div>

      <Card
        title={t("bank.importTitle")}
        hint={t("bank.importHint")}
        action={
          <Badge tone={state.bank.total > 0 ? "success" : "muted"}>
            {state.bank.total > 0 ? t("bank.available") : t("bank.empty")}
          </Badge>
        }
      >
        <div
          class="sh-dropzone"
          data-drag={dragging ? "true" : "false"}
          role="button"
          tabIndex={0}
          onClick={(event) => {
            if ((event.target as HTMLElement).tagName !== "INPUT") fileRef.current?.click();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") fileRef.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void handleFiles(event.dataTransfer?.files ?? null);
          }}
        >
          <input
            ref={fileRef}
            class="sh-file"
            type="file"
            accept=".json,.csv,.tsv,.txt,application/json,text/csv,text/plain"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => void handleFiles(event.currentTarget.files)}
          />
          <div class="sh-row" style="justify-content:center;gap:7px">
            {importing ? <Spinner size={15} /> : <Icon name="upload" size={16} />}
            <span style="font-size:12px;font-weight:600">
              {importing ? t("bank.importing") : t("bank.dropHint")}
            </span>
          </div>
          <div class="sh-hint" style="margin-top:5px">
            {t("bank.csvHint")}
          </div>
        </div>
        {importResult ? (
          <div class="sh-hint" style="margin-top:8px;color:var(--sh-text)">
            {importResult}
          </div>
        ) : null}
        <div class="sh-actions" style="margin-top:9px">
          <Button size="sm" icon="download" disabled={exporting} onClick={() => void doExport()}>
            {t("bank.export")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon="trash"
            disabled={state.bank.total === 0}
            onClick={() => setConfirmClear(true)}
          >
            {t("bank.clear")}
          </Button>
        </div>
      </Card>

      <Card title={t("bank.searchTitle")} hint={t("bank.searchHint")}>
        <div class="sh-searchbar">
          <TextInput
            placeholder={t("bank.searchPlaceholder")}
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void doSearch();
            }}
          />
          <Button size="sm" icon="search" disabled={searching} onClick={() => void doSearch()}>
            {t("bank.searchButton")}
          </Button>
        </div>
        {found.length > 0 ? (
          <div class="sh-stack" style="margin-top:9px">
            {found.map((entry) => (
              <div class="sh-bank-row" key={entry.id}>
                <div class="sh-grow">
                  <div class="sh-qitem__stem" style="margin-bottom:3px">
                    {entry.stem}
                  </div>
                  <div class="sh-row" style="gap:5px;flex-wrap:wrap">
                    <Badge tone="muted">{questionTypeLabel(entry.type)}</Badge>
                    <span class="sh-small" style="color:var(--sh-accent-2)">
                      {formatAnswer(entry.answer)}
                    </span>
                  </div>
                  <div class="sh-hint" style="margin-top:3px">
                    {t("bank.source", {
                      source: entry.source || t("bank.unknownSource"),
                      time: formatDateTime(entry.updatedAt),
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : query && !searching ? (
          <div class="sh-hint" style="margin-top:8px">
            {t("bank.searchEmpty")}
          </div>
        ) : null}
      </Card>

      <CollapsibleCard
        id={SECTION_KEYS.bankSettings}
        title={t("bank.settingsTitle")}
        hint={t("bank.settingsHint")}
        summary={t("bank.settingsSummary", {
          threshold: state.settings.bank.fuzzyThreshold.toFixed(2),
          days: state.settings.bank.cacheTtlDays,
          remote: state.settings.bank.remote.enabled ? t("bank.remoteOn") : t("bank.remoteOff"),
        })}
        open={isSectionOpen(sectionStates, SECTION_KEYS.bankSettings)}
        onToggle={() => toggleSection(controller, sectionStates, SECTION_KEYS.bankSettings)}
        action={
          <Badge tone={state.settings.bank.remote.enabled ? "info" : "muted"}>
            {state.settings.bank.remote.enabled ? t("bank.badgeHttp") : t("bank.badgeLocal")}
          </Badge>
        }
      >
        <BankPanel controller={controller} state={state} />
      </CollapsibleCard>

      <Modal
        open={confirmClear}
        title={t("bank.clearTitle")}
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
                setConfirmClear(false);
                void controller.clearBank();
              }}
            >
              {t("bank.clearConfirm")}
            </Button>
          </>
        }
      >
        {t("bank.clearBody")}
      </Modal>

      {state.bank.total === 0 ? (
        <EmptyState
          icon="book"
          title={t("bank.emptyTitle")}
          description={t("bank.emptyDesc")}
        />
      ) : null}

      <div class="sh-hint" style="text-align:center;padding:2px 0 6px">
        {t("bank.footer")}
      </div>
    </div>
  );
}
