import { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type {
  AckResponse,
  ClientToServerEvents,
  DeleteGuestbookEntry,
  GuestbookEntry,
  ServerToClientEvents,
  SubmitGuestbookEntry,
} from "../shared/types.js";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
let serverUrl = "";
let httpServer: typeof import("../server/index.js").httpServer;
let serverIo: typeof import("../server/index.js").io;
let guestbookFile = "";
let temporaryDirectory = "";
const previousGuestbookFile = process.env.GUESTBOOK_FILE;
const previousAdminToken = process.env.ADMIN_TOKEN;
const adminToken = "test-admin-token";

function connectClient(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function getGuestbook(client: TestSocket): Promise<AckResponse<GuestbookEntry[]>> {
  return new Promise((resolve) => client.emit("guestbook:get", resolve));
}

function postGuestbook(client: TestSocket, payload: SubmitGuestbookEntry): Promise<AckResponse<GuestbookEntry[]>> {
  return new Promise((resolve) => client.emit("guestbook:post", payload, resolve));
}

function deleteGuestbook(client: TestSocket, payload: DeleteGuestbookEntry): Promise<AckResponse<GuestbookEntry[]>> {
  return new Promise((resolve) => client.emit("guestbook:delete", payload, resolve));
}

describe("Game Center guestbook", () => {
  beforeAll(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "game-center-guestbook-"));
    guestbookFile = join(temporaryDirectory, "guestbook.json");
    process.env.GUESTBOOK_FILE = guestbookFile;
    process.env.ADMIN_TOKEN = adminToken;
    const serverModule = await import("../server/index.js");
    httpServer = serverModule.httpServer;
    serverIo = serverModule.io;
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => serverIo.close(() => resolve()));
    if (previousGuestbookFile === undefined) delete process.env.GUESTBOOK_FILE;
    else process.env.GUESTBOOK_FILE = previousGuestbookFile;
    if (previousAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousAdminToken;
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("persists guest reviews and broadcasts them to other visitors", async () => {
    const author = await connectClient();
    const visitor = await connectClient();
    const initial = await getGuestbook(visitor);
    expect(initial).toEqual({ ok: true, data: [] });

    const visitorUpdate = new Promise<GuestbookEntry[]>((resolve) => {
      visitor.once("guestbook:updated", resolve);
    });
    const posted = await postGuestbook(author, {
      name: "Guest Reviewer",
      message: "A pleasant table for a quick game.",
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) throw new Error(posted.error);
    expect(posted.data[0]).toMatchObject({
      name: "Guest Reviewer",
      message: "A pleasant table for a quick game.",
    });

    const broadcast = await visitorUpdate;
    expect(broadcast).toEqual(posted.data);
    const persisted = JSON.parse(readFileSync(guestbookFile, "utf8")) as { entries: GuestbookEntry[] };
    expect(persisted.entries).toHaveLength(1);

    const rateLimited = await postGuestbook(author, { message: "Another review" });
    expect(rateLimited.ok).toBe(false);
    if (rateLimited.ok) throw new Error("Guestbook rate limit was not enforced.");
    expect(rateLimited.error).toContain("频繁");
  });

  it("lets only an admin delete guest reviews", async () => {
    const author = await connectClient();
    const intruder = await connectClient();
    const admin = await connectClient();
    const posted = await postGuestbook(author, { message: "Spam that should be removed." });
    if (!posted.ok) throw new Error(posted.error);
    const target = posted.data[0]!;

    const verifyWrong = await new Promise<AckResponse<void>>((resolve) => {
      intruder.emit("admin:verify", "wrong-token", resolve);
    });
    expect(verifyWrong.ok).toBe(false);
    const rejected = await deleteGuestbook(intruder, { id: target.id, token: "wrong-token" });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("Admin retry delay was not enforced.");
    expect(rejected.error).toContain("频繁");

    const verified = await new Promise<AckResponse<void>>((resolve) => {
      admin.emit("admin:verify", adminToken, resolve);
    });
    expect(verified).toEqual({ ok: true, data: undefined });

    const authorUpdate = new Promise<GuestbookEntry[]>((resolve) => {
      author.once("guestbook:updated", resolve);
    });
    const deleted = await deleteGuestbook(admin, { id: target.id, token: adminToken });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) throw new Error(deleted.error);
    expect(deleted.data.some((entry) => entry.id === target.id)).toBe(false);
    expect(await authorUpdate).toEqual(deleted.data);
    const persisted = JSON.parse(readFileSync(guestbookFile, "utf8")) as { entries: GuestbookEntry[] };
    expect(persisted.entries.some((entry) => entry.id === target.id)).toBe(false);

    const missing = await deleteGuestbook(admin, { id: target.id, token: adminToken });
    expect(missing.ok).toBe(false);
  });
});
