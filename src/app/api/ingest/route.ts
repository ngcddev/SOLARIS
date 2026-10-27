import { NextResponse } from "next/server";
import { z } from "zod";
import { processPacket } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  packets: z
    .array(z.object({ packet: z.string().max(120_000), path: z.array(z.string().max(40)).max(16).optional() }))
    .min(1)
    .max(300),
});

/** Gateway endpoint: receives opaque (sealed) packets, never plaintext. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud no válida" }, { status: 400 });
  const results = [];
  for (const p of parsed.data.packets) results.push(await processPacket(p.packet, p.path ?? []));
  return NextResponse.json({ results });
}
