"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/design";
import { Overlay } from "@/components/overlay";

const MESSAGE = "Please share with anyone you feel may wish to see this: family, friends, bands, authorities.";
const SHARE_TEXT = "Full Transparency: where I've been, where I'm going and whether I'm within my usual area, shared openly.";

/**
 * A share button floating at the bottom right of every public page. It always
 * shares the site's front page, never the page's own address (a watch page's
 * address is a private link).
 */
export function ShareButton() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(`${window.location.origin}/`);
    setCanShare(typeof navigator.share === "function");
  }, []);

  const enc = encodeURIComponent;
  const links = [
    { label: "WhatsApp", href: `https://wa.me/?text=${enc(`${SHARE_TEXT} ${url}`)}` },
    { label: "Email", href: `mailto:?subject=${enc("Full Transparency")}&body=${enc(`${SHARE_TEXT}\n\n${url}`)}` },
    { label: "Text message", href: `sms:?&body=${enc(`${SHARE_TEXT} ${url}`)}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
    { label: "X (Twitter)", href: `https://twitter.com/intent/tweet?text=${enc(SHARE_TEXT)}&url=${enc(url)}` },
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` },
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-[45] inline-flex h-14 items-center gap-2 rounded-full bg-accent px-5 font-semibold text-white shadow-lg ring-4 ring-white/70 hover:bg-accent-hover print:hidden"
      >
        <Icon name="share" className="h-6 w-6" />
        Share
      </button>
      {open && (
        <Overlay title="Share Full Transparency" onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <p className="text-[17px] font-semibold">{MESSAGE}</p>
            <p className="text-sm text-muted">
              This shares the site&apos;s front page: <span className="font-mono text-ink">{url}</span>. It never shares a private watch link.
            </p>
            {canShare && (
              <button
                type="button"
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[var(--ft-radius-control)] bg-accent px-5 font-semibold text-white hover:bg-accent-hover"
                onClick={() => navigator.share({ title: "Full Transparency", text: SHARE_TEXT, url }).catch(() => undefined)}
              >
                <Icon name="share" /> Share with an app on this device
              </button>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {links.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center justify-center rounded-[var(--ft-radius-control)] border border-border bg-white px-3 text-sm font-semibold hover:bg-sky"
                >
                  {l.label}
                </a>
              ))}
            </div>
            <button
              type="button"
              onClick={copy}
              className="inline-flex h-11 w-full items-center justify-center rounded-[var(--ft-radius-control)] border border-border bg-white px-3 text-sm font-semibold hover:bg-sky"
            >
              {copied ? "Link copied" : "Copy the link"}
            </button>
          </div>
        </Overlay>
      )}
    </>
  );
}
