import { NextResponse } from "next/server";
import { recommendAssignments } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** On demand only (button): the analyst model is the expensive one. */
export async function POST() {
  return NextResponse.json(await recommendAssignments());
}
