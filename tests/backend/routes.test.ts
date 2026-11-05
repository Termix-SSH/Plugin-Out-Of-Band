import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express, { type Router } from "express";
import {
  createMockCtx,
  createTestDb,
  type MockPluginContext,
  type TestDb,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { activate } from "../../src/backend/index.js";
import { fakeFetch, json, status } from "./fake-fetch.js";

const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
const manifest = manifestJson as unknown as PluginManifest;

let refuse = false;
let powerState = "On";
const posts: Array<{ path: string; method: string; body: any }> = [];
const link = (path: string) => ({ "@odata.id": path });

const router = fakeFetch((url, init) => {
  if (url.hostname !== "10.0.0.9") return undefined;
  if (refuse) return status(401);
  const path = url.pathname;
  if (init.method === "POST" || init.method === "PATCH") {
    posts.push({
      path,
      method: init.method,
      body: init.body ? JSON.parse(init.body) : null,
    });
    return json({});
  }
  switch (path) {
    case "/redfish/v1/Systems":
      return json({ Members: [link("/redfish/v1/Systems/1")] });
    case "/redfish/v1/Systems/1":
      return json({
        PowerState: powerState,
        Status: { Health: "OK" },
        Model: "R740",
        Actions: {
          "#ComputerSystem.Reset": {
            target: "/redfish/v1/Systems/1/Actions/ComputerSystem.Reset",
          },
        },
        LogServices: link("/redfish/v1/Systems/1/LogServices"),
      });
    case "/redfish/v1/Chassis":
      return json({ Members: [link("/redfish/v1/Chassis/1")] });
    case "/redfish/v1/Chassis/1":
      return json({ Thermal: link("/redfish/v1/Chassis/1/Thermal") });
    case "/redfish/v1/Chassis/1/Thermal":
      return json({
        Temperatures: [
          { Name: "CPU", ReadingCelsius: 40, Status: { Health: "OK" } },
        ],
        Fans: [],
      });
    case "/redfish/v1/Managers":
      return json({ Members: [link("/redfish/v1/Managers/1")] });
    case "/redfish/v1/Managers/1":
      return json({
        FirmwareVersion: "1.0",
        VirtualMedia: link("/redfish/v1/Managers/1/VirtualMedia"),
      });
    case "/redfish/v1/Managers/1/VirtualMedia":
      return json({
        Members: [link("/redfish/v1/Managers/1/VirtualMedia/CD")],
      });
    case "/redfish/v1/Managers/1/VirtualMedia/CD":
      return json({
        Id: "CD",
        Name: "CD",
        MediaTypes: ["CD"],
        Inserted: false,
      });
    case "/redfish/v1/Systems/1/LogServices":
      return json({ Members: [link("/redfish/v1/Systems/1/LogServices/SEL")] });
    case "/redfish/v1/Systems/1/LogServices/SEL":
      return json({
        Entries: link("/redfish/v1/Systems/1/LogServices/SEL/Entries"),
        Actions: {
          "#LogService.ClearLog": {
            target:
              "/redfish/v1/Systems/1/LogServices/SEL/Actions/LogService.ClearLog",
          },
        },
      });
    case "/redfish/v1/Systems/1/LogServices/SEL/Entries":
      return json({
        Members: [
          {
            Id: "1",
            Created: "2026-11-01T00:00:00Z",
            Severity: "OK",
            Message: "Boot",
          },
        ],
      });
    default:
      return status(404);
  }
});

let db: TestDb;
let mock: MockPluginContext;
let server: http.Server;
let port: number;

async function setup(permissions: string[]) {
  db = await createTestDb(pluginDir);
  for (const user of ["user-1", "user-2"]) {
    db.sqlite
      .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
      .run(user, user);
  }
  let routes: Router | null = null;
  mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    router: () => (routes = express.Router()),
    permissions,
    fetch: router as never,
  });
  await activate(mock.ctx);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    mock.setActor(req.header("x-test-user") ?? "user-1");
    next();
  });
  app.use((req, res, next) => routes!(req, res, next));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
}

