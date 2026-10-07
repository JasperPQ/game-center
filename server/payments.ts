import type { IncomingMessage, ServerResponse } from "node:http";
import { formatYuan } from "../shared/pricing.js";
import { fulfilOrder, findOrder, type OrderRecord } from "./orders.js";

/** 下单后把玩家送去哪里付款。 */
export type Checkout = { kind: "redirect"; url: string };

/**
 * 一个收款渠道。新接渠道时实现这个接口，并在 providers 里登记：
 * - createCheckout：拿订单去渠道下单，返回付款页地址；
 * - handleRequest：渠道自己的回调路由（/api/pay/<id>/...），验签或回查确认到账后调用 fulfilOrder。
 */
export interface PaymentProvider {
  readonly id: string;
  /** 给玩家看的渠道名，例如「支付宝」。 */
  readonly label: string;
  createCheckout(order: OrderRecord): Promise<Checkout>;
  handleRequest(subpath: string, request: IncomingMessage, response: ServerResponse): Promise<boolean>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * 模拟渠道：只用于本地开发和测试，点「确认付款」就算付了。
 * 线上不要设置 PAY_PROVIDER=mock。
 */
const mockProvider: PaymentProvider = {
  id: "mock",
  label: "模拟支付",
  async createCheckout(order) {
    return { kind: "redirect", url: `/api/pay/mock/checkout?order=${encodeURIComponent(order.id)}` };
  },
  async handleRequest(subpath, request, response) {
    const url = new URL(request.url ?? "/", "http://localhost");
    const order = findOrder(url.searchParams.get("order"));
    if (!order) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("订单不存在");
      return true;
    }
    if (subpath === "checkout" && request.method === "GET") {
      const id = escapeHtml(order.id);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(`<!doctype html><meta charset="utf-8"><title>模拟支付</title>
<body style="font-family:sans-serif;max-width:360px;margin:60px auto">
<h2>模拟支付（仅开发用）</h2>
<p>订单 ${id}<br>${order.months} 个月 · ${formatYuan(order.amountFen)} 元</p>
<form method="post" action="/api/pay/mock/confirm?order=${encodeURIComponent(order.id)}"><button>确认付款</button></form>
<p><a href="/?order=${encodeURIComponent(order.id)}">取消，返回</a></p></body>`);
      return true;
    }
    if (subpath === "confirm" && request.method === "POST") {
      fulfilOrder(order.id, `mock-${Date.now()}`, order.amountFen);
      response.writeHead(302, { location: `/?order=${encodeURIComponent(order.id)}` });
      response.end();
      return true;
    }
    return false;
  },
};

const providers: Record<string, PaymentProvider> = {
  [mockProvider.id]: mockProvider,
};

/** 当前启用的渠道（环境变量 PAY_PROVIDER）；没配置时在线支付关闭，只能用兑换码。 */
export function activeProvider(): PaymentProvider | null {
  const id = process.env.PAY_PROVIDER;
  return id ? providers[id] ?? null : null;
}
