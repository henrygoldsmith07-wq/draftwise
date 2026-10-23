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

export function showToast({ message, type = "info", duration = 4000 }: ToastProps) {
  const id = Date.now().toString();
  
  // Dispatch custom event for global toast management
  window.dispatchEvent(new CustomEvent("draftwise-toast", {
    detail: { id, message, type, duration }
  }));
  
  return id;
}

// Global toast provider component
export function ToastProvider() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const handleToast = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setToasts((prev) => [...prev, detail]);
      
      // Auto-remove after duration
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== detail.id));
      }, detail.duration || 4000);
    };

    window.addEventListener("draftwise-toast" as any, handleToast);
    return () => window.removeEventListener("draftwise-toast" as any, handleToast);
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
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
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
