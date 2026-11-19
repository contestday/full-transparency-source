"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui";

/**
 * Two-step confirmation shown on the page. Replaces window.confirm(), which
 * some embedded browsers silently suppress (the action then never runs).
 */
export function ConfirmButton({
  children,
  prompt = "Are you sure?",
  confirmLabel = "Yes",
  onConfirm,
  variant = "ghost",
  size = "sm",
  disabled,
}: {
  children: ReactNode;
  prompt?: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button type="button" variant={variant} size={size} disabled={disabled} onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-xs text-red-900" role="alert">
      {prompt}
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={async () => {
          setAsking(false);
          await onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}
