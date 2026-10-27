import { NextResponse } from "next/server";
import { toBase64 } from "@/lib/packet";
import { getCenterKeys } from "@/lib/server/center";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public key only. Citizens' phones seal SOS packets towards it. */
export async function GET() {
  return NextResponse.json({ publicKey: toBase64((await getCenterKeys()).publicKey) });
}
