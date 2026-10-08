import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TRIAL_DAYS } from "../shared/pricing.js";
import type { PublicAccount } from "../shared/types.js";

const USERNAME_MIN = 2;
const USERNAME_MAX = 20;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 100;
const MONTHS_MAX = 120;
const CODES_MAX = 100;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 账号的完整记录（含密码，只留在服务端，绝不发给前端）。 */
export interface AccountRecord {
  username: string;
  salt: string;
  passwordHash: string;
  createdAt: string;
  expiresAt: string | null;
  lastLoginAt: string | null;
  /** 是否付过费（兑换码、管理员延长、在线支付都算）；没付过的有效期就是注册送的试用。 */
  paid: boolean;
  /** 永久会员：管理员给自己人开的，不看到期时间。 */
  lifetime: boolean;
  /** 绑定的公众号 openid；一个微信只能绑一个账号、领一次试用。 */
  wechatOpenId: string | null;
  /** 领过试用没有。老账号注册时就送了试用，读进来一律算领过。 */
  trialClaimed: boolean;
}

export interface RedeemCodeRecord {
  code: string;
  /** 加几个月；永久码为 0。 */
  months: number;
  /** 永久码：兑换后账号变成永久会员。 */
  lifetime: boolean;
  createdAt: string;
  usedBy: string | null;
  usedAt: string | null;
}

interface SessionRecord {
  username: string;
  createdAt: string;
}

export type AccountResult =
  | { ok: true; token: string; user: PublicAccount }
  | { ok: false; error: string };

export type AccountMutationResult =
  | { ok: true; user: PublicAccount }
  | { ok: false; error: string };

export type WechatTrialResult =
  | { ok: true; user: PublicAccount }
  | { ok: false; reason: "missing" | "claimed" | "wechat-used"; boundTo?: string };

export type AdminAccountResult =
  | { ok: true; account: PublicAccount }
  | { ok: false; error: string };

export type AdminCodesResult =
  | { ok: true; codes: string[] }
  | { ok: false; error: string };

const accountsPath = process.env.ACCOUNTS_FILE
  ?? fileURLToPath(new URL("../data/accounts.json", import.meta.url));
const codesPath = process.env.CODES_FILE
  ?? fileURLToPath(new URL("../data/codes.json", import.meta.url));
const sessionsPath = process.env.SESSIONS_FILE
  ?? fileURLToPath(new URL("../data/sessions.json", import.meta.url));

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

type StoredAccount = Omit<AccountRecord, "paid" | "lifetime" | "wechatOpenId" | "trialClaimed">
  & { paid?: boolean; lifetime?: boolean; wechatOpenId?: string | null; trialClaimed?: boolean };

function isAccountRecord(value: unknown): value is StoredAccount {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.username === "string"
    && typeof record.salt === "string"
    && typeof record.passwordHash === "string"
    && typeof record.createdAt === "string"
    && (record.expiresAt === null || typeof record.expiresAt === "string")
    && (record.lastLoginAt === null || typeof record.lastLoginAt === "string");
}

function isRedeemCodeRecord(value: unknown): value is Omit<RedeemCodeRecord, "lifetime"> & { lifetime?: boolean } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === "string"
    && typeof record.months === "number"
    && typeof record.createdAt === "string"
    && (record.usedBy === null || typeof record.usedBy === "string")
    && (record.usedAt === null || typeof record.usedAt === "string");
}

function loadAccounts(): AccountRecord[] {
  const parsed = readJsonFile(accountsPath);
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { accounts?: unknown }).accounts)) {
    return [];
  }
  return (parsed as { accounts: unknown[] }).accounts
    .filter(isAccountRecord)
    .map((account) => ({
      ...account,
      paid: account.paid === true,
      lifetime: account.lifetime === true,
      wechatOpenId: typeof account.wechatOpenId === "string" ? account.wechatOpenId : null,
      trialClaimed: account.trialClaimed !== false,
    }));
}

/** 删掉的账号绑过的微信：留着记录，删号后同一个微信不能再领一次试用。 */
function loadRetiredWechatOpenIds(): Set<string> {
  const parsed = readJsonFile(accountsPath);
  const stored = parsed && typeof parsed === "object" ? (parsed as { retiredWechatOpenIds?: unknown }).retiredWechatOpenIds : null;
  return new Set(Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : []);
}

