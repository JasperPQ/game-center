import { useEffect, useState, type FormEvent } from "react";
import { formatYuan, PLAN_MONTHS, PRICE_PER_MONTH_YUAN, priceFen, TRIAL_DAYS } from "../shared/pricing";
import type { PublicAccount, PublicOrder } from "../shared/types";
import { api, type PayConfigResponse, type WechatConfigResponse } from "./api";

const ORDER_POLL_MS = 3_000;
const ORDER_POLL_LIMIT = 40;
/** 等玩家去公众号发码时，隔这么久查一次领到没有。 */
const WECHAT_POLL_MS = 4_000;
const PENDING_ORDER_KEY = "game-center-pending-order";
const PENDING_ORDER_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 跳去付款前记下订单号：爱发电付完不会跳回来，玩家自己回到大厅时靠它接着查结果。
 * 读写失败（隐私模式等）就只能靠网址上的 ?order=。
 */
function rememberPendingOrder(id: string | null): void {
  try {
    if (id) localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify({ id, at: Date.now() }));
    else localStorage.removeItem(PENDING_ORDER_KEY);
  } catch {
    // 存储不可用时忽略。
  }
}

export function readPendingOrder(): string | null {
  try {
    const stored = JSON.parse(localStorage.getItem(PENDING_ORDER_KEY) ?? "null") as { id?: unknown; at?: unknown } | null;
    if (stored && typeof stored.id === "string" && typeof stored.at === "number"
      && Date.now() - stored.at < PENDING_ORDER_TTL_MS) {
      return stored.id;
    }
  } catch {
    // 存储不可用或内容损坏时当作没有。
  }
  return null;
}

const ADMIN_TOKEN_KEY = "game-center-account-admin-token";
// 在网址后加 ?admin 才显示账号管理入口。
const adminEntryEnabled = new URLSearchParams(window.location.search).has("admin");

function readStoredAdminToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeAdminToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // 存储不可用时仅在本页有效。
  }
}

function formatDate(value: string | null): string {
  if (!value) return "未开通";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未开通";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function Account({
  user,
  onUserChange,
  returningOrderId,
}: {
  user: PublicAccount | null;
  onUserChange: (user: PublicAccount | null) => void;
  /** 从付款页回来时网址上带的订单号，用来查付款结果。 */
  returningOrderId: string | null;
}) {
  const [wechat, setWechat] = useState<WechatConfigResponse | null>(null);

  useEffect(() => {
    api.wechatConfig().then(setWechat).catch(() => setWechat({ enabled: false, name: null }));
  }, []);

  const trialHint = wechat?.enabled
    ? `注册后关注公众号领 ${TRIAL_DAYS} 天试用`
    : `注册就送 ${TRIAL_DAYS} 天试用`;

  return (
    <section className="account" id="account" aria-labelledby="account-title">
      <div className="account-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> 会员订阅</div>
          <h2 id="account-title">{user ? "你好，桌友。" : "登录后才能开桌。"}</h2>
          <p>
            {user
              ? `订阅有效期内，所有游戏都能进。${PRICE_PER_MONTH_YUAN} 元 / 月。`
              : `${trialHint}，之后 ${PRICE_PER_MONTH_YUAN} 元 / 月，所有游戏都能玩。`}
          </p>
        </div>
      </div>

      {user ? (
        <AccountStatus user={user} onUserChange={onUserChange} returningOrderId={returningOrderId} wechat={wechat} />
      ) : (
        <LoginRegister onUserChange={onUserChange} trialHint={trialHint} />
      )}

      {adminEntryEnabled && <AccountAdmin />}
    </section>
  );
}

