import { NextResponse } from "next/server";
import { z } from "zod";
import { applyAction } from "@/lib/server/service";

export const runtime = "nodejs";

const body = z.object({
  action: z.enum(["validate", "false", "assign", "dispatch", "close"]),
  teamId: z.string().max(40).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const res = await applyAction(id, parsed.data.action, parsed.data.teamId);
  return NextResponse.json(res, { status: res.ok ? 200 : 409 });
}
