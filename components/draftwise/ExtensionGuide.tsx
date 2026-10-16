"use client";

import { useState } from "react";
import { Check, Code2, Copy, Laptop, Puzzle, Settings2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Where the unpacked extension lives, relative to the project root.
 *
 * The button used to copy the bare string "extension/" with no feedback of any
 * kind, so it looked broken — you clicked it and nothing visibly happened. It
 * now copies the path together with the step it belongs to, and says so.
 */
const INSTALL_FOLDER = "extension/";

export function ExtensionGuide({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyFolder = () => {
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    void clipboard.writeText(INSTALL_FOLDER).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    }).catch(() => {
      // Clipboard access can be denied by permissions policy. Silence is
      // correct here — the path is visible in the step below either way.
    });
  };
  return (
    <section className="full-view extension-view">
      <div className="extension-hero">
        <div className="extension-hero-copy">
          <div className="extension-icon"><Puzzle size={24} /></div>
          <p className="eyebrow">Draftwise extension</p>
          <h1>Helpful, wherever you write.</h1>
          <p>Bring the same local rules to textareas, inputs, and contenteditable fields across the web. The service worker keeps optional AI requests away from page-facing code.</p>
          <div className="extension-hero-actions">
            <Button onClick={copyFolder}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Folder path copied" : "Copy install folder"}
            </Button>
            <Button variant="outline" onClick={onOpenSettings}><Settings2 size={15} /> Extension settings</Button>
          </div>
          {/* The confirmation is also announced, since the button label change
              alone is easy to miss with a screen reader reading the page. */}
          <p className="sr-only" role="status" aria-live="polite">{copied ? `Copied ${INSTALL_FOLDER}` : ""}</p>
        </div>
        {/* Decorative: a picture of the panel, not the panel. It is hidden from
            assistive technology because it previously exposed a non-functional
            "Accept" button that a screen reader could focus and activate. */}
        <div className="extension-preview" aria-hidden="true">
          <div className="fake-browser-bar"><span /><span /><span /><strong>docs.example.com</strong></div>
          <div className="fake-page">
            <div className="fake-page-copy"><span className="fake-line wide" /><span className="fake-line" /><span className="fake-line short" /><span className="fake-underline">The draft is ready to review.</span></div>
            <div className="fake-assistant">
              <div className="fake-assistant-header"><span className="mini-mark" /> <strong>draftwise</strong><span className="fake-close">×</span></div>
              <p>One spelling suggestion</p>
              <div className="fake-fix"><span>recieve</span><span aria-hidden="true">→</span><strong>receive</strong></div>
              <span className="fake-accept">Accept</span>
            </div>
          </div>
        </div>
      </div>
      <div className="extension-grid">
        <div className="extension-card">
          <div className="extension-card-icon"><Laptop size={18} /></div>
          <h3>Install with least privilege</h3>
          <p>Open <code>chrome://extensions</code>, turn on Developer mode, choose “Load unpacked”, select the <code>extension</code> folder, and grant access only to sites you choose.</p>
          <span className="extension-card-note"><Check size={13} /> Optional host permissions</span>
        </div>
        <div className="extension-card">
          <div className="extension-card-icon"><ShieldCheck size={18} /></div>
          <h3>Private by design</h3>
          <p>Sensitive fields are skipped. Local analysis runs in the page; optional AI runs in the Manifest V3 service worker. API keys never enter page scripts.</p>
          <span className="extension-card-note"><Check size={13} /> No page analytics</span>
        </div>
        <div className="extension-card">
          <div className="extension-card-icon"><Code2 size={18} /></div>
          <h3>One shared engine</h3>
          <p>The extension bundle is built from the same grammar and provider packages as the web editor, so rule IDs and behavior stay aligned.</p>
          <span className="extension-card-note"><Check size={13} /> Build-time shared packages</span>
        </div>
      </div>
    </section>
  );
}
