"use client";

import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, HTMLAttributes } from "react";

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger";
  loading?: boolean;
}) {
  const map = {
    primary: "btn-primary",
    ghost:   "btn-ghost",
    outline: "btn-outline",
    danger:  "btn-danger",
  };
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={clsx("btn", map[variant], className, "disabled:cursor-not-allowed disabled:opacity-50")}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx("input", props.className)} />;
}

export function Card(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={clsx("card", props.className)} />;
}

export function Badge({
  children,
  tone = "idle",
}: {
  children: React.ReactNode;
  tone?: "warn" | "ok" | "fail" | "idle";
}) {
  const map = { warn: "badge-warn", ok: "badge-ok", fail: "badge-fail", idle: "badge-idle" };
  return <span className={clsx("badge", map[tone])}>{children}</span>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-bg-2 px-8 py-16 text-center">
      <div className="mb-3 h-12 w-12 rounded-full bg-gold/10 ring-1 ring-gold/30" />
      <h3 className="text-lg font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-fg-2">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("animate-spin text-fg-2", className)} size={18} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-md bg-bg-3", className)} />;
}
