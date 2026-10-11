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
  PinEntry,
  ServerToClientEvents,
  SubmitGuestbookEntry,
  SubmitWish,
  VoteWish,
  Wish,
} from "../shared/types.js";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
let serverUrl = "";
let httpServer: typeof import("../server/index.js").httpServer;
let serverIo: typeof import("../server/index.js").io;
let guestbookFile = "";
let temporaryDirectory = "";
const previousGuestbookFile = process.env.GUESTBOOK_FILE;
const previousWishesFile = process.env.WISHES_FILE;
const previousAdminToken = process.env.ADMIN_TOKEN;
let wishesFile = "";
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

function pinGuestbook(client: TestSocket, payload: PinEntry): Promise<AckResponse<GuestbookEntry[]>> {
  return new Promise((resolve) => client.emit("guestbook:pin", payload, resolve));
}

function getWishes(client: TestSocket): Promise<AckResponse<Wish[]>> {
  return new Promise((resolve) => client.emit("wishes:get", resolve));
}

function postWish(client: TestSocket, payload: SubmitWish): Promise<AckResponse<Wish[]>> {
  return new Promise((resolve) => client.emit("wishes:post", payload, resolve));
}

function voteWish(client: TestSocket, payload: VoteWish): Promise<AckResponse<Wish[]>> {
  return new Promise((resolve) => client.emit("wishes:vote", payload, resolve));
}

function pinWish(client: TestSocket, payload: PinEntry): Promise<AckResponse<Wish[]>> {
  return new Promise((resolve) => client.emit("wishes:pin", payload, resolve));
}

function deleteWish(client: TestSocket, payload: DeleteGuestbookEntry): Promise<AckResponse<Wish[]>> {
  return new Promise((resolve) => client.emit("wishes:delete", payload, resolve));
}

