import type { ReactNode } from "react";
import { statusMetaFor, statusValidationTone } from "../lifecycle";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <rect x="3" y="3" width="58" height="58" rx="14" fill="#1d4aff" stroke="#151515" strokeWidth="4" />
        <path d="M20 44V20h10c6 0 10 4 10 9s-4 9-10 9h-4v6z" fill="#fff" />
        <circle cx="44" cy="24" r="5" fill="#f9bd2b" stroke="#151515" strokeWidth="3" />
      </svg>
      <span className="font-extrabold tracking-tight text-[1.05rem] leading-none">
        PoC&nbsp;Pilot
      </span>
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const meta = statusMetaFor(status);
  return (
    <span
      className="chip"
      style={{ background: meta.color, color: meta.fg, borderColor: "var(--color-line)" }}
    >
      {meta.label}
    </span>
  );
}

export function ValidationBadge({ status }: { status?: "pass" | "warn" | "fail" }) {
  if (!status) return null;
  const tone = statusValidationTone(status);
  const label = status === "pass" ? "Validation pass" : status === "warn" ? "Validation warn" : "Validation fail";
  const icon = status === "pass" ? "✓" : status === "warn" ? "!" : "✕";
  return (
    <span className="chip" style={{ background: "#fff", color: tone, borderColor: tone }}>
      <span className="font-black">{icon}</span>
      {label}
    </span>
  );
}

export function Dot({ color = "var(--color-grass)", live = false }: { color?: string; live?: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${live ? "live-dot" : ""}`}
      style={{ background: color, outline: "1.5px solid var(--color-line)" }}
    />
  );
}

export function Section({
  title,
  right,
  children,
  className = "",
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`pop p-5 ${className}`}>
      {(title || right) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h3 className="text-sm font-extrabold uppercase tracking-wider text-[var(--color-muted)]">{title}</h3>}
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function KeyVal({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-muted)]">{k}</dt>
      <dd className="text-sm font-medium text-[var(--color-ink)]">{children}</dd>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-[var(--color-muted)]">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-line)] border-t-transparent" />
      {label && <span className="text-sm font-semibold">{label}</span>}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="pop-flat ticker grid place-items-center px-6 py-12 text-center">
      <p className="text-base font-extrabold">{title}</p>
      {hint && <p className="mt-1 max-w-md text-sm text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "danger" | "success";
  children: ReactNode;
}) {
  const map = {
    info: { bg: "#eaf0ff", bd: "var(--color-brand)", fg: "var(--color-brand-ink)" },
    warn: { bg: "#fff6e0", bd: "var(--color-warn)", fg: "#7a5200" },
    danger: { bg: "#ffece6", bd: "var(--color-fail)", fg: "#8c2a14" },
    success: { bg: "#e6f6ec", bd: "var(--color-grass)", fg: "var(--color-grass-ink)" },
  }[tone];
  return (
    <div
      className="rounded-[10px] border-2 px-4 py-3 text-sm font-semibold"
      style={{ background: map.bg, borderColor: map.bd, color: map.fg }}
    >
      {children}
    </div>
  );
}

export function ResourceIcon({ type }: { type: string }) {
  const map: Record<string, string> = {
    project: "◆",
    dashboard: "▦",
    insight: "▣",
    action: "➤",
    cohort: "❏",
    feature_flag: "⚑",
    survey: "✎",
    alert: "🔔",
    experiment: "⚗",
    subscription: "✉",
  };
  return <span className="mono text-[var(--color-brand)]">{map[type] ?? "•"}</span>;
}
