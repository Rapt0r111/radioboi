// apps/web/src/components/TopStatusBar.tsx
// Shared chrome for status banners (connection / presence).

import type { ReactNode } from "react";

type Variant = "danger" | "warn";

/** `fixed` — alone at viewport top. `stack` — in-flow inside SessionChrome column. */
export type StatusBarLayout = "fixed" | "stack";

type Props = {
  variant: Variant;
  layout?: StatusBarLayout;
  role?: "status" | "alert";
  live?: "assertive" | "polite" | "off";
  label: string;
  children?: ReactNode;
  action?: ReactNode;
};

const VARIANT_STYLES: Record<
  Variant,
  { border: string; glow: string; text: string; dot: string }
> = {
  danger: {
    border: "border-hit-red/60",
    glow: "0 0 16px rgba(255, 59, 59, 0.35), 0 1px 0 rgba(255,59,59,0.3)",
    text: "text-hit-red",
    dot: "bg-hit-red",
  },
  warn: {
    border: "border-morse-amber/50",
    glow: "0 0 16px rgba(255, 176, 0, 0.25)",
    text: "text-morse-amber",
    dot: "bg-morse-amber",
  },
};

export function TopStatusBar({
  variant,
  layout = "fixed",
  role = "status",
  live = "polite",
  label,
  children,
  action,
}: Props) {
  const styles = VARIANT_STYLES[variant];
  const positionClass =
    layout === "stack"
      ? "relative w-full"
      : "fixed inset-x-0 top-0 z-100";

  return (
    <div
      role={role}
      aria-live={live === "off" ? undefined : live}
      aria-label={label}
      className={`
        ${positionClass}
        flex items-center justify-between gap-4
        border-b ${styles.border}
        bg-ocean-950/95 px-4 py-2.5
        backdrop-blur-sm font-mono
      `}
      style={{ boxShadow: styles.glow }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${styles.dot}`}
          aria-hidden="true"
          style={{ animation: "morse-blink 0.8s step-end infinite" }}
        />
        <span className={`truncate text-[10px] uppercase tracking-[0.18em] ${styles.text}`}>
          {children}
        </span>
      </div>
      {action}
    </div>
  );
}
