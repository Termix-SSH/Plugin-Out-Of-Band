import { describe, expect, it } from "vitest";
import { redfish } from "../../src/backend/drivers/redfish.js";
import {
  connectionArgs,
  ipmi,
  parseLog,
  parseSensors,
} from "../../src/backend/drivers/ipmi.js";
import { amt } from "../../src/backend/drivers/amt.js";
import {
  DriverError,
  type CommandResult,
  type DriverIo,
  type Target,
} from "../../src/backend/drivers/types.js";
import { relayScript } from "../../src/backend/ipmitool.js";
import { solCommand } from "../../src/backend/sol.js";
import { fakeFetch, json, status } from "./fake-fetch.js";

const target = (extra: Partial<Target> = {}): Target => ({
  address: "10.0.0.9",
  port: 443,
  options: { scheme: "https" },
  credentials: { username: "root", password: "SECRET-PASSWORD" },
  ...extra,
});

const link = (path: string) => ({ "@odata.id": path });

/** A small Redfish tree that records what was posted. */
function bmc(extra: { allowed?: string[]; noLogs?: boolean } = {}) {
  const posts: Array<{ path: string; method: string; body: unknown }> = [];
  const fetch = fakeFetch((url, init) => {
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
          PowerState: "On",
          Status: { Health: "OK", State: "Enabled" },
          Manufacturer: "Dell",
          Model: "R740",
          SerialNumber: "ABC123",
          BiosVersion: "2.1",
          Actions: {
            "#ComputerSystem.Reset": {
              target: "/redfish/v1/Systems/1/Actions/ComputerSystem.Reset",
              "ResetType@Redfish.AllowableValues": extra.allowed ?? [
                "On",
                "ForceOff",
                "GracefulShutdown",
                "ForceRestart",
                "PowerCycle",
              ],
            },
          },
          LogServices: extra.noLogs
            ? undefined
            : link("/redfish/v1/Systems/1/LogServices"),
        });
      case "/redfish/v1/Chassis":
        return json({ Members: [link("/redfish/v1/Chassis/1")] });
      case "/redfish/v1/Chassis/1":
        return json({
          Thermal: link("/redfish/v1/Chassis/1/Thermal"),
          Power: link("/redfish/v1/Chassis/1/Power"),
        });
      case "/redfish/v1/Chassis/1/Thermal":
        return json({
          Temperatures: [
            {
              MemberID: "0",
              Name: "CPU1 Temp",
              ReadingCelsius: 45,
              Status: { Health: "OK" },
            },
          ],
          Fans: [
            {
              MemberID: "0",
              Name: "Fan1",
              Reading: 5000,
              ReadingUnits: "RPM",
              Status: { Health: "Warning" },
            },
          ],
        });
      case "/redfish/v1/Chassis/1/Power":
        return json({
          PowerSupplies: [
            {
              MemberID: "0",
              Name: "PSU1",
              PowerOutputWatts: 210,
              Status: { Health: "OK" },
            },
          ],
          PowerControl: [
            { MemberID: "0", Name: "System Power", PowerConsumedWatts: 380 },
          ],
        });
      case "/redfish/v1/Managers":
        return json({ Members: [link("/redfish/v1/Managers/1")] });
      case "/redfish/v1/Managers/1":
        return json({
          FirmwareVersion: "4.40",
          VirtualMedia: link("/redfish/v1/Managers/1/VirtualMedia"),
        });
      case "/redfish/v1/Managers/1/VirtualMedia":
        return json({
          Members: [link("/redfish/v1/Managers/1/VirtualMedia/CD")],
        });
      case "/redfish/v1/Managers/1/VirtualMedia/CD":
        return json({
          Id: "CD",
          Name: "Virtual CD",
          MediaTypes: ["CD", "DVD"],
          Inserted: false,
          Actions: {
            "#VirtualMedia.InsertMedia": {
              target:
                "/redfish/v1/Managers/1/VirtualMedia/CD/Actions/VirtualMedia.InsertMedia",
            },
          },
        });
      case "/redfish/v1/Systems/1/LogServices":
        return json({
          Members: [link("/redfish/v1/Systems/1/LogServices/SEL")],
        });
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
              Created: "2026-11-01T10:00:00Z",
              Severity: "OK",
              Message: "Boot",
            },
            {
              Id: "2",
              Created: "2026-11-02T10:00:00Z",
              Severity: "Critical",
              Message: "Fan failed",
            },
          ],
        });
      default:
        return status(404);
    }
  });
  const io: DriverIo = {
    fetch: fetch as never,
    ipmitool: async () => {
      throw new Error("no ipmitool here");
    },
  };
  return { io, posts, fetch };
}

