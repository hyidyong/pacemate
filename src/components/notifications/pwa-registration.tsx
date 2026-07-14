"use client";

import { useEffect } from "react";

const CACHE_PREFIX = "pacemate-static-";
const DEV_RESET_KEY = "pacemate-dev-sw-reset";

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export default function PwaRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    async function syncServiceWorker() {
      if (isLocalhost(window.location.hostname)) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));

        const cacheKeys = typeof caches === "undefined" ? [] : await caches.keys();
        const staleCacheKeys = cacheKeys.filter((key) => key.startsWith(CACHE_PREFIX));
        await Promise.all(staleCacheKeys.map((key) => caches.delete(key)));

        if ((registrations.length || staleCacheKeys.length) && !window.sessionStorage.getItem(DEV_RESET_KEY)) {
          window.sessionStorage.setItem(DEV_RESET_KEY, "1");
          window.location.reload();
        }

        return;
      }

      window.sessionStorage.removeItem(DEV_RESET_KEY);

      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.warn("Service worker registration failed:", error);
      });
    }

    void syncServiceWorker();
  }, []);

  return null;
}
