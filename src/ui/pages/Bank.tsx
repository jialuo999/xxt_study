import { useRef, useState } from "preact/hooks";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  Modal,
  Spinner,
  TextInput,
} from "@/ui/components";
import { QUESTION_TYPE_LABEL } from "@/core/settings";
import { formatAnswer } from "@/utils/text";
import type { BankEntry } from "@/core/types";
import { downloadText, formatDateTime } from "@/ui/tabs";
import type { PageProps } from "./shared";

export function BankPage({ controller, state, onNavigate }: PageProps) {
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
      setImportResult(`导入失败：${error instanceof Error ? error.message : String(error)}`);
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

  const openRemoteSettings = () => {
    controller.saveSettings({ ui: { sectionStates: { bank: true } } });
    onNavigate("settings");
  };

  return (
    <div class="sh-stack">
      <div class="sh-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <Card>
          <div class="sh-stat">
            <div class="sh-stat__value">{state.bank.total}</div>
            <div class="sh-stat__label">题库条目</div>
          </div>
        </Card>
        <Card>
          <div class="sh-stat">
            <div class="sh-stat__value" style="font-size:15px">
              {formatDateTime(state.bank.lastUpdated)}
            </div>
            <div class="sh-stat__label">最近更新</div>
          </div>
        </Card>
      </div>

      <Card
        title="导入题库"
        hint="支持 JSON / CSV / TSV / TXT，自动去重、按题干与选项匹配"
        action={
          <Badge tone={state.bank.total > 0 ? "success" : "muted"}>
            {state.bank.total > 0 ? "可用" : "空"}
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
            accept=".json,.jsonl,.csv,.tsv,.txt,application/json,text/csv,text/plain"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => void handleFiles(event.currentTarget.files)}
          />
          <div class="sh-row" style="justify-content:center;gap:7px">
            {importing ? <Spinner size={15} /> : <Icon name="upload" size={16} />}
            <span style="font-size:12px;font-weight:600">
              {importing ? "正在导入…" : "点击选择或拖拽题库文件"}
            </span>
          </div>
          <div class="sh-hint" style="margin-top:5px">
            CSV 列名：type, question, optionA-F, answer, source（也兼容中文表头）
          </div>
        </div>
        {importResult ? (
          <div class="sh-hint" style="margin-top:8px;color:var(--sh-text)">
            {importResult}
          </div>
        ) : null}
        <div class="sh-actions" style="margin-top:9px">
          <Button size="sm" icon="download" disabled={exporting} onClick={() => void doExport()}>
            导出题库
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon="trash"
            disabled={state.bank.total === 0}
            onClick={() => setConfirmClear(true)}
          >
            清空
          </Button>
        </div>
      </Card>

      <Card
        title="检索"
        hint="按题干文本模糊搜索本地题库"
        action={
          <Button size="sm" variant="ghost" onClick={openRemoteSettings}>
            远程题库
          </Button>
        }
      >
        <div class="sh-searchbar">
          <TextInput
            placeholder="输入题干关键词…"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void doSearch();
            }}
          />
          <Button size="sm" icon="search" disabled={searching} onClick={() => void doSearch()}>
            搜索
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
                    <Badge tone="muted">{QUESTION_TYPE_LABEL[entry.type]}</Badge>
                    <span class="sh-small" style="color:var(--sh-accent-2)">
                      {formatAnswer(entry.answer)}
                    </span>
                  </div>
                  <div class="sh-hint" style="margin-top:3px">
                    来源：{entry.source || "未知"} · {formatDateTime(entry.updatedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : query && !searching ? (
          <div class="sh-hint" style="margin-top:8px">
            没有命中，试试缩短关键词，或导入更多题库。
          </div>
        ) : null}
      </Card>

      <Card title="远程题库" hint={state.settings.bank.remote.enabled ? "已启用通用 HTTP 接口" : "未启用"}>
        <div class="sh-row sh-row--between">
          <div class="sh-hint">
            {state.settings.bank.remote.enabled
              ? state.settings.bank.remote.url || "未填写 URL"
              : "可在设置中配置远程搜题接口（可选）"}
          </div>
          <Badge tone={state.settings.bank.remote.enabled ? "info" : "muted"}>
            {state.settings.bank.remote.enabled ? "HTTP" : "关闭"}
          </Badge>
        </div>
      </Card>

      <Modal
        open={confirmClear}
        title="清空本地题库？"
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
                setConfirmClear(false);
                void controller.clearBank();
              }}
            >
              确认清空
            </Button>
          </>
        }
      >
        将删除本机浏览器中的全部题库条目与解题缓存，无法撤销。建议先导出备份。
      </Modal>

      {state.bank.total === 0 ? (
        <EmptyState
          icon="book"
          title="题库还是空的"
          description="导入已有题库后，解题会优先命中本地答案，速度更快、成本更低。"
        />
      ) : null}

      <div class="sh-hint" style="text-align:center;padding:2px 0 6px">
        题库仅保存在本机 IndexedDB，不会上传
      </div>
    </div>
  );
}
