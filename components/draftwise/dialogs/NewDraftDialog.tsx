"use client";

import { useState } from "react";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface NewDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function NewDraftDialog({ open, onOpenChange, onConfirm }: NewDraftDialogProps) {
  const [title, setTitle] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (title.trim()) {
      onConfirm();
      onOpenChange(false);
      setTitle("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New document</DialogTitle>
          <DialogDescription>
            Create a blank draft to start writing. Your words stay private on this device.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Input
                id="draft-title"
                placeholder="Untitled"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">Create document</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
