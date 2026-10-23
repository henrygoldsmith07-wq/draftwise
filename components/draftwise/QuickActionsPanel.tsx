"use client";

import { useState } from "react";
import { Copy, Download, Share2, Trash2, RotateCcw, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/draftwise/utilities/Toast";

interface QuickActionsPanelProps {
  title: string;
  content: string;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onClear?: () => void;
}

export function QuickActionsPanel({ 
  title, 
  content, 
  onDuplicate,
  onDelete,
  onClear 
}: QuickActionsPanelProps) {
  const [isLoading, setIsLoading] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      showToast({ message: "Copied to clipboard!", type: "success" });
    } catch (error) {
      showToast({ message: "Failed to copy", type: "error" });
    }
  }

  async function handleDownload(format: "txt" | "md") {
    setIsLoading(true);
    try {
      const extension = format === "md" ? "markdown" : "txt";
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || "document"}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast({ message: `Downloaded as ${format.toUpperCase()}`, type: "success" });
    } catch (error) {
      showToast({ message: "Failed to download", type: "error" });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="bg-card border rounded-lg p-4">
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <RotateCcw size={16} />
        Quick Actions
      </h3>
      
      <div className="grid grid-cols-2 gap-2">
        {/* Primary Actions */}
        <Button 
          onClick={handleCopy}
          variant="outline" 
          size="sm"
          disabled={isLoading}
        >
          <Copy size={14} className="mr-2" />
          Copy
        </Button>
        
        <Button 
          onClick={() => handleDownload("md")}
          variant="outline" 
          size="sm"
          disabled={isLoading}
        >
          <Download size={14} className="mr-2" />
          MD
        </Button>
        
        <Button 
          onClick={() => handleDownload("txt")}
          variant="outline" 
          size="sm"
          disabled={isLoading}
        >
          <Download size={14} className="mr-2" />
          TXT
        </Button>
        
        {onDuplicate && (
          <Button 
            onClick={onDuplicate}
            variant="outline" 
            size="sm"
            disabled={isLoading}
          >
            <PlusCircle size={14} className="mr-2" />
            Duplicate
          </Button>
        )}
        
        {onClear && (
          <Button 
            onClick={onClear}
            variant="destructive" 
            size="sm"
            disabled={isLoading}
          >
            <Trash2 size={14} className="mr-2" />
            Clear
          </Button>
        )}
        
        <Button variant="ghost" size="sm" disabled className="opacity-50 cursor-not-allowed">
          <Share2 size={14} className="mr-2" />
          Share
        </Button>
      </div>
      
      <p className="text-xs text-muted-foreground mt-3">
        Your documents stay private. Local storage only.
      </p>
    </div>
  );
}
