import type { IncomingMessage, ServerResponse } from "node:http";
import {
  currentUser,
  destroySession,
  extendSubscription,
  generateCodes,
  listAccounts,
  login,
  redeem,
  register,
  resetPassword,
} from "./accounts.js";
import { verifyAdminToken } from "./admin-token.js";
import { createOrder, findOrder, fulfilOrder, listOrders, toPublicOrder } from "./orders.js";
import { activeProvider } from "./payments.js";
import { clientIp, RateLimiter } from "./rate-limit.js";

const SESSION_COOKIE = "gc_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const MAX_BODY_BYTES = 16 * 1024;
const HOUR_MS = 60 * 60 * 1000;
const TOO_MANY = "操作太频繁了，请稍后再试。";

// 每个 IP 一天最多注册 5 个号（试用期不被反复白嫖）；登录、兑换输错和下单也各自限次。
const registerLimiter = new RateLimiter(5, 24 * HOUR_MS);
const loginFailureLimiter = new RateLimiter(10, HOUR_MS / 4);
const redeemFailureLimiter = new RateLimiter(10, HOUR_MS);
const orderLimiter = new RateLimiter(20, HOUR_MS);

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    request.on("data", (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(new Error("请求体过大。"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (failed) return;
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("请求体不是合法的 JSON。"));
      }
    });
    request.on("error", reject);
  });
}

function getCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) result[name] = value;
  }
  return result;
}

function sessionToken(request: IncomingMessage): string | null {
  return getCookies(request)[SESSION_COOKIE] ?? null;
}

