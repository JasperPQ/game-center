import type { PublicAccount, PublicOrder } from "../shared/types";

export interface MeResponse {
  user: PublicAccount | null;
}
export interface AuthResponse {
  user: PublicAccount;
}
export interface AccountsResponse {
  accounts: PublicAccount[];
}
export interface CodesResponse {
  codes: string[];
}
export interface PayConfigResponse {
  enabled: boolean;
  label: string | null;
}
export interface CreateOrderResponse {
  order: PublicOrder;
  checkout: { kind: "redirect"; url: string };
}
export interface WechatConfigResponse {
  /** 打开后注册不送试用，要去公众号发绑定码领。 */
  enabled: boolean;
  name: string | null;
}
export interface BindCodeResponse {
  code: string;
  expiresAt: string;
}
export interface OrderResponse {
  order: PublicOrder;
  user: PublicAccount;
}

interface ErrorBody {
  error?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) {
    throw new Error(body.error ?? `请求失败（${response.status}）`);
  }
  return body;
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: "POST", headers, body: JSON.stringify(body) };
}

export const api = {
  me: () => request<MeResponse>("/api/me"),
  register: (username: string, password: string) =>
    request<AuthResponse>("/api/register", post("/api/register", { username, password })),
  login: (username: string, password: string) =>
    request<AuthResponse>("/api/login", post("/api/login", { username, password })),
  logout: () => request<{ ok: boolean }>("/api/logout", { method: "POST" }),
  redeem: (code: string) => request<AuthResponse>("/api/redeem", post("/api/redeem", { code })),
  payConfig: () => request<PayConfigResponse>("/api/pay/config"),
  wechatConfig: () => request<WechatConfigResponse>("/api/wechat/config"),
  bindCode: () => request<BindCodeResponse>("/api/wechat/bind-code"),
  createOrder: (months: number) =>
    request<CreateOrderResponse>("/api/orders", post("/api/orders", { months })),
  order: (id: string) => request<OrderResponse>(`/api/orders/${encodeURIComponent(id)}`),
  admin: {
    accounts: (token: string) =>
      request<AccountsResponse>("/api/admin/accounts", { headers: { "X-Admin-Token": token } }),
    extend: (token: string, username: string, months: number) =>
      request<{ account: PublicAccount }>(
        "/api/admin/extend",
        post("/api/admin/extend", { username, months }, { "X-Admin-Token": token }),
      ),
    code: (token: string, months: number, count: number, lifetime = false) =>
      request<CodesResponse>(
        "/api/admin/code",
        post("/api/admin/code", { months, count, lifetime }, { "X-Admin-Token": token }),
      ),
    lifetime: (token: string, username: string, lifetime: boolean) =>
      request<{ account: PublicAccount }>(
        "/api/admin/lifetime",
        post("/api/admin/lifetime", { username, lifetime }, { "X-Admin-Token": token }),
      ),
    resetPassword: (token: string, username: string, password: string) =>
      request<{ account: PublicAccount }>(
        "/api/admin/reset-password",
        post("/api/admin/reset-password", { username, password }, { "X-Admin-Token": token }),
      ),
    orders: (token: string) =>
      request<{ orders: PublicOrder[] }>("/api/admin/orders", { headers: { "X-Admin-Token": token } }),
    markPaid: (token: string, id: string) =>
      request<{ order: PublicOrder }>(
        "/api/admin/orders/mark-paid",
        post("/api/admin/orders/mark-paid", { id }, { "X-Admin-Token": token }),
      ),
  },
};
