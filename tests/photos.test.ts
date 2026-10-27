import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getRepository } from "../src/lib/repo/memory";
import { resetRuntime } from "../src/lib/server/runtime";
import { getCenterKeys } from "../src/lib/server/center";
import { addFieldPhoto, getState, processPacket, setOffline } from "../src/lib/server/service";
import { buildSosPacket, generateIdentity, initCrypto, toBase64 } from "../src/lib/packet";
import { mockVision } from "../src/lib/ai/mock";

const IMG = "data:image/jpeg;base64," + Buffer.from("fake-image-bytes-for-test").toString("base64");

describe("field photos (SAM 3.1 mock)", () => {
  beforeAll(initCrypto);
  beforeEach(async () => {
    await getRepository().reset();
    resetRuntime();
    setOffline(false);
  });
  async function newCase() {
    const center = await getCenterKeys();
    const pkt = buildSosPacket({ type: "trapped", who: ["adult"], count: 2, lat: 3.45, lon: -76.53 }, { identity: await generateIdentity(), centerPublicKey: center.publicKey });
    const r = await processPacket(toBase64(pkt), ["n1", "gw-1"]);
    return r.id!;
  }

  it("mock segmentation is deterministic and returns normalised polygons", async () => {
    const phrases = ["persona", "estructura colapsada", "vía bloqueada"];
    const a = await mockVision.segment({ imageDataUrl: IMG, phrases });
    const b = await mockVision.segment({ imageDataUrl: IMG, phrases });
    expect(a).toEqual(b);
    expect(a.find((f) => f.phrase === "persona")!.count).toBeGreaterThanOrEqual(1);
    for (const f of a) for (const m of f.masks) for (const [x, y] of m.points) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1); }
  });

  it("a photo with people raises the case confidence and is stored on the case", async () => {
    const id = await newCase();
    const before = (await getState()).cases[0].trust!.score;
    expect((await addFieldPhoto(id, IMG)).ok).toBe(true);
    const after = (await getState()).cases[0];
    expect(after.photos).toHaveLength(1);
    expect(after.photos[0].dataUrl).toBe(""); // list payload stays light
    expect(after.trust!.signals.some((s) => s.id === "field_photo")).toBe(true);
    expect(after.trust!.score).toBeGreaterThanOrEqual(before);
  });

  it("rejects non-image payloads", async () => {
    const id = await newCase();
    expect((await addFieldPhoto(id, "data:text/html;base64,PGgxPg==")).ok).toBe(false);
  });

  it("without internet the photo is kept but nothing is invented", async () => {
    const id = await newCase();
    setOffline(true);
    expect((await addFieldPhoto(id, IMG)).ok).toBe(true);
    const c = (await getState()).cases[0];
    expect(c.photos[0].findings).toEqual([]);
    expect(c.photos[0].source).toBe("rules");
  });
});