function LoginRegister({ onUserChange, trialHint }: { onUserChange: (user: PublicAccount) => void; trialHint: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const action = mode === "login" ? api.login : api.register;
    action(username.trim(), password)
      .then((response) => {
        setBusy(false);
        setPassword("");
        onUserChange(response.user);
        setNotice(mode === "login" ? "已登录。" : "注册成功，已登录。");
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : "请求失败。");
      });
  }

  return (
    <div className="account-panel account-form-panel">
      <div className="account-tabs" role="tablist" aria-label="登录或注册">
        <button
          type="button"
          className={mode === "login" ? "account-tab active" : "account-tab"}
          aria-selected={mode === "login"}
          onClick={() => { setMode("login"); setError(""); setNotice(""); }}
        >
          登录
        </button>
        <button
          type="button"
          className={mode === "register" ? "account-tab active" : "account-tab"}
          aria-selected={mode === "register"}
          onClick={() => { setMode("register"); setError(""); setNotice(""); }}
        >
          注册
        </button>
      </div>

      <form className="account-form" onSubmit={submit}>
        <label className="field-label" htmlFor="account-username">用户名</label>
        <input
          id="account-username"
          className="text-input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="2–20 个字符，字母、数字、下划线或横线"
          maxLength={20}
          autoComplete="username"
          required
        />
        <label className="field-label field-label-spaced" htmlFor="account-password">密码</label>
        <input
          id="account-password"
          className="text-input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="至少 6 个字符"
          maxLength={100}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
        />
        {error && <p className="feedback feedback-error" role="alert">{error}</p>}
        {notice && <p className="feedback feedback-success" role="status">{notice}</p>}
        <button
          className="primary-button account-submit"
          type="submit"
          disabled={busy || !username.trim() || !password}
        >
          {busy ? <><span className="spinner" /> 请稍候</> : mode === "login" ? "登录" : "注册并登录"}
        </button>
        {mode === "register" ? (
          <p className="account-hint">注册即登录，{trialHint}；之后 {PRICE_PER_MONTH_YUAN} 元 / 月。</p>
        ) : (
          <p className="account-hint">忘记密码请在下方留言板留言，管理员帮你重置。</p>
        )}
      </form>
    </div>
  );
}

function statusBadge(user: PublicAccount): string {
  if (user.lifetime) return "永久会员";
  if (!user.subscribed) return user.paid ? "订阅已到期" : user.trialClaimed ? "试用已结束" : "未开通";
  if (user.trial) return `试用中 · 还剩 ${user.daysLeft} 天`;
  return `订阅至 ${formatDate(user.expiresAt)}（还剩 ${user.daysLeft} 天）`;
}

function statusNote(user: PublicAccount): string {
  if (user.lifetime) return "永久会员，所有游戏随便玩，不用续费。";
  if (!user.subscribed && !user.paid && !user.trialClaimed) return "还没开通。按上面的步骤去公众号领试用，或者在下方直接付款开通。";
  if (!user.subscribed) return "游戏入口暂时关闭了。在下方续费，或输入兑换码，马上就能继续玩。";
  if (user.trial) return `试用期内所有游戏都能玩。试用结束后 ${PRICE_PER_MONTH_YUAN} 元 / 月，现在续费，剩下的试用天数照样保留。`;
  if (user.daysLeft <= 3) return "订阅快到期了，续费后从原到期日往后顺延。";
  return "订阅有效，可以进入任意游戏开桌了。续费从原到期日往后顺延。";
}

