import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";
import { formatValue, healthTone, statusTone } from "../../src/frontend/format";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const device = {
  id: 1,
  hostId: null,
  name: "rack-1",
  driver: "redfish",
  address: "10.0.0.9",
  port: null,
  options: {},
  hasCa: false,
  pollSeconds: 120,
  status: "up",
  lastError: null,
  lastSeenAt: null,
  reading: {
    at: "",
    info: { model: "R740" },
    power: "on",
    health: "warning",
    sensors: [],
  },
};

function api(devices: unknown[]) {
  return {
    get: vi.fn(async (path: string) => ({
      data: path === "/drivers" ? { drivers: [] } : { devices },
    })),
  } as never;
}

describe(`${manifest.id} activate`, () => {
  it("registers the rail item, tab and dashboard card", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["out-of-band"]);
    expect(rendered.registered.railItems()).toEqual([
      expect.objectContaining({
        id: "out-of-band",
        permission: "out-of-band.view",
      }),
    ]);
  });

  it("lists BMCs with power and health", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api([device]),
    });
    rendered.renderTab("out-of-band", { isVisible: true });
    expect(await screen.findByText("rack-1")).toBeTruthy();
    expect(screen.getByText(/On \| Warning/)).toBeTruthy();
  });

  it("shows the empty state", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api([]),
    });
    rendered.renderTab("out-of-band", { isVisible: true });
    expect(await screen.findByText(locales.empty)).toBeTruthy();
  });
});

describe("format", () => {
  it("picks tones and formats readings", () => {
    expect(healthTone("critical")).toBe("bad");
    expect(healthTone(undefined)).toBe("idle");
    expect(statusTone("down", "ok")).toBe("bad");
    expect(statusTone("up", "warning")).toBe("warn");
    expect(statusTone("up", "unknown")).toBe("ok");
    expect(formatValue(45, "C")).toBe("45 °C");
    expect(formatValue(12.12, "V")).toBe("12.1 V");
    expect(formatValue(undefined)).toBe("");
  });
});
