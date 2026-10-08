import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { TRIAL_DAYS } from "../shared/pricing.js";
import { claimWechatTrial } from "./accounts.js";
import { readRawBody } from "./body.js";
import { RateLimiter } from "./rate-limit.js";

/**
 * 公众号（个人订阅号）领试用：网站给登录的账号发一个 6 位绑定码，玩家关注公众号后把码发过去，
 * 公众号把消息转给 /api/wechat，我们按发消息的 openid 绑定账号、送试用。一个微信只能领一次。
 * 个人订阅号没有主动发消息的权限，只能在 5 秒内被动回复，所以所有结果都在回包里说。
 * 公众号后台的消息加解密方式选「明文模式」。
 * 配置（环境变量）：WECHAT_TOKEN（和公众号后台填的 Token 一致，设了才开接口）、WECHAT_NAME（公众号名称，显示在网页上）、
 * WECHAT_TRIAL=on（注册不再直接送试用，改成去公众号领；公众号接好之后再打开）。
 */

const BIND_CODE_TTL_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SITE_URL = "https://gulugagame.com/";

interface BindCode {
  code: string;
  username: string;
  expiresAt: number;
}

/** 绑定码只放内存：服务重启后旧码作废，玩家刷新页面拿新码即可。 */
const codesByCode = new Map<string, BindCode>();
const codesByUser = new Map<string, BindCode>();
/** 同一个微信一小时最多发错 10 次码，防止乱猜别人的码。 */
const wrongCodeLimiter = new RateLimiter(10, HOUR_MS);

function wechatToken(): string | null {
  return process.env.WECHAT_TOKEN?.trim() || null;
}

export function wechatName(): string | null {
  return process.env.WECHAT_NAME?.trim() || null;
}

/** 注册是否改成去公众号领试用。 */
export function wechatTrialEnabled(): boolean {
  return wechatToken() !== null && process.env.WECHAT_TRIAL === "on";
}

function dropExpired(now: number): void {
  for (const entry of codesByCode.values()) {
    if (entry.expiresAt <= now) {
      codesByCode.delete(entry.code);
      if (codesByUser.get(entry.username.toLowerCase()) === entry) codesByUser.delete(entry.username.toLowerCase());
    }
  }
}

/** 给账号发绑定码；还没过期就沿用旧码，页面反复刷新码不会变。 */
export function issueBindCode(username: string): { code: string; expiresAt: string } {
  const now = Date.now();
  dropExpired(now);
  const key = username.toLowerCase();
  let entry = codesByUser.get(key);
  // 剩不到 5 分钟的码换一个，免得玩家刚抄下来就过期。
  if (!entry || entry.expiresAt - now < 5 * 60 * 1000) {
    if (entry) codesByCode.delete(entry.code);
    let code: string;
    do code = String(randomInt(100000, 1000000)); while (codesByCode.has(code));
    entry = { code, username, expiresAt: now + BIND_CODE_TTL_MS };
    codesByCode.set(code, entry);
    codesByUser.set(key, entry);
  }
  return { code: entry.code, expiresAt: new Date(entry.expiresAt).toISOString() };
}

/** 微信的签名：token、timestamp、nonce 字典序排好拼起来做 sha1。 */
function verifySignature(token: string, url: URL): boolean {
  const signature = url.searchParams.get("signature") ?? "";
  const timestamp = url.searchParams.get("timestamp") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  const expected = createHash("sha1").update([token, timestamp, nonce].sort().join("")).digest("hex");
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** 公众号推来的 XML 很扁平，按标签名取值就够了（兼容 CDATA 和纯文本）。 */
export function xmlField(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${tag}>`).exec(xml);
  if (!match) return null;
  return match[1] ?? match[2] ?? "";
}

function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function textReply(toUser: string, fromUser: string, content: string): string {
  return `<xml><ToUserName>${cdata(toUser)}</ToUserName><FromUserName>${cdata(fromUser)}</FromUserName>`
    + `<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType>${cdata("text")}</MsgType>`
    + `<Content>${cdata(content)}</Content></xml>`;
}

const HELP = [
  `领 ${TRIAL_DAYS} 天试用：在 ${SITE_URL} 注册登录，把网页上显示的 6 位数字发到这里。`,
  `续费：在网页上「会员订阅」里付款，回复「续费」也能拿到链接。`,
  "其他问题请到网站首页的留言板留言。",
].join("\n");

/** 根据玩家发来的内容决定回什么。 */
export function replyFor(openId: string, msgType: string, event: string, content: string): string | null {
  if (msgType === "event") {
    if (event === "subscribe") return `欢迎关注${wechatName() ? `「${wechatName()}」` : ""}！\n\n${HELP}`;
    return null;
  }
  if (msgType !== "text") return HELP;
  const text = content.trim();
  const digits = text.replace(/\s/g, "");
  if (/^\d{6}$/.test(digits)) return bindReply(openId, digits);
  if (/续费|付款|会员|充值|购买/.test(text)) return `续费在这里：${SITE_URL}#account\n登录后在「会员订阅」里选时长付款，几十秒内自动到账。`;
  return HELP;
}

function bindReply(openId: string, code: string): string {
  if (wrongCodeLimiter.isLimited(openId)) return "发错的次数太多了，请一小时后再试。";
  dropExpired(Date.now());
  const entry = codesByCode.get(code);
  if (!entry) {
    wrongCodeLimiter.hit(openId);
    return "这个数字不对或者已经过期了。请刷新网页，发送页面上最新的 6 位数字。";
  }
  const result = claimWechatTrial(entry.username, openId);
  if (result.ok) {
    codesByCode.delete(entry.code);
    codesByUser.delete(entry.username.toLowerCase());
    return `领取成功！账号「${entry.username}」已开通 ${TRIAL_DAYS} 天试用，回到网页就能开始玩了。`;
  }
  if (result.reason === "wechat-used") {
    return result.boundTo?.toLowerCase() === entry.username.toLowerCase()
      ? `这个微信已经给账号「${entry.username}」领过试用了。`
      : `这个微信已经给账号「${result.boundTo}」领过试用，每个微信只能领一次。想继续玩可以在网页上续费。`;
  }
  if (result.reason === "claimed") return `账号「${entry.username}」已经领过试用了。想继续玩可以在网页上续费。`;
  return "没找到这个账号，请刷新网页后重试。";
}

/** 处理 /api/wechat：GET 是公众号后台保存配置时的校验，POST 是玩家发来的消息和关注事件。 */
export async function handleWechatRequest(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const token = wechatToken();
  if (!token || !verifySignature(token, url)) {
    response.writeHead(token ? 403 : 404, { "content-type": "text/plain; charset=utf-8" });
    response.end(token ? "bad signature" : "not configured");
    return;
  }
  if (request.method === "GET") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(url.searchParams.get("echostr") ?? "");
    return;
  }
  const xml = await readRawBody(request);
  const openId = xmlField(xml, "FromUserName");
  const accountId = xmlField(xml, "ToUserName");
  const reply = openId && accountId
    ? replyFor(openId, xmlField(xml, "MsgType") ?? "", xmlField(xml, "Event") ?? "", xmlField(xml, "Content") ?? "")
    : null;
  // 不需要回复时按微信的约定回 "success"，否则公众号会提示「该公众号暂时无法提供服务」。
  response.writeHead(200, { "content-type": reply ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8" });
  response.end(reply && openId && accountId ? textReply(openId, accountId, reply) : "success");
}
