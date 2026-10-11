import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  DeleteGuestbookEntry,
  PinEntry,
  ServerToClientEvents,
  SubmitWish,
  VoteWish,
  Wish,
} from "../shared/types.js";

/** 许愿池：任何人都能许愿、给别人的愿望 +1；管理员能删除和置顶。 */

const WISH_LIMIT = 200;
const WISH_RATE_LIMIT_MS = 10_000;
const VOTE_RATE_LIMIT_MS = 1_000;

/** 存在文件里的愿望多一份投票人编号，发给前端时去掉。 */
interface StoredWish extends Omit<Wish, "votes"> {
  readonly voters: readonly string[];
}

const wishesPath = process.env.WISHES_FILE
  ?? fileURLToPath(new URL("../data/wishes.json", import.meta.url));

function loadWishes(): StoredWish[] {
  if (!existsSync(wishesPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(wishesPath, "utf8")) as { wishes?: unknown };
    if (!Array.isArray(parsed.wishes)) return [];
    return parsed.wishes.filter((wish): wish is StoredWish =>
      Boolean(wish)
      && typeof wish === "object"
      && typeof wish.id === "string"
      && typeof wish.name === "string"
      && typeof wish.game === "string"
      && typeof wish.note === "string"
      && typeof wish.createdAt === "string"
      && Array.isArray(wish.voters)
      && (wish.pinnedAt === undefined || typeof wish.pinnedAt === "string"),
    );
  } catch {
    return [];
  }
}

