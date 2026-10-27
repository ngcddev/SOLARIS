import type { Metadata, Viewport } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Solaris — rescue coordination",
  description:
    "Coordination and prioritization of help requests in the first 72 hours after a disaster. A support tool for rescuers, with human validation.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