function AccountStatus({
  user,
  onUserChange,
  returningOrderId,
  wechat,
}: {
  user: PublicAccount;
  onUserChange: (user: PublicAccount | null) => void;
  returningOrderId: string | null;
  wechat: WechatConfigResponse | null;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    api.redeem(code.trim())
      .then((response) => {
        setBusy(false);
        setCode("");
        onUserChange(response.user);
        setNotice("兑换成功，订阅已开通。");
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : "兑换失败。");
      });
  }

  function logout() {
    api.logout()
      .then(() => onUserChange(null))
      .catch(() => onUserChange(null));
  }

  return (
    <div className="account-panel account-status-panel">
      <div className="account-status-line">
        <span className="account-username">{user.username}</span>
        <span className={user.subscribed ? "account-badge subscribed" : "account-badge expired"}>
          {statusBadge(user)}
        </span>
      </div>

      {wechat?.enabled && !user.trialClaimed && (
        <WechatTrial wechatName={wechat.name} onUserChange={onUserChange} />
      )}

      <p className={user.lifetime || user.subscribed && user.daysLeft > 3 ? "account-status-note" : "account-status-note account-status-note-warn"}>
        {statusNote(user)}
      </p>

      {!user.lifetime && (
        <>
          <Purchase onUserChange={onUserChange} returningOrderId={returningOrderId} />

          <form className="account-redeem" onSubmit={redeem}>
            <label className="field-label" htmlFor="account-code">有兑换码？</label>
            <div className="account-redeem-row">
              <input
                id="account-code"
                className="text-input"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="例如 8K2M-PQ4X-7YTR"
                autoComplete="off"
                required
              />
              <button className="account-redeem-button" type="submit" disabled={busy || !code.trim()}>
                {busy ? <span className="spinner" /> : "开通 / 续费"}
              </button>
            </div>
            {error && <p className="feedback feedback-error" role="alert">{error}</p>}
            {notice && <p className="feedback feedback-success" role="status">{notice}</p>}
          </form>
        </>
      )}

      <button className="account-logout" type="button" onClick={logout}>退出登录</button>
    </div>
  );
}

/** 公众号领试用：显示绑定码，玩家在公众号发出去以后轮询账号，领到了就刷新状态。 */
function WechatTrial({
  wechatName,
  onUserChange,
}: {
  wechatName: string | null;
  onUserChange: (user: PublicAccount | null) => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const loadCode = () => {
      api.bindCode()
        .then((response) => {
          if (cancelled) return;
          setCode(response.code);
          setError("");
          // 码快过期时（服务端 30 分钟）换一个新的。
          timer = window.setTimeout(loadCode, Math.max(60_000, Date.parse(response.expiresAt) - Date.now() - 5 * 60_000));
        })
        .catch((reason: unknown) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : "读取验证码失败，请刷新页面。");
        });
    };
    loadCode();
    const poll = window.setInterval(() => {
      api.me()
        .then((response) => {
          if (!cancelled && response.user?.trialClaimed) onUserChange(response.user);
        })
        .catch(() => {});
    }, WECHAT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
    // 只在面板出现时开始；领到后面板消失，清理函数停掉轮询。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="account-wechat">
      <span className="field-label">领 {TRIAL_DAYS} 天免费试用</span>
      <ol className="account-wechat-steps">
        <li>微信搜索并关注公众号{wechatName ? <strong>「{wechatName}」</strong> : null}</li>
        <li>在公众号里发送下面的数字</li>
      </ol>
      <div className="account-wechat-code" aria-live="polite">{code ?? "······"}</div>
      {error
        ? <p className="feedback feedback-error" role="alert">{error}</p>
        : <p className="account-hint">发送后这里会自动开通，不用刷新。每个微信只能领一次。</p>}
    </div>
  );
}

