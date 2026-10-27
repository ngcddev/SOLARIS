import { z } from "zod";
import { EMERGENCY } from "./types";

export const sosPayloadSchema = z.object({
  type: z.enum(Object.keys(EMERGENCY) as [keyof typeof EMERGENCY, ...(keyof typeof EMERGENCY)[]]),
  who: z.array(z.enum(["baby", "child", "adult", "elder"])),
  count: z.number().int().min(1).max(255),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
