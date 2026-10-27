import { NextResponse } from "next/server";
import { z } from "zod";
import { addFieldPhoto } from "@/lib/server/service";

export const runtime = "nodejs";

/** Field photos come from rescuers or drones with connectivity, never from the citizen SOS. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = z.object({ dataUrl: z.string() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud no válida" }, { status: 400 });
  const res = await addFieldPhoto(id, parsed.data.dataUrl);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
