import type { ButtonHTMLAttributes, ReactNode } from "react";
import s from "./ui.module.css";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "critical";
  size?: "md" | "sm" | "xl";
  selected?: boolean;
};

export function Button({ variant = "default", size = "md", selected, className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(s.button, variant === "primary" && s.primary, variant === "critical" && s.critical, size === "sm" && s.small, size === "xl" && s.xl, selected && s.selected, className)}
      {...rest}
    />
  );
}

export function Badge({ tone = "default", children, title }: { tone?: "default" | "inverse" | "critical" | "muted"; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx(s.badge, tone === "inverse" && s.badgeInverse, tone === "critical" && s.badgeCritical, tone === "muted" && s.badgeMuted)}>
      {children}
    </span>
  );
}

/** Loading / empty / error / success messages, one component so every view handles all four states. */
export function StateNotice({ kind, children }: { kind: "loading" | "empty" | "error" | "success"; children: ReactNode }) {
  return (
    <div
      className={cx(s.notice, kind === "error" && s.noticeError, kind === "success" && s.noticeSuccess, kind === "empty" && s.noticeCenter)}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      {kind === "loading" && <span className={s.spinner} aria-hidden="true" />}
      <div>{children}</div>
    </div>
  );
}
