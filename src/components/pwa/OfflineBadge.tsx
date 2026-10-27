"use client";

import { useEffect, useState } from "react";

/** Visible notice while the browser reports no connection. */
export default function OfflineBadge() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "var(--space-3)",
        right: "var(--space-3)",
        bottom: "var(--space-3)",
        zIndex: 1000,
        padding: "var(--space-2) var(--space-4)",
        background: "var(--color-inverse-bg)",
        color: "var(--color-inverse-text)",
        border: "var(--border-width) solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        fontWeight: "var(--font-weight-bold)",
        textAlign: "center",
      }}
    >
      Offline — SOS will be sent when the connection returns
    </div>
  );
}
