import type { Metadata } from "next";
import MeshSimulator from "@/components/malla/MeshSimulator";

export const metadata: Metadata = { title: "Simulador de malla — Solaris" };

export default function Page() {
  return <MeshSimulator />;
}
