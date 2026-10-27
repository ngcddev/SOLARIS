import { describe, expect, it } from "vitest";
import { buildMesh, flood, areLinked, offsetM, type MeshNode } from "../src/lib/mesh/graph";
import { haversineM } from "../src/lib/geo/geo";

const line = (n: number, step = 40): MeshNode[] =>
  Array.from({ length: n }, (_, i) => {
    const [lat, lon] = offsetM(3.45, -76.53, i * step, 0);
    return { id: `p${i}`, kind: "phone" as const, lat, lon };
  });

describe("mesh flooding", () => {
  it("offsetM moves roughly the requested distance", () => {
    const [lat, lon] = offsetM(3.45, -76.53, 100, 0);
    expect(haversineM(3.45, -76.53, lat, lon)).toBeGreaterThan(98);
    expect(haversineM(3.45, -76.53, lat, lon)).toBeLessThan(102);
  });

  it("delivers hop by hop to a gateway within Bluetooth range chain", () => {
    const phones = line(4);
    const [glat, glon] = offsetM(3.45, -76.53, 4 * 40, 0);
    const nodes = [...phones, { id: "gw", kind: "gateway" as const, lat: glat, lon: glon }];
    const r = flood(nodes, "p0");
    expect(r.deliveries).toEqual([{ gateway: "gw", path: ["p1", "p2", "p3", "gw"] }]);
  });

  it("stops when TTL runs out", () => {
    const phones = line(6);
    const [glat, glon] = offsetM(3.45, -76.53, 6 * 40, 0);
    const nodes = [...phones, { id: "gw", kind: "gateway" as const, lat: glat, lon: glon }];
    expect(flood(nodes, "p0", 3).deliveries).toHaveLength(0);
  });

  it("dedups per node and reaches several gateways by different paths", () => {
    const [a1, a2] = offsetM(3.45, -76.53, 0, 30);
    const nodes: MeshNode[] = [
      { id: "o", kind: "phone", lat: 3.45, lon: -76.53 },
      { id: "r1", kind: "phone", lat: a1, lon: a2 },
      { id: "gw1", kind: "gateway", lat: offsetM(3.45, -76.53, 30, 0)[0], lon: offsetM(3.45, -76.53, 30, 0)[1] },
      { id: "gw2", kind: "gateway", lat: offsetM(a1, a2, 0, 30)[0], lon: offsetM(a1, a2, 0, 30)[1] },
    ];
    const r = flood(nodes, "o");
    expect(r.deliveries.map((d) => d.gateway).sort()).toEqual(["gw1", "gw2"]);
    expect(r.suppressed.length).toBeGreaterThan(0);
    expect(new Set(r.hops.map((h) => h.to)).size).toBe(r.hops.length); // every node receives its first copy once
  });

  it("phones link only within BLE range, LoRa trunk reaches kilometres", () => {
    const a: MeshNode = { id: "a", kind: "phone", lat: 3.45, lon: -76.53 };
    const far: MeshNode = { id: "b", kind: "phone", lat: offsetM(3.45, -76.53, 200, 0)[0], lon: offsetM(3.45, -76.53, 200, 0)[1] };
    expect(areLinked(a, far)).toBe(false);
    expect(areLinked({ ...a, kind: "lora" }, { ...far, kind: "gateway", lat: offsetM(3.45, -76.53, 2000, 0)[0], lon: offsetM(3.45, -76.53, 2000, 0)[1] })).toBe(true);
  });

  it("buildMesh creates connected clusters that reach a gateway through the LoRa trunk", () => {
    const clusters = [{ name: "A", lat: 3.45, lon: -76.53 }, { name: "B", lat: 3.46, lon: -76.52 }];
    const { nodes, phonesByCluster } = buildMesh(clusters, [{ id: "gw-1", lat: 3.455, lon: -76.525 }], { seed: 7, phonesPerCluster: 10 });
    for (const phones of phonesByCluster.values()) {
      for (const p of phones) expect(flood(nodes, p.id, 12).deliveries.length).toBeGreaterThan(0);
    }
  });
});