function loadCodes(): RedeemCodeRecord[] {
  const parsed = readJsonFile(codesPath);
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { codes?: unknown }).codes)) {
    return [];
  }
  return (parsed as { codes: unknown[] }).codes
    .filter(isRedeemCodeRecord)
    .map((code) => ({ ...code, lifetime: code.lifetime === true }));
}

function isSessionExpired(session: SessionRecord): boolean {
  return Date.now() - Date.parse(session.createdAt) > SESSION_TTL_MS;
}

/** 文件格式是 { sessions: { token: 记录 } }；读的时候顺手丢掉已过期的。 */
function loadSessions(): Record<string, SessionRecord> {
  const parsed = readJsonFile(sessionsPath);
  const stored = parsed && typeof parsed === "object" ? (parsed as { sessions?: unknown }).sessions : null;
  if (!stored || typeof stored !== "object") return {};
  const result: Record<string, SessionRecord> = {};
  for (const [token, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (typeof record.username !== "string" || typeof record.createdAt !== "string") continue;
    const session = { username: record.username, createdAt: record.createdAt };
    if (!isSessionExpired(session)) result[token] = session;
  }
  return result;
}

let accounts = loadAccounts();
let retiredWechatOpenIds = loadRetiredWechatOpenIds();
let codes = loadCodes();
let sessions = loadSessions();

function saveAccounts(): void {
  writeJsonAtomic(accountsPath, { accounts, retiredWechatOpenIds: [...retiredWechatOpenIds] });
}

function saveCodes(): void {
  writeJsonAtomic(codesPath, { codes });
}

function saveSessions(): void {
  writeJsonAtomic(sessionsPath, { sessions });
}

function hashPassword(password: string, saltHex: string): string {
  return scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
}

function verifyPassword(password: string, account: AccountRecord): boolean {
  const candidate = Buffer.from(hashPassword(password, account.salt), "hex");
  return timingSafeEqual(candidate, Buffer.from(account.passwordHash, "hex"));
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim();
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) return null;
  if (!/^[\p{L}\p{N}_-]+$/u.test(username)) return null;
  return username;
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) return null;
  return value;
}

function normalizeMonths(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const months = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(months) || months < 1 || months > MONTHS_MAX) return null;
  return months;
}

function normalizeCount(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(count) || count < 1 || count > CODES_MAX) return null;
  return count;
}

/** 兑换码不区分大小写，忽略空格和横线，只比对字母数字。 */
function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase().replace(/[\s-]/g, "");
  return code.length >= 1 && code.length <= 32 ? code : null;
}

function findAccount(username: string): AccountRecord | undefined {
  const needle = username.toLowerCase();
  return accounts.find((account) => account.username.toLowerCase() === needle);
}

function isSubscribed(account: AccountRecord): boolean {
  return account.lifetime || account.expiresAt !== null && Date.parse(account.expiresAt) > Date.now();
}

function daysLeft(account: AccountRecord): number {
  if (account.expiresAt === null) return 0;
  return Math.max(0, Math.ceil((Date.parse(account.expiresAt) - Date.now()) / DAY_MS));
}

function toPublicAccount(account: AccountRecord): PublicAccount {
  const subscribed = isSubscribed(account);
  return {
    username: account.username,
    createdAt: account.createdAt,
    expiresAt: account.expiresAt,
    subscribed,
    trial: subscribed && !account.paid && !account.lifetime,
    paid: account.paid,
    lifetime: account.lifetime,
    daysLeft: daysLeft(account),
    lastLoginAt: account.lastLoginAt,
    wechatBound: account.wechatOpenId !== null,
    trialClaimed: account.trialClaimed,
  };
}

/** 从未到期时间或现在开始，往后延 months 个自然月；试用剩下的天数也保留。 */
function extendAccount(account: AccountRecord, months: number): void {
  const base = account.expiresAt !== null && Date.parse(account.expiresAt) > Date.now()
    ? new Date(account.expiresAt)
    : new Date();
  base.setMonth(base.getMonth() + months);
  account.expiresAt = base.toISOString();
  account.paid = true;
}

function createSession(username: string): string {
  const token = randomBytes(32).toString("base64url");
  sessions[token] = { username, createdAt: new Date().toISOString() };
  saveSessions();
  return token;
}

