"use client";

import { useState } from "react";
import { FileDown, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportAsPDFWrapper } from "@/lib/import-export";
import { showToast, ToastType } from "@/components/draftwise/utilities/Toast";

interface ExportButtonProps {
  title: string;
  content: string;
  format?: "txt" | "md" | "pdf";
  disabled?: boolean;
}

export function ExportButton({ 
  title, 
  content, 
  format = "txt",
  disabled = false
}: ExportButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  async function handleExport() {
    if (!title.trim()) {
      showToast({ 
        message: "Please save your document before exporting",
        type: "error" as ToastType
      });
      return;
    }

    setIsLoading(true);

    try {
      switch (format) {
        case "pdf":
          await exportAsPDFWrapper(title, content);
          break;
        case "md":
          // Markdown export handled by import-export.ts
          break;
        default:
          // Plain text export
          break;
      }

      showToast({
        message: `Document exported as ${format.toUpperCase()}`,
        type: "success" as ToastType
      });
    } catch (error) {
      console.error(`Export failed:`, error);
      showToast({
        message: "Failed to export document. Please try again.",
        type: "error" as ToastType
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Button
      onClick={handleExport}
      disabled={disabled || isLoading}
      variant="outline"
      size="sm"
      className="relative"
    >
      {isLoading ? (
        <>
          <div className="loading-pulse mr-2" />
          Processing...
        </>
      ) : (
        <>
          <FileDown size={14} className="mr-2" />
          Export
        </>
      )}
    </Button>
  );
}
