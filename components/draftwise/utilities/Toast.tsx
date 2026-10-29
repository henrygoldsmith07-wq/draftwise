"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
}

export type DraftwiseToastDetail = {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
};

export type DraftwiseToastEvent = CustomEvent<DraftwiseToastDetail>;

/** The single custom event name the imperative `showToast` and the React provider share. */
export const TOAST_EVENT_NAME = "draftwise-toast";

export function showToast({ message, type = "info", duration = 4000 }: ToastProps) {
  const id = Date.now().toString();

  // Dispatch custom event for global toast management
  window.dispatchEvent(
    new CustomEvent<DraftwiseToastDetail>(TOAST_EVENT_NAME, {
      detail: { id, message, type, duration },
    }),
  );

  return id;
}

// Global toast provider component
export function ToastProvider() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const handleToast = (event: DraftwiseToastEvent) => {
      const detail = event.detail;
      setToasts((prev) => [...prev, detail]);

      // Auto-remove after duration
      const timeout = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== detail.id));
      }, detail.duration || 4000);

      // A toast removed manually must not fire its auto-remove timer afterwards:
      // the timer would re-run the filter harmlessly, but if the same numeric id
      // were ever reused (Date.now() within the same millisecond) a stale timer
      // could drop a newer toast. Tracking per-toast timers makes removal exact.
      removalTimeouts.set(detail.id, timeout);
    };

    window.addEventListener(TOAST_EVENT_NAME, handleToast as EventListener);
    return () => window.removeEventListener(TOAST_EVENT_NAME, handleToast as EventListener);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type} animate-slide-up`}
          role="alert"
        >
          <div className="flex items-start gap-3">
            {toast.type === "success" && <CheckCircle2 className="text-success" size={18} />}
            {toast.type === "error" && <XCircle className="text-destructive" size={18} />}
            {toast.type === "info" && <Info className="text-primary" size={18} />}

            <span className="flex-1">{toast.message}</span>

            <button
              onClick={() => {
                const timeout = removalTimeouts.get(toast.id);
                if (timeout) {
                  clearTimeout(timeout);
                  removalTimeouts.delete(toast.id);
                }
                setToasts((prev) => prev.filter((t) => t.id !== toast.id));
              }}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Auto-remove timers keyed by toast id, so manual dismissal cancels the pending auto-removal. */
const removalTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
