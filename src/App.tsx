import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { PRICE_PER_MONTH_YUAN, TRIAL_DAYS } from "../shared/pricing";
import type { GuestbookEntry, PublicAccount } from "../shared/types";
import { Account, readPendingOrder } from "./Account";
import { api } from "./api";
import Guestbook from "./Guestbook";
import { socket } from "./socket";
import eggUrl from "./assets/pixel/egg.png";
// 每个游戏卡片的封面（PixelLab 生成，见 art/covers.py）
import gemCover from "./assets/pixel/covers/gem-merchant.png";
import guandanCover from "./assets/pixel/covers/guandan.png";
import pokerCover from "./assets/pixel/covers/poker.png";
import camelCover from "./assets/pixel/covers/camel.png";
import azulCover from "./assets/pixel/covers/azul.png";
import ttrCover from "./assets/pixel/covers/ttr.png";
import cantstopCover from "./assets/pixel/covers/cantstop.png";
import luckyCover from "./assets/pixel/covers/lucky.png";
import flip7Cover from "./assets/pixel/covers/flip7.png";
import seasaltCover from "./assets/pixel/covers/seasalt.png";
import mahjongCover from "./assets/pixel/covers/mahjong.png";
import doudizhuCover from "./assets/pixel/covers/doudizhu.png";
import kingdominoCover from "./assets/pixel/covers/kingdomino.png";
import niutouCover from "./assets/pixel/covers/niutou.png";
import "./egg.css";
import { ThemeToggle, useTheme } from "./theme";

