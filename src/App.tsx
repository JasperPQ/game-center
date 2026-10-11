import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { TRIAL_DAYS } from "../shared/pricing";
import type { GuestbookEntry, PublicAccount, Wish } from "../shared/types";
import { Account, AccountAdmin, readPendingOrder } from "./Account";
import { api } from "./api";
import { adminEntryEnabled, readStoredAdminToken, storeAdminToken } from "./admin";
import Guestbook, { BoardAdminBar } from "./Guestbook";
import { socket } from "./socket";
import WishingWell from "./WishingWell";
import { Letter } from "./Letter";
import eggUrl from "./assets/pixel/egg-small.png";
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
import wondersCover from "./assets/pixel/covers/wonders.png";
import loveletterCover from "./assets/pixel/covers/loveletter.png";
import skullCover from "./assets/pixel/covers/skull.png";
import incanCover from "./assets/pixel/covers/incan.png";
import yachtCover from "./assets/pixel/covers/yacht.png";
import baohuangCover from "./assets/pixel/covers/baohuang.png";
import goujiCover from "./assets/pixel/covers/gouji.png";
import welcometoCover from "./assets/pixel/covers/welcometo.png";
import harmoniesCover from "./assets/pixel/covers/harmonies.png";
import hanabiCover from "./assets/pixel/covers/hanabi.png";
import "./egg.css";
import { ThemeToggle, useTheme } from "./theme";
import { SoundToggle, useBgm, type BgmTrack } from "./gm-sound";

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
  {
    id: "wonders",
    name: "七大奇迹",
    tagline: "3–7 人 · 可加人机",
    description: "每人经营一座古代名城、修一座奇迹。三个时代里，大家同时从手牌挑一张，剩下的传给邻居：盖原料作坊、神殿和集市，研究科技，扩充军队和左右邻居比拼，或者用这张牌给奇迹添一层。资源不够就向邻居花钱买，三个时代后分数最高的城邦获胜。",
    url: gameUrl("/wonders/", 5189),
    cover: wondersCover,
  },
  {
    id: "loveletter",
    name: "情书",
    tagline: "2–6 人 · 可加人机",
    description: "整副只有 21 张宫廷角色牌，每人手里只握 1 张。轮到你先摸一张，再从两张里打出一张：卫兵猜别人的牌，牧师偷看，男爵比大小，王子逼人弃牌……被猜中、比输或者丢掉了公主就出局。撑到最后、或者牌堆抽完时点数最大，就收下一枚钟情标记，先攒够的人赢。",
    url: gameUrl("/loveletter/", 5190),
    cover: loveletterCover,
  },
  {
    id: "skull",
    name: "骷髅牌",
    tagline: "3–6 人 · 可加人机",
    description: "每人手里 4 张垫子：3 朵玫瑰、1 个骷髅。大家轮流往面前盖一张，或者开口叫价：「我能翻开 N 朵玫瑰」。叫得最高的人得自己翻，先翻自己的，再挑别人的；翻满 N 朵算成功，翻到骷髅就丢掉一张垫子。成功两次的人获胜，被吃光垫子就出局。唬人、加注、看穿别人，全凭一张脸。",
    url: gameUrl("/skull/", 5191),
    cover: skullCover,
  },
  {
    id: "incan",
    name: "印加宝藏",
    tagline: "3–8 人 · 可加人机",
    description: "一群探险者举着火把钻进神庙，一张张翻开通道：宝石大家平分，分不完的留在路上。每翻一张，所有人同时决定继续往里挖，还是带着手上的宝石回营地。同一种危险出现第二次，神庙就塌了，还没走的人两手空空。越往里越值钱，也越危险，打 5 局，带回营地最多的人赢。",
    url: gameUrl("/incan/", 5192),
    cover: incanCover,
  },
  {
    id: "yacht",
    name: "快艇骰子",
    tagline: "1–6 人 · 可加人机",
    description: "五颗骰子，每回合最多掷三次，每次自己挑哪几颗重掷。凑出三条、葫芦、顺子，或者五颗一样的「快艇」，再挑计分表上的一格填分；凑不成也得划掉一格。上半区凑够 63 分再奖 35 分。13 轮把表填满，总分最高的人赢。一个人也能挑战最高分。",
    url: gameUrl("/yacht/", 5293),
    cover: yachtCover,
  },
  {
    id: "baohuang",
    name: "保皇",
    tagline: "5 人 · 人机自动补位",
    description: "五个人分四副去掉 3、4、5 的扑克。拿到皇牌的人登基当皇帝，亮出三张同花色同点数的牌，第四张在谁手里，谁就是暗中的侍卫；皇帝也可以一个人独保，以一敌四。其余的人是革命党，可谁是侍卫要打到那张牌落地才知道。一样的点数越凑越多越大，抢先出完手牌的人走科，按名次算一盘输赢，打完几盘总分最高的人赢。",
    url: gameUrl("/baohuang/", 5291),
    cover: baohuangCover,
  },
  {
    id: "gouji",
    name: "够级",
    tagline: "6 人 · 三对三 · 人机自动补位",
    description: "青岛人爱打的六人牌：两队隔座坐，四副牌每人 36 张。打出够级的大牌，只有正对面的对头能接，别的人还能抢着烧牌，一口气把整手牌出完。按出完牌的先后排出头科到大落算分，一队包揽前三名就是串三户；下一盘落后的人要拿大王、2 给赢家进贡。",
    url: gameUrl("/gouji/", 5292),
    cover: goujiCover,
  },
  {
    id: "welcometo",
    name: "欢迎来到",
    tagline: "1–6 人 · 同时填表 · 可加人机",
    description: "五十年代郊区的建筑师比赛：每回合翻出三组「门牌号 + 行动」，大家同时挑一组，把门牌号填进自己的三条街，从左到右只能越填越大。画栅栏围出小区、建公园和泳池、雇临时工改号码，抢在别人前面完成市里的三张规划目标拿高分。",
    url: gameUrl("/welcometo/", 5298),
    cover: welcometoCover,
  },
  {
    id: "harmonies",
    name: "自然和弦",
    tagline: "1–4 人 · 可加人机",
    description: "每回合从中央拿三枚彩色木片，放到自己的六角小版图上：叠高的树和山更值分，连片的田、蜿蜒的河、挨着各色邻居的小屋也都算分。再领几张动物卡，在版图上摆出卡上的小图案，就能把动物请进家门，住进来的越多分越高。打到有人版图快放满或者布袋抽空为止，总分最高的人赢。",
    url: gameUrl("/harmonies/", 5294),
    cover: harmoniesCover,
  },
  {
    id: "hanabi",
    name: "花火",
    tagline: "2–5 人 · 合作 · 可加人机",
    description: "全队一起办一场烟火大会：每个人都看不到自己的牌，只看得到队友的。轮到你时给队友一个提示（「这两张是红色」「这张是 3」）、弃一张牌换回提示，或者凭推理打出一张，把红黄绿蓝白五色烟火各按 1 到 5 放上天。打错三次全队失败，牌堆摸完时五色加起来就是全队得分，满分 25。",
    url: gameUrl("/hanabi/", 5295),
    cover: hanabiCover,
  },
];

