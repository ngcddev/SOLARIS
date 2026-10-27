import { NextResponse } from "next/server";
import { getRepository } from "@/lib/repo";
import { resetRuntime } from "@/lib/server/runtime";

export const runtime = "nodejs";

export async function POST() {
  await getRepository().reset();
  resetRuntime();
  return NextResponse.json({ ok: true });
}
