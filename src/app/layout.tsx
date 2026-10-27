import type { Metadata, Viewport } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Solaris — coordinación de rescate",
  description:
    "Coordinación y priorización de pedidos de ayuda en las primeras 72 horas tras un desastre. Herramienta de apoyo a rescatistas, con validación humana.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO">
      <body>{children}</body>
    </html>
  );
}
