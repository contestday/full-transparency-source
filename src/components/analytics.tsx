"use client";

import { Analytics } from "@vercel/analytics/next";
import { redactAnalyticsUrl } from "@/lib/analytics-redact";

/** Vercel Web Analytics (no cookies), with private links removed before sending. */
export function SiteAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        const url = redactAnalyticsUrl(event.url);
        return url ? { ...event, url } : null;
      }}
    />
  );
}
