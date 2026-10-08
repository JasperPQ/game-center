import { io, type Socket } from "socket.io-client";
import type { AdminGameRooms, AdminRoom } from "../shared/types.js";

/**
 * 管理员看所有游戏的房间、强制关闭房间。游戏中心的服务端在服务器内部直接连各游戏的端口
 * （不经过 Caddy 的门禁），用各游戏都有的 lobby:get 列房间、admin:dissolve 解散房间，
 * 口令用同一个 ADMIN_TOKEN。新游戏上线后在这里加一行。
 */
export const GAME_SERVERS: ReadonlyArray<{ id: string; name: string; port: number }> = [
  { id: "gem", name: "宝石商人", port: 3001 },
  { id: "guandan", name: "掼蛋", port: 3002 },
  { id: "poker", name: "德州扑克", port: 3003 },
  { id: "jingmai", name: "晶脉", port: 3004 },
  { id: "camel", name: "沙丘赛驼", port: 3005 },
  { id: "azul", name: "花砖物语", port: 3006 },
  { id: "ttr", name: "车票之旅", port: 3007 },
  { id: "cantstop", name: "欲罢不能", port: 3008 },
  { id: "lucky", name: "幸运数字", port: 3009 },
  { id: "flip7", name: "翻七", port: 3010 },
  { id: "seasalt", name: "海盐与纸", port: 3011 },
];

const TIMEOUT_MS = 4000;

/** 测试时可以用 GAME_SERVER_HOST / GAME_SERVER_PORTS（"gem=4001,camel=4005"）指到别的地址。 */
function serverUrl(game: { id: string; port: number }): string {
  const overrides = new Map(
    (process.env.GAME_SERVER_PORTS ?? "").split(",").map((pair) => pair.split("=")).filter((pair) => pair.length === 2) as [string, string][],
  );
  return `http://${process.env.GAME_SERVER_HOST ?? "127.0.0.1"}:${overrides.get(game.id) ?? game.port}`;
}

type Ack = { ok: true; data?: unknown } | { ok: false; error: string };

/** 连上一个游戏服务端，发一个带回执的事件，拿到回执就断开。 */
function call(game: { id: string; port: number }, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve) => {
    const socket: Socket = io(serverUrl(game), { transports: ["websocket"], reconnection: false, timeout: TIMEOUT_MS });
    const timer = setTimeout(() => finish({ ok: false, error: "连接超时（这个游戏的服务可能没在运行）。" }), TIMEOUT_MS);
    function finish(result: Ack) {
      clearTimeout(timer);
      socket.close();
      resolve(result);
    }
    socket.on("connect_error", () => finish({ ok: false, error: "连不上这个游戏的服务。" }));
    socket.on("connect", () => socket.emit(event, ...args, (response: Ack) => finish(response ?? { ok: false, error: "没有回应。" })));
  });
}

function toRoom(value: unknown): AdminRoom | null {
  if (!value || typeof value !== "object") return null;
  const room = value as Record<string, unknown>;
  if (typeof room.id !== "string") return null;
  const players = Array.isArray(room.players) ? room.players as Array<Record<string, unknown>> : [];
  return {
    id: room.id,
    status: typeof room.status === "string" ? room.status : "unknown",
    capacity: typeof room.capacity === "number" ? room.capacity : null,
    spectators: typeof room.spectators === "number" ? room.spectators : 0,
    players: players.map((player) => ({
      name: typeof player.name === "string" ? player.name : "?",
      connected: player.connected !== false,
    })),
  };
}

export async function listAllRooms(): Promise<AdminGameRooms[]> {
  return Promise.all(GAME_SERVERS.map(async (game) => {
    const response = await call(game, "lobby:get");
    if (!response.ok) return { game: game.id, name: game.name, rooms: [], error: response.error };
    const rooms = Array.isArray(response.data) ? response.data.map(toRoom).filter((room): room is AdminRoom => room !== null) : [];
    return { game: game.id, name: game.name, rooms, error: null };
  }));
}

export async function dissolveGameRoom(gameId: unknown, roomId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const game = GAME_SERVERS.find((candidate) => candidate.id === gameId);
  if (!game) return { ok: false, error: "没有这个游戏。" };
  if (typeof roomId !== "string" || !roomId || roomId.length > 64) return { ok: false, error: "房间不正确。" };
  const token = process.env.ADMIN_TOKEN;
  if (!token) return { ok: false, error: "服务器没配置 ADMIN_TOKEN。" };
  const response = await call(game, "admin:dissolve", { roomId, token });
  return response.ok ? { ok: true } : { ok: false, error: response.error };
}