describe("redfish", () => {
  it("reads power, health, identity and sensors", async () => {
    const { io, fetch } = bmc();
    const reading = await redfish.read(target(), io);
    expect(reading.power).toBe("on");
    expect(reading.info).toMatchObject({
      manufacturer: "Dell",
      model: "R740",
      serial: "ABC123",
      bmcVersion: "4.40",
    });
    expect(reading.sensors.map((s) => s.kind).sort()).toEqual([
      "fan",
      "power",
      "psu",
      "temperature",
    ]);
    // A fan in warning makes the whole machine warn
    expect(reading.health).toBe("warning");
    expect(fetch.calls[0].init.headers.authorization).toBe(
      `Basic ${Buffer.from("root:SECRET-PASSWORD").toString("base64")}`,
    );
    expect(fetch.calls[0].init.allowPrivateHosts).toEqual(["10.0.0.9"]);
  });

  it("passes a pinned CA to the request", async () => {
    const { io, fetch } = bmc();
    await redfish.read(target({ ca: "PEM" }), io);
    expect(fetch.calls[0].init.tls).toEqual({ ca: "PEM" });
  });

  it("maps power actions to reset types", async () => {
    const { io, posts } = bmc();
    await redfish.power(target(), io, "cycle");
    await redfish.power(target(), io, "graceful-shutdown");
    expect(posts.map((p) => p.body)).toEqual([
      { ResetType: "PowerCycle" },
      { ResetType: "GracefulShutdown" },
    ]);
    expect(posts[0].path).toBe(
      "/redfish/v1/Systems/1/Actions/ComputerSystem.Reset",
    );
  });

  it("falls back to a restart when power cycle is not allowed", async () => {
    const { io, posts } = bmc({ allowed: ["On", "ForceOff", "ForceRestart"] });
    await redfish.power(target(), io, "cycle");
    expect(posts[0].body).toEqual({ ResetType: "ForceRestart" });
  });

  it("refuses an action the BMC does not allow", async () => {
    const { io } = bmc({ allowed: ["On"] });
    await expect(redfish.power(target(), io, "off")).rejects.toThrow(
      /does not support/,
    );
  });

  it("reads the log newest first and clears it", async () => {
    const { io, posts } = bmc();
    const entries = await redfish.eventLog!(target(), io);
    expect(entries.map((e) => e.message)).toEqual(["Fan failed", "Boot"]);
    expect(entries[0].severity).toBe("critical");
    await redfish.clearLog!(target(), io);
    expect(posts[0].path).toMatch(/ClearLog$/);
  });

  it("sets a one time boot override", async () => {
    const { io, posts } = bmc();
    await redfish.bootOnce!(target(), io, "pxe", true);
    expect(posts[0]).toMatchObject({
      method: "PATCH",
      path: "/redfish/v1/Systems/1",
      body: {
        Boot: {
          BootSourceOverrideTarget: "Pxe",
          BootSourceOverrideEnabled: "Once",
          BootSourceOverrideMode: "UEFI",
        },
      },
    });
  });

  it("lists virtual CD slots and mounts an image", async () => {
    const { io, posts } = bmc();
    const slots = await redfish.media!.list(target(), io);
    expect(slots).toEqual([
      {
        id: "/redfish/v1/Managers/1/VirtualMedia/CD",
        name: "Virtual CD",
        inserted: false,
        image: undefined,
      },
    ]);
    await redfish.media!.mount(
      target(),
      io,
      slots[0].id,
      "https://x.test/a.iso",
    );
    expect(posts[0].body).toEqual({
      Image: "https://x.test/a.iso",
      Inserted: true,
      WriteProtected: true,
    });
    await expect(
      redfish.media!.mount(target(), io, "/nope", "https://x.test/a.iso"),
    ).rejects.toThrow(/not found/);
  });

  it("says when the login is refused", async () => {
    const fetch = fakeFetch(() => status(401));
    await expect(
      redfish.read(target(), {
        fetch: fetch as never,
        ipmitool: async () => ({ stdout: "", stderr: "", code: 0 }),
      }),
    ).rejects.toThrow(/refused the login/);
  });
});