/** 搜索时忽略大小写、空格和中间点。 */
function normalizeSearch(text: string): string {
  return text.toLowerCase().replace(/[\s·・]+/g, "");
}

/** 卡片标语里的人数范围（「2–4 人」「6 人」），搜「4人」「4」时按人数匹配。 */
function playerRange(tagline: string): [number, number] | null {
  const match = /(\d+)\s*(?:[–~-]\s*(\d+))?\s*人/.exec(tagline);
  if (!match) return null;
  const low = Number(match[1]);
  return [low, match[2] ? Number(match[2]) : low];
}

/** 按名字、标语、简介搜；只输入人数（「5」「5人」「5 个人」）时找能这么多人玩的游戏。 */
function matchGame(game: GameCard, query: string): boolean {
  const needle = normalizeSearch(query);
  if (!needle) return true;
  const players = /^(\d+)个?人?$/.exec(needle);
  if (players) {
    const range = playerRange(game.tagline);
    return range !== null && Number(players[1]) >= range[0] && Number(players[1]) <= range[1];
  }
  return normalizeSearch(`${game.name} ${game.tagline} ${game.description} ${game.id}`).includes(needle);
}

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

// 背景音乐：大厅的所有页面都放这首（浏览器要求先点过页面才出声；点游戏卡片这种链接不算，免得跳页前响一下）。
// gain / start / end 是按这首曲子量的（见 bgm.tsx）。
const LOBBY_BGM: BgmTrack = { src: `${import.meta.env.BASE_URL}bgm/lobby.mp3`, gain: 0.83, start: 0.05, end: 146.1 };

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
  useBgm(LOBBY_BGM);
  // 登录状态；null 表示未登录，subscribed 决定能否进入游戏。
  const [user, setUser] = useState<PublicAccount | null>(null);
  const [accountNotice, setAccountNotice] = useState(() => gateNotice(landingGate));
  // 留言板和许愿池共用的管理员口令（网址带 ?admin 时才有入口）。
  const [adminToken, setAdminToken] = useState(readStoredAdminToken);
  const [wishGame, setWishGame] = useState("");
  const [wishes, setWishes] = useState<Wish[]>([]);
  // 「来访者的声音」里的两个标签：评价 / 许愿池。
  const [voicesTab, setVoicesTab] = useState<"reviews" | "wishes">("reviews");
  // 右上角的会员面板；从游戏被拦回来、付款回来时自动打开。
  const [accountOpen, setAccountOpen] = useState(Boolean(landingGate || landingOrderId));
  const accountDialog = useRef<HTMLDialogElement>(null);
  // 没登录时点的那款游戏：登录、开通后面板里给一个「继续进入」。
  const [pendingGame, setPendingGame] = useState<{ name: string; url: string } | null>(landingNextGame);
  const [query, setQuery] = useState("");
  const visibleGames = useMemo(() => GAMES.filter((game) => matchGame(game, query)), [query]);

  function updateAdminToken(token: string) {
    setAdminToken(token);
    storeAdminToken(token);
  }

  /** 搜不到想玩的游戏：把搜的词带进许愿池。 */
  function wishForQuery() {
    setWishGame(query.trim().slice(0, 30));
    setVoicesTab("wishes");
    document.getElementById("voices")?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => document.getElementById("wish-game")?.focus({ preventScroll: true }), 400);
  }

  // 会员面板用原生 <dialog>：Esc、点外面的暗处都能关。
  useEffect(() => {
    const dialog = accountDialog.current;
    if (!dialog) return;
    if (accountOpen && !dialog.open) dialog.showModal();
    if (!accountOpen && dialog.open) dialog.close();
  }, [accountOpen]);

  // 悬浮窗发完评价后的「去看看」链接是 #voices：切到评价标签。
  useEffect(() => {
    const onHash = () => { if (window.location.hash === "#voices") setVoicesTab("reviews"); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    api.me().then((response) => {
      setUser(response.user);
      if (response.kicked) setAccountNotice(gateNotice("kicked"));
    }).catch(() => {});
    // 读完就把参数从地址栏去掉，刷新时不再重复提示。
    if (landingParams.has("gate") || landingParams.has("order")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  function handleGameClick(event: MouseEvent<HTMLAnchorElement>, game: GameCard) {
    if (user && user.subscribed) return;
    event.preventDefault();
    setPendingGame(game);
    setAccountNotice(gateNotice(!user ? "login" : user.trialClaimed || user.paid ? "expired" : "trial"));
    setAccountOpen(true);
  }

  // 停在大厅的窗口也要知道自己被挤掉了：隔一会儿、以及切回这个标签页时查一次登录状态。
  useEffect(() => {
    if (!user) return;
    function check() {
      api.me().then((response) => {
        if (response.user) return;
        setUser(null);
        setAccountNotice(gateNotice(response.kicked ? "kicked" : "login"));
        setAccountOpen(true);
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
      socket.emit("wishes:get", (response) => {
        if (response.ok) setWishes(response.data);
      });
    };
    const handleDisconnect = () => setConnected(false);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("guestbook:updated", setEntries);
    socket.on("wishes:updated", setWishes);
    socket.connect();
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("guestbook:updated", setEntries);
      socket.off("wishes:updated", setWishes);
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

  const accountLabel = !user ? "登录 / 注册" : user.lifetime ? "永久会员" : user.subscribed ? (user.trial ? "试用中" : "会员") : "未开通";

  return (
    <main className="app-shell">
      {/* 晶脉的入口：页面左上角一颗不写说明的小彩蛋，点进去就是晶脉的房间页 */}
      <a className="corner-egg" href={JINGMAI_URL} aria-label="晶脉">
        <img src={eggUrl} alt="" width={21} height={29} />
      </a>

      <header className="topbar">
        <a className="brand" href="/" aria-label="Game Center 首页">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-name">Game Center<span> 游戏中心</span></span>
        </a>
        <div className="topbar-right">
          <button
            type="button"
            className={user?.subscribed ? "quiet-button account-entry subscribed" : "quiet-button account-entry"}
            onClick={() => setAccountOpen(true)}
            aria-haspopup="dialog"
            title={user ? "会员订阅：查看状态、续费" : "登录或注册"}
          >
            {user ? <><span className="account-entry-name">{user.username}</span><span className="account-entry-status">{accountLabel}</span></> : accountLabel}
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <SoundToggle />
          <div className={connected ? "connection-status online" : "connection-status"}>
            <span className="connection-dot" />
            {connected ? "服务已连接" : "连接中…"}
          </div>
        </div>
      </header>

      <dialog
        ref={accountDialog}
        className="account-dialog"
        aria-label="会员订阅"
        onClose={() => setAccountOpen(false)}
        // 点面板外面的暗处收起
        onClick={(event) => { if (event.target === event.currentTarget) setAccountOpen(false); }}
      >
        <div className="account-dialog-panel">
          <button type="button" className="account-dialog-close quiet-button" onClick={() => setAccountOpen(false)} aria-label="关闭">✕</button>
          {accountNotice && <p className="account-notice" role="status">{accountNotice}</p>}
          {pendingGame && user?.subscribed && (
            <a className="account-continue primary-button" href={pendingGame.url}>
              继续进入{pendingGame.name} <span aria-hidden="true">→</span>
            </a>
          )}
          <Account user={user} onUserChange={handleUserChange} returningOrderId={landingOrderId} />
        </div>
      </dialog>

      <section className="hero">
        <div className="eyebrow"><span className="eyebrow-line" /> 和朋友在线开一局</div>
        <div className="hero-title">
          <h1>Game Center</h1>
          {/* 站长写给第一次来的朋友的信：标题右边的信封，点开是信纸 */}
          <Letter />
        </div>
        <p>欢迎来到咕噜嘎的桌游店，陌生的朋友。试运行期间新用户赠送{TRIAL_DAYS}天会员，祝你玩的愉快。</p>
      </section>

      {adminEntryEnabled && (
        <section className="admin-page" aria-label="管理页">
          <AccountAdmin />
        </section>
      )}

      <section className="games" aria-labelledby="games-title">
        <div className="games-heading">
          <h2 id="games-title">全部游戏 <span>{query.trim() ? `找到 ${visibleGames.length} 款` : `${GAMES.length} 款`}</span></h2>
          <div className="game-search" role="search">
            <input
              className="text-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索游戏：名字、玩法，或输入人数如 5"
              aria-label="搜索游戏"
              maxLength={30}
            />
            {query && (
              <button type="button" className="quiet-button" onClick={() => setQuery("")}>清除</button>
            )}
          </div>
        </div>
        {visibleGames.length > 0 ? (
          <div className="game-grid">
            {visibleGames.map((game) => (
              <a
                className={`game-card game-card-${game.id}`}
                href={game.url}
                key={game.id}
                onClick={(event) => handleGameClick(event, game)}
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
          </div>
        ) : (
          <div className="game-search-empty">
            <strong>没找到「{query.trim()}」</strong>
            {/^\d+\s*个?人?$/.test(query.trim()) ? (
              <p>暂时没有能这么多人一起玩的游戏，换个人数试试。</p>
            ) : (
              <>
                <p>站上暂时还没有这款游戏。想玩的话，去许愿池许个愿，票多的我们优先做。</p>
                <button type="button" className="primary-button" onClick={wishForQuery}>
                  把「{query.trim().slice(0, 30)}」投进许愿池 <span aria-hidden="true">✦</span>
                </button>
              </>
            )}
          </div>
        )}
      </section>

      <section className="guestbook voices" id="voices" aria-labelledby="voices-title">
        <div className="guestbook-heading">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> 来访者的声音</div>
            <h2 id="voices-title">{voicesTab === "reviews" ? "写下你的评价。" : "还想玩什么？许个愿。"}</h2>
            <p>
              {voicesTab === "reviews"
                ? "给后来加入的玩家留句话，也看看大家对牌桌的感受。在游戏里也能随时点右下角「写评价」。"
                : "写下你想在这里玩到的桌游；看到和你想法一样的，点「想要」+1，票多的优先做。"}
            </p>
          </div>
        </div>

        <div className="voices-tabs" role="tablist" aria-label="来访者的声音">
          <button
            type="button"
            role="tab"
            className={voicesTab === "reviews" ? "voices-tab active" : "voices-tab"}
            aria-selected={voicesTab === "reviews"}
            onClick={() => setVoicesTab("reviews")}
          >
            评价 <span>{entries.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            className={voicesTab === "wishes" ? "voices-tab active" : "voices-tab"}
            aria-selected={voicesTab === "wishes"}
            onClick={() => setVoicesTab("wishes")}
          >
            许愿池 <span>{wishes.length}</span>
          </button>
        </div>

        {adminEntryEnabled && (
          <BoardAdminBar token={adminToken} connected={connected} onTokenChange={updateAdminToken} />
        )}

        <div role="tabpanel" hidden={voicesTab !== "reviews"}>
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
            adminToken={adminToken}
          />
        </div>
        <div role="tabpanel" hidden={voicesTab !== "wishes"}>
          <WishingWell
            wishes={wishes}
            onWishesChange={setWishes}
            connected={connected}
            adminToken={adminToken}
            game={wishGame}
            onGameChange={setWishGame}
          />
        </div>
      </section>

      <footer className="page-footer">围坐桌边，专注每一次选择。</footer>
    </main>
  );
}

export default App;
