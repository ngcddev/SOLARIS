import { NextResponse } from "next/server";
import { crossCheckCase } from "@/lib/server/service";

export const runtime = "nodejs";

/** On demand (button): the multimodal analyst is the expensive model. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await crossCheckCase(id);
  return NextResponse.json(res, { status: res.ok ? 200 : 404 });
}
