import type { Metadata } from "next";
import Dashboard from "@/components/centro/Dashboard";

export const metadata: Metadata = { title: "Centro de mando — Solaris" };

export default function Page() {
  return <Dashboard />;
}