function saveWishes(): void {
  mkdirSync(dirname(wishesPath), { recursive: true });
  const temporaryPath = `${wishesPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ wishes }, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, wishesPath);
}

/** 置顶的在最上面（越晚置顶越靠前），其余按票数从多到少，同票的新的在前。 */
function compareWishes(a: StoredWish, b: StoredWish): number {
  if (a.pinnedAt !== undefined || b.pinnedAt !== undefined) {
    if (a.pinnedAt === undefined) return 1;
    if (b.pinnedAt === undefined) return -1;
    return b.pinnedAt.localeCompare(a.pinnedAt);
  }
  return b.voters.length - a.voters.length || b.createdAt.localeCompare(a.createdAt);
}

/** 超过上限时删掉排在最后的未置顶愿望（票最少、最早的）。 */
function trimWishes(list: StoredWish[]): StoredWish[] {
  if (list.length <= WISH_LIMIT) return list;
  const sorted = [...list].sort(compareWishes);
  const dropped = new Set<string>();
  for (let index = sorted.length - 1; index >= 0 && list.length - dropped.size > WISH_LIMIT; index -= 1) {
    const wish = sorted[index]!;
    if (wish.pinnedAt === undefined) dropped.add(wish.id);
  }
  return list.filter((wish) => !dropped.has(wish.id));
}

let wishes = trimWishes(loadWishes());

function publicWishes(): Wish[] {
  return [...wishes].sort(compareWishes).map(({ voters, ...wish }) => ({ ...wish, votes: voters.length }));
}

function normalizeName(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "游客";
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 18 ? name : null;
}

function normalizeGame(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const game = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
  return game.length >= 1 && game.length <= 30 ? game : null;
}

function normalizeNote(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const note = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  return note.length <= 140 ? note : null;
}

/** 判断是不是同一款游戏：忽略大小写、空格和标点。 */
function gameKey(game: string): string {
  return game.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function isVoterId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value);
}

type GameCenterServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameCenterSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerWishHandlers(
  io: GameCenterServer,
  socket: GameCenterSocket,
  checkAdminToken: (socketId: string, token: unknown) => string | null,
): void {
  let lastPostAt = 0;
  let lastVoteAt = 0;

  /** 改动先落盘，存不下就退回原样。 */
  function commit(previous: StoredWish[], ack: (response: { ok: true; data: Wish[] } | { ok: false; error: string }) => void, failure: string): boolean {
    try {
      saveWishes();
    } catch {
      wishes = previous;
      ack({ ok: false, error: failure });
      return false;
    }
    const data = publicWishes();
    ack({ ok: true, data });
    io.emit("wishes:updated", data);
    return true;
  }

  socket.on("wishes:get", (ack) => {
    ack({ ok: true, data: publicWishes() });
  });

  socket.on("wishes:post", (payload: SubmitWish, ack) => {
    const name = normalizeName(payload?.name);
    if (!name) {
      ack({ ok: false, error: "昵称最多 18 个字符。" });
      return;
    }
    const game = normalizeGame(payload?.game);
    if (!game) {
      ack({ ok: false, error: "游戏名需为 1–30 个字符。" });
      return;
    }
    const note = normalizeNote(payload?.note);
    if (note === null) {
      ack({ ok: false, error: "补充说明最多 140 个字符。" });
      return;
    }
    if (!isVoterId(payload?.voterId)) {
      ack({ ok: false, error: "请刷新页面后再试。" });
      return;
    }
    const now = Date.now();
    if (now - lastPostAt < WISH_RATE_LIMIT_MS) {
      ack({ ok: false, error: "许愿太频繁了，请稍后再试。" });
      return;
    }

    const previous = wishes;
    // 池子里已经有这款游戏了：不另起一条，直接给那条 +1。
    const existing = gameKey(game) ? wishes.find((wish) => gameKey(wish.game) === gameKey(game)) : undefined;
    if (existing) {
      if (!existing.voters.includes(payload.voterId)) {
        wishes = wishes.map((wish) => (wish.id === existing.id ? { ...wish, voters: [...wish.voters, payload.voterId] } : wish));
      }
      if (commit(previous, ack, "愿望暂时无法保存，请稍后重试。")) lastPostAt = now;
      return;
    }
    const wish: StoredWish = {
      id: randomUUID(),
      name,
      game,
      note,
      createdAt: new Date(now).toISOString(),
      voters: [payload.voterId],
    };
    wishes = trimWishes([...wishes, wish]);
    if (commit(previous, ack, "愿望暂时无法保存，请稍后重试。")) lastPostAt = now;
  });

  socket.on("wishes:vote", (payload: VoteWish, ack) => {
    if (!isVoterId(payload?.voterId)) {
      ack({ ok: false, error: "请刷新页面后再试。" });
      return;
    }
    const now = Date.now();
    if (now - lastVoteAt < VOTE_RATE_LIMIT_MS) {
      ack({ ok: false, error: "点得太快了，稍等一下。" });
      return;
    }
    const target = wishes.find((wish) => wish.id === payload.id);
    if (!target) {
      ack({ ok: false, error: "这个愿望已不存在。" });
      return;
    }
    const hasVoted = target.voters.includes(payload.voterId);
    if (hasVoted === Boolean(payload.voted)) {
      ack({ ok: true, data: publicWishes() });
      return;
    }
    const voters = payload.voted
      ? [...target.voters, payload.voterId]
      : target.voters.filter((voter) => voter !== payload.voterId);
    const previous = wishes;
    wishes = wishes.map((wish) => (wish.id === target.id ? { ...wish, voters } : wish));
    if (commit(previous, ack, "暂时无法保存，请稍后重试。")) lastVoteAt = now;
  });

  socket.on("wishes:delete", (payload: DeleteGuestbookEntry, ack) => {
    const error = checkAdminToken(socket.id, payload?.token);
    if (error) {
      ack({ ok: false, error });
      return;
    }
    const previous = wishes;
    wishes = wishes.filter((wish) => wish.id !== payload.id);
    if (wishes.length === previous.length) {
      ack({ ok: false, error: "这个愿望已不存在。" });
      return;
    }
    commit(previous, ack, "删除暂时无法保存，请稍后重试。");
  });

  socket.on("wishes:pin", (payload: PinEntry, ack) => {
    const error = checkAdminToken(socket.id, payload?.token);
    if (error) {
      ack({ ok: false, error });
      return;
    }
    const previous = wishes;
    if (!previous.some((wish) => wish.id === payload.id)) {
      ack({ ok: false, error: "这个愿望已不存在。" });
      return;
    }
    const pinnedAt = new Date().toISOString();
    wishes = previous.map((wish) => {
      if (wish.id !== payload.id) return wish;
      const { pinnedAt: _previous, ...rest } = wish;
      return payload.pinned ? { ...rest, pinnedAt } : rest;
    });
    commit(previous, ack, "置顶暂时无法保存，请稍后重试。");
  });
}
