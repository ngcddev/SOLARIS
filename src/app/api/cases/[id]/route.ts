import { NextResponse } from "next/server";
import { getRepository } from "@/lib/repo/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getRepository().getCase(id);
  if (!c) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
  return NextResponse.json(c);
}
