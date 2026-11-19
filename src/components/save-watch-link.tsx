"use client";

/**
 * Keep your watch link: email it to yourself, share/save it, or show a QR code.
 *
 * PRIVACY: everything here happens on the visitor's own device. This file
 * makes NO network requests to our server (a unit test checks this): the email
 * button opens the visitor's own email app (mailto:), sharing uses the device's
 * share sheet, and the QR code is drawn in the browser. We never see an email
 * address.
 */
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui";
import { Icon } from "@/components/design";

/** `href` may be a path ("/watch/…"); the full address is worked out in the browser. */
export function SaveWatchLink({ href, compact = false }: { href: string; compact?: boolean }) {
  const [url, setUrl] = useState(href);
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
    setUrl(new URL(href, window.location.origin).href);
  }, [href]);

  useEffect(() => {
    if (!showQr || qr) return;
    QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: "#142B49", light: "#FFFFFF" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [showQr, qr, url]);

  const subject = "My Full Transparency watch link";
  const body = `My private watch link (keep this to myself):\n\n${url}\n\nOpening it shows the live marker coloured against my own areas.`;
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <a
          href={mailto}
          className="inline-flex h-11 items-center gap-2 rounded-[var(--ft-radius-control)] bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          <Icon name="chat" className="h-4 w-4" /> Email it to myself
        </a>
        {canShare ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigator.share({ title: subject, text: "My private watch link", url }).catch(() => {})}
          >
            Save or share…
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard?.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={() => setShowQr((s) => !s)} aria-expanded={showQr}>
          {showQr ? "Hide QR code" : "QR code"}
        </Button>
      </div>
      {showQr && qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR code for your private watch link" width={240} height={240} className="rounded-xl border border-border bg-white p-2" />
      )}
      {!compact && (
        <p className="text-xs text-muted">
          <strong className="text-ink">We never see your email address.</strong> &ldquo;Email it to myself&rdquo; opens your
          own email app with the link filled in; the message goes from you, to you. Sharing and the QR code also happen
          only on your device.
        </p>
      )}
    </div>
  );
}