/** 选时长、下单、跳去付款；付完回来按订单号查结果。 */
function Purchase({
  onUserChange,
  returningOrderId,
}: {
  onUserChange: (user: PublicAccount | null) => void;
  returningOrderId: string | null;
}) {
  const [config, setConfig] = useState<PayConfigResponse | null>(null);
  const [months, setMonths] = useState<number>(PLAN_MONTHS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // 正在查付款结果的订单号；玩家点「取消」就停止查询，可以重新下单。
  const [checkingOrderId, setCheckingOrderId] = useState(returningOrderId);
  const checking = checkingOrderId !== null;

  useEffect(() => {
    api.payConfig().then(setConfig).catch(() => setConfig({ enabled: false, label: null }));
    // 从付款页按「返回」回来时浏览器可能直接恢复旧页面（按钮还停在「正在下单」），重新加载一次去查结果。
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  useEffect(() => {
    if (!checkingOrderId) return;
    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;
    const poll = () => {
      attempts += 1;
      api.order(checkingOrderId)
        .then((response) => {
          if (cancelled) return;
          if (response.order.status === "paid") {
            rememberPendingOrder(null);
            setCheckingOrderId(null);
            onUserChange(response.user);
            setNotice(`付款成功：已续费 ${response.order.months} 个月，订阅至 ${formatDate(response.user.expiresAt)}。`);
            return;
          }
          if (attempts >= ORDER_POLL_LIMIT) {
            // 之后到账由服务端后台对账开通，不必每次打开大厅都再查一轮。
            rememberPendingOrder(null);
            setCheckingOrderId(null);
            setNotice(`订单 ${response.order.id} 还没查到付款。已经付过的话，到账后会自动开通，稍后刷新看看；还没付可以重新下单。`);
            return;
          }
          timer = window.setTimeout(poll, ORDER_POLL_MS);
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          // 订单不是这个账号的（比如换了号登录），就不再记着它。
          rememberPendingOrder(null);
          setCheckingOrderId(null);
          setError(reason instanceof Error ? reason.message : "查询订单失败。");
        });
    };
    poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // 每个订单只查一轮；取消时 checkingOrderId 变成 null，上面的清理函数停掉轮询。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkingOrderId]);

  /** 没付成功（关掉了付款页、付款失败等）时放弃等待。订单在服务端仍是待付，万一其实付了，后台对账照样会开通。 */
  function cancelChecking() {
    rememberPendingOrder(null);
    setCheckingOrderId(null);
    setError("");
    setNotice("已取消等待，可以重新选择时长付款。如果刚才其实付成功了，到账后会自动开通。");
  }

  function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    api.createOrder(months)
      .then((response) => {
        rememberPendingOrder(response.order.id);
        window.location.href = response.checkout.url;
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : "下单失败。");
      });
  }

  return (
    <form className="account-purchase" onSubmit={pay}>
      <span className="field-label">续费时长</span>
      <div className="account-plans" role="radiogroup" aria-label="续费时长">
        {PLAN_MONTHS.map((plan) => (
          <button
            key={plan}
            type="button"
            role="radio"
            aria-checked={months === plan}
            className={months === plan ? "account-plan active" : "account-plan"}
            onClick={() => setMonths(plan)}
          >
            <span className="account-plan-months">{plan} 个月</span>
            <span className="account-plan-price">{formatYuan(priceFen(plan))} 元</span>
          </button>
        ))}
      </div>
      {config?.enabled ? (
        <>
          <button className="primary-button account-pay" type="submit" disabled={busy || checking}>
            {busy || checking
              ? <><span className="spinner" /> {checking ? "正在确认付款结果" : "正在下单"}</>
              : `去${config.label ?? "在线"}付款 ${formatYuan(priceFen(months))} 元`}
          </button>
          {checking ? (
            <p className="account-hint">
              正在确认订单 {checkingOrderId} 的付款结果，付过款的话一般几十秒内开通。
              <button className="account-cancel" type="button" onClick={cancelChecking}>没付成功？取消，重新支付</button>
            </p>
          ) : (
            <p className="account-hint">
              会跳到{config.label ?? "付款页"}，用微信或支付宝付款。付完回到这个页面，一般几十秒内自动开通。
            </p>
          )}
        </>
      ) : (
        <p className="account-hint">
          {config ? "在线付款即将开通，暂时请找管理员购买兑换码。" : "正在读取付款方式…"}
        </p>
      )}
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success" role="status">{notice}</p>}
    </form>
  );
}

function formatAdminTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function AccountAdmin() {
  const [token, setToken] = useState(() => readStoredAdminToken());
  const [tokenInput, setTokenInput] = useState("");
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [orders, setOrders] = useState<PublicOrder[]>([]);
  const [months, setMonths] = useState("1");
  const [count, setCount] = useState("1");
  const [lifetimeCodes, setLifetimeCodes] = useState(false);
  const [generated, setGenerated] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function updateToken(next: string) {
    setToken(next);
    storeAdminToken(next);
    setError("");
    setNotice("");
    setGenerated([]);
  }

  function loadAccounts(nextToken: string) {
    setBusy(true);
    setError("");
    Promise.all([api.admin.accounts(nextToken), api.admin.orders(nextToken)])
      .then(([accountsResponse, ordersResponse]) => {
        setBusy(false);
        setAccounts(accountsResponse.accounts);
        setOrders(ordersResponse.orders);
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : "读取失败。");
        setAccounts([]);
        setOrders([]);
      });
  }

  function markPaid(order: PublicOrder) {
    if (!window.confirm(`确认已收到 ${order.username} 的 ${formatYuan(order.amountFen)} 元（订单 ${order.id}）？确认后给这个账号加 ${order.months} 个月。`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    api.admin.markPaid(token, order.id)
      .then(() => {
        setNotice(`订单 ${order.id} 已补单。`);
        loadAccounts(token);
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : "补单失败。");
      });
  }

  const paidActive = accounts.filter((account) => account.subscribed && !account.trial && !account.lifetime).length;
  const inTrial = accounts.filter((account) => account.trial).length;
  const lifetimeCount = accounts.filter((account) => account.lifetime).length;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthRevenueFen = orders
    .filter((order) => order.status === "paid" && order.paidAt && Date.parse(order.paidAt) >= monthStart.getTime())
    .reduce((sum, order) => sum + order.amountFen, 0);

  useEffect(() => {
    if (token) loadAccounts(token);
    // 只在进入管理时读一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function enter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tokenInput.trim()) updateToken(tokenInput.trim());
  }

  function extend(username: string) {
    setBusy(true);
    setError("");
    setNotice("");
    api.admin.extend(token, username, 1)
      .then(() => {
        setNotice(`${username} 已延长 1 个月。`);
        return loadAccounts(token);
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : "延长失败。");
      });
  }

  function toggleLifetime(account: PublicAccount) {
    setBusy(true);
    setError("");
    setNotice("");
    api.admin.lifetime(token, account.username, !account.lifetime)
      .then(() => {
        setNotice(account.lifetime ? `${account.username} 已取消永久会员。` : `${account.username} 已设为永久会员。`);
        loadAccounts(token);
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : "设置失败。");
      });
  }

  function resetPassword(username: string) {
    const next = window.prompt(`为 ${username} 设置新密码（至少 6 个字符）：`);
    if (next === null) return;
    setBusy(true);
    setError("");
    setNotice("");
    api.admin.resetPassword(token, username, next)
      .then(() => {
        setBusy(false);
        setNotice(`${username} 的密码已重置。`);
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : "重置失败。");
      });
  }

  function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    api.admin.code(token, Number(months), Number(count), lifetimeCodes)
      .then((response) => {
        setBusy(false);
        setGenerated(response.codes);
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : "生成失败。");
      });
  }

  function copyCodes() {
    const text = generated.join("\n");
    navigator.clipboard?.writeText(text).catch(() => {});
    setNotice(`已尝试复制 ${generated.length} 个兑换码。`);
  }

  if (!token) {
    return (
      <div className="account-admin">
        <form className="account-admin-row" onSubmit={enter}>
          <span>账号管理：输入管理员口令</span>
          <input
            className="text-input"
            type="password"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            placeholder="管理员口令"
            autoComplete="current-password"
            aria-label="管理员口令"
          />
          <button className="account-admin-button" type="submit" disabled={!tokenInput.trim()}>进入管理</button>
        </form>
      </div>
    );
  }

  return (
    <div className="account-admin">
      <div className="account-admin-row account-admin-top">
        <span>
          账号管理（{accounts.length} 个账号 · 付费有效 {paidActive} · 试用中 {inTrial} · 永久 {lifetimeCount} · 本月在线收款 {formatYuan(monthRevenueFen)} 元）
        </span>
        <button className="account-admin-button" type="button" onClick={() => updateToken("")}>退出管理</button>
      </div>

      <form className="account-admin-row account-admin-code" onSubmit={generate}>
        <label htmlFor="admin-months">生成兑换码</label>
        <select
          className="text-input account-admin-kind"
          value={lifetimeCodes ? "lifetime" : "months"}
          onChange={(event) => setLifetimeCodes(event.target.value === "lifetime")}
          aria-label="兑换码类型"
        >
          <option value="months">按月</option>
          <option value="lifetime">永久</option>
        </select>
        {!lifetimeCodes && (
          <>
            <input
              id="admin-months"
              className="text-input"
              type="number"
              min={1}
              max={120}
              value={months}
              onChange={(event) => setMonths(event.target.value)}
              aria-label="兑换码月数"
            />
            <span>个月</span>
          </>
        )}
        <span>×</span>
        <input
          className="text-input"
          type="number"
          min={1}
          max={100}
          value={count}
          onChange={(event) => setCount(event.target.value)}
          aria-label="兑换码数量"
        />
        <span>张</span>
        <button className="account-admin-button" type="submit" disabled={busy}>生成</button>
      </form>

      {generated.length > 0 && (
        <div className="account-admin-codes">
          <div className="account-admin-codes-head">
            <span>新生成的兑换码（请立即复制，刷新后不再显示）</span>
            <button className="account-admin-button" type="button" onClick={copyCodes}>复制全部</button>
          </div>
          <ul>{generated.map((code) => <li key={code}>{code}</li>)}</ul>
        </div>
      )}

      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

      {accounts.length > 0 ? (
        <div className="account-admin-table-wrap">
          <table className="account-admin-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>注册时间</th>
                <th>订阅到期</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.username}>
                  <td>{account.username}</td>
                  <td>{formatDate(account.createdAt)}</td>
                  <td>{formatDate(account.expiresAt)}</td>
                  <td>
                    {account.lifetime ? "永久"
                      : account.subscribed ? `${account.trial ? "试用" : "有效"} · ${account.daysLeft} 天`
                      : account.trialClaimed || account.paid ? "已到期" : "未开通"}
                    {account.wechatBound && " · 微信"}
                  </td>
                  <td className="account-admin-actions">
                    <button className="account-admin-button" type="button" disabled={busy} onClick={() => extend(account.username)}>
                      ＋1 月
                    </button>
                    <button className="account-admin-button" type="button" disabled={busy} onClick={() => toggleLifetime(account)}>
                      {account.lifetime ? "取消永久" : "设为永久"}
                    </button>
                    <button className="account-admin-button" type="button" disabled={busy} onClick={() => resetPassword(account.username)}>
                      重置密码
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !busy && <p className="account-admin-empty">还没有注册账号。</p>
      )}

      {orders.length > 0 && (
        <div className="account-admin-table-wrap">
          <table className="account-admin-table">
            <thead>
              <tr>
                <th>订单号</th>
                <th>用户名</th>
                <th>时长</th>
                <th>金额</th>
                <th>下单</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.id}</td>
                  <td>{order.username}</td>
                  <td>{order.months} 个月</td>
                  <td>{formatYuan(order.amountFen)} 元</td>
                  <td>{formatAdminTime(order.createdAt)}</td>
                  <td>
                    {order.status === "paid" ? `已付 ${formatAdminTime(order.paidAt)}` : (
                      <button className="account-admin-button" type="button" disabled={busy} onClick={() => markPaid(order)}>
                        未付 · 手动补单
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Account;
