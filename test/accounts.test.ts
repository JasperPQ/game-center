import { createHash } from "node:crypto";
import { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { priceFen, TRIAL_DAYS } from "../shared/pricing.js";
import type { AdminGameRooms, PublicAccount, PublicOrder } from "../shared/types.js";

let serverUrl = "";
let httpServer: typeof import("../server/index.js").httpServer;
let serverIo: typeof import("../server/index.js").io;
let temporaryDirectory = "";
const previousAccountsFile = process.env.ACCOUNTS_FILE;
const previousCodesFile = process.env.CODES_FILE;
const previousSessionsFile = process.env.SESSIONS_FILE;
const previousOrdersFile = process.env.ORDERS_FILE;
const previousAdminToken = process.env.ADMIN_TOKEN;
const previousPayProvider = process.env.PAY_PROVIDER;
const adminToken = "test-admin-token";
const DAY_MS = 24 * 60 * 60 * 1000;

interface RequestOptions {
  method?: string;
  body?: unknown;
  cookie?: string | null;
  token?: string;
  /** 模拟不同访客 IP（服务端信任来自本机的 X-Forwarded-For）。 */
  ip?: string;
}

function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.token) headers["X-Admin-Token"] = options.token;
  if (options.ip) headers["X-Forwarded-For"] = options.ip;
  const init: RequestInit = { method: options.method ?? "GET", headers, redirect: "manual" };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  return fetch(`${serverUrl}${path}`, init);
}

/** 模拟 Caddy forward_auth：带上原始地址，默认像浏览器打开网页一样要 HTML。 */
function checkAuth(cookie: string | null, options: { uri?: string; accept?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: options.accept ?? "text/html,application/xhtml+xml",
    "X-Forwarded-Uri": options.uri ?? "/gem/",
  };
  if (cookie) headers.Cookie = cookie;
  return fetch(`${serverUrl}/api/auth/check`, { headers, redirect: "manual" });
}

async function registerUser(username: string, ip: string): Promise<{ user: PublicAccount; cookie: string }> {
  const response = await request("/api/register", {
    method: "POST",
    body: { username, password: "secret12" },
    ip,
  });
  expect(response.status).toBe(200);
  const cookie = sessionCookie(response);
  expect(cookie).toBeTruthy();
  return { user: ((await response.json()) as { user: PublicAccount }).user, cookie: cookie! };
}


const wechatToken = "test-wechat-token";

/** 带上公众号签名的 /api/wechat 地址。 */
function wechatUrl(extra: Record<string, string> = {}, token = wechatToken): string {
  const timestamp = "1700000000";
  const nonce = "12345";
  const signature = createHash("sha1").update([token, timestamp, nonce].sort().join("")).digest("hex");
  return `/api/wechat?${new URLSearchParams({ signature, timestamp, nonce, ...extra }).toString()}`;
}

/** 模拟微信用户在公众号里发一条文字，返回公众号回复的内容。 */
async function sendWechatText(openId: string, content: string): Promise<string> {
  const xml = `<xml><ToUserName><![CDATA[gh_test]]></ToUserName><FromUserName><![CDATA[${openId}]]></FromUserName>`
    + `<CreateTime>1700000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${content}]]></Content>`
    + `<MsgId>1</MsgId></xml>`;
  const response = await fetch(`${serverUrl}${wechatUrl()}`, { method: "POST", body: xml, headers: { "Content-Type": "text/xml" } });
  expect(response.status).toBe(200);
  const reply = await response.text();
  expect(reply).toContain(`<ToUserName><![CDATA[${openId}]]></ToUserName>`);
  return /<Content><!\[CDATA\[([\s\S]*?)\]\]><\/Content>/.exec(reply)?.[1] ?? "";
}

/** 从注册/登录响应的 Set-Cookie 里取出会话 cookie（"gc_session=…"）。 */
function sessionCookie(response: Response): string | null {
  const header = response.headers.get("set-cookie");
  if (!header) return null;
  const first = header.split(";")[0] ?? "";
  return first.includes("=") ? first : null;
}

