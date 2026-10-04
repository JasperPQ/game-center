import { useEffect, useState, type FormEvent } from "react";
import type { GuestbookEntry } from "../shared/types";
import Guestbook from "./Guestbook";
import { socket } from "./socket";

/** 线上按路径访问各游戏；本地开发时各游戏跑在自己的端口上。 */
function gameUrl(path: string, devPort: number): string {
  return import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:${devPort}/` : path;
}

const GAMES = [
  {
    id: "gem-merchant",
    name: "宝石商人",
    tagline: "2–4 人 · 约 30 分钟",
    description: "收集五色宝石、购买土地、吸引贵族来访，率先达到 15 分的商人获胜。",
    url: gameUrl("/gem/", 5173),
  },
  {
    id: "guandan",
    name: "掼蛋",
    tagline: "4 人 · 约 1 小时",
    description: "对家是队友，逢人配、炸弹、同花顺，从 2 一路打到 A，先过 A 的一队获胜。",
    url: gameUrl("/guandan/", 5174),
  },
  {
    id: "poker",
    name: "德州扑克",
    tagline: "2–6 人 · 约 1 小时",
    description: "无限注淘汰赛：两张底牌、五张公共牌，诈唬与跟注之间，打到最后一人获胜。",
    url: gameUrl("/poker/", 5176),
  },
] as const;

function GemArt() {
  return (
    <div className="game-art game-art-gem" aria-hidden="true">
      <span className="gem gem-white" />
      <span className="gem gem-blue" />
      <span className="gem gem-green" />
      <span className="gem gem-red" />
      <span className="gem gem-black" />
    </div>
  );
}

function GuandanArt() {
  return (
    <div className="game-art game-art-cards" aria-hidden="true">
      <span className="mini-card"><b>A</b>♠</span>
      <span className="mini-card red"><b>2</b>♥</span>
      <span className="mini-card joker"><span>JOKER</span></span>
    </div>
  );
}

function PokerArt() {
  return (
    <div className="game-art game-art-cards" aria-hidden="true">
      <span className="mini-card"><b>A</b>♠</span>
      <span className="mini-card red"><b>A</b>♥</span>
      <span className="poker-chips"><i /><i /><i /></span>
    </div>
  );
}

function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guestMessage, setGuestMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      socket.emit("guestbook:get", (response) => {
        if (response.ok) setEntries(response.data);
      });
    };
    const handleDisconnect = () => setConnected(false);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("guestbook:updated", setEntries);
    socket.connect();
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("guestbook:updated", setEntries);
      socket.disconnect();
    };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    socket.emit("guestbook:post", {
      ...(guestName.trim() ? { name: guestName.trim() } : {}),
      message: guestMessage,
    }, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setEntries(response.data);
      setGuestMessage("");
      setNotice("感谢留言，其他访客现在也能看到了。");
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Game Center 首页">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-name">Game Center<span> 游戏中心</span></span>
        </a>
        <div className={connected ? "connection-status online" : "connection-status"}>
          <span className="connection-dot" />
          {connected ? "服务已连接" : "连接中…"}
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow"><span className="eyebrow-line" /> 和朋友在线开一局</div>
        <h1>Game Center</h1>
        <p>无需注册，选一款游戏，创建房间后把房间码发给朋友就能开始。</p>
      </section>

      <section className="game-grid" aria-label="选择游戏">
        {GAMES.map((game) => (
          <a className={`game-card game-card-${game.id}`} href={game.url} key={game.id}>
            {game.id === "gem-merchant" ? <GemArt /> : game.id === "guandan" ? <GuandanArt /> : <PokerArt />}
            <div className="game-card-body">
              <span className="game-card-tagline">{game.tagline}</span>
              <h2>{game.name}</h2>
              <p>{game.description}</p>
              <span className="game-card-enter">进入游戏 <span aria-hidden="true">→</span></span>
            </div>
          </a>
        ))}
      </section>

      <Guestbook
        entries={entries}
        name={guestName}
        message={guestMessage}
        busy={busy}
        connected={connected}
        error={error}
        notice={notice}
        onNameChange={setGuestName}
        onMessageChange={setGuestMessage}
        onSubmit={submit}
      />
      <footer className="page-footer">围坐桌边，专注每一次选择。</footer>
    </main>
  );
}

export default App;
