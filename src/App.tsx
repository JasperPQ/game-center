import { useEffect, useState, type FormEvent } from "react";
import type { GuestbookEntry } from "../shared/types";
import { useBoardStyle } from "./boardStyle";
import Guestbook from "./Guestbook";
import { socket } from "./socket";
import eggUrl from "./assets/pixel/egg.png";
import "./egg.css";
import "./style-toggle.css";
// 像素风皮肤：只在像素版时放进页面，叠在原始的 styles.css 上。
import centerPixelCss from "./center-pixel.css?inline";

/** 线上按路径访问各游戏；本地开发时各游戏跑在自己的端口上。 */
function gameUrl(path: string, devPort: number): string {
  return import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:${devPort}/` : path;
}

/** 晶脉不放卡片，只从标题旁的彩蛋进入。 */
const JINGMAI_URL = gameUrl("/jingmai/", 5177);

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
  {
    id: "camel",
    name: "沙丘赛驼",
    tagline: "3–8 人 · 约 30 分钟",
    description: "金字塔下的骆驼赛跑：骆驼会叠着背一起跑，疯骆驼逆着捣乱。你不骑骆驼，只押注领先、冠军和垫底，金币最多的人获胜。",
    url: gameUrl("/camel/", 5178),
  },
  {
    id: "azul",
    name: "花砖物语",
    tagline: "2–4 人 · 约 30 分钟",
    description: "从工厂圆盘拿花砖拼墙：按行、按列、按颜色铺满，先拼满一整行触发终局，分数最高者获胜。",
    url: gameUrl("/azul/", 5179),
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

function CamelArt() {
  // 三只赛驼叠成一座塔（游戏里骆驼就是这样背着跑的），旁边一只绿驼、一只逆行的黑疯骆驼
  return (
    <div className="game-art game-art-camel" aria-hidden="true">
      <span className="camel-sprite camel-green" />
      <span className="camel-stack">
        <span className="camel-sprite camel-red" />
        <span className="camel-sprite camel-blue" />
        <span className="camel-sprite camel-yellow" />
      </span>
      <span className="camel-sprite camel-black flip" />
    </div>
  );
}

function AzulArt() {
  // 五种花砖排成一排，像一条还没铺满的图案行
  return (
    <div className="game-art game-art-azul" aria-hidden="true">
      <span className="azul-tile azul-blue" />
      <span className="azul-tile azul-yellow" />
      <span className="azul-tile azul-red" />
      <span className="azul-tile azul-black" />
      <span className="azul-tile azul-white" />
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
  // 画面风格（默认像素版），顶栏按钮随时切换；和宝石商人共用同一个选择。
  const [boardStyle, toggleBoardStyle] = useBoardStyle();
  const pixel = boardStyle === "pixel";

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
      {pixel && <style>{centerPixelCss}</style>}
      <header className="topbar">
        <a className="brand" href="/" aria-label="Game Center 首页">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-name">Game Center<span> 游戏中心</span></span>
        </a>
        <div className="topbar-right">
          <button
            type="button"
            className="quiet-button style-toggle"
            onClick={toggleBoardStyle}
            title={pixel ? "换回原始版本的画面（只影响你自己看到的）" : "换成像素风画面（只影响你自己看到的）"}
          >
            {pixel ? "切换原版" : "切换像素版"}
          </button>
          <div className={connected ? "connection-status online" : "connection-status"}>
            <span className="connection-dot" />
            {connected ? "服务已连接" : "连接中…"}
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow"><span className="eyebrow-line" /> 和朋友在线开一局</div>
        <div className="hero-title">
          <h1>Game Center</h1>
          {/* 晶脉的入口：标题右边一颗不写说明的彩蛋，点进去就是晶脉的房间页 */}
          <a className="hero-egg" href={JINGMAI_URL} aria-label="晶脉">
            <img src={eggUrl} alt="" width={42} height={58} />
          </a>
        </div>
        <p>无需注册，选一款游戏，创建房间后把房间码发给朋友就能开始。</p>
      </section>

      <section className="game-grid" aria-label="选择游戏">
        {GAMES.map((game) => (
          <a className={`game-card game-card-${game.id}`} href={game.url} key={game.id}>
            {game.id === "gem-merchant" ? <GemArt />
              : game.id === "guandan" ? <GuandanArt />
              : game.id === "camel" ? <CamelArt />
              : game.id === "azul" ? <AzulArt />
              : <PokerArt />}
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
