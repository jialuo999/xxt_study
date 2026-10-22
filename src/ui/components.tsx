import type {
  ButtonHTMLAttributes,
  ComponentChildren,
  InputHTMLAttributes,
  SelectHTMLAttributes,
} from "preact";
import { useId } from "preact/hooks";

export type IconName =
  | "spark"
  | "refresh"
  | "play"
  | "pause"
  | "send"
  | "check"
  | "close"
  | "settings"
  | "book"
  | "list"
  | "bug"
  | "eye"
  | "eyeOff"
  | "trash"
  | "download"
  | "upload"
  | "key"
  | "chevronRight"
  | "chevronDown"
  | "alert"
  | "scan"
  | "wand"
  | "clock"
  | "layers"
  | "shield"
  | "external"
  | "copy"
  | "search";

const ICON_PATHS: Record<IconName, ComponentChildren> = {
  spark: (
    <path d="M12 2.8l1.7 5.1 5.1 1.7-5.1 1.7L12 16.4l-1.7-5.1L5.2 9.6l5.1-1.7L12 2.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 10-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  play: <path d="M8 5.5v13l10-6.5-10-6.5z" />,
  pause: (
    <>
      <path d="M9 5v14M15 5v14" />
    </>
  ),
  send: (
    <>
      <path d="M21 3L10.5 13.5" />
      <path d="M21 3l-6.5 18-4-7.5L3 9.5 21 3z" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5L20 6.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </>
  ),
  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  bug: (
    <>
      <path d="M8 2l1.5 2.5M16 2l-1.5 2.5" />
      <rect x="7" y="6" width="10" height="14" rx="5" />
      <path d="M3 10h4M17 10h4M3 15h4M17 15h4M4 6l3 2M20 6l-3 2M4 20l3-2M20 20l-3-2" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A10.6 10.6 0 0112 6c6.5 0 10 6 10 6a17 17 0 01-3 3.7M6.5 6.7A17 17 0 002 12s3.5 6 10 6a10 10 0 004.3-.9" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 19h16" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 3l3 3M14.5 5.5l2 2" />
    </>
  ),
  chevronRight: <path d="M9 5l7 7-7 7" />,
  chevronDown: <path d="M5 9l7 7 7-7" />,
  alert: (
    <>
      <path d="M12 3l9.5 17H2.5L12 3z" />
      <path d="M12 9v5M12 17.5h.01" />
    </>
  ),
  scan: (
    <>
      <path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" />
      <path d="M4 12h16" />
    </>
  ),
  wand: (
    <>
      <path d="M15 4l1 2.5L18.5 8 16 9l-1 2.5L14 9l-2.5-1L14 6.5 15 4zM6 14l1 2.5L9.5 18 7 19l-1 2.5L5 19l-2.5-1L5 16.5 6 14z" />
      <path d="M14 14l6 6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  layers: (
    <>
      <path d="M12 2l9 5-9 5-9-5 9-5z" />
      <path d="M3 12l9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  external: (
    <>
      <path d="M14 3h7v7M21 3l-9 9" />
      <path d="M19 14v6H4V5h6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
};

const FILLED_ICONS = new Set<IconName>(["play", "spark", "check", "send"]);

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const filled = FILLED_ICONS.has(name);
  return (
    <svg
      class={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  block?: boolean;
  icon?: IconName;
}

export function Button({
  variant = "secondary",
  size = "md",
  block,
  icon,
  children,
  class: className,
  ...rest
}: ButtonProps) {
  const classes = [
    "sh-btn",
    `sh-btn--${variant}`,
    size === "sm" ? "sh-btn--sm" : "",
    block ? "sh-btn--block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" class={classes} {...rest}>
      {icon ? <Icon name={icon} size={size === "sm" ? 13 : 15} /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  danger?: boolean;
}

export function IconButton({ icon, label, danger, class: className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      class={`sh-icon-btn ${danger ? "sh-icon-btn--danger" : ""} ${className ?? ""}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

export type Tone = "accent" | "success" | "warn" | "danger" | "info" | "muted";

export function Badge({ tone = "muted", children }: { tone?: Tone; children: ComponentChildren }) {
  return (
    <span class="sh-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function Card({
  title,
  hint,
  accent,
  children,
  action,
}: {
  title?: string;
  hint?: string;
  accent?: boolean;
  children: ComponentChildren;
  action?: ComponentChildren;
}) {
  return (
    <section class={`sh-card ${accent ? "sh-card--accent" : ""}`}>
      {title || action ? (
        <div class="sh-row sh-row--between" style="margin-bottom:8px">
          <div>
            {title ? <div class="sh-card__title">{title}</div> : null}
            {hint ? <div class="sh-card__hint">{hint}</div> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function CollapsibleCard({
  id,
  title,
  hint,
  summary,
  open,
  onToggle,
  accent,
  action,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  accent?: boolean;
  action?: ComponentChildren;
  children: ComponentChildren;
}) {
  const bodyId = `sh-section-${id}`;
  return (
    <section
      class={`sh-card sh-card--collapse ${accent ? "sh-card--accent" : ""}`}
      data-section={id}
      data-open={open ? "true" : "false"}
    >
      <div class="sh-collapse-head">
        <button
          type="button"
          class="sh-collapse-toggle"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
        >
          <span class="sh-collapse-chevron" aria-hidden="true">
            <Icon name="chevronDown" size={14} />
          </span>
          <span class="sh-collapse-copy">
            <span class="sh-card__title">{title}</span>
            {open && hint ? (
              <span class="sh-card__hint">{hint}</span>
            ) : !open && (summary || hint) ? (
              <span class="sh-card__hint">{summary ?? hint}</span>
            ) : null}
          </span>
        </button>
        {action ? <div class="sh-collapse-action">{action}</div> : null}
      </div>
      {open ? (
        <div class="sh-collapse-body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function Stat({ value, label }: { value: ComponentChildren; label: string }) {
  return (
    <div class="sh-stat">
      <div class="sh-stat__value">{value}</div>
      <div class="sh-stat__label">{label}</div>
    </div>
  );
}

export function Progress({
  value,
  max = 100,
  tone,
}: {
  value: number;
  max?: number;
  tone?: "warn" | "danger";
}) {
  const percent = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      class="sh-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div class="sh-progress__bar" data-tone={tone} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div class="sh-toggle-row">
      <div class="sh-toggle-copy">
        <div class="sh-toggle-copy__title">{label}</div>
        {description ? <div class="sh-toggle-copy__desc">{description}</div> : null}
      </div>
      <button
        type="button"
        class="sh-switch"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        data-on={checked ? "true" : "false"}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ComponentChildren;
  htmlFor?: string;
}) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  return (
    <div class="sh-field">
      <label class="sh-label" for={id}>
        {label}
      </label>
      {children}
      {hint ? <div class="sh-hint">{hint}</div> : null}
    </div>
  );
}

export function TextInput({
  class: className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input class={`sh-input ${className ?? ""}`} {...(rest as any)} />;
}

export function Select({
  options,
  class: className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select class={`sh-select ${className ?? ""}`} {...(rest as any)}>
      {options.map((option) => (
        <option value={option.value} key={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div class="sh-seg" role="tablist">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          class="sh-seg__item"
          data-active={option.value === value ? "true" : "false"}
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon = "spark",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ComponentChildren;
}) {
  return (
    <div class="sh-empty">
      <div class="sh-empty__icon">
        <Icon name={icon} size={21} />
      </div>
      <div class="sh-empty__title">{title}</div>
      {description ? <div class="sh-empty__desc">{description}</div> : null}
      {action ? <div style="margin-top:12px">{action}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  actions,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  actions?: ComponentChildren;
}) {
  if (!open) return null;
  return (
    <div
      class="sh-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div class="sh-modal__card">
        <div class="sh-modal__title">{title}</div>
        <div class="sh-modal__body">{children}</div>
        <div class="sh-modal__actions">{actions}</div>
      </div>
    </div>
  );
}

export function Confidence({ value }: { value: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const tone = percent >= 80 ? "#34d399" : percent >= 60 ? "#fbbf24" : "#fb7185";
  return (
    <span class="sh-confidence" title={`置信度 ${percent}%`}>
      <span class="sh-confidence__track">
        <span
          class="sh-confidence__fill"
          style={{ width: `${percent}%`, background: tone }}
        />
      </span>
      {percent}%
    </span>
  );
}

export function formatClock(ts: number): string {
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleDateString();
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" class="sh-spinner" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-width="3" />
      <path d="M21 12a9 9 0 00-9-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}