function setSessionCookie(request: IncomingMessage, response: ServerResponse, token: string | null): void {
  const secure = request.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  const parts = [
    `${SESSION_COOKIE}=${token ?? ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${token ? SESSION_MAX_AGE_SECONDS : 0}`,
  ];
  if (secure) parts.push("Secure");
  response.setHeader("Set-Cookie", parts.join("; "));
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function requireAdmin(request: IncomingMessage, response: ServerResponse): boolean {
  if (verifyAdminToken(request.headers["x-admin-token"])) return true;
  sendJson(response, 401, { error: "管理员口令不正确。" });
  return false;
}

/**
 * Caddy forward_auth 的网关检查：订阅有效返回 200；否则打开网页的 302 回大厅（带上原因和想去的游戏），
 * 其他请求（socket.io、图片等）直接 401。
 */
function handleAuthCheck(request: IncomingMessage, response: ServerResponse): void {
  const user = currentUser(sessionToken(request));
  if (user && user.subscribed) {
    response.writeHead(200, { "cache-control": "no-store" });
    response.end("ok");
    return;
  }
  const originalUri = request.headers["x-forwarded-uri"];
  const accept = request.headers.accept ?? "";
  if (request.headers.upgrade || !accept.includes("text/html")) {
    response.writeHead(401, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("未登录或订阅已到期");
    return;
  }
  const params = new URLSearchParams({ gate: user ? "expired" : "login" });
  const game = typeof originalUri === "string" ? /^\/([a-z-]+)\//.exec(originalUri)?.[1] : undefined;
  if (game) params.set("next", game);
  response.writeHead(302, { location: `/?${params.toString()}`, "cache-control": "no-store" });
  response.end();
}

/** 处理 /api/* 请求；返回是否命中（非 /api 路径返回 false，交给上层回 404）。 */
export async function handleApiRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = url.pathname;
  if (!path.startsWith("/api/")) return false;
  const method = request.method ?? "GET";

  try {
    if (method === "GET" && path === "/api/me") {
      sendJson(response, 200, { user: currentUser(sessionToken(request)) });
      return true;
    }

    if (method === "GET" && path === "/api/auth/check") {
      handleAuthCheck(request, response);
      return true;
    }

    if (method === "POST" && path === "/api/register") {
      const ip = clientIp(request);
      if (registerLimiter.isLimited(ip)) {
        sendJson(response, 429, { error: "这个网络今天注册的账号太多了，请明天再试。" });
        return true;
      }
      const body = await readBody(request) as { username?: unknown; password?: unknown };
      const result = register(body.username, body.password);
      if (!result.ok) {
        sendJson(response, 400, { error: result.error });
        return true;
      }
      registerLimiter.hit(ip);
      setSessionCookie(request, response, result.token);
      sendJson(response, 200, { user: result.user });
      return true;
    }

    if (method === "POST" && path === "/api/login") {
      const body = await readBody(request) as { username?: unknown; password?: unknown };
      const ipKey = `ip:${clientIp(request)}`;
      const userKey = `user:${typeof body.username === "string" ? body.username.trim().toLowerCase() : ""}`;
      if (loginFailureLimiter.isLimited(ipKey) || loginFailureLimiter.isLimited(userKey)) {
        sendJson(response, 429, { error: "密码输错次数太多，请 15 分钟后再试。" });
        return true;
      }
      const result = login(body.username, body.password);
      if (!result.ok) {
        loginFailureLimiter.hit(ipKey);
        loginFailureLimiter.hit(userKey);
        sendJson(response, 400, { error: result.error });
        return true;
      }
      setSessionCookie(request, response, result.token);
      sendJson(response, 200, { user: result.user });
      return true;
    }

    if (method === "POST" && path === "/api/logout") {
      destroySession(sessionToken(request));
      setSessionCookie(request, response, null);
      sendJson(response, 200, { ok: true });
      return true;
    }

    if (method === "POST" && path === "/api/redeem") {
      const user = currentUser(sessionToken(request));
      if (!user) {
        sendJson(response, 401, { error: "请先登录。" });
        return true;
      }
      if (redeemFailureLimiter.isLimited(user.username)) {
        sendJson(response, 429, { error: TOO_MANY });
        return true;
      }
      const body = await readBody(request) as { code?: unknown };
      const result = redeem(user.username, body.code);
      if (!result.ok) {
        redeemFailureLimiter.hit(user.username);
        sendJson(response, 400, { error: result.error });
        return true;
      }
      sendJson(response, 200, { user: result.user });
      return true;
    }

    if (method === "GET" && path === "/api/pay/config") {
      const provider = activeProvider();
      sendJson(response, 200, { enabled: provider !== null, label: provider?.label ?? null });
      return true;
    }

    if (method === "POST" && path === "/api/orders") {
      const user = currentUser(sessionToken(request));
      if (!user) {
        sendJson(response, 401, { error: "请先登录。" });
        return true;
      }
      const provider = activeProvider();
      if (!provider) {
        sendJson(response, 503, { error: "在线支付暂未开通，请先用兑换码开通。" });
        return true;
      }
      if (orderLimiter.isLimited(user.username)) {
        sendJson(response, 429, { error: TOO_MANY });
        return true;
      }
      orderLimiter.hit(user.username);
      const body = await readBody(request) as { months?: unknown };
      const created = createOrder(user.username, body.months, provider.id);
      if (!created.ok) {
        sendJson(response, 400, { error: created.error });
        return true;
      }
      const checkout = await provider.createCheckout(created.order);
      sendJson(response, 200, { order: toPublicOrder(created.order), checkout });
      return true;
    }

    const orderMatch = /^\/api\/orders\/([A-Za-z0-9-]+)$/.exec(path);
    if (method === "GET" && orderMatch) {
      const user = currentUser(sessionToken(request));
      const order = findOrder(orderMatch[1]);
      // 只能查自己的订单；查不到和不是自己的都回 404。
      if (!user || !order || order.username !== user.username) {
        sendJson(response, 404, { error: "订单不存在。" });
        return true;
      }
      sendJson(response, 200, { order: toPublicOrder(order), user });
      return true;
    }

    const payMatch = /^\/api\/pay\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(path);
    if (payMatch) {
      const provider = activeProvider();
      if (provider && provider.id === payMatch[1] && await provider.handleRequest(payMatch[2]!, request, response)) {
        return true;
      }
      sendJson(response, 404, { error: "接口不存在。" });
      return true;
    }

    if (method === "GET" && path === "/api/admin/orders") {
      if (!requireAdmin(request, response)) return true;
      sendJson(response, 200, { orders: listOrders() });
      return true;
    }

    if (method === "POST" && path === "/api/admin/orders/mark-paid") {
      if (!requireAdmin(request, response)) return true;
      const body = await readBody(request) as { id?: unknown };
      const order = findOrder(body.id);
      if (!order) {
        sendJson(response, 404, { error: "订单不存在。" });
        return true;
      }
      // 渠道回调没到、但确认已收到钱时，管理员手动补单。
      const result = fulfilOrder(order.id, "manual", order.amountFen);
      if (!result.ok) {
        sendJson(response, 400, { error: result.error });
        return true;
      }
      sendJson(response, 200, { order: toPublicOrder(result.order) });
      return true;
    }

    if (method === "GET" && path === "/api/admin/accounts") {
      if (!requireAdmin(request, response)) return true;
      sendJson(response, 200, { accounts: listAccounts() });
      return true;
    }

    if (method === "POST" && path === "/api/admin/extend") {
      if (!requireAdmin(request, response)) return true;
      const body = await readBody(request) as { username?: unknown; months?: unknown };
      const result = extendSubscription(body.username, body.months);
      if (!result.ok) {
        sendJson(response, 400, { error: result.error });
        return true;
      }
      sendJson(response, 200, { account: result.account });
      return true;
    }

    if (method === "POST" && path === "/api/admin/code") {
      if (!requireAdmin(request, response)) return true;
      const body = await readBody(request) as { months?: unknown; count?: unknown };
      const result = generateCodes(body.months, body.count ?? 1);
      if (!result.ok) {
        sendJson(response, 400, { error: result.error });
        return true;
      }
      sendJson(response, 200, { codes: result.codes });
      return true;
    }

    if (method === "POST" && path === "/api/admin/reset-password") {
      if (!requireAdmin(request, response)) return true;
      const body = await readBody(request) as { username?: unknown; password?: unknown };
      const result = resetPassword(body.username, body.password);
      if (!result.ok) {
        sendJson(response, 400, { error: result.error });
        return true;
      }
      sendJson(response, 200, { account: result.account });
      return true;
    }

    sendJson(response, 404, { error: "接口不存在。" });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : "请求失败。" });
  }
  return true;
}