export function destroySession(token: string | null): void {
  if (token && sessions[token]) {
    delete sessions[token];
    saveSessions();
  }
}

/** 用会话 token 拿到当前账号，token 无效、过期或账号不存在时返回 null。 */
export function currentUser(token: string | null): PublicAccount | null {
  if (!token) return null;
  const session = sessions[token];
  if (!session) return null;
  if (isSessionExpired(session)) {
    delete sessions[token];
    saveSessions();
    return null;
  }
  const account = findAccount(session.username);
  return account ? toPublicAccount(account) : null;
}

/** withTrial 为 false 时（公众号领试用模式）新账号不带试用，要绑定微信后才送。 */
export function register(usernameValue: unknown, passwordValue: unknown, withTrial = true): AccountResult {
  const username = normalizeUsername(usernameValue);
  if (!username) {
    return { ok: false, error: `用户名需为 ${USERNAME_MIN}–${USERNAME_MAX} 个字符，只能含字母、数字、下划线和横线。` };
  }
  const password = normalizePassword(passwordValue);
  if (!password) {
    return { ok: false, error: `密码需为 ${PASSWORD_MIN}–${PASSWORD_MAX} 个字符。` };
  }
  if (findAccount(username)) {
    return { ok: false, error: "这个用户名已经被注册了。" };
  }
  const salt = randomBytes(16).toString("hex");
  const now = Date.now();
  const account: AccountRecord = {
    username,
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date(now).toISOString(),
    expiresAt: withTrial ? new Date(now + TRIAL_DAYS * DAY_MS).toISOString() : null,
    lastLoginAt: null,
    paid: false,
    lifetime: false,
    wechatOpenId: null,
    trialClaimed: withTrial,
  };
  accounts = [...accounts, account];
  saveAccounts();
  const token = createSession(username);
  return { ok: true, token, user: toPublicAccount(account) };
}

export function login(usernameValue: unknown, passwordValue: unknown): AccountResult {
  const username = normalizeUsername(usernameValue);
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const account = username ? findAccount(username) : undefined;
  if (!account || !verifyPassword(password, account)) {
    return { ok: false, error: "用户名或密码不正确。" };
  }
  account.lastLoginAt = new Date().toISOString();
  saveAccounts();
  const token = createSession(account.username);
  return { ok: true, token, user: toPublicAccount(account) };
}

export function redeem(username: string, codeValue: unknown): AccountMutationResult {
  const code = normalizeCode(codeValue);
  if (!code) return { ok: false, error: "请输入兑换码。" };
  const record = codes.find((candidate) => !candidate.usedBy && normalizeCode(candidate.code) === code);
  if (!record) return { ok: false, error: "兑换码无效或已被使用。" };
  const account = findAccount(username);
  if (!account) return { ok: false, error: "账号不存在。" };
  record.usedBy = username;
  record.usedAt = new Date().toISOString();
  if (record.lifetime) account.lifetime = true;
  else extendAccount(account, record.months);
  saveCodes();
  saveAccounts();
  return { ok: true, user: toPublicAccount(account) };
}

/**
 * 公众号里发了绑定码：把这个微信绑到账号上，送试用（从现在或原到期时间往后加 TRIAL_DAYS 天）。
 * 账号领过试用、或者这个微信已经绑过别的账号，都不送。
 */
export function claimWechatTrial(username: string, openId: string): WechatTrialResult {
  const account = findAccount(username);
  if (!account) return { ok: false, reason: "missing" };
  const owner = accounts.find((candidate) => candidate.wechatOpenId === openId);
  if (owner) return { ok: false, reason: "wechat-used", boundTo: owner.username };
  if (retiredWechatOpenIds.has(openId)) return { ok: false, reason: "wechat-used", boundTo: "（已删除的账号）" };
  if (account.trialClaimed) return { ok: false, reason: "claimed" };
  const now = Date.now();
  const base = account.expiresAt !== null && Date.parse(account.expiresAt) > now ? Date.parse(account.expiresAt) : now;
  account.expiresAt = new Date(base + TRIAL_DAYS * DAY_MS).toISOString();
  account.wechatOpenId = openId;
  account.trialClaimed = true;
  saveAccounts();
  return { ok: true, user: toPublicAccount(account) };
}

