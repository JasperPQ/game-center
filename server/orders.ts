import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAN_MONTHS, priceFen } from "../shared/pricing.js";
import type { PublicAccount, PublicOrder } from "../shared/types.js";
import { grantMonths } from "./accounts.js";

const ORDER_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ADMIN_LIST_LIMIT = 200;

/** 订单记录。金额一律用「分」存，避免小数。 */
export interface OrderRecord {
  id: string;
  username: string;
  months: number;
  amountFen: number;
  provider: string;
  status: "pending" | "paid";
  createdAt: string;
  paidAt: string | null;
  /** 支付渠道那边的交易号；管理员手动确认的记 "manual"。 */
  tradeNo: string | null;
}

export type CreateOrderResult = { ok: true; order: OrderRecord } | { ok: false; error: string };

export type FulfilResult =
  | { ok: true; order: OrderRecord; user: PublicAccount | null; alreadyPaid: boolean }
  | { ok: false; error: string };

const ordersPath = process.env.ORDERS_FILE
  ?? fileURLToPath(new URL("../data/orders.json", import.meta.url));

function isOrderRecord(value: unknown): value is OrderRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && typeof record.username === "string"
    && typeof record.months === "number"
    && typeof record.amountFen === "number"
    && typeof record.provider === "string"
    && (record.status === "pending" || record.status === "paid")
    && typeof record.createdAt === "string"
    && (record.paidAt === null || typeof record.paidAt === "string")
    && (record.tradeNo === null || typeof record.tradeNo === "string");
}

function loadOrders(): OrderRecord[] {
  if (!existsSync(ordersPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(ordersPath, "utf8")) as { orders?: unknown };
    return Array.isArray(parsed.orders) ? parsed.orders.filter(isOrderRecord) : [];
  } catch {
    return [];
  }
}

let orders = loadOrders();

function saveOrders(): void {
  mkdirSync(dirname(ordersPath), { recursive: true });
  const temporaryPath = `${ordersPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ orders }, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, ordersPath);
}

/** 订单号形如 GC20261007-7K2M9QXT：日期方便对账，后面随机，玩家付款备注里也好抄。 */
function newOrderId(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const bytes = randomBytes(8);
  let suffix = "";
  for (const byte of bytes) suffix += ORDER_ID_ALPHABET[byte % ORDER_ID_ALPHABET.length];
  return `GC${date}-${suffix}`;
}

export function toPublicOrder(order: OrderRecord): PublicOrder {
  return {
    id: order.id,
    username: order.username,
    months: order.months,
    amountFen: order.amountFen,
    status: order.status,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
  };
}

export function createOrder(username: string, monthsValue: unknown, provider: string): CreateOrderResult {
  const months = typeof monthsValue === "number" ? monthsValue : Number(monthsValue);
  if (!(PLAN_MONTHS as readonly number[]).includes(months)) {
    return { ok: false, error: `可购买的时长是 ${PLAN_MONTHS.join(" / ")} 个月。` };
  }
  const order: OrderRecord = {
    id: newOrderId(),
    username,
    months,
    amountFen: priceFen(months),
    provider,
    status: "pending",
    createdAt: new Date().toISOString(),
    paidAt: null,
    tradeNo: null,
  };
  orders = [...orders, order];
  saveOrders();
  return { ok: true, order };
}

export function findOrder(id: unknown): OrderRecord | undefined {
  if (typeof id !== "string") return undefined;
  const needle = id.trim().toUpperCase();
  return orders.find((order) => order.id === needle);
}

/**
 * 确认收到钱后给订单记账并给账号加时长。支付渠道的通知可能重复推送，同一个订单只记一次。
 * 实收金额少于订单金额时拒绝（防止改价后付少了也开通）。
 */
export function fulfilOrder(id: unknown, tradeNo: string, paidFen: number): FulfilResult {
  const order = findOrder(id);
  if (!order) return { ok: false, error: "订单不存在。" };
  if (order.status === "paid") {
    return { ok: true, order, user: null, alreadyPaid: true };
  }
  if (!Number.isFinite(paidFen) || paidFen < order.amountFen) {
    return { ok: false, error: `实付金额 ${paidFen} 分少于订单金额 ${order.amountFen} 分。` };
  }
  const user = grantMonths(order.username, order.months);
  if (!user) return { ok: false, error: "订单对应的账号不存在。" };
  order.status = "paid";
  order.paidAt = new Date().toISOString();
  order.tradeNo = tradeNo;
  saveOrders();
  return { ok: true, order, user, alreadyPaid: false };
}

/** 某个渠道在 sinceMs 之后创建、还没付的订单（后台对账用）。 */
export function pendingOrders(provider: string, sinceMs: number): OrderRecord[] {
  return orders.filter((order) =>
    order.provider === provider && order.status === "pending" && Date.parse(order.createdAt) >= sinceMs);
}

/** 管理页用：最近的订单在前。 */
export function listOrders(): PublicOrder[] {
  return orders.slice(-ADMIN_LIST_LIMIT).reverse().map(toPublicOrder);
}