const SDR = `CPU Temp         | 01h | ok  |  3.1 | 45 degrees C
Fan1             | 02h | nc  |  7.1 | 1200 RPM
Fan2             | 03h | cr  |  7.2 | 0 RPM
12V              | 04h | ok  |  7.3 | 12.1 Volts
Pwr Consumption  | 05h | ok  | 10.1 | 380 Watts
PS1 Status       | 06h | ok  | 10.2 | Presence detected
Chassis Intru    | 07h | ns  | 23.1 | No Reading
Disk Bay         | 08h | cr  | 23.2 | Drive Fault`;

const SEL = ` 1 | 11/01/2026 | 10:00:00 | System Boot Initiated #0x01 | Initiated by power up | Asserted
 2 | 11/02/2026 | 10:00:00 | Fan #0x32 | Lower Critical going low | Asserted
 3 | 11/03/2026 | 10:00:00 | Temperature #0x01 | Upper Non-critical going high | Asserted`;

function fakeIpmitool(answers: Record<string, string | CommandResult>) {
  const calls: Array<{ target: Target; args: string[] }> = [];
  const io: DriverIo = {
    fetch: fakeFetch() as never,
    ipmitool: async (t, args) => {
      calls.push({ target: t, args });
      const answer = answers[args.join(" ")];
      if (answer === undefined)
        return { stdout: "", stderr: "Unable to send RAW command", code: 1 };
      return typeof answer === "string"
        ? { stdout: answer, stderr: "", code: 0 }
        : answer;
    },
  };
  return { io, calls };
}

describe("ipmi", () => {
  it("never puts the password in the arguments", () => {
    const args = connectionArgs(target({ port: 623, options: { cipher: 17 } }));
    expect(args.join(" ")).not.toContain("SECRET-PASSWORD");
    expect(args).toContain("-E");
    expect(args.slice(-2)).toEqual(["-C", "17"]);
  });

  it("parses sensors and keeps discrete faults", () => {
    const sensors = parseSensors(SDR);
    const byName = Object.fromEntries(sensors.map((s) => [s.name, s]));
    expect(byName["CPU Temp"]).toMatchObject({
      kind: "temperature",
      value: 45,
      unit: "C",
      state: "ok",
    });
    expect(byName["Fan1"]).toMatchObject({ kind: "fan", state: "warning" });
    expect(byName["Fan2"].state).toBe("critical");
    expect(byName["12V"]).toMatchObject({
      kind: "voltage",
      value: 12.1,
      unit: "V",
    });
    expect(byName["Pwr Consumption"]).toMatchObject({
      kind: "power",
      value: 380,
    });
    // Healthy discrete sensors are skipped, a faulty one is kept
    expect(byName["PS1 Status"]).toBeUndefined();
    expect(byName["Chassis Intru"]).toBeUndefined();
    expect(byName["Disk Bay"].state).toBe("critical");
  });

  it("parses the event log newest first with a severity", () => {
    const entries = parseLog(SEL);
    expect(entries.map((e) => e.id)).toEqual(["3", "2", "1"]);
    expect(entries[0].severity).toBe("warning");
    expect(entries[1].severity).toBe("critical");
    expect(entries[2].severity).toBe("info");
  });

  it("reads power, sensors and identity", async () => {
    const { io } = fakeIpmitool({
      "chassis power status": "Chassis Power is on",
      "sdr elist": SDR,
      "mc info": "Manufacturer Name : Supermicro\nFirmware Revision : 3.1",
      "fru print 0": "Product Name : X11\nProduct Serial : S1",
    });
    const reading = await ipmi.read(target({ port: 623 }), io);
    expect(reading.power).toBe("on");
    expect(reading.health).toBe("critical");
    expect(reading.info).toMatchObject({
      manufacturer: "Supermicro",
      bmcVersion: "3.1",
      model: "X11",
      serial: "S1",
    });
  });

  it("still reads power when the sensor repository is missing", async () => {
    const { io } = fakeIpmitool({
      "chassis power status": "Chassis Power is off",
    });
    const reading = await ipmi.read(target({ port: 623 }), io);
    expect(reading.power).toBe("off");
    expect(reading.health).toBe("unknown");
  });

  it("maps power actions and the boot device", async () => {
    const { io, calls } = fakeIpmitool({
      "chassis power soft": "Chassis Power Control: Soft",
      "chassis power cycle": "ok",
      "chassis bootdev pxe options=efiboot": "ok",
      "chassis bootdev cdrom": "ok",
      "sel clear": "ok",
    });
    await ipmi.power(target(), io, "graceful-shutdown");
    await ipmi.power(target(), io, "cycle");
    await ipmi.bootOnce!(target(), io, "pxe", true);
    await ipmi.bootOnce!(target(), io, "cd", false);
    await ipmi.clearLog!(target(), io);
    expect(calls.map((c) => c.args.join(" "))).toEqual([
      "chassis power soft",
      "chassis power cycle",
      "chassis bootdev pxe options=efiboot",
      "chassis bootdev cdrom",
      "sel clear",
    ]);
  });

  it("turns a failed command into a readable error", async () => {
    const { io } = fakeIpmitool({
      "chassis power status": {
        stdout: "",
        stderr: "Error: Unable to establish IPMI v2 / RMCP+ session",
        code: 1,
      },
    });
    await expect(ipmi.read(target(), io)).rejects.toBeInstanceOf(DriverError);
    await expect(ipmi.read(target(), io)).rejects.toThrow(/RMCP\+/);
  });
});

