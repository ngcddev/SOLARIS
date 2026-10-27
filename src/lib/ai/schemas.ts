import { z } from "zod";

const emergency = z.enum(["trapped", "injured", "bleeding", "fire", "other"]);

export const triageOutputSchema = z.object({
  emergencyType: emergency,
  people: z.number().int().min(1).max(1000),
  hasBabies: z.boolean(),
  hasChildren: z.boolean(),
  hasElderly: z.boolean(),
  trapped: z.boolean(),
  priority: z.enum(["P1", "P2", "P3", "P4"]),
  justification: z.string().min(5).max(280),
  coherence: z.number().min(0).max(1),
});

export const analystOutputSchema = z.object({
  assignments: z.array(
    z.object({
      caseId: z.string().min(1),
      teamId: z.string().min(1),
      rationale: z.string().min(3).max(300),
    }),
  ),
  notes: z.string().max(600),
});

export const photoFindingsSchema = z.array(
  z.object({
    phrase: z.string(),
    count: z.number().int().min(0),
    masks: z.array(
      z.object({
        points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(3),
        score: z.number().min(0).max(1),
      }),
    ),
  }),
);

/** JSON schemas sent to the Meta API as structured-output constraints. */
export const triageJsonSchema = z.toJSONSchema(triageOutputSchema);
export const analystJsonSchema = z.toJSONSchema(analystOutputSchema);

export const crossCheckOutputSchema = z.object({
  verdict: z.enum(["consistent", "contradictory", "insufficient"]),
  reasons: z.array(z.string().min(3).max(300)).min(1).max(6),
});

export const handoverOutputSchema = z.object({
  headline: z.string().min(5).max(300),
  summary: z.array(z.string().min(3).max(300)).min(1).max(10),
  risks: z.array(z.string().min(3).max(300)).min(1).max(8),
  nextActions: z.array(z.string().min(3).max(300)).min(1).max(8),
});

export const crossCheckJsonSchema = z.toJSONSchema(crossCheckOutputSchema);
export const handoverJsonSchema = z.toJSONSchema(handoverOutputSchema);
