"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ClearDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  theme?: "dark" | "light";
}

export function ClearDataDialog({ open, onOpenChange, onConfirm, theme }: ClearDataDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-theme={theme}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Trash2 className="text-destructive" size={20} />
            <DialogTitle>Delete all local data?</DialogTitle>
          </div>
          <DialogDescription>
            This will permanently delete all your drafts and settings stored in this browser.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>Delete everything</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
