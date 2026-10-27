import { NextResponse } from "next/server";
import { z } from "zod";
import { setOffline } from "@/lib/server/service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const parsed = z.object({ offline: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud no válida" }, { status: 400 });
  setOffline(parsed.data.offline);
  return NextResponse.json({ offline: parsed.data.offline });
}