function unwrap<T>(response: AckResponse<T>): T {
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Game Center guestbook", () => {
  beforeAll(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "game-center-guestbook-"));
    guestbookFile = join(temporaryDirectory, "guestbook.json");
    process.env.GUESTBOOK_FILE = guestbookFile;
    wishesFile = join(temporaryDirectory, "wishes.json");
    process.env.WISHES_FILE = wishesFile;
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
    if (previousWishesFile === undefined) delete process.env.WISHES_FILE;
    else process.env.WISHES_FILE = previousWishesFile;
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

  it("lets an admin pin reviews to the top", async () => {
    const first = await connectClient();
    const second = await connectClient();
    const intruder = await connectClient();
    const admin = await connectClient();
    const older = unwrap(await postGuestbook(first, { message: "Older review to pin." }))[0]!;
    const newer = unwrap(await postGuestbook(second, { message: "Newer review." }))[0]!;

    const rejected = await pinGuestbook(intruder, { id: older.id, token: "wrong-token", pinned: true });
    expect(rejected.ok).toBe(false);

    const pinned = unwrap(await pinGuestbook(admin, { id: older.id, token: adminToken, pinned: true }));
    expect(pinned[0]).toMatchObject({ id: older.id });
    expect(pinned[0]!.pinnedAt).toBeTypeOf("string");
    expect(pinned[1]).toMatchObject({ id: newer.id });
    const persisted = JSON.parse(readFileSync(guestbookFile, "utf8")) as { entries: GuestbookEntry[] };
    expect(persisted.entries.find((entry) => entry.id === older.id)?.pinnedAt).toBeTypeOf("string");

    const unpinned = unwrap(await pinGuestbook(admin, { id: older.id, token: adminToken, pinned: false }));
    expect(unpinned[0]).toMatchObject({ id: newer.id });
    expect(unpinned.find((entry) => entry.id === older.id)?.pinnedAt).toBeUndefined();
  });

  it("accepts reviews from the floating widget over HTTP, tagged with the game", async () => {
    const visitor = await connectClient();
    const update = new Promise<GuestbookEntry[]>((resolve) => visitor.once("guestbook:updated", resolve));
    const post = (body: unknown, ip: string) => fetch(`${serverUrl}/api/guestbook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    });

    const ok = await post({ name: "小李", message: "斗地主的记牌器很好用。", source: "doudizhu" }, "10.0.0.1");
    expect(ok.status).toBe(200);
    const broadcast = await update;
    expect(broadcast.find((entry) => entry.message === "斗地主的记牌器很好用。")).toMatchObject({ name: "小李", source: "斗地主" });

    // 同一个 IP 10 秒内只能发一条
    const tooSoon = await post({ message: "再来一条评价" }, "10.0.0.1");
    expect(tooSoon.status).toBe(429);

    // 认不出的来源不标；太短的留言拒绝
    const unknown = await post({ message: "大厅很好看", source: "not-a-game" }, "10.0.0.2");
    expect(unknown.status).toBe(200);
    const list = unwrap(await getGuestbook(visitor));
    const entry = list.find((candidate) => candidate.message === "大厅很好看");
    expect(entry?.source).toBeUndefined();
    expect(entry?.name).toBe("游客");
    const short = await post({ message: "好" }, "10.0.0.3");
    expect(short.status).toBe(400);
  });

  describe("wishing well", () => {
    it("lets anyone wish and +1, sorted by votes", async () => {
      const alice = await connectClient();
      const bob = await connectClient();
      expect(await getWishes(bob)).toEqual({ ok: true, data: [] });

      const bobUpdate = new Promise<Wish[]>((resolve) => bob.once("wishes:updated", resolve));
      const afterFirst = unwrap(await postWish(alice, { game: "卡坦岛", note: "想和朋友一起玩", voterId: "voter-alice-1" }));
      expect(afterFirst[0]).toMatchObject({ name: "游客", game: "卡坦岛", note: "想和朋友一起玩", votes: 1 });
      expect(afterFirst[0]).not.toHaveProperty("voters");
      expect(await bobUpdate).toEqual(afterFirst);

      const tooSoon = await postWish(alice, { game: "璀璨宝石", voterId: "voter-alice-1" });
      expect(tooSoon.ok).toBe(false);
      const empty = await postWish(bob, { game: "  ", voterId: "voter-bob-1" });
      expect(empty.ok).toBe(false);

      const afterSecond = unwrap(await postWish(bob, { name: "Bob", game: "UNO", voterId: "voter-bob-1" }));
      // 同票时新的在前
      expect(afterSecond.map((wish) => wish.game)).toEqual(["UNO", "卡坦岛"]);
      const catan = afterSecond[1]!;

      const voted = unwrap(await voteWish(bob, { id: catan.id, voterId: "voter-bob-1", voted: true }));
      expect(voted[0]).toMatchObject({ game: "卡坦岛", votes: 2 });
      await delay(1_050);
      // 同一个编号重复 +1 不多算
      const again = unwrap(await voteWish(bob, { id: catan.id, voterId: "voter-bob-1", voted: true }));
      expect(again[0]).toMatchObject({ game: "卡坦岛", votes: 2 });
      await delay(1_050);
      const withdrawn = unwrap(await voteWish(bob, { id: catan.id, voterId: "voter-bob-1", voted: false }));
      expect(withdrawn.find((wish) => wish.id === catan.id)?.votes).toBe(1);

      const badVoter = await voteWish(alice, { id: catan.id, voterId: "x", voted: true });
      expect(badVoter.ok).toBe(false);

      // 许同一款游戏（大小写、空格不同）不另起一条，算给原来那条 +1。
      const charlie = await connectClient();
      const merged = unwrap(await postWish(charlie, { game: " u n o ", voterId: "voter-charlie-1" }));
      expect(merged).toHaveLength(2);
      expect(merged.find((wish) => wish.game === "UNO")?.votes).toBe(2);

      const persisted = JSON.parse(readFileSync(wishesFile, "utf8")) as { wishes: Array<{ voters: string[] }> };
      expect(persisted.wishes).toHaveLength(2);
    });

    it("lets only an admin pin and delete wishes", async () => {
      const intruder = await connectClient();
      const admin = await connectClient();
      const wishesNow = unwrap(await getWishes(admin));
      const last = wishesNow[wishesNow.length - 1]!;

      expect((await pinWish(intruder, { id: last.id, token: "wrong", pinned: true })).ok).toBe(false);
      expect((await deleteWish(intruder, { id: last.id, token: "wrong" })).ok).toBe(false);

      const pinned = unwrap(await pinWish(admin, { id: last.id, token: adminToken, pinned: true }));
      expect(pinned[0]).toMatchObject({ id: last.id });
      expect(pinned[0]!.pinnedAt).toBeTypeOf("string");

      const deleted = unwrap(await deleteWish(admin, { id: last.id, token: adminToken }));
      expect(deleted.some((wish) => wish.id === last.id)).toBe(false);
      expect((await deleteWish(admin, { id: last.id, token: adminToken })).ok).toBe(false);
    });
  });
});
