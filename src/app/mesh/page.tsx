import type { Metadata } from "next";
import MeshSimulator from "@/components/mesh/MeshSimulator";

export const metadata: Metadata = { title: "Mesh simulator — Solaris" };

export default function Page() {
  return <MeshSimulator />;
}