/** 线上按路径访问各游戏；本地开发时各游戏跑在自己的端口上。 */
function gameUrl(path: string, devPort: number): string {
  return import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:${devPort}/` : path;
}

/** 晶脉不放卡片，只从标题旁的彩蛋进入。 */
const JINGMAI_URL = gameUrl("/jingmai/", 5177);

/** 大厅里的一张游戏卡片。badge 是封面右上角的小标签：流水线先上线的简洁版写「抢先体验 · 美术制作中」，换上正式美术后去掉。 */
type GameCard = { id: string; name: string; tagline: string; description: string; url: string; cover: string; badge?: string };

const GAMES: readonly GameCard[] = [
  {
    id: "gem-merchant",
    name: "宝石商人",
    tagline: "2–4 人 · 约 30 分钟",
    description: "收集五色宝石、购买土地、吸引贵族来访，率先达到 15 分的商人获胜。",
    url: gameUrl("/gem/", 5173),
    cover: gemCover,
  },
  {
    id: "guandan",
    name: "掼蛋",
    tagline: "4 人 · 约 1 小时",
    description: "对家是队友，逢人配、炸弹、同花顺，从 2 一路打到 A，先过 A 的一队获胜。",
    url: gameUrl("/guandan/", 5174),
    cover: guandanCover,
  },
  {
    id: "poker",
    name: "德州扑克",
    tagline: "2–6 人 · 约 1 小时",
    description: "无限注淘汰赛：两张底牌、五张公共牌，诈唬与跟注之间，打到最后一人获胜。",
    url: gameUrl("/poker/", 5176),
    cover: pokerCover,
  },
  {
    id: "camel",
    name: "沙丘赛驼",
    tagline: "3–8 人 · 约 30 分钟",
    description: "金字塔下的骆驼赛跑：骆驼会叠着背一起跑，疯骆驼逆着捣乱。你不骑骆驼，只押注领先、冠军和垫底，金币最多的人获胜。",
    url: gameUrl("/camel/", 5178),
    cover: camelCover,
  },
  {
    id: "azul",
    name: "花砖物语",
    tagline: "2–4 人 · 约 30 分钟",
    description: "从工厂圆盘拿花砖拼墙：按行、按列、按颜色铺满，先拼满一整行触发终局，分数最高者获胜。",
    url: gameUrl("/azul/", 5179),
    cover: azulCover,
  },
  {
    id: "ttr",
    name: "车票之旅",
    tagline: "2–5 人 · 约 45 分钟",
    description: "收集彩色车票，在美国地图上铺铁路、连城市、完成目的地票，铺出最长铁路的人加分最多。",
    url: gameUrl("/ttr/", 5180),
    cover: ttrCover,
  },
  {
    id: "cantstop",
    name: "欲罢不能",
    tagline: "2–4 人 · 约 20 分钟",
    description: "掷 4 颗骰子两两分组往山上爬：再掷一次继续冒险，还是收手扎营保住进度？贪心爆掉就白爬，先登顶 3 条路的人获胜。",
    url: gameUrl("/cantstop/", 5181),
    cover: cantstopCover,
  },
  {
    id: "lucky",
    name: "幸运数字",
    tagline: "2–4 人 · 约 15 分钟",
    description: "把 1–20 的数字牌摆进自己的 4×4 棋盘，每一行、每一列都要从小到大。抽牌、拿别人弃的明牌、换下旧牌，第一个摆满 16 格的人获胜。",
    url: gameUrl("/lucky/", 5182),
    cover: luckyCover,
  },
  {
    id: "flip7",
    name: "翻七",
    tagline: "3–10 人 · 约 20 分钟",
    description: "一张一张翻牌：再要一张还是见好就收？翻到重复的数字就爆掉，凑齐 7 张不同的数字额外 +15。冻结、翻三能塞给别人，先到 200 分的那一轮打完，总分最高者获胜。",
    url: gameUrl("/flip7/", 5183),
    cover: flip7Cover,
  },
  {
    id: "seasalt",
    name: "海盐与纸",
    tagline: "2–4 人 · 约 20 分钟",
    description: "在海边收集卡牌、凑对子换效果：蟹翻弃牌堆、船再来一回合、鱼多摸一张、鲨鱼配泳者偷一张。卡牌分到 7 就能喊停，稳稳 STOP 还是赌一把「最后机会」？",
    url: gameUrl("/seasalt/", 5184),
    cover: seasaltCover,
  },
  {
    id: "mahjong",
    name: "麻将",
    tagline: "1–4 人 · 空座机器人补位",
    description: "麻将系列，进去先选玩法：四川麻将（换三张、定缺，血战到底 / 血流成河）或立直麻将（日本麻将：立直、宝牌、役和符，半庄 / 东风战）。人不够时机器人坐空座，一个人也能练手。",
    url: gameUrl("/mahjong/", 5185),
    cover: mahjongCover,
  },
  {
    id: "doudizhu",
    name: "斗地主",
    tagline: "1–3 人 · 空座人机补位",
    description: "叫地主、抢地主，地主多拿 3 张底牌，一个人打两个农民，谁先出完谁那一方赢。明牌、加倍、炸弹、王炸、春天都翻倍，还有记牌器。人不够时人机坐空座，一个人也能练手。",
    url: gameUrl("/doudizhu/", 5186),
    cover: doudizhuCover,
  },
  {
    id: "kingdomino",
    name: "多米诺王国",
    tagline: "2–4 人 · 可加人机",
    description: "每人从一座城堡起步，轮流挑骨牌拼进自己的王国：麦田、森林、湖泊、草地、沼泽、矿山。同种地形连成一片，格数 × 皇冠就是这片的分；挑大号骨牌皇冠多，下一轮就得排在后面。",
    url: gameUrl("/kingdomino/", 5187),
    cover: kingdominoCover,
  },
  {
    id: "niutou",
    name: "谁是牛头王",
    tagline: "2–10 人 · 可加人机",
    description: "每人 10 张数字牌，大家同时扣下一张，亮牌后从小到大接到桌上 4 排里。谁的牌落在一排的第 6 格，就把前面 5 张连牛头一起收走；牌比每排都小，就自己挑一排收下。牛头越少越好，人多更热闹。",
    url: gameUrl("/niutou/", 5188),
    cover: niutouCover,
  },
];

// 网关拦下没订阅的访客时会带着 ?gate=login|expired|trial|kicked&next=<游戏路径> 回到大厅；付款页回来时带 ?order=<订单号>。
const landingParams = new URLSearchParams(window.location.search);
const landingGate = landingParams.get("gate");
// 没带订单号回来（比如从爱发电自己点回大厅）时，接着查上次跳去付款的那一单。
const landingOrderId = landingParams.get("order") ?? readPendingOrder();
const JINGMAI_GAME = { id: "jingmai", name: "晶脉", url: JINGMAI_URL };
const landingNextGame = [...GAMES, JINGMAI_GAME].find((game) => game.url === `/${landingParams.get("next") ?? ""}/`) ?? null;

function gateNotice(gate: string | null): string {
  if (gate === "login") return "请先登录，登录后才能进入游戏。";
  if (gate === "expired") return "订阅已到期，续费后就能继续进入游戏。";
  if (gate === "trial") return "账号还没开通：关注公众号领试用，或者直接付款开通。";
  if (gate === "kicked") return "这个账号在别的浏览器或设备上登录了，这里已经退出。每个账号同时登录的设备数有限，最早登录的会被挤掉；重新登录即可。";
  return "";
}

function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guestMessage, setGuestMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // 白天 / 夜间画面，顶栏按钮随时切换；和各个游戏共用同一个选择。
  const [theme, toggleTheme] = useTheme();
  // 登录状态；null 表示未登录，subscribed 决定能否进入游戏。
  const [user, setUser] = useState<PublicAccount | null>(null);
  const [accountNotice, setAccountNotice] = useState(() => gateNotice(landingGate));

  useEffect(() => {
    api.me().then((response) => {
      setUser(response.user);
      if (response.kicked) setAccountNotice(gateNotice("kicked"));
    }).catch(() => {});
    // 读完就把参数从地址栏去掉，刷新时不再重复提示。
    if (landingParams.has("gate") || landingParams.has("order")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (landingGate || landingOrderId) scrollToAccount();
  }, []);

  function scrollToAccount() {
    document.getElementById("account")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleGameClick(event: MouseEvent<HTMLAnchorElement>) {
    if (user && user.subscribed) return;
    event.preventDefault();
    setAccountNotice(gateNotice(!user ? "login" : user.trialClaimed || user.paid ? "expired" : "trial"));
    scrollToAccount();
  }

  // 停在大厅的窗口也要知道自己被挤掉了：隔一会儿、以及切回这个标签页时查一次登录状态。
  useEffect(() => {
    if (!user) return;
    function check() {
      api.me().then((response) => {
        if (response.user) return;
        setUser(null);
        setAccountNotice(gateNotice(response.kicked ? "kicked" : "login"));
        scrollToAccount();
      }).catch(() => {});
    }
    const timer = window.setInterval(check, 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user]);

  function handleUserChange(next: PublicAccount | null) {
    setUser(next);
    setAccountNotice("");
  }

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
        <div className="topbar-right">
          <button
            type="button"
            className="quiet-button account-entry"
            onClick={scrollToAccount}
            title={user ? "查看订阅状态" : "登录或注册"}
          >
            {user ? user.username : "登录 / 注册"}
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
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
        <p>新用户送 {TRIAL_DAYS} 天试用，之后 {PRICE_PER_MONTH_YUAN} 元 / 月。选一款游戏，创建房间把房间码发给朋友（朋友也要登录）就能开始。</p>
      </section>

      {accountNotice && <p className="account-notice" role="status">{accountNotice}</p>}

      {landingNextGame && user?.subscribed && (
        <a className="account-continue primary-button" href={landingNextGame.url}>
          继续进入{landingNextGame.name} <span aria-hidden="true">→</span>
        </a>
      )}

      <Account user={user} onUserChange={handleUserChange} returningOrderId={landingOrderId} />

      <section className="game-grid" aria-label="选择游戏">
        {GAMES.map((game) => (
          <a
            className={`game-card game-card-${game.id}`}
            href={game.url}
            key={game.id}
            onClick={handleGameClick}
          >
            <div className="game-art game-cover" aria-hidden="true">
              <img src={game.cover} alt="" />
              {game.badge && <span className="game-card-badge">{game.badge}</span>}
            </div>
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
