import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  DeleteGuestbookEntry,
  GuestbookEntry,
  PinEntry,
  ServerToClientEvents,
  SubmitGuestbookEntry,
} from "../shared/types.js";
import { adminTokenHash, verifyAdminToken } from "./admin-token.js";
import { readBody } from "./body.js";
import { handleApiRequest } from "./http.js";
import { clientIp, RateLimiter } from "./rate-limit.js";
import { GAME_SERVERS } from "./rooms.js";
import { startPaymentSync } from "./payments.js";
import { registerWishHandlers } from "./wishes.js";

const GUESTBOOK_LIMIT = 200;
const GUESTBOOK_RATE_LIMIT_MS = 10_000;
const ADMIN_RETRY_DELAY_MS = 2_000;
const guestbookPostTimes = new Map<string, number>();
// 悬浮窗走 HTTP，按 IP 限频：10 秒 1 条、1 小时 20 条。
const guestbookIpBurst = new RateLimiter(1, GUESTBOOK_RATE_LIMIT_MS);
const guestbookIpHourly = new RateLimiter(20, 60 * 60 * 1000);
const adminFailureTimes = new Map<string, number>();

const guestbookPath = process.env.GUESTBOOK_FILE
  ?? fileURLToPath(new URL("../data/guestbook.json", import.meta.url));

function loadGuestbook(): GuestbookEntry[] {
  if (!existsSync(guestbookPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(guestbookPath, "utf8")) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter((entry): entry is GuestbookEntry =>
      Boolean(entry)
      && typeof entry === "object"
      && typeof entry.id === "string"
      && typeof entry.name === "string"
      && typeof entry.message === "string"
      && typeof entry.createdAt === "string"
      && (entry.pinnedAt === undefined || typeof entry.pinnedAt === "string")
      && (entry.source === undefined || typeof entry.source === "string"),
    );
  } catch {
    return [];
  }
}

/** 超过上限时从最早的未置顶留言删起，置顶的不会被挤掉。 */
function trimGuestbook(entries: GuestbookEntry[]): GuestbookEntry[] {
  let excess = entries.length - GUESTBOOK_LIMIT;
  if (excess <= 0) return entries;
  return entries.filter((entry) => entry.pinnedAt !== undefined || excess-- <= 0);
}

let guestbookEntries = trimGuestbook(loadGuestbook());

/** 置顶的在最上面（越晚置顶越靠前），其余从新到旧。 */
function getGuestbookEntries(): GuestbookEntry[] {
  const newestFirst = [...guestbookEntries].reverse().map((entry) => ({ ...entry }));
  const pinned = newestFirst
    .filter((entry) => entry.pinnedAt !== undefined)
    .sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? ""));
  return [...pinned, ...newestFirst.filter((entry) => entry.pinnedAt === undefined)];
}

