import type { Metadata } from "next";
import Dashboard from "@/components/command-center/Dashboard";

export const metadata: Metadata = { title: "Command center — Solaris" };

export default function Page() {
  return <Dashboard />;
}
