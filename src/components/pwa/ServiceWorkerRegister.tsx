"use client";

import { useEffect } from "react";

/** Registers the service worker in production (or when NEXT_PUBLIC_PWA_DEV=1). Failures never break the app. */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    const enabled = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_PWA_DEV === "1";
    if (!enabled || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is an enhancement; ignore registration errors */
    });
  }, []);
  return null;
}
