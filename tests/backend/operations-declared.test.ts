import { describe, expect, it } from "vitest";
import { parseManifest } from "@termix-ssh/plugin-sdk/manifest";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import manifest from "../../manifest.json";
import { registerOperations } from "../../src/backend/operations.js";
import type { Service } from "../../src/backend/service.js";

type Declared = {
  id: string;
  risk: string;
  permission: string;
  dryRun?: string;
};

const actions = (
  manifest.contributes as { operations: { actions: Declared[] } }
).operations.actions;

describe("declared actions", () => {
  it("is a valid manifest", () => {
    expect(parseManifest(manifest).errors ?? []).toEqual([]);
  });

  it("has a handler for every declared action and nothing else", () => {
    const registered: string[] = [];
    const ctx = {
      operations: {
        register: (id: string) => {
          registered.push(id);
        },
      },
    } as unknown as PluginContext;
    registerOperations(ctx, {} as Service);
    expect([...registered].sort()).toEqual(actions.map((a) => a.id).sort());
  });

  it("needs a permission and a dry run for anything that changes a machine", () => {
    for (const action of actions) {
      if (action.risk === "read") continue;
      expect(["power", "manage"]).toContain(action.permission);
      expect(action.dryRun).toBeTruthy();
    }
  });

  it("marks hard power changes and log clearing as destructive", () => {
    const risk = (id: string) => actions.find((a) => a.id === id)?.risk;
    expect(risk("out-of-band.power-off")).toBe("destructive");
    expect(risk("out-of-band.power-cycle")).toBe("destructive");
    expect(risk("out-of-band.reset")).toBe("destructive");
    expect(risk("out-of-band.clear-log")).toBe("destructive");
    expect(risk("out-of-band.power-on")).toBe("change");
  });
});

describe("handlers", () => {
  const device = {
    id: 4,
    hostId: null as number | null,
    name: "rack-1",
    status: "up",
    reading: { power: "on", health: "ok" },
  };
  const calls: string[] = [];
  const service = {
    list: async () => [device],
    get: async () => device,
    poll: async () => device,
    power: async (...args: unknown[]) => {
      calls.push(`power ${args.join(",")}`);
    },
    bootOnce: async (...args: unknown[]) => {
      calls.push(`boot ${args.join(",")}`);
    },
    clearLog: async (...args: unknown[]) => {
      calls.push(`clear ${args.join(",")}`);
    },
  } as unknown as Service;

  const handlers = new Map<
    string,
    {
      run: (input: Record<string, unknown>) => Promise<any>;
      describe?: (input: Record<string, unknown>) => Promise<string>;
    }
  >();
  let access = true;
  const checked: Array<[number, string]> = [];
  registerOperations(
    {
      operations: {
        register: (id: string, handler: never) => handlers.set(id, handler),
      },
      hosts: {
        checkAccess: async (hostId: number, level: string) => {
          checked.push([hostId, level]);
          return { hasAccess: access };
        },
      },
    } as unknown as PluginContext,
    service,
  );

  it("describes a power change without making it", async () => {
    const text = await handlers.get("out-of-band.power-cycle")!.describe!({
      device: "4",
    });
    expect(text).toBe("Would power cycle rack-1");
    expect(calls).toEqual([]);
  });

  it("runs power, boot and log actions", async () => {
    await handlers.get("out-of-band.power-on")!.run({ device: "4" });
    await handlers.get("out-of-band.graceful-shutdown")!.run({ device: "4" });
    await handlers.get("out-of-band.power-off")!.run({ device: "4" });
    await handlers.get("out-of-band.power-cycle")!.run({ device: "4" });
    await handlers.get("out-of-band.reset")!.run({ device: "4" });
    await handlers
      .get("out-of-band.set-boot-once")!
      .run({ device: "4", boot: "pxe", uefi: true });
    await handlers.get("out-of-band.clear-log")!.run({ device: "4" });
    expect(calls).toEqual([
      "power 4,on",
      "power 4,graceful-shutdown",
      "power 4,off",
      "power 4,cycle",
      "power 4,reset",
      "boot 4,pxe,true",
      "clear 4",
    ]);
  });

  it("checks the linked host before changing anything", async () => {
    device.hostId = 12;
    access = false;
    calls.length = 0;
    await expect(
      handlers.get("out-of-band.power-off")!.run({ device: "4" }),
    ).rejects.toThrow(/access/);
    expect(calls).toEqual([]);
    expect(checked.at(-1)).toEqual([12, "edit"]);
    device.hostId = null;
    access = true;
  });

  it("reports unhealthy BMCs as a failing signal", async () => {
    const ok = await handlers.get("out-of-band.list-devices")!.run({});
    expect(ok.data.status).toBe("ok");
    device.reading.health = "critical";
    const bad = await handlers.get("out-of-band.list-devices")!.run({});
    expect(bad.data).toMatchObject({ status: "fail", value: 1 });
    expect(bad.summary).toBe("1 need attention");
    device.reading.health = "ok";
  });

  it("reports the power state as a status", async () => {
    const result = await handlers.get("out-of-band.power-state")!.run({
      device: "4",
    });
    expect(result.data).toMatchObject({ value: "on", status: "ok" });
  });
});