/** 付款成功后给账号加月数（在线支付走这里）。 */
export function grantMonths(username: string, months: number): PublicAccount | null {
  const account = findAccount(username);
  if (!account) return null;
  extendAccount(account, months);
  saveAccounts();
  return toPublicAccount(account);
}

export function extendSubscription(usernameValue: unknown, monthsValue: unknown): AdminAccountResult {
  const username = normalizeUsername(usernameValue);
  if (!username) return { ok: false, error: "用户名不正确。" };
  const months = normalizeMonths(monthsValue);
  if (!months) return { ok: false, error: `延长月数需为 1–${MONTHS_MAX} 的整数。` };
  const account = findAccount(username);
  if (!account) return { ok: false, error: "账号不存在。" };
  extendAccount(account, months);
  saveAccounts();
  return { ok: true, account: toPublicAccount(account) };
}

/** 设为或取消永久会员。取消后回到原来的到期时间。 */
export function setLifetime(usernameValue: unknown, lifetimeValue: unknown): AdminAccountResult {
  const username = normalizeUsername(usernameValue);
  if (!username) return { ok: false, error: "用户名不正确。" };
  if (typeof lifetimeValue !== "boolean") return { ok: false, error: "缺少 lifetime 参数。" };
  const account = findAccount(username);
  if (!account) return { ok: false, error: "账号不存在。" };
  account.lifetime = lifetimeValue;
  saveAccounts();
  return { ok: true, account: toPublicAccount(account) };
}

/** 生成兑换码：lifetime 为 true 时是永久码（忽略月数）。 */
export function generateCodes(monthsValue: unknown, countValue: unknown, lifetimeValue: unknown = false): AdminCodesResult {
  const lifetime = lifetimeValue === true;
  const months = lifetime ? 0 : normalizeMonths(monthsValue);
  if (months === null) return { ok: false, error: `月数需为 1–${MONTHS_MAX} 的整数。` };
  const count = normalizeCount(countValue);
  if (!count) return { ok: false, error: `数量需为 1–${CODES_MAX} 的整数。` };
  const created: RedeemCodeRecord[] = [];
  const result: string[] = [];
  const bytes = randomBytes(12 * Math.max(count, 1));
  for (let i = 0; i < count; i++) {
    let raw = "";
    for (let j = 0; j < 12; j++) {
      const byte = bytes[i * 12 + j] ?? 0;
      raw += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    }
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    result.push(code);
    created.push({ code, months, lifetime, createdAt: new Date().toISOString(), usedBy: null, usedAt: null });
  }
  codes = [...codes, ...created];
  saveCodes();
  return { ok: true, codes: result };
}

export function resetPassword(usernameValue: unknown, passwordValue: unknown): AdminAccountResult {
  const username = normalizeUsername(usernameValue);
  if (!username) return { ok: false, error: "用户名不正确。" };
  const password = normalizePassword(passwordValue);
  if (!password) return { ok: false, error: `密码需为 ${PASSWORD_MIN}–${PASSWORD_MAX} 个字符。` };
  const account = findAccount(username);
  if (!account) return { ok: false, error: "账号不存在。" };
  account.salt = randomBytes(16).toString("hex");
  account.passwordHash = hashPassword(password, account.salt);
  saveAccounts();
  return { ok: true, account: toPublicAccount(account) };
}

/**
 * 管理员删除账号：账号和它的登录状态一起删掉，已经打开的网页下次请求就会回到登录。
 * 订单记录保留（对账用）；绑过的微信记下来，不能再领一次试用。
 */
export function deleteAccount(usernameValue: unknown): AdminAccountResult {
  const username = normalizeUsername(usernameValue);
  if (!username) return { ok: false, error: "用户名不正确。" };
  const account = findAccount(username);
  if (!account) return { ok: false, error: "账号不存在。" };
  const removed = toPublicAccount(account);
  accounts = accounts.filter((candidate) => candidate !== account);
  if (account.wechatOpenId) retiredWechatOpenIds.add(account.wechatOpenId);
  saveAccounts();
  const key = account.username.toLowerCase();
  let loggedOut = false;
  for (const [token, session] of Object.entries(sessions)) {
    if (session.username.toLowerCase() === key) {
      delete sessions[token];
      loggedOut = true;
    }
  }
  if (loggedOut) saveSessions();
  return { ok: true, account: removed };
}

export function listAccounts(): PublicAccount[] {
  return [...accounts]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toPublicAccount);
}
