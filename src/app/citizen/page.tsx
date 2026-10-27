import type { Metadata } from "next";
import CitizenApp from "@/components/citizen/CitizenApp";

export const metadata: Metadata = { title: "Ask for help — Solaris (simulator)" };

export default function Page() {
  return <CitizenApp />;
}
