"use client";

import { CircleHelp } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface KeyboardShortcutsOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme?: "dark" | "light";
}

// Only bindings that actually exist. The previous list advertised New/Import,
// Ctrl+D, and number keys that no handler implements — pressing them did
// nothing (or bookmarked the page), which is worse than no help at all.
// Every entry below is wired to the global keydown handler in app/page.tsx
// (review keys mapped in lib/review-navigation.ts); nothing is aspirational.
const SHORTCUT_GROUPS = [
  {
    title: "Document",
    shortcuts: [
      ["Save a checkpoint", "⌘ + S / Ctrl + S"],
      ["Undo (in the draft)", "⌘ + Z / Ctrl + Z"],
      ["Redo (in the draft)", "⌘ + Shift + Z / Ctrl + Y"],
      ["Show this help", "?"],
    ],
  },
  {
    title: "Review",
    shortcuts: [
      ["Next suggestion", "⌘ + ↓ / Ctrl + ↓"],
      ["Previous suggestion", "⌘ + ↑ / Ctrl + ↑"],
      ["Accept suggestion", "⌘ + Enter / Ctrl + Enter"],
      // Remote addition: implemented by the acceptAll branch of the same
      // global handler. It intentionally shares modifier+Enter with the
      // single-suggestion accept above (the handler routes by context).
      ["Accept all visible suggestions", "⌘ + Enter / Ctrl + Enter"],
      ["Dismiss suggestion", "⌘ + Backspace / Ctrl + Backspace"],
      ["Close rewrite preview", "Esc"],
    ],
  },
];

export function KeyboardShortcutsOverlay({ open, onOpenChange, theme }: KeyboardShortcutsOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-theme={theme}>
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
