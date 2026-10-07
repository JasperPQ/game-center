import { createHash, timingSafeEqual } from "node:crypto";

/** 未配置 ADMIN_TOKEN 时管理功能关闭。 */
export const adminTokenHash = process.env.ADMIN_TOKEN
  ? createHash("sha256").update(process.env.ADMIN_TOKEN).digest()
  : null;

export function verifyAdminToken(token: unknown): boolean {
  if (!adminTokenHash) return false;
  const hash = createHash("sha256").update(typeof token === "string" ? token : "").digest();
  return timingSafeEqual(hash, adminTokenHash);
}
