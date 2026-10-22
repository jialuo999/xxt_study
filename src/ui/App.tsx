import { useEffect, useRef, useState } from "preact/hooks";
import type { TargetedPointerEvent } from "preact";
import type { UiController, UiState } from "./contract";
import { useController } from "./useController";
import { Badge, Icon, IconButton, Modal, Button } from "./components";
import { TABS, type TabId } from "./tabs";
import { OverviewPage } from "./pages/Overview";
import { SolvePage } from "./pages/Solve";
import { BankPage } from "./pages/Bank";
import { SettingsPage } from "./pages/Settings";
import { LogsPage } from "./pages/Logs";

type DragMode = "bubble" | "panel";

interface Position {
  x: number;
  y: number;
}

export function App({ controller }: { controller: UiController }) {
  const state = useController(controller);
  const [tab, setTab] = useState<TabId>(() => readInitialTab());
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [position, setPosition] = useState<Position>(() => resolvePosition(state));
  const [, forceTheme] = useState(0);
  const positionRef = useRef(position);
  positionRef.current = position;
  const dragRef = useRef<{ moved: boolean } | null>(null);

  const collapsed = state.settings.ui.collapsed;
  const theme = resolveTheme(state);
  const width = Math.min(state.settings.ui.width, Math.max(340, window.innerWidth - 24));
  const height = Math.min(state.settings.ui.height, Math.max(420, window.innerHeight - 24));
  const panelTop = Math.max(8, Math.min(position.y, window.innerHeight - height - 8));
  const panelLeft = Math.max(8, Math.min(position.x, window.innerWidth - width - 8));

  useEffect(() => {
    const next = resolvePosition(state);
    setPosition(next);
  }, [state.settings.ui.x, state.settings.ui.y, state.settings.ui.width, state.settings.ui.height]);

  useEffect(() => {
    const onResize = () => {
      setPosition((current) => ({
        x: Math.max(8, Math.min(current.x, window.innerWidth - 60)),
        y: Math.max(8, Math.min(current.y, window.innerHeight - 60)),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    try {
      const query = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => forceTheme((value) => value + 1);
      query.addEventListener?.("change", onChange);
      return () => query.removeEventListener?.("change", onChange);
    } catch {
      return;
    }
  }, [forceTheme]);

  const startDrag = (event: TargetedPointerEvent<HTMLElement>, mode: DragMode) => {
    if (event.button !== 0) return;
    if (mode === "panel" && (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...positionRef.current };
    const drag = { moved: false };
    dragRef.current = drag;

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      setPosition({
        x: clamp(origin.x + dx, 8, window.innerWidth - 60),
        y: clamp(origin.y + dy, 8, window.innerHeight - 60),
      });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragRef.current = null;
      if (drag.moved) {
        const latest = positionRef.current;
        controller.saveSettings({ ui: { x: latest.x, y: latest.y } });
      } else if (mode === "bubble") {
        controller.setCollapsed(false);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const busy = ["scanning", "solving", "filling", "submitting"].includes(state.status);
  const statusTone =
    state.status === "error" ? "error" : busy ? "busy" : state.page.supported ? "ok" : "idle";
  const statusLabel = state.statusText || (state.page.supported ? "已就绪" : "未适配");

  return (
    <div class="sh-root" data-theme={theme} lang="zh-CN">
      {collapsed ? (
        <button
          type="button"
          class="sh-bubble"
          style={{ left: `${position.x}px`, top: `${position.y}px` }}
          aria-label="打开学习助手"
          title="学习助手（拖动可移动）"
          onPointerDown={(event) => startDrag(event, "bubble")}
        >
          <Icon name="spark" size={25} className="sh-bubble__glyph" />
          <span class="sh-bubble__dot" data-busy={busy ? "true" : "false"} />
        </button>
      ) : (
        <section
          class="sh-panel"
          style={{
            left: `${panelLeft}px`,
            top: `${panelTop}px`,
            width: `${width}px`,
            height: `${height}px`,
          }}
          role="dialog"
          aria-modal="false"
          aria-label="学习助手面板"
        >
          <header
            class="sh-panel__header"
            onPointerDown={(event) => startDrag(event, "panel")}
          >
            <div class="sh-brand">
              <div class="sh-logo">
                <Icon name="spark" size={17} />
              </div>
              <div>
                <div class="sh-brand__title">学习助手</div>
                <div class="sh-brand__sub">Study Helper</div>
              </div>
            </div>
            <div class="sh-header__actions">
              <span class="sh-status" data-tone={statusTone}>
                <span class="sh-status__led" />
                {statusLabel}
              </span>
              <IconButton
                icon="close"
                label="收起面板"
                onClick={() => controller.setCollapsed(true)}
              />
            </div>
          </header>

          <nav class="sh-tabs" aria-label="功能标签">
            {TABS.map((item) => (
              <button
                type="button"
                key={item.id}
                class="sh-tab"
                data-active={tab === item.id ? "true" : "false"}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div class="sh-content">
            {tab === "overview" ? (
              <OverviewPage controller={controller} state={state} onNavigate={setTab} />
            ) : null}
            {tab === "solve" ? (
              <SolvePage controller={controller} state={state} onNavigate={setTab} />
            ) : null}
            {tab === "bank" ? (
              <BankPage controller={controller} state={state} onNavigate={setTab} />
            ) : null}
            {tab === "settings" ? (
              <SettingsPage controller={controller} state={state} onNavigate={setTab} />
            ) : null}
            {tab === "logs" ? (
              <LogsPage controller={controller} state={state} onNavigate={setTab} />
            ) : null}
          </div>
        </section>
      )}

      {state.toast ? (
        <div class="sh-toast" data-kind={state.toast.kind} role="status">
          <span class="sh-toast__dot" />
          {state.toast.text}
        </div>
      ) : null}

      <Modal
        open={!state.noticeAccepted && !noticeDismissed}
        title="使用须知"
        onClose={() => {
          setNoticeDismissed(true);
          controller.setCollapsed(true);
        }}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setNoticeDismissed(true);
                controller.setCollapsed(true);
              }}
            >
              暂不使用
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                controller.acceptNotice();
                setNoticeDismissed(true);
              }}
            >
              我已知晓
            </Button>
          </>
        }
      >
        <div class="sh-stack" style="gap:8px">
          <div class="sh-row" style="align-items:flex-start;gap:8px">
            <Icon name="shield" size={17} />
            <div>
              本工具用于个人学习辅助，默认「复核后提交」，考试页面默认禁用。
            </div>
          </div>
          <div>
            请遵守学校与平台的用户协议；不要用于代考、刷课或任何违规用途。工具不会伪造视频进度、绕过验证码或对抗平台检测。
          </div>
          <div class="sh-row" style="gap:6px;flex-wrap:wrap">
            <Badge tone="success">本地题库</Badge>
            <Badge tone="info">OpenAI 兼容</Badge>
            <Badge tone="warn">默认人工复核</Badge>
          </div>
          <div class="sh-hint">继续使用即表示你理解并自行承担相关风险。</div>
        </div>
      </Modal>
    </div>
  );
}

function resolveTheme(state: UiState): "light" | "dark" {
  const mode = state.settings.ui.theme;
  if (mode !== "auto") return mode;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

function resolvePosition(state: UiState): Position {
  const width = Math.min(state.settings.ui.width, Math.max(340, window.innerWidth - 24));
  const preferredX =
    state.settings.ui.x < 0 ? window.innerWidth - width - 24 : state.settings.ui.x;
  return {
    x: clamp(preferredX, 8, Math.max(8, window.innerWidth - 60)),
    y: clamp(state.settings.ui.y, 8, Math.max(8, window.innerHeight - 60)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readInitialTab(): TabId {
  const hash = window.location.hash.replace(/^#/, "").trim().toLowerCase();
  return TABS.some((item) => item.id === hash) ? (hash as TabId) : "overview";
}
