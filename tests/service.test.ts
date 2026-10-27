import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getRepository } from "../src/lib/repo";
import { resetRuntime } from "../src/lib/server/runtime";
import { getCenterKeys } from "../src/lib/server/center";
import { applyAction, getState, processPacket, recommendAssignments, setOffline } from "../src/lib/server/service";
import { buildSosPacket, generateIdentity, initCrypto, toBase64 } from "../src/lib/packet";

describe("end to end: packet -> ingest -> triage -> trust -> queue -> actions", () => {
  beforeAll(initCrypto);
  beforeEach(async () => {
    await getRepository().reset();
    resetRuntime();
    setOffline(false);
  });

  async function send(over: Partial<Parameters<typeof buildSosPacket>[1]> = {}, sos = { type: "trapped", who: ["baby"], count: 3, lat: 3.45, lon: -76.53 } as const) {
    const center = await getCenterKeys();
    const id = await generateIdentity();
    const pkt = buildSosPacket({ ...sos, who: [...sos.who] }, { identity: id, centerPublicKey: center.publicKey, ...over });
    return processPacket(toBase64(pkt), ["n1", "gw"]);
  }

  it("prioritises an accepted SOS and exposes metrics", async () => {
    const r = await send();
    expect(r.status).toBe("accepted");
    const s = await getState();
    expect(s.cases).toHaveLength(1);
    expect(s.cases[0].triage?.priority).toBe("P1");
    expect(s.cases[0].trust?.signals.length).toBeGreaterThanOrEqual(5);
    expect(s.metrics).toMatchObject({ received: 1, accepted: 1, prioritized: 1 });
    expect(s.modeLabel).toBe("AI: SIMULATED");
  });

  it("switches to rules when internet is simulated down and keeps working", async () => {
    setOffline(true);
    await send();
    const s = await getState();
    expect(s.modeLabel).toBe("OFFLINE: RULES");
    expect(s.cases[0].triage?.source).toBe("rules");
  });

  it("assign -> dispatch -> close frees the team; busy teams cannot be double assigned", async () => {
    await send();
    const s0 = await getState();
    const caseId = s0.cases[0].id;
    expect((await applyAction(caseId, "assign", "eq-1")).ok).toBe(true);
    await send();
    const second = (await getState()).cases.find((c) => c.id !== caseId)!;
    expect((await applyAction(second.id, "assign", "eq-1")).ok).toBe(false);
    expect((await applyAction(caseId, "dispatch")).ok).toBe(true);
    expect((await applyAction(caseId, "close")).ok).toBe(true);
    expect((await getState()).teams.find((t) => t.id === "eq-1")?.status).toBe("available");
  });

  it("recommends assignments without touching state", async () => {
    await send();
    const rec = await recommendAssignments();
    expect(rec.assignments.length).toBe(1);
    expect((await getState()).teams.every((t) => t.status === "available")).toBe(true);
  });

  it("rejects garbage without crashing", async () => {
    expect((await processPacket("not-base64!!")).status).toBe("rejected");
  });
});
