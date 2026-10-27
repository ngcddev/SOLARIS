import { NextResponse } from "next/server";
import { buildHandover } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** On demand (button): shift-handover situation report. */
export async function POST() {
  return NextResponse.json(await buildHandover());
}
