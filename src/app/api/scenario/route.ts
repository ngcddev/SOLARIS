import { NextResponse } from "next/server";
import { z } from "zod";
import { loadCaliScenario, runBenchmark } from "@/lib/server/scenarioRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ action: z.enum(["load", "benchmark"]) });

/** "load" resets the live state and replays the fictional Cali 2026 scenario; "benchmark" runs in an isolated state. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud no válida" }, { status: 400 });
  if (parsed.data.action === "load") return NextResponse.json(await loadCaliScenario());
  return NextResponse.json(await runBenchmark(100));
}
