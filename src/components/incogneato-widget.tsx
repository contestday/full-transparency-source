"use client";

import { useEffect } from "react";

/**
 * Incogneato's floating "Anonymous Feedback" button. Their embed expects two
 * globals (mybox, buttontext) to exist before widget.js runs, so they are set
 * here first and the script is then added once. Loaded only on the Contact page.
 */
export function IncogneatoWidget({ box, buttonText = "Anonymous Feedback" }: { box: string; buttonText?: string }) {
  useEffect(() => {
    const w = window as unknown as { mybox?: string; buttontext?: string };
    w.mybox = box;
    w.buttontext = buttonText;
    // Their script adds its own viewport tag (initial-scale=.77), which shrinks
    // the whole page on phones. Keep only ours.
    const ours = document.querySelector('meta[name="viewport"]');
    const content = ours?.getAttribute("content") ?? "width=device-width, initial-scale=1";
    const strip = () => {
      let removed = false;
      document.querySelectorAll('meta[name="viewport"]').forEach((m) => {
        if (m !== ours) {
          m.remove();
          removed = true;
        }
      });
      if (removed && ours) {
        // Make the browser apply ours again (it keeps the last zoom otherwise).
        ours.setAttribute("content", `${content}, minimum-scale=1`);
        requestAnimationFrame(() => ours.setAttribute("content", content));
      }
    };
    const observer = new MutationObserver(strip);
    observer.observe(document.head, { childList: true, subtree: true });
    strip();
    if (document.getElementById("incogneato-widget")) return () => observer.disconnect();
    const s = document.createElement("script");
    s.id = "incogneato-widget";
    s.src = "https://whoanswered.me/embed/widget.js";
    s.async = true;
    document.body.appendChild(s);
  }, [box, buttonText]);
  return null;
}