describe("Game Center accounts and subscription", () => {
  beforeAll(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "game-center-accounts-"));
    process.env.ACCOUNTS_FILE = join(temporaryDirectory, "accounts.json");
    process.env.CODES_FILE = join(temporaryDirectory, "codes.json");
    process.env.SESSIONS_FILE = join(temporaryDirectory, "sessions.json");
    process.env.ORDERS_FILE = join(temporaryDirectory, "orders.json");
    process.env.ADMIN_TOKEN = adminToken;
    process.env.PAY_PROVIDER = "mock";
    const serverModule = await import("../server/index.js");
    httpServer = serverModule.httpServer;
    serverIo = serverModule.io;
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => serverIo.close(() => resolve()));
    if (previousAccountsFile === undefined) delete process.env.ACCOUNTS_FILE;
    else process.env.ACCOUNTS_FILE = previousAccountsFile;
    if (previousCodesFile === undefined) delete process.env.CODES_FILE;
    else process.env.CODES_FILE = previousCodesFile;
    if (previousSessionsFile === undefined) delete process.env.SESSIONS_FILE;
    else process.env.SESSIONS_FILE = previousSessionsFile;
    if (previousOrdersFile === undefined) delete process.env.ORDERS_FILE;
    else process.env.ORDERS_FILE = previousOrdersFile;
    if (previousAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousAdminToken;
    if (previousPayProvider === undefined) delete process.env.PAY_PROVIDER;
    else process.env.PAY_PROVIDER = previousPayProvider;
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("registers an account with a free trial, exposes it on /me, and rejects duplicates", async () => {
    const registered = await request("/api/register", {
      method: "POST",
      body: { username: "Alice", password: "secret12" },
    });
    expect(registered.status).toBe(200);
    const auth = (await registered.json()) as { user: PublicAccount };
    expect(auth.user.username).toBe("Alice");
    expect(auth.user.subscribed).toBe(true);
    expect(auth.user.trial).toBe(true);
    expect(auth.user.paid).toBe(false);
    expect(auth.user.daysLeft).toBe(TRIAL_DAYS);
    const cookie = sessionCookie(registered);
    expect(cookie).toBeTruthy();
    expect((await checkAuth(cookie)).status).toBe(200);

    const me = await request("/api/me", { cookie });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: PublicAccount | null }).user?.username).toBe("Alice");

    const duplicate = await request("/api/register", {
      method: "POST",
      body: { username: "alice", password: "another12" },
    });
    expect(duplicate.status).toBe(400);
  });

  it("rejects a wrong password and a guest without a session", async () => {
    const login = await request("/api/login", {
      method: "POST",
      body: { username: "Alice", password: "wrong-password" },
    });
    expect(login.status).toBe(400);

    const guestMe = await request("/api/me");
    expect(((await guestMe.json()) as { user: PublicAccount | null }).user).toBeNull();

    const blocked = await checkAuth(null, { uri: "/camel/" });
    expect(blocked.status).toBe(302);
    expect(blocked.headers.get("location")).toBe("/?gate=login&next=camel");
    // 路径里带数字的游戏（翻七 /flip7/）也要带上 next。
    const blockedFlip7 = await checkAuth(null, { uri: "/flip7/" });
    expect(blockedFlip7.headers.get("location")).toBe("/?gate=login&next=flip7");
    // socket.io、图片等非网页请求直接 401，不重定向。
    const blockedSocket = await checkAuth(null, { uri: "/camel/socket.io/?EIO=4", accept: "*/*" });
    expect(blockedSocket.status).toBe(401);
  });

  it("gates games behind an active subscription and lets a redeem code unlock them", async () => {
    // 把时钟拨到试用结束之后（只假冒 Date，网络和定时器照常）。
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + (TRIAL_DAYS + 1) * DAY_MS);
    const codesResponse = await request("/api/admin/code", {
      method: "POST",
      body: { months: 1, count: 1 },
      token: adminToken,
    });
    expect(codesResponse.status).toBe(200);
    const { codes } = (await codesResponse.json()) as { codes: string[] };
    expect(codes).toHaveLength(1);

    const login = await request("/api/login", {
      method: "POST",
      body: { username: "Alice", password: "secret12" },
    });
    expect(login.status).toBe(200);
    const cookie = sessionCookie(login);
    expect(cookie).toBeTruthy();

    const before = await checkAuth(cookie);
    expect(before.status).toBe(302);
    expect(before.headers.get("location")).toBe("/?gate=expired&next=gem");

    const redeemed = await request("/api/redeem", {
      method: "POST",
      body: { code: codes[0] },
      cookie,
    });
    expect(redeemed.status).toBe(200);
    const redeemedUser = ((await redeemed.json()) as { user: PublicAccount }).user;
    expect(redeemedUser.subscribed).toBe(true);
    expect(redeemedUser.trial).toBe(false);
    expect(redeemedUser.paid).toBe(true);
    expect(redeemedUser.daysLeft).toBeGreaterThanOrEqual(28);

    const after = await checkAuth(cookie);
    expect(after.status).toBe(200);

    const reused = await request("/api/redeem", {
      method: "POST",
      body: { code: codes[0] },
      cookie,
    });
    expect(reused.status).toBe(400);
  });

  it("lets the admin extend a subscription and reset a password", async () => {
    const extended = await request("/api/admin/extend", {
      method: "POST",
      body: { username: "Alice", months: 1 },
      token: adminToken,
    });
    expect(extended.status).toBe(200);
    const extendedUser = ((await extended.json()) as { account: PublicAccount }).account;
    expect(extendedUser.subscribed).toBe(true);

    const reset = await request("/api/admin/reset-password", {
      method: "POST",
      body: { username: "Alice", password: "brand-new-pass" },
      token: adminToken,
    });
    expect(reset.status).toBe(200);

    const oldLogin = await request("/api/login", {
      method: "POST",
      body: { username: "Alice", password: "secret12" },
    });
    expect(oldLogin.status).toBe(400);
    const newLogin = await request("/api/login", {
      method: "POST",
      body: { username: "Alice", password: "brand-new-pass" },
    });
    expect(newLogin.status).toBe(200);

    const accounts = await request("/api/admin/accounts", { token: adminToken });
    expect(accounts.status).toBe(200);
    const usernames = ((await accounts.json()) as { accounts: PublicAccount[] }).accounts
      .map((account) => account.username);
    expect(usernames).toContain("Alice");
  });

  it("blocks admin endpoints without the admin token", async () => {
    const accounts = await request("/api/admin/accounts", { token: "wrong" });
    expect(accounts.status).toBe(401);
    const orders = await request("/api/admin/orders", { token: "wrong" });
    expect(orders.status).toBe(401);
  });

  it("keeps sessions across a server restart", async () => {
    const { cookie } = await registerUser("Carol", "10.0.0.3");
    const token = cookie.split("=")[1]!;
    vi.resetModules();
    const reloaded = await import("../server/accounts.js");
    expect(reloaded.currentUser(token)?.username).toBe("Carol");
  });

  it("sells months through an order: trial days carry over and a repeated notify only counts once", async () => {
    const { user, cookie } = await registerUser("Bob", "10.0.0.2");
    const trialEnd = Date.parse(user.expiresAt!);

    const config = await request("/api/pay/config");
    expect(await config.json()).toEqual({ enabled: true, label: "模拟支付" });

    const invalid = await request("/api/orders", { method: "POST", body: { months: 2 }, cookie });
    expect(invalid.status).toBe(400);
    const guest = await request("/api/orders", { method: "POST", body: { months: 1 } });
    expect(guest.status).toBe(401);

    const created = await request("/api/orders", { method: "POST", body: { months: 3 }, cookie });
    expect(created.status).toBe(200);
    const { order, checkout } = (await created.json()) as {
      order: PublicOrder;
      checkout: { kind: string; url: string };
    };
    expect(order.amountFen).toBe(priceFen(3));
    expect(order.status).toBe("pending");
    expect(checkout.kind).toBe("redirect");

    // 别人查不到这个订单。
    const { cookie: otherCookie } = await registerUser("Mallory", "10.0.0.9");
    expect((await request(`/api/orders/${order.id}`, { cookie: otherCookie })).status).toBe(404);

    const page = await request(checkout.url);
    expect(page.status).toBe(200);
    const confirm = await request(`/api/pay/mock/confirm?order=${order.id}`, { method: "POST" });
    expect(confirm.status).toBe(302);
    expect(confirm.headers.get("location")).toBe(`/?order=${order.id}`);
    // 重复通知不重复加时长。
    await request(`/api/pay/mock/confirm?order=${order.id}`, { method: "POST" });

    const status = await request(`/api/orders/${order.id}`, { cookie });
    const paid = (await status.json()) as { order: PublicOrder; user: PublicAccount };
    expect(paid.order.status).toBe("paid");
    expect(paid.user.paid).toBe(true);
    expect(paid.user.trial).toBe(false);
    const expected = new Date(trialEnd);
    expected.setMonth(expected.getMonth() + 3);
    expect(Math.abs(Date.parse(paid.user.expiresAt!) - expected.getTime())).toBeLessThan(5_000);

    const adminOrders = await request("/api/admin/orders", { token: adminToken });
    const listed = ((await adminOrders.json()) as { orders: PublicOrder[] }).orders;
    expect(listed.find((candidate) => candidate.id === order.id)?.status).toBe("paid");
  });

  it("lets the admin settle a pending order by hand", async () => {
    const { cookie } = await registerUser("Dave", "10.0.0.4");
    const created = await request("/api/orders", { method: "POST", body: { months: 1 }, cookie });
    const { order } = (await created.json()) as { order: PublicOrder };
    const settled = await request("/api/admin/orders/mark-paid", {
      method: "POST",
      body: { id: order.id },
      token: adminToken,
    });
    expect(settled.status).toBe(200);
    expect(((await settled.json()) as { order: PublicOrder }).order.status).toBe("paid");
  });

  it("gives friends a lifetime pass by admin switch or by a lifetime code", async () => {
    const { cookie: friendCookie } = await registerUser("Friend", "10.0.0.20");
    const flagged = await request("/api/admin/lifetime", {
      method: "POST",
      body: { username: "Friend", lifetime: true },
      token: adminToken,
    });
    expect(((await flagged.json()) as { account: PublicAccount }).account.lifetime).toBe(true);

    const codesResponse = await request("/api/admin/code", {
      method: "POST",
      body: { count: 1, lifetime: true },
      token: adminToken,
    });
    const { codes } = (await codesResponse.json()) as { codes: string[] };
    const { cookie: buddyCookie } = await registerUser("Buddy", "10.0.0.21");
    const redeemed = await request("/api/redeem", { method: "POST", body: { code: codes[0] }, cookie: buddyCookie });
    const buddy = ((await redeemed.json()) as { user: PublicAccount }).user;
    expect(buddy.lifetime).toBe(true);
    expect(buddy.trial).toBe(false);

    // 试用期早过了（登录态 30 天内）依然能进游戏。
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 20 * DAY_MS);
    expect((await checkAuth(friendCookie)).status).toBe(200);
    expect((await checkAuth(buddyCookie)).status).toBe(200);
    vi.useRealTimers();

    const unflagged = await request("/api/admin/lifetime", {
      method: "POST",
      body: { username: "Friend", lifetime: false },
      token: adminToken,
    });
    const friend = ((await unflagged.json()) as { account: PublicAccount }).account;
    expect(friend.lifetime).toBe(false);
    expect(friend.trial).toBe(true);
  });

  it("limits registrations per IP and repeated wrong passwords", async () => {
    for (let i = 0; i < 5; i++) await registerUser(`Spam${i}`, "10.0.0.66");
    const sixth = await request("/api/register", {
      method: "POST",
      body: { username: "Spam5", password: "secret12" },
      ip: "10.0.0.66",
    });
    expect(sixth.status).toBe(429);

    for (let i = 0; i < 10; i++) {
      await request("/api/login", { method: "POST", body: { username: "Spam0", password: "nope-nope" }, ip: "10.0.0.67" });
    }
    const locked = await request("/api/login", {
      method: "POST",
      body: { username: "Spam0", password: "secret12" },
      ip: "10.0.0.68",
    });
    expect(locked.status).toBe(429);
  });

  it("answers the WeChat server check only with a valid signature", async () => {
    process.env.WECHAT_TOKEN = wechatToken;
    try {
      const ok = await request(wechatUrl({ echostr: "hello-echo" }));
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe("hello-echo");
      const forged = await request(wechatUrl({ echostr: "hello-echo" }, "wrong-token"));
      expect(forged.status).toBe(403);
    } finally {
      delete process.env.WECHAT_TOKEN;
    }
  });

  it("gives the trial through the WeChat account, once per WeChat user", async () => {
    process.env.WECHAT_TOKEN = wechatToken;
    process.env.WECHAT_TRIAL = "on";
    try {
      const config = await (await request("/api/wechat/config")).json() as { enabled: boolean };
      expect(config.enabled).toBe(true);

      const { user, cookie } = await registerUser("Wendy", "10.0.1.1");
      expect(user.subscribed).toBe(false);
      expect(user.trialClaimed).toBe(false);
      const gate = await checkAuth(cookie);
      expect(gate.status).toBe(302);
      expect(gate.headers.get("location")).toContain("gate=trial");

      const bind = await (await request("/api/wechat/bind-code", { cookie })).json() as { code: string };
      expect(bind.code).toMatch(/^\d{6}$/);
      const again = await (await request("/api/wechat/bind-code", { cookie })).json() as { code: string };
      expect(again.code).toBe(bind.code);

      const wrong = bind.code === "000000" ? "111111" : "000000";
      expect(await sendWechatText("openid-wendy", wrong)).toContain("不对");
      expect(await sendWechatText("openid-wendy", bind.code)).toContain("领取成功");
      const me = await (await request("/api/me", { cookie })).json() as { user: PublicAccount };
      expect(me.user.subscribed).toBe(true);
      expect(me.user.trial).toBe(true);
      expect(me.user.wechatBound).toBe(true);
      expect(me.user.daysLeft).toBe(TRIAL_DAYS);
      expect((await checkAuth(cookie)).status).toBe(200);
      expect((await request("/api/wechat/bind-code", { cookie })).status).toBe(400);

      // 同一个微信再给小号领：不给。
      const second = await registerUser("WendyAlt", "10.0.1.2");
      const altCode = await (await request("/api/wechat/bind-code", { cookie: second.cookie })).json() as { code: string };
      expect(await sendWechatText("openid-wendy", altCode.code)).toContain("Wendy");
      const alt = await (await request("/api/me", { cookie: second.cookie })).json() as { user: PublicAccount };
      expect(alt.user.subscribed).toBe(false);

      // 换一个微信就能给这个号领。
      expect(await sendWechatText("openid-other", altCode.code)).toContain("领取成功");
      expect(await sendWechatText("openid-other", "续费")).toContain("gulugagame.com");
    } finally {
      delete process.env.WECHAT_TOKEN;
      delete process.env.WECHAT_TRIAL;
    }
  });

  it("lets the admin delete an account: logged out at once, its WeChat can't claim again, the name is free", async () => {
    process.env.WECHAT_TOKEN = wechatToken;
    process.env.WECHAT_TRIAL = "on";
    try {
      const { cookie } = await registerUser("Doomed", "10.0.2.1");
      const bind = await (await request("/api/wechat/bind-code", { cookie })).json() as { code: string };
      expect(await sendWechatText("openid-doomed", bind.code)).toContain("领取成功");
      expect((await checkAuth(cookie)).status).toBe(200);

      expect((await request("/api/admin/delete-account", { method: "POST", body: { username: "Doomed" } })).status).toBe(401);
      const deleted = await request("/api/admin/delete-account", { method: "POST", body: { username: "doomed" }, token: adminToken });
      expect(deleted.status).toBe(200);
      expect(((await deleted.json()) as { account: PublicAccount }).account.username).toBe("Doomed");
      expect((await request("/api/admin/delete-account", { method: "POST", body: { username: "Doomed" }, token: adminToken })).status).toBe(400);

      const me = await (await request("/api/me", { cookie })).json() as { user: PublicAccount | null };
      expect(me.user).toBeNull();
      const gate = await checkAuth(cookie);
      expect(gate.status).toBe(302);
      expect(gate.headers.get("location")).toContain("gate=login");
      const accounts = await (await request("/api/admin/accounts", { token: adminToken })).json() as { accounts: PublicAccount[] };
      expect(accounts.accounts.some((account) => account.username === "Doomed")).toBe(false);

      // 删号再注册，不能拿同一个微信再领一次。
      const again = await registerUser("Doomed", "10.0.2.2");
      const code = await (await request("/api/wechat/bind-code", { cookie: again.cookie })).json() as { code: string };
      expect(await sendWechatText("openid-doomed", code.code)).toContain("每个微信只能领一次");
      const fresh = await (await request("/api/me", { cookie: again.cookie })).json() as { user: PublicAccount };
      expect(fresh.user.subscribed).toBe(false);
    } finally {
      delete process.env.WECHAT_TOKEN;
      delete process.env.WECHAT_TRIAL;
    }
  });

  it("lists every game's rooms and force-closes one through the game server", async () => {
    const { Server } = await import("socket.io");
    const { createServer } = await import("node:http");
    const { GAME_SERVERS } = await import("../server/rooms.js");
    const rooms = [
      { id: "ROOM01", status: "playing", capacity: 4, spectators: 1, players: [{ name: "甲", connected: true }, { name: "乙", connected: false }] },
    ];
    const dissolved: Array<{ roomId: string; token: string }> = [];
    const fakeHttp = createServer();
    const fake = new Server(fakeHttp);
    fake.on("connection", (socket) => {
      socket.on("lobby:get", (ack: (response: unknown) => void) => ack({ ok: true, data: rooms }));
      socket.on("admin:dissolve", (payload: { roomId: string; token: string }, ack: (response: unknown) => void) => {
        if (payload.token !== adminToken) return ack({ ok: false, error: "管理员口令不正确。" });
        if (!rooms.some((room) => room.id === payload.roomId)) return ack({ ok: false, error: "这个房间已经不存在。" });
        dissolved.push(payload);
        rooms.splice(0, rooms.length);
        ack({ ok: true, data: undefined });
      });
    });
    await new Promise<void>((resolve) => fakeHttp.listen(0, "127.0.0.1", resolve));
    const fakePort = (fakeHttp.address() as AddressInfo).port;
    // 宝石商人指到假服务端，其他游戏指到没人监听的端口（马上连不上）。
    process.env.GAME_SERVER_PORTS = GAME_SERVERS.map((game) => `${game.id}=${game.id === "gem" ? fakePort : 1}`).join(",");
    try {
      expect((await request("/api/admin/rooms")).status).toBe(401);
      const listed = await (await request("/api/admin/rooms", { token: adminToken })).json() as { games: AdminGameRooms[] };
      expect(listed.games).toHaveLength(GAME_SERVERS.length);
      const gem = listed.games.find((game) => game.game === "gem")!;
      expect(gem.error).toBeNull();
      expect(gem.rooms).toEqual([rooms[0]]);
      expect(listed.games.find((game) => game.game === "camel")!.error).toBeTruthy();

      expect((await request("/api/admin/rooms/dissolve", { method: "POST", body: { game: "gem", roomId: "ROOM01" } })).status).toBe(401);
      const closed = await request("/api/admin/rooms/dissolve", { method: "POST", body: { game: "gem", roomId: "ROOM01" }, token: adminToken });
      expect(closed.status).toBe(200);
      expect(dissolved).toEqual([{ roomId: "ROOM01", token: adminToken }]);
      const gone = await request("/api/admin/rooms/dissolve", { method: "POST", body: { game: "gem", roomId: "ROOM01" }, token: adminToken });
      expect(gone.status).toBe(400);
      expect(((await gone.json()) as { error: string }).error).toContain("不存在");
      expect((await request("/api/admin/rooms/dissolve", { method: "POST", body: { game: "nope", roomId: "X" }, token: adminToken })).status).toBe(400);
    } finally {
      delete process.env.GAME_SERVER_PORTS;
      await new Promise<void>((resolve) => fake.close(() => resolve()));
    }
  });

  it("limits how many browsers an account can stay logged in on, kicking the oldest one out of the games", async () => {
    const { Server } = await import("socket.io");
    const { createServer } = await import("node:http");
    const { GAME_SERVERS } = await import("../server/rooms.js");
    const kicks: string[] = [];
    const fakeHttp = createServer();
    const fake = new Server(fakeHttp);
    fake.on("connection", (socket) => {
      socket.on("admin:kick-session", (payload: { sessionId: string; token: string }, ack: (response: unknown) => void) => {
        if (payload.token !== adminToken) return ack({ ok: false, error: "管理员口令不正确。" });
        kicks.push(payload.sessionId);
        ack({ ok: true, data: 1 });
      });
    });
    await new Promise<void>((resolve) => fakeHttp.listen(0, "127.0.0.1", resolve));
    const fakePort = (fakeHttp.address() as AddressInfo).port;
    process.env.GAME_SERVER_PORTS = GAME_SERVERS.map((game) => `${game.id}=${game.id === "gem" ? fakePort : 1}`).join(",");
    const login = async (cookie: string | null = null) => {
      const response = await request("/api/login", { method: "POST", body: { username: "Juggler", password: "secret12" }, cookie });
      expect(response.status).toBe(200);
      return sessionCookie(response)!;
    };
    const sessionIdOf = async (cookie: string) => {
      const ok = await checkAuth(cookie);
      expect(ok.status).toBe(200);
      return ok.headers.get("x-gc-session")!;
    };
    const waitForKicks = async (count: number) => {
      for (let i = 0; i < 50 && kicks.length < count; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    };
    try {
      const first = (await registerUser("Juggler", "10.0.3.1")).cookie;
      const firstId = await sessionIdOf(first);
      expect(firstId).toMatch(/^[0-9a-f]{16}$/);
      const second = await login();
      // 同一个浏览器再登录一次：替换自己原来的登录，不挤别人。
      const secondAgain = await login(second);
      expect((await request("/api/me", { cookie: first })).status).toBe(200);
      expect(((await (await request("/api/me", { cookie: first })).json()) as { user: PublicAccount | null }).user?.activeSessions).toBe(2);
      expect(kicks).toEqual([]);

      // 第三个浏览器：最早的 first 被挤掉，游戏收到它的编号。
      const third = await login();
      const me = await (await request("/api/me", { cookie: first })).json() as { user: PublicAccount | null; kicked: boolean };
      expect(me.user).toBeNull();
      expect(me.kicked).toBe(true);
      const gate = await checkAuth(first);
      expect(gate.status).toBe(302);
      expect(gate.headers.get("location")).toContain("gate=kicked");
      await waitForKicks(1);
      expect(kicks).toEqual([firstId]);
      expect((await checkAuth(secondAgain)).status).toBe(200);
      expect((await checkAuth(third)).status).toBe(200);

      // 管理员给这个号放宽到 3 个：再登录不挤。
      expect((await request("/api/admin/max-sessions", { method: "POST", body: { username: "Juggler", max: 3 } })).status).toBe(401);
      expect((await request("/api/admin/max-sessions", { method: "POST", body: { username: "Juggler", max: 0 }, token: adminToken })).status).toBe(400);
      const raised = await request("/api/admin/max-sessions", { method: "POST", body: { username: "Juggler", max: 3 }, token: adminToken });
      expect(((await raised.json()) as { account: PublicAccount }).account.maxSessions).toBe(3);
      const fourth = await login();
      for (const cookie of [secondAgain, third, fourth]) expect((await checkAuth(cookie)).status).toBe(200);

      // 调回 1 个：立刻只留最新的。
      const secondId = await sessionIdOf(secondAgain);
      const thirdId = await sessionIdOf(third);
      const lowered = await request("/api/admin/max-sessions", { method: "POST", body: { username: "Juggler", max: 1 }, token: adminToken });
      expect(((await lowered.json()) as { account: PublicAccount }).account.activeSessions).toBe(1);
      expect((await checkAuth(fourth)).status).toBe(200);
      expect((await checkAuth(secondAgain)).headers.get("location")).toContain("gate=kicked");
      await waitForKicks(3);
      expect(kicks.slice(1).sort()).toEqual([secondId, thirdId].sort());
    } finally {
      delete process.env.GAME_SERVER_PORTS;
      await new Promise<void>((resolve) => fake.close(() => resolve()));
    }
  });
});