describe("relay scripts", () => {
  it("sends the password as base64 and quotes every argument", () => {
    const script = relayScript(target({ port: 623 }), [
      "sel",
      "elist; rm -rf /",
    ]);
    expect(script).not.toContain("SECRET-PASSWORD");
    expect(script).toContain(Buffer.from("SECRET-PASSWORD").toString("base64"));
    expect(script).toContain("'elist; rm -rf /'");
    expect(script).toContain("command -v ipmitool");
  });

  it("keeps the console password off the command line", () => {
    const command = solCommand(["-H", "10.0.0.9", "sol", "activate"]);
    expect(command.startsWith("bash -c ")).toBe(true);
    expect(command).toContain("stty -echo");
    expect(command).toContain("read -r B");
    expect(command).not.toContain("SECRET");
  });
});

describe("amt", () => {
  const amtTarget = target({ port: 16992, options: { scheme: "http" } });

  /** Answers 401 with a digest challenge first, like a real AMT. */
  function device(power: number) {
    const bodies: string[] = [];
    const fetch = fakeFetch((_url, init) => {
      if (!init.headers?.authorization) {
        return new Response("", {
          status: 401,
          headers: {
            "www-authenticate":
              'Digest realm="Digest:A1", nonce="abc", qop="auth"',
          },
        });
      }
      bodies.push(init.body ?? "");
      if ((init.body ?? "").includes("RequestPowerStateChange")) {
        return new Response(
          "<Body><RequestPowerStateChange_OUTPUT><ReturnValue>0</ReturnValue></RequestPowerStateChange_OUTPUT></Body>",
          { status: 200 },
        );
      }
      return new Response(
        `<Body><g:PowerState>${power}</g:PowerState></Body>`,
        { status: 200 },
      );
    });
    return {
      bodies,
      fetch,
      io: {
        fetch: fetch as never,
        ipmitool: async () => ({ stdout: "", stderr: "", code: 0 }),
      } as DriverIo,
    };
  }

  it("answers the digest challenge and reads power", async () => {
    const { io, fetch } = device(2);
    const reading = await amt.read(amtTarget, io);
    expect(reading.power).toBe("on");
    const sent = fetch.calls[1].init.headers.authorization as string;
    expect(sent).toMatch(
      /^Digest username="root", realm="Digest:A1", nonce="abc"/,
    );
    expect(sent).toContain("qop=auth");
    expect(sent).not.toContain("SECRET-PASSWORD");
    expect(fetch.calls[0].url).toBe("http://10.0.0.9:16992/wsman");
  });

  it("reads other power states as off", async () => {
    const { io } = device(8);
    expect((await amt.read(amtTarget, io)).power).toBe("off");
  });

  it("requests a power state change", async () => {
    const { io, bodies } = device(2);
    await amt.power(amtTarget, io, "cycle");
    expect(bodies[0]).toContain("<r:PowerState>5</r:PowerState>");
  });

  it("reports a refused change", async () => {
    const fetch = fakeFetch((_url, init) =>
      init.headers?.authorization
        ? new Response("<ReturnValue>1</ReturnValue>", { status: 200 })
        : new Response("", {
            status: 401,
            headers: { "www-authenticate": 'Digest realm="r", nonce="n"' },
          }),
    );
    await expect(
      amt.power(
        amtTarget,
        {
          fetch: fetch as never,
          ipmitool: async () => ({ stdout: "", stderr: "", code: 0 }),
        },
        "off",
      ),
    ).rejects.toThrow(/refused the power change/);
  });
});
