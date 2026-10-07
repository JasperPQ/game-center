import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody } from "./body.js";
import { findOrder, fulfilOrder, pendingOrders } from "./orders.js";
import type { PaymentProvider } from "./payments.js";

/**
 * 爱发电（afdian.com）收款。
 * - 下单：跳到爱发电的方案购买页，链接里带 month（月数）和 custom_order_id（我们的订单号）。
 * - 到账：爱发电的 Webhook 不带签名，所以收到通知后拿 out_trade_no 回查一次开放 API，以 API 返回为准；
 *   另外玩家回到大厅等结果时、以及后台每分钟，都会翻一遍最近的订单补账，Webhook 没配或丢了也能开通。
 * 配置（环境变量）：AFDIAN_USER_ID、AFDIAN_TOKEN、AFDIAN_PLAN_ID，可选 AFDIAN_BASE（默认 https://afdian.com）。
 */

const API_TIMEOUT_MS = 10_000;
/** 两次翻订单之间至少隔这么久，多个玩家同时等结果也只打一次 API。 */
const SYNC_MIN_INTERVAL_MS = 5_000;
/** 只对最近两天的待付订单补账。 */
const SYNC_WINDOW_MS = 48 * 60 * 60 * 1000;
/** 爱发电订单状态：2 = 交易成功。 */
const AFDIAN_PAID = 2;

interface AfdianConfig {
  userId: string;
  token: string;
  planId: string;
  base: string;
}

/** 爱发电 API 返回的订单里我们用到的字段。 */
export interface AfdianOrder {
  out_trade_no: string;
  custom_order_id?: string;
  plan_id: string;
  month: number;
  total_amount: string;
  status: number;
}

function readConfig(): AfdianConfig | null {
  const { AFDIAN_USER_ID: userId, AFDIAN_TOKEN: token, AFDIAN_PLAN_ID: planId } = process.env;
  if (!userId || !token || !planId) return null;
  return { userId, token, planId, base: (process.env.AFDIAN_BASE ?? "https://afdian.com").replace(/\/+$/, "") };
}

/** 签名：md5(token + "params" + params + "ts" + ts + "user_id" + user_id)，见爱发电开发者文档。 */
export function afdianSign(token: string, params: string, ts: number, userId: string): string {
  return createHash("md5").update(`${token}params${params}ts${ts}user_id${userId}`).digest("hex");
}

async function callApi(config: AfdianConfig, path: string, params: Record<string, unknown>): Promise<unknown> {
  const ts = Math.floor(Date.now() / 1000);
  const paramsJson = JSON.stringify(params);
  const response = await fetch(`${config.base}/api/open/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: config.userId,
      params: paramsJson,
      ts,
      sign: afdianSign(config.token, paramsJson, ts, config.userId),
    }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const body = await response.json() as { ec?: number; em?: string; data?: unknown };
  if (body.ec !== 200) throw new Error(`爱发电接口 ${path} 返回 ${body.ec}：${body.em ?? ""}`);
  return body.data;
}

async function queryOrders(config: AfdianConfig, params: Record<string, unknown>): Promise<AfdianOrder[]> {
  const data = await callApi(config, "query-order", params) as { list?: unknown };
  return Array.isArray(data?.list) ? data.list as AfdianOrder[] : [];
}

/** 按爱发电的订单给我们的订单记账：必须是成功状态、我们的方案、能对上订单号；金额由 fulfilOrder 核对。 */
function settle(config: AfdianConfig, afdianOrder: AfdianOrder): void {
  if (afdianOrder.status !== AFDIAN_PAID || afdianOrder.plan_id !== config.planId) return;
  const order = findOrder(afdianOrder.custom_order_id);
  if (!order || order.status === "paid") return;
  const paidFen = Math.round(Number(afdianOrder.total_amount) * 100);
  const result = fulfilOrder(order.id, afdianOrder.out_trade_no, paidFen);
  if (!result.ok) console.warn(`[afdian] 订单 ${order.id} 未记账：${result.error}`);
}

let lastSyncAt = 0;
let syncing: Promise<void> | null = null;

/** 翻最近 50 笔爱发电订单，给能对上的待付订单记账。 */
function syncRecent(config: AfdianConfig): Promise<void> {
  if (syncing) return syncing;
  if (Date.now() - lastSyncAt < SYNC_MIN_INTERVAL_MS) return Promise.resolve();
  if (pendingOrders("afdian", Date.now() - SYNC_WINDOW_MS).length === 0) return Promise.resolve();
  lastSyncAt = Date.now();
  syncing = queryOrders(config, { page: 1 })
    .then((list) => list.forEach((afdianOrder) => settle(config, afdianOrder)))
    .catch((error: unknown) => console.warn("[afdian] 对账失败：", error instanceof Error ? error.message : error))
    .finally(() => { syncing = null; });
  return syncing;
}

function sendAfdianAck(response: ServerResponse, ok: boolean): void {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(ok ? { ec: 200, em: "" } : { ec: 500, em: "verify failed" }));
}

/** Webhook：只取 out_trade_no，回查 API 后再记账。爱发电保存地址时发的测试通知查不到订单，照样回成功。 */
async function handleWebhook(config: AfdianConfig, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readBody(request).catch(() => null) as { data?: { order?: { out_trade_no?: unknown } } } | null;
  const tradeNo = body?.data?.order?.out_trade_no;
  if (typeof tradeNo !== "string" || !tradeNo) {
    sendAfdianAck(response, true);
    return;
  }
  try {
    const list = await queryOrders(config, { out_trade_no: tradeNo });
    list.forEach((afdianOrder) => settle(config, afdianOrder));
    sendAfdianAck(response, true);
  } catch (error) {
    // 回查失败让爱发电稍后重推。
    console.warn("[afdian] Webhook 回查失败：", error instanceof Error ? error.message : error);
    sendAfdianAck(response, false);
  }
}

/** 没配全 AFDIAN_* 时返回 null，在线支付保持关闭。 */
export function createAfdianProvider(): PaymentProvider | null {
  const config = readConfig();
  if (!config) return null;
  return {
    id: "afdian",
    label: "爱发电",
    async createCheckout(order) {
      const params = new URLSearchParams({
        plan_id: config.planId,
        product_type: "0",
        month: String(order.months),
        custom_order_id: order.id,
      });
      return { kind: "redirect", url: `${config.base}/order/create?${params.toString()}` };
    },
    async handleRequest(subpath, request, response) {
      if (subpath !== "webhook" || request.method !== "POST") return false;
      await handleWebhook(config, request, response);
      return true;
    },
    sync: () => syncRecent(config),
  };
}
