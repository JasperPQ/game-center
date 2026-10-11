import { useEffect, useState, type FormEvent } from "react";
import type { Wish } from "../shared/types";
import { formatGuestbookDate } from "./Guestbook";
import { socket } from "./socket";

/** 许愿池：任何人都能写下想玩的游戏，别人点「我也想要」+1，票多的排前面。 */

const VOTER_KEY = "gc-wish-voter";
const VOTED_KEY = "gc-wish-voted";

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 这个浏览器的投票人编号；存不了时只在本页有效。 */
function readVoterId(): string {
  try {
    const stored = localStorage.getItem(VOTER_KEY);
    if (stored && /^[A-Za-z0-9-]{8,64}$/.test(stored)) return stored;
    const created = randomId();
    localStorage.setItem(VOTER_KEY, created);
    return created;
  } catch {
    return randomId();
  }
}

function readVoted(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(VOTED_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function storeVoted(voted: Set<string>): void {
  try {
    localStorage.setItem(VOTED_KEY, JSON.stringify([...voted]));
  } catch {
    // 存不了就只在本页记得。
  }
}

const voterId = readVoterId();

/** 和服务端一样：忽略大小写、空格和标点来判断是不是同一款游戏。 */
function sameGame(a: string, b: string): boolean {
  const key = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  return key(a) === key(b);
}

function WishingWell({
  connected,
  adminToken,
  game,
  onGameChange,
}: {
  connected: boolean;
  adminToken: string;
  /** 游戏名输入框的内容放在大厅里，搜不到游戏时可以一键带过来。 */
  game: string;
  onGameChange: (value: string) => void;
}) {
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [voted, setVoted] = useState(readVoted);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [listError, setListError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // 平时只露出游戏名一栏，点进去或者开始填了才展开说明和昵称，免得把下面的游戏挤得太远。
  const [focused, setFocused] = useState(false);
  const expanded = focused || game.trim() !== "" || note !== "";

  useEffect(() => {
    const load = () => {
      socket.emit("wishes:get", (response) => {
        if (response.ok) setWishes(response.data);
      });
    };
    if (socket.connected) load();
    socket.on("connect", load);
    socket.on("wishes:updated", setWishes);
    return () => {
      socket.off("connect", load);
      socket.off("wishes:updated", setWishes);
    };
  }, []);

  function updateVoted(id: string, on: boolean) {
    setVoted((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      storeVoted(next);
      return next;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const before = new Set(wishes.map((wish) => wish.id));
    socket.emit("wishes:post", {
      ...(name.trim() ? { name: name.trim() } : {}),
      game,
      note,
      voterId,
    }, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setWishes(response.data);
      // 许愿的人自己算一票；池子里已有同一款游戏时，服务端是给那条 +1。
      const created = response.data.find((wish) => !before.has(wish.id));
      const merged = created ? null : response.data.find((wish) => sameGame(wish.game, game));
      const target = created ?? merged;
      if (target) updateVoted(target.id, true);
      onGameChange("");
      setNote("");
      setFocused(false);
      setNotice(merged
        ? `池子里已经有「${merged.game}」了，帮你在那条上 +1 了。`
        : "愿望已经投进池子，大家都能看到、帮你 +1 了。");
    });
  }

  function vote(wish: Wish) {
    const on = !voted.has(wish.id);
    setListError("");
    setBusyId(wish.id);
    socket.emit("wishes:vote", { id: wish.id, voterId, voted: on }, (response) => {
      setBusyId(null);
      if (!response.ok) {
        setListError(response.error);
        return;
      }
      setWishes(response.data);
      updateVoted(wish.id, on);
    });
  }

  function togglePin(wish: Wish) {
    setListError("");
    setBusyId(wish.id);
    socket.emit("wishes:pin", { id: wish.id, token: adminToken, pinned: !wish.pinnedAt }, (response) => {
      setBusyId(null);
      if (!response.ok) setListError(response.error);
    });
  }

  function remove(wish: Wish) {
    if (!window.confirm(`确定删除「${wish.game}」这个愿望吗？删除后无法恢复。`)) return;
    setListError("");
    setBusyId(wish.id);
    socket.emit("wishes:delete", { id: wish.id, token: adminToken }, (response) => {
      setBusyId(null);
      if (!response.ok) setListError(response.error);
    });
  }

  return (
    <section className="guestbook wishwell" id="wishes" aria-labelledby="wishes-title">
      <div className="guestbook-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> 许愿池</div>
          <h2 id="wishes-title">还想玩什么？许个愿。</h2>
          <p>写下你想在这里玩到的桌游；看到和你想法一样的，点「想要」+1，票多的优先做。</p>
        </div>
        <span className="guestbook-count">{wishes.length} 个愿望</span>
      </div>

      <div className="guestbook-layout">
        <form className="guestbook-form" onSubmit={submit}>
          <label className="field-label" htmlFor="wish-game">想玩的游戏</label>
          <input
            id="wish-game"
            className="text-input"
            value={game}
            onChange={(event) => onGameChange(event.target.value)}
            onFocus={() => setFocused(true)}
            placeholder="比如：卡坦岛、UNO、狼人杀"
            maxLength={30}
            required
          />
          {expanded && (
            <>
              <label className="field-label field-label-spaced" htmlFor="wish-note">想说的话 <span>可选</span></label>
              <textarea
                id="wish-note"
                className="text-input guestbook-textarea wish-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="为什么想玩、几个人玩、喜欢哪个版本……"
                maxLength={140}
              />
              <label className="field-label field-label-spaced" htmlFor="wish-name">怎么称呼你？ <span>可选</span></label>
              <input
                id="wish-name"
                className="text-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="留空则显示为游客"
                maxLength={18}
                autoComplete="nickname"
              />
              <div className="guestbook-form-meta"><span>公开展示 · 请勿填写个人敏感信息</span><span>{note.length} / 140</span></div>
            </>
          )}
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {notice && <p className="feedback feedback-success" role="status">{notice}</p>}
          <button className="primary-button guestbook-submit" type="submit" disabled={!connected || busy || !game.trim()}>
            {busy ? <><span className="spinner" /> 正在许愿</> : "投进许愿池"}
            {!busy && <span aria-hidden="true">✦</span>}
          </button>
        </form>

        <div className="guestbook-list" aria-live="polite" aria-label="大家的愿望">
          {listError && <p className="feedback feedback-error wish-list-error" role="alert">{listError}</p>}
          {wishes.length > 0 ? wishes.map((wish) => {
            const mine = voted.has(wish.id);
            return (
              <article className={wish.pinnedAt ? "guestbook-entry wish-entry pinned" : "guestbook-entry wish-entry"} key={wish.id}>
                <button
                  type="button"
                  className={mine ? "wish-vote voted" : "wish-vote"}
                  aria-pressed={mine}
                  title={mine ? "撤回我的 +1" : "我也想要 +1"}
                  disabled={!connected || busyId === wish.id}
                  onClick={() => vote(wish)}
                >
                  <strong>{wish.votes}</strong>
                  <span>{mine ? "已想要" : "想要"}</span>
                </button>
                <div className="guestbook-entry-content">
                  <div className="guestbook-entry-meta">
                    <strong className="wish-game">{wish.game}</strong>
                    {wish.pinnedAt && <span className="pin-badge">置顶</span>}
                    <time dateTime={wish.createdAt}>{wish.name} · {formatGuestbookDate(wish.createdAt)}</time>
                    {adminToken && (
                      <>
                        <button className="guestbook-pin" type="button" disabled={!connected || busyId === wish.id} onClick={() => togglePin(wish)}>
                          {wish.pinnedAt ? "取消置顶" : "置顶"}
                        </button>
                        <button className="guestbook-delete" type="button" disabled={!connected || busyId === wish.id} onClick={() => remove(wish)}>
                          删除
                        </button>
                      </>
                    )}
                  </div>
                  {wish.note && <p>{wish.note}</p>}
                </div>
              </article>
            );
          }) : (
            <div className="guestbook-empty">
              <span aria-hidden="true">✦</span>
              <strong>池子里还没有愿望</strong>
              <p>许下第一个愿望吧。</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default WishingWell;
