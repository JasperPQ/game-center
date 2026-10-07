import type { IncomingMessage } from "node:http";

/** 滑动窗口计数：同一个 key 在 windowMs 内最多 limit 次。只存在内存里，重启清零。 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  private recent(key: string, now: number): number[] {
    const kept = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (kept.length > 0) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  isLimited(key: string): boolean {
    return this.recent(key, Date.now()).length >= this.limit;
  }

  hit(key: string): void {
    const now = Date.now();
    this.hits.set(key, [...this.recent(key, now), now]);
    if (this.hits.size > 10_000) {
      for (const candidate of [...this.hits.keys()]) this.recent(candidate, now);
    }
  }
}

/**
 * 访客 IP。线上经 Caddy 转发，Caddy 会把真实来源写进 X-Forwarded-For 的最后一项；
 * 只有请求确实来自本机（Caddy）时才信这个头，否则用连接地址。
 */
export function clientIp(request: IncomingMessage): string {
  const remote = request.socket.remoteAddress ?? "";
  const fromLocalProxy = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const forwarded = request.headers["x-forwarded-for"];
  if (fromLocalProxy && typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",").at(-1)!.trim();
  }
  return remote;
}