function saveGuestbook(): void {
  mkdirSync(dirname(guestbookPath), { recursive: true });
  const temporaryPath = `${guestbookPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ entries: guestbookEntries }, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, guestbookPath);
}

function checkAdminToken(socketId: string, token: unknown): string | null {
  if (!adminTokenHash) return "管理功能未启用。";
  const now = Date.now();
  if (now - (adminFailureTimes.get(socketId) ?? 0) < ADMIN_RETRY_DELAY_MS) {
    return "尝试太频繁了，请稍后再试。";
  }
  if (!verifyAdminToken(token)) {
    adminFailureTimes.set(socketId, now);
    return "管理员口令不正确。";
  }
  return null;
}

function normalizeGuestName(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "游客";
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 18 ? name : null;
}

function normalizeGuestMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  return message.length >= 2 && message.length <= 280 ? message : null;
}

/** 新增一条留言并广播给所有大厅页面。source 是游戏路径（「doudizhu」），换成中文名存下来。 */
function addGuestbookEntry(rawName: unknown, rawMessage: unknown, source: string | null):
  { ok: true; data: GuestbookEntry[] } | { ok: false; error: string } {
  const name = normalizeGuestName(rawName);
  if (!name) return { ok: false, error: "昵称最多 18 个字符。" };
  const message = normalizeGuestMessage(rawMessage);
  if (!message) return { ok: false, error: "留言需为 2–280 个字符。" };

  const sourceName = source ? GAME_SERVERS.find((game) => game.id === source)?.name : undefined;
  const entry: GuestbookEntry = {
    id: randomUUID(),
    name,
    message,
    createdAt: new Date().toISOString(),
    ...(sourceName ? { source: sourceName } : {}),
  };
  const beforePost = guestbookEntries;
  guestbookEntries = trimGuestbook([...guestbookEntries, entry]);
  try {
    saveGuestbook();
  } catch {
    guestbookEntries = beforePost;
    return { ok: false, error: "留言暂时无法保存，请稍后重试。" };
  }
  const entries = getGuestbookEntries();
  io.emit("guestbook:updated", entries);
  return { ok: true, data: entries };
}

/** POST /api/guestbook：各游戏页面上的「写评价」悬浮窗（public/gc-feedback.js）用。 */
async function handleGuestbookPost(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  };
  const ip = clientIp(request);
  if (guestbookIpBurst.isLimited(ip) || guestbookIpHourly.isLimited(ip)) {
    send(429, { error: "留言太频繁了，请稍后再试。" });
    return;
  }
  let body: { name?: unknown; message?: unknown; source?: unknown };
  try {
    body = (await readBody(request) ?? {}) as typeof body;
  } catch (error) {
    send(400, { error: error instanceof Error ? error.message : "请求失败。" });
    return;
  }
  const source = typeof body.source === "string" && /^[a-z0-9-]{1,32}$/.test(body.source) ? body.source : null;
  const result = addGuestbookEntry(body.name, body.message, source);
  if (!result.ok) {
    send(400, { error: result.error });
    return;
  }
  guestbookIpBurst.hit(ip);
  guestbookIpHourly.hit(ip);
  send(200, { ok: true });
}

export const httpServer = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/guestbook") {
    await handleGuestbookPost(request, response);
    return;
  }
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "game-center-server" }));
    return;
  }
  if (!(await handleApiRequest(request, response))) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

const configuredWebOrigins = new Set(
  (process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN ?? "http://localhost:5175")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return first === 10 || first === 192 && second === 168 || first === 172 && second >= 16 && second <= 31;
}

function isAllowedWebOrigin(origin: string | undefined): boolean {
  if (!origin || configuredWebOrigins.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:"
      && parsed.port === "5175"
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || isPrivateIpv4(parsed.hostname));
  } catch {
    return false;
  }
}

export const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: (origin, callback) => callback(null, isAllowedWebOrigin(origin)),
  },
});

io.on("connection", (socket) => {
  socket.on("guestbook:get", (ack) => {
    ack({ ok: true, data: getGuestbookEntries() });
  });

  socket.on("guestbook:post", (payload: SubmitGuestbookEntry, ack) => {
    const now = Date.now();
    if (now - (guestbookPostTimes.get(socket.id) ?? 0) < GUESTBOOK_RATE_LIMIT_MS) {
      ack({ ok: false, error: "留言太频繁了，请稍后再试。" });
      return;
    }
    const result = addGuestbookEntry(payload?.name, payload?.message, null);
    if (!result.ok) {
      ack(result);
      return;
    }
    guestbookPostTimes.set(socket.id, now);
    ack(result);
  });

  socket.on("admin:verify", (token, ack) => {
    const error = checkAdminToken(socket.id, token);
    ack(error ? { ok: false, error } : { ok: true, data: undefined });
  });

  socket.on("guestbook:delete", (payload: DeleteGuestbookEntry, ack) => {
    const error = checkAdminToken(socket.id, payload?.token);
    if (error) {
      ack({ ok: false, error });
      return;
    }
    const previousEntries = guestbookEntries;
    guestbookEntries = guestbookEntries.filter((entry) => entry.id !== payload.id);
    if (guestbookEntries.length === previousEntries.length) {
      ack({ ok: false, error: "这条留言已不存在。" });
      return;
    }
    try {
      saveGuestbook();
    } catch {
      guestbookEntries = previousEntries;
      ack({ ok: false, error: "删除暂时无法保存，请稍后重试。" });
      return;
    }

    const entries = getGuestbookEntries();
    ack({ ok: true, data: entries });
    io.emit("guestbook:updated", entries);
  });

  socket.on("guestbook:pin", (payload: PinEntry, ack) => {
    const error = checkAdminToken(socket.id, payload?.token);
    if (error) {
      ack({ ok: false, error });
      return;
    }
    const previousEntries = guestbookEntries;
    if (!previousEntries.some((entry) => entry.id === payload.id)) {
      ack({ ok: false, error: "这条留言已不存在。" });
      return;
    }
    const pinnedAt = new Date().toISOString();
    guestbookEntries = previousEntries.map((entry) => {
      if (entry.id !== payload.id) return entry;
      const { pinnedAt: _previous, ...rest } = entry;
      return payload.pinned ? { ...rest, pinnedAt } : rest;
    });
    try {
      saveGuestbook();
    } catch {
      guestbookEntries = previousEntries;
      ack({ ok: false, error: "置顶暂时无法保存，请稍后重试。" });
      return;
    }

    const entries = getGuestbookEntries();
    ack({ ok: true, data: entries });
    io.emit("guestbook:updated", entries);
  });

  registerWishHandlers(io, socket, checkAdminToken);

  socket.on("disconnect", () => {
    guestbookPostTimes.delete(socket.id);
    adminFailureTimes.delete(socket.id);
  });
});

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 3000);
  startPaymentSync();
  httpServer.listen(port, () => {
    console.log(`Game Center server listening on http://localhost:${port}`);
  });
}