async function request(method: string, path: string, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

const ALL = [
  "out-of-band.view",
  "out-of-band.power",
  "out-of-band.media",
  "out-of-band.manage",
];

const input = {
  name: "rack-1",
  driver: "redfish",
  address: "10.0.0.9",
  options: { scheme: "https" },
  credentials: { username: "root", password: "SECRET-PASSWORD" },
};

async function addDevice(extra: Record<string, unknown> = {}) {
  const created = await request("POST", "/devices", { ...input, ...extra });
  expect(created.status).toBe(201);
  return created.body.device.id as number;
}

beforeEach(async () => {
  refuse = false;
  powerState = "On";
  posts.length = 0;
  router.mockClear();
  router.calls.length = 0;
  await setup(ALL);
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

describe("devices", () => {
  it("lists the BMC types", async () => {
    const result = await request("GET", "/drivers");
    expect(result.body.drivers.map((d: { id: string }) => d.id).sort()).toEqual(
      ["amt", "ipmi", "redfish"],
    );
  });

  it("adds a BMC and never shows or stores the login in plain text", async () => {
    await addDevice();
    const list = await request("GET", "/devices");
    expect(list.body.devices).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain("SECRET-PASSWORD");
    const stored = db.sqlite
      .prepare("SELECT credentials FROM p_out_of_band_devices")
      .get() as { credentials: string };
    expect(stored.credentials).not.toContain("SECRET-PASSWORD");
  });

  it("reads power, health and sensors", async () => {
    const id = await addDevice();
    const polled = await request("POST", `/devices/${id}/poll`);
    expect(polled.body.device.status).toBe("up");
    expect(polled.body.device.reading).toMatchObject({
      power: "on",
      health: "ok",
    });
    expect(polled.body.device.reading.sensors[0].name).toBe("CPU");
  });

  it("marks a BMC down after two failed readings and says why", async () => {
    const id = await addDevice();
    await request("POST", `/devices/${id}/poll`);
    refuse = true;
    const first = await request("POST", `/devices/${id}/poll`);
    expect(first.body.device.status).toBe("up");
    const second = await request("POST", `/devices/${id}/poll`);
    expect(second.body.device.status).toBe("down");
    expect(second.body.device.lastError).toMatch(/refused the login/);
  });

  it("alerts when the machine changes power on its own, but not after our change", async () => {
    const id = await addDevice();
    await request("POST", `/devices/${id}/poll`);
    powerState = "Off";
    await request("POST", `/devices/${id}/poll`);
    const sent = mock.notifications;
    expect(JSON.stringify(sent)).toContain("out-of-band.power");

    const before = JSON.stringify(mock.notifications).length;
    await request("POST", `/devices/${id}/power`, { action: "on" });
    powerState = "On";
    await request("POST", `/devices/${id}/poll`);
    expect(JSON.stringify(mock.notifications).length).toBe(before);
  });

  it("rejects bad input", async () => {
    expect(
      (await request("POST", "/devices", { ...input, name: " " })).status,
    ).toBe(400);
    expect(
      (await request("POST", "/devices", { ...input, address: "a b" })).status,
    ).toBe(400);
    expect(
      (await request("POST", "/devices", { ...input, driver: "nope" })).status,
    ).toBe(400);
    expect(
      (await request("POST", "/devices", { ...input, credentials: {} })).status,
    ).toBe(400);
    expect(
      (await request("POST", "/devices", { ...input, ca: "not a cert" }))
        .status,
    ).toBe(400);
    expect(
      (
        await request("POST", "/devices", {
          ...input,
          pollSeconds: 1,
          port: 99999,
        })
      ).status,
    ).toBe(400);
  });

  it("keeps the poll interval above the floor", async () => {
    const id = await addDevice({ pollSeconds: 1 });
    const list = await request("GET", "/devices");
    expect(
      list.body.devices.find((d: { id: number }) => d.id === id).pollSeconds,
    ).toBe(30);
  });

  it("refuses a second BMC with the same name", async () => {
    await addDevice();
    expect((await request("POST", "/devices", input)).status).toBe(409);
  });

  it("keeps the saved login when an edit sends none", async () => {
    const id = await addDevice();
    const before = db.sqlite
      .prepare("SELECT credentials FROM p_out_of_band_devices")
      .get() as { credentials: string };
    const changed = await request("PUT", `/devices/${id}`, {
      name: "rack-1b",
      address: "10.0.0.9",
    });
    expect(changed.status).toBe(200);
    const after = db.sqlite
      .prepare("SELECT credentials FROM p_out_of_band_devices")
      .get() as { credentials: string };
    expect(after.credentials).toBe(before.credentials);
  });

  it("removes a BMC", async () => {
    const id = await addDevice();
    expect((await request("DELETE", `/devices/${id}`)).status).toBe(200);
    expect((await request("GET", "/devices")).body.devices).toHaveLength(0);
    expect((await request("DELETE", `/devices/${id}`)).status).toBe(404);
  });

  it("tests unsaved settings", async () => {
    const result = await request("POST", "/devices/test", input);
    expect(result.status).toBe(200);
    expect(result.body.reading.power).toBe("on");
    refuse = true;
    expect((await request("POST", "/devices/test", input)).status).toBe(502);
  });
});

describe("actions", () => {
  it("sends a power change", async () => {
    const id = await addDevice();
    const result = await request("POST", `/devices/${id}/power`, {
      action: "graceful-shutdown",
    });
    expect(result.status).toBe(200);
    expect(posts.at(-1)).toMatchObject({
      path: "/redfish/v1/Systems/1/Actions/ComputerSystem.Reset",
      body: { ResetType: "GracefulShutdown" },
    });
  });

  it("refuses an unknown action", async () => {
    const id = await addDevice();
    expect(
      (await request("POST", `/devices/${id}/power`, { action: "explode" }))
        .status,
    ).toBe(400);
    expect(posts).toHaveLength(0);
  });

  it("reads and clears the event log", async () => {
    const id = await addDevice();
    const log = await request("GET", `/devices/${id}/log`);
    expect(log.body.entries[0].message).toBe("Boot");
    expect((await request("DELETE", `/devices/${id}/log`)).status).toBe(200);
    expect(posts.at(-1)?.path).toMatch(/ClearLog$/);
  });

  it("sets the next boot device", async () => {
    const id = await addDevice();
    await request("POST", `/devices/${id}/boot`, { device: "pxe", uefi: true });
    expect(posts.at(-1)?.body.Boot.BootSourceOverrideTarget).toBe("Pxe");
    expect(
      (await request("POST", `/devices/${id}/boot`, { device: "floppy" }))
        .status,
    ).toBe(400);
  });

  it("mounts only web addresses as virtual media", async () => {
    const id = await addDevice();
    const slots = await request("GET", `/devices/${id}/media`);
    const slot = slots.body.slots[0].id;
    expect(
      (
        await request("POST", `/devices/${id}/media/mount`, {
          slot,
          url: "file:///etc/passwd",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("POST", `/devices/${id}/media/mount`, {
          slot,
          url: "https://example.com/a.iso",
        })
      ).status,
    ).toBe(200);
    expect(posts.at(-1)?.body.Image).toBe("https://example.com/a.iso");
  });

  it("says when a type has no such feature", async () => {
    const id = await addDevice({
      driver: "amt",
      options: { scheme: "http" },
    });
    expect((await request("GET", `/devices/${id}/log`)).status).toBe(400);
    expect((await request("GET", `/devices/${id}/media`)).status).toBe(400);
  });
});

describe("permissions", () => {
  it("lets a viewer read but not change anything", async () => {
    const id = await addDevice();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    await setup(["out-of-band.view"]);
    expect((await request("GET", "/devices")).status).toBe(200);
    expect((await request("POST", "/devices", input)).status).toBe(403);
    expect((await request("PUT", `/devices/${id}`, input)).status).toBe(403);
    expect((await request("DELETE", `/devices/${id}`)).status).toBe(403);
    expect(
      (await request("POST", `/devices/${id}/power`, { action: "on" })).status,
    ).toBe(403);
    expect((await request("POST", `/devices/${id}/boot`, {})).status).toBe(403);
    expect((await request("GET", `/devices/${id}/media`)).status).toBe(403);
    expect((await request("DELETE", `/devices/${id}/log`)).status).toBe(403);
  });

  it("refuses everything without view", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    await setup([]);
    expect((await request("GET", "/devices")).status).toBe(403);
    expect((await request("GET", "/drivers")).status).toBe(403);
  });
});
