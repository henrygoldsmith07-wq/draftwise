"use client";

import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface KeyboardShortcutsOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUT_GROUPS = [
  {
    title: "Document",
    shortcuts: [
      ["Save locally", "⌘ + S / Ctrl + S"],
      ["New document", "⌘ + N / Ctrl + N"],
      ["Import file", "⌘ + O / Ctrl + O"],
    ],
  },
  {
    title: "Review",
    shortcuts: [
      ["Next suggestion", "⌘ + ↓ / Ctrl + ↓"],
      ["Previous suggestion", "⌘ + ↑ / Ctrl + ↑"],
      ["Accept suggestion", "⌘ + Enter / Ctrl + Enter"],
      ["Dismiss suggestion", "⌘ + D / Ctrl + D"],
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      ["Documents view", "1"],
      ["Write view", "2"],
      ["Insights view", "3"],
      ["Toggle suggestions", "5"],
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
              <h4 className="font-semibold mb-2">{group.title}</h4>
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
