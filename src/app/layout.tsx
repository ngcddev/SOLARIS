import type { Metadata, Viewport } from "next";
import "../styles/globals.css";
import OfflineBadge from "../components/pwa/OfflineBadge";
import ServiceWorkerRegister from "../components/pwa/ServiceWorkerRegister";

export const metadata: Metadata = {
  applicationName: "Solaris",
  appleWebApp: { capable: true, title: "Solaris", statusBarStyle: "black" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  title: "Solaris — rescue coordination",
  description:
    "Coordination and prioritization of help requests in the first 72 hours after a disaster. A support tool for rescuers, with human validation.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#000000" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <OfflineBadge />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
