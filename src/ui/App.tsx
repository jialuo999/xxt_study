import { useEffect, useRef, useState } from "preact/hooks";
import type { TargetedPointerEvent } from "preact";
import type { UiController, UiState } from "./contract";
import { useController } from "./useController";
import { Badge, Icon, IconButton, Modal, Button } from "./components";
import { TABS, type TabId } from "./tabs";
import { HomePage } from "./pages/Home";
import { SolvePage } from "./pages/Solve";
import { BankPage } from "./pages/Bank";
import { SettingsPage } from "./pages/Settings";

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
    const dragElement =
      mode === "bubble"
        ? (event.currentTarget as HTMLElement)
        : ((event.currentTarget as HTMLElement).closest(".sh-panel") as HTMLElement | null);
    const maxX = Math.max(8, window.innerWidth - (mode === "panel" ? width : 60) - 8);
    const maxY = Math.max(8, window.innerHeight - (mode === "panel" ? height : 60) - 8);
    const pointerTarget = event.currentTarget as HTMLElement;
    let lastDx = 0;
    let lastDy = 0;

    try {
      pointerTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }

    if (dragElement) {
      dragElement.style.willChange = "transform";
      dragElement.style.transition = "none";
    }

    const updateFromPointer = (moveEvent: PointerEvent) => {
      const dx = clamp(moveEvent.clientX - startX, 8 - origin.x, maxX - origin.x);
      const dy = clamp(moveEvent.clientY - startY, 8 - origin.y, maxY - origin.y);
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      lastDx = dx;
      lastDy = dy;
      if (dragElement) {
        // 同步写 transform：不再等 rAF，快速移动时也不会落后一帧
        dragElement.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      }
    };

    const onMove = (moveEvent: PointerEvent) => {
      // pointerrawupdate / getCoalescedEvents 能拿到更密集、更接近光标的点
      try {
        const coalesced = moveEvent.getCoalescedEvents?.();
        if (coalesced && coalesced.length > 0) {
          updateFromPointer(coalesced[coalesced.length - 1]);
          return;
        }
      } catch {
        /* ignore */
      }
      updateFromPointer(moveEvent);
    };

    const finish = (upEvent?: PointerEvent) => {
      window.removeEventListener("pointermove", onMove as EventListener);
      window.removeEventListener("pointerrawupdate", onMove as EventListener, true);
      window.removeEventListener("pointerup", finish as EventListener);
      window.removeEventListener("pointercancel", onCancel);
      try {
        pointerTarget.releasePointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
      if (upEvent) updateFromPointer(upEvent);

      const finalPosition = {
        x: clamp(origin.x + lastDx, 8, maxX),
        y: clamp(origin.y + lastDy, 8, maxY),
      };
      if (drag.moved) {
        if (dragElement) {
          // 同一帧内同步提交 left/top 并清除 transform，避免两者叠加导致松手时抖一下
          dragElement.style.left = `${finalPosition.x}px`;
          dragElement.style.top = `${finalPosition.y}px`;
          dragElement.style.transform = "";
          dragElement.style.willChange = "";
          requestAnimationFrame(() => {
            if (dragElement) dragElement.style.transition = "";
          });
        }
        setPosition(finalPosition);
        controller.saveSettings({ ui: { x: finalPosition.x, y: finalPosition.y } });
      } else {
        if (dragElement) {
          dragElement.style.transform = "";
          dragElement.style.willChange = "";
          dragElement.style.transition = "";
        }
        if (mode === "bubble") controller.setCollapsed(false);
      }
    };

    const onCancel = () => finish();
    window.addEventListener("pointermove", onMove as EventListener);
    if ("onpointerrawupdate" in window) {
      window.addEventListener("pointerrawupdate", onMove as EventListener, true);
    }
    window.addEventListener("pointerup", finish as EventListener);
    window.addEventListener("pointercancel", onCancel);
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
          <Icon name="bookOpen" size={25} className="sh-bubble__glyph" />
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
                <Icon name="bookOpen" size={17} />
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

          {state.verification.detected ? (
            <div class="sh-verify" role="alert">
              <Icon name="alert" size={15} />
              <div class="sh-verify__copy">
                <div class="sh-verify__title">需要手动完成人机验证</div>
                <div class="sh-verify__desc">
                  {`${state.verification.message || "平台要求人机验证"}。自动翻页不会继续，请在页面中完成验证后重新开始。`}
                </div>
              </div>
            </div>
          ) : null}

          <div class="sh-content">
            {tab === "home" ? (
              <HomePage controller={controller} state={state} onNavigate={setTab} />
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
  return TABS.some((item) => item.id === hash) ? (hash as TabId) : "home";
}
