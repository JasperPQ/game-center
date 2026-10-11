/** 留言板和许愿池共用的管理员口令（存在本标签页的 sessionStorage）。 */

const ADMIN_TOKEN_KEY = "game-center-admin-token";
// 在网址后加 ?admin 才显示管理员入口。
export const adminEntryEnabled = new URLSearchParams(window.location.search).has("admin");

export function readStoredAdminToken(): string {
  if (!adminEntryEnabled) return "";
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function storeAdminToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // 存储不可用时仅在本页有效。
  }
}
