import type { Metadata } from "next";
import CitizenApp from "@/components/ciudadano/CitizenApp";

export const metadata: Metadata = { title: "Pedir ayuda — Solaris (simulador)" };

export default function Page() {
  return <CitizenApp />;
}
