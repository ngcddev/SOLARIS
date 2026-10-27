import { NextResponse } from "next/server";
import { getState } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getState());
}
