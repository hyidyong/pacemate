"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    async function registerServiceWorker() {
      if (typeof window === "undefined" || typeof navigator === "undefined") {
        return;
      }

      if (!("serviceWorker" in navigator)) {
        return;
      }

      try {
        await navigator.serviceWorker.register("/sw.js");
      } catch {
        // Service worker registration can fail in local/dev browsers. Keep the app usable.
      }
    }

    void registerServiceWorker();
  }, []);

  return null;
}
