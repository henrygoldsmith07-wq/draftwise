"use client";

import { CircleHelp } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface KeyboardShortcutsOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Every binding here is implemented by the single global keydown handler in
// app/page.tsx (review keys mapped in lib/review-navigation.ts). Nothing in this
// list is aspirational — a shortcut that does not exist is worse than none.
const SHORTCUT_GROUPS = [
  {
    title: "Document",
    shortcuts: [
      ["Save locally", "⌘ + S / Ctrl + S"],
      ["Undo", "⌘ + Z / Ctrl + Z"],
      ["Redo", "⌘ + Shift + Z / Ctrl + Y"],
    ],
  },
  {
    title: "Review",
    shortcuts: [
      ["Next suggestion", "⌘ + ↓ / Ctrl + ↓"],
      ["Previous suggestion", "⌘ + ↑ / Ctrl + ↑"],
      ["Accept suggestion", "⌘ + Enter / Ctrl + Enter"],
      ["Accept all visible suggestions", "⌘ + Enter / Ctrl + Enter"],
      ["Dismiss suggestion", "⌘ + Backspace / Ctrl + Backspace"],
    ],
  },
  {
    title: "General",
    shortcuts: [
      ["Close rewrite preview", "Esc"],
      ["Open shortcuts", "?"],
    ],
  },
];

export function KeyboardShortcutsOverlay({ open, onOpenChange }: KeyboardShortcutsOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <CircleHelp size={24} />
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </div>
          <DialogDescription>
            Keep your hands on the keyboard while reviewing and writing.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="font-semibold mb-2">{group.title}</h3>
              <div className="grid gap-2">
                {group.shortcuts.map(([action, shortcut]) => (
                  <div key={action} className="flex justify-between items-center">
                    <span>{action}</span>
                    <kbd className="keyboard-key">{shortcut}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="text-sm text-muted-foreground mt-4">
          Press{" "}
          <kbd className="keyboard-key">?</kbd>{" "}
          anywhere to open this dialog again.
        </div>
      </DialogContent>
    </Dialog>
  );
}
