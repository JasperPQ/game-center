import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PublicAccount, PublicOrder } from "../shared/types.js";
import type { AfdianOrder } from "../server/afdian.js";

const AFDIAN_USER = "creator-1";
const AFDIAN_TOKEN = "afdian-test-token";
const AFDIAN_PLAN = "plan-5-yuan";
const ENV_KEYS = [
  "ACCOUNTS_FILE", "CODES_FILE", "SESSIONS_FILE", "ORDERS_FILE",
  "PAY_PROVIDER", "AFDIAN_USER_ID", "AFDIAN_TOKEN", "AFDIAN_PLAN_ID", "AFDIAN_BASE",
] as const;
const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

let serverUrl = "";
let httpServer: typeof import("../server/index.js").httpServer;
let serverIo: typeof import("../server/index.js").io;
let temporaryDirectory = "";

/** 假的爱发电开放 API：核对签名，按 out_trade_no 或整页返回 afdianOrders。 */
let fakeAfdian: Server;
let afdianOrders: AfdianOrder[] = [];
let afdianCalls: Array<{ path: string; params: Record<string, unknown> }> = [];

function startFakeAfdian(): Promise<string> {
  fakeAfdian = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        user_id: string; params: string; ts: number; sign: string;
      };
      const expected = createHash("md5")
        .update(`${AFDIAN_TOKEN}params${body.params}ts${body.ts}user_id${body.user_id}`)
        .digest("hex");
      response.writeHead(200, { "content-type": "application/json" });
      if (body.user_id !== AFDIAN_USER || body.sign !== expected) {
        response.end(JSON.stringify({ ec: 400005, em: "sign validation failed" }));
        return;
      }
      const params = JSON.parse(body.params) as Record<string, unknown>;
      afdianCalls.push({ path: request.url ?? "", params });
      const list = typeof params.out_trade_no === "string"
        ? afdianOrders.filter((order) => order.out_trade_no === params.out_trade_no)
        : [...afdianOrders].reverse();
      response.end(JSON.stringify({ ec: 200, em: "ok", data: { list, total_count: list.length, total_page: 1 } }));
    });
  });
  return new Promise((resolve) => {
    fakeAfdian.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(fakeAfdian.address() as AddressInfo).port}`));
  });
}

function request(path: string, options: { method?: string; body?: unknown; cookie?: string; ip?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  headers["X-Forwarded-For"] = options.ip ?? "10.1.0.1";
  const init: RequestInit = { method: options.method ?? "GET", headers, redirect: "manual" };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  return fetch(`${serverUrl}${path}`, init);
}

async function registerUser(username: string): Promise<{ user: PublicAccount; cookie: string }> {
  const response = await request("/api/register", {
    method: "POST",
    body: { username, password: "secret12" },
    ip: `10.1.0.${username.length}${username.charCodeAt(0)}`,
  });
  expect(response.status).toBe(200);
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0]!;
  return { user: ((await response.json()) as { user: PublicAccount }).user, cookie };
}

async function placeOrder(cookie: string, months: number): Promise<{ order: PublicOrder; url: string }> {
  const response = await request("/api/orders", { method: "POST", body: { months }, cookie });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { order: PublicOrder; checkout: { url: string } };
  return { order: body.order, url: body.checkout.url };
}

function afdianOrder(customOrderId: string, overrides: Partial<AfdianOrder> = {}): AfdianOrder {
  return {
    out_trade_no: `T${Math.random().toString().slice(2, 12)}`,
    custom_order_id: customOrderId,
    plan_id: AFDIAN_PLAN,
    month: 1,
    total_amount: "5.00",
    status: 2,
    ...overrides,
  };
}

function webhook(order: Partial<AfdianOrder>) {
  return request("/api/pay/afdian/webhook", {
    method: "POST",
    body: { ec: 200, em: "ok", data: { type: "order", order } },
  });
}

async function orderStatus(id: string, cookie: string): Promise<{ order: PublicOrder; user: PublicAccount }> {
  return (await (await request(`/api/orders/${id}`, { cookie })).json()) as { order: PublicOrder; user: PublicAccount };
}

/** 跳过对账节流（两次翻单至少隔 5 秒）。每次都比上次拨得更远，测试之间恢复真实时钟也不会退回去。 */
let clockOffset = 0;
function skipSyncThrottle(): void {
  clockOffset += 6_000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + clockOffset);
}

describe("爱发电收款", () => {
  beforeAll(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "game-center-afdian-"));
    process.env.ACCOUNTS_FILE = join(temporaryDirectory, "accounts.json");
    process.env.CODES_FILE = join(temporaryDirectory, "codes.json");
    process.env.SESSIONS_FILE = join(temporaryDirectory, "sessions.json");
    process.env.ORDERS_FILE = join(temporaryDirectory, "orders.json");
    process.env.PAY_PROVIDER = "afdian";
    process.env.AFDIAN_USER_ID = AFDIAN_USER;
    process.env.AFDIAN_TOKEN = AFDIAN_TOKEN;
    process.env.AFDIAN_PLAN_ID = AFDIAN_PLAN;
    process.env.AFDIAN_BASE = await startFakeAfdian();
    const serverModule = await import("../server/index.js");
    httpServer = serverModule.httpServer;
    serverIo = serverModule.io;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    serverUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => serverIo.close(() => resolve()));
    await new Promise<void>((resolve) => fakeAfdian.close(() => resolve()));
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("signs API calls the way the afdian docs show", async () => {
    const { afdianSign } = await import("../server/afdian.js");
    expect(afdianSign("123", "{\"a\":333}", 1624339905, "abc")).toBe("a4acc28b81598b7e5d84ebdc3e91710c");
  });

  it("sends the player to the plan page with the month count and our order id", async () => {
    expect(await (await request("/api/pay/config")).json()).toEqual({ enabled: true, label: "爱发电" });
    const { cookie } = await registerUser("Ann");
    const { order, url } = await placeOrder(cookie, 3);
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(`${process.env.AFDIAN_BASE}/order/create`);
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      plan_id: AFDIAN_PLAN,
      product_type: "0",
      month: "3",
      custom_order_id: order.id,
    });
  });

  it("settles a webhook only after confirming the order with the API", async () => {
    const { user, cookie } = await registerUser("Ben");
    const { order } = await placeOrder(cookie, 3);
    const paid = afdianOrder(order.id, { month: 3, total_amount: "15.00" });
    afdianOrders.push(paid);

    // 通知里的金额是伪造的也没关系：以回查 API 的结果为准。
    const response = await webhook({ ...paid, total_amount: "999.00" });
    expect(await response.json()).toEqual({ ec: 200, em: "" });
    expect(afdianCalls.at(-1)?.params).toEqual({ out_trade_no: paid.out_trade_no });

    const status = await orderStatus(order.id, cookie);
    expect(status.order.status).toBe("paid");
    expect(status.user.paid).toBe(true);
    const expected = new Date(user.expiresAt!);
    expected.setMonth(expected.getMonth() + 3);
    expect(Math.abs(Date.parse(status.user.expiresAt!) - expected.getTime())).toBeLessThan(5_000);

    // 重推同一个通知不重复加时长。
    await webhook(paid);
    expect((await orderStatus(order.id, cookie)).user.expiresAt).toBe(status.user.expiresAt);
  });

  it("ignores forged, underpaid, unpaid and other-plan orders", async () => {
    const { cookie } = await registerUser("Cat");
    const { order } = await placeOrder(cookie, 3);

    // 爱发电那边查不到的订单号（伪造通知，或保存 Webhook 地址时的测试通知）。
    const forged = await webhook(afdianOrder(order.id, { out_trade_no: "NOT-REAL", total_amount: "15.00" }));
    expect(await forged.json()).toEqual({ ec: 200, em: "" });

    const underpaid = afdianOrder(order.id, { month: 1, total_amount: "5.00" });
    const unpaid = afdianOrder(order.id, { month: 3, total_amount: "15.00", status: 1 });
    const otherPlan = afdianOrder(order.id, { month: 3, total_amount: "15.00", plan_id: "someone-else" });
    afdianOrders.push(underpaid, unpaid, otherPlan);
    for (const candidate of [underpaid, unpaid, otherPlan]) await webhook(candidate);

    skipSyncThrottle();
    expect((await orderStatus(order.id, cookie)).order.status).toBe("pending");
  });

  it("finds a payment without any webhook when the player comes back to check", async () => {
    const { cookie } = await registerUser("Dan");
    const { order } = await placeOrder(cookie, 1);
    afdianOrders.push(afdianOrder(order.id));

    skipSyncThrottle();
    const status = await orderStatus(order.id, cookie);
    expect(afdianCalls.at(-1)?.params).toEqual({ page: 1 });
    expect(status.order.status).toBe("paid");
    expect(status.user.trial).toBe(false);
  });

  it("turns online payment off when the afdian settings are incomplete", async () => {
    delete process.env.AFDIAN_TOKEN;
    try {
      expect(await (await request("/api/pay/config")).json()).toEqual({ enabled: false, label: null });
      const { cookie } = await registerUser("Eve");
      expect((await request("/api/orders", { method: "POST", body: { months: 1 }, cookie })).status).toBe(503);
    } finally {
      process.env.AFDIAN_TOKEN = AFDIAN_TOKEN;
    }
  });
});
