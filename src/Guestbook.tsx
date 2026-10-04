import { useState, type FormEvent } from "react";
import type { GuestbookEntry } from "../shared/types";
import { socket } from "./socket";

const ADMIN_TOKEN_KEY = "game-center-admin-token";
// 在网址后加 ?admin 才显示管理员入口。
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

function Guestbook({
  entries,
  name,
  message,
  busy,
  connected,
  error,
  notice,
  onNameChange,
  onMessageChange,
  onSubmit,
}: {
  entries: GuestbookEntry[];
  name: string;
  message: string;
  busy: boolean;
  connected: boolean;
  error: string;
  notice: string;
  onNameChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [adminToken, setAdminToken] = useState(() => (adminEntryEnabled ? readStoredAdminToken() : ""));
  const [adminError, setAdminError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function updateAdminToken(token: string) {
    setAdminToken(token);
    storeAdminToken(token);
  }

  function loginAdmin(token: string) {
    setAdminError("");
    socket.emit("admin:verify", token, (response) => {
      if (!response.ok) {
        setAdminError(response.error);
        return;
      }
      updateAdminToken(token);
    });
  }

  function deleteEntry(entry: GuestbookEntry) {
    if (!window.confirm(`确定删除 ${entry.name} 的这条留言吗？删除后无法恢复。`)) return;
    setAdminError("");
    setDeletingId(entry.id);
    // 删除成功后服务端会广播 guestbook:updated，列表随之刷新。
    socket.emit("guestbook:delete", { id: entry.id, token: adminToken }, (response) => {
      setDeletingId(null);
      if (!response.ok) setAdminError(response.error);
    });
  }

  return (
    <section className="guestbook" aria-labelledby="guestbook-title">
      <div className="guestbook-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> 来访者的声音</div>
          <h2 id="guestbook-title">写下你的评价。</h2>
          <p>给后来加入的玩家留句话，也看看大家对牌桌的感受。</p>
        </div>
        <span className="guestbook-count">{entries.length} 条留言</span>
      </div>

      {adminEntryEnabled && (
        <GuestbookAdminBar
          token={adminToken}
          connected={connected}
          error={adminError}
          onLogin={loginAdmin}
          onLogout={() => updateAdminToken("")}
        />
      )}

      <div className="guestbook-layout">
        <form className="guestbook-form" onSubmit={onSubmit}>
          <label className="field-label" htmlFor="guestbook-name">怎么称呼你？ <span>可选</span></label>
          <input
            id="guestbook-name"
            className="text-input"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="留空则显示为游客"
            maxLength={18}
            autoComplete="nickname"
          />
          <label className="field-label field-label-spaced" htmlFor="guestbook-message">你的评价</label>
          <textarea
            id="guestbook-message"
            className="text-input guestbook-textarea"
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="分享一下你的体验……"
            maxLength={280}
            required
          />
          <div className="guestbook-form-meta"><span>公开展示 · 请勿填写个人敏感信息</span><span>{message.length} / 280</span></div>
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {notice && <p className="feedback feedback-success" role="status">{notice}</p>}
          <button className="primary-button guestbook-submit" type="submit" disabled={!connected || busy || message.trim().length < 2}>
            {busy ? <><span className="spinner" /> 正在发布</> : "发布留言"}
            {!busy && <span aria-hidden="true">↗</span>}
          </button>
        </form>

        <div className="guestbook-list" aria-live="polite" aria-label="游客评价">
          {entries.length > 0 ? entries.map((entry) => (
            <article className="guestbook-entry" key={entry.id}>
              <div className="guestbook-entry-avatar">{entry.name.slice(0, 1).toUpperCase()}</div>
              <div className="guestbook-entry-content">
                <div className="guestbook-entry-meta">
                  <strong>{entry.name}</strong>
                  <time dateTime={entry.createdAt}>{formatGuestbookDate(entry.createdAt)}</time>
                  {adminToken && (
                    <button
                      className="guestbook-delete"
                      type="button"
                      disabled={!connected || deletingId === entry.id}
                      onClick={() => deleteEntry(entry)}
                    >
                      {deletingId === entry.id ? "删除中…" : "删除"}
                    </button>
                  )}
                </div>
                <p>{entry.message}</p>
              </div>
            </article>
          )) : (
            <div className="guestbook-empty">
              <span aria-hidden="true">✦</span>
              <strong>还没有访客留言</strong>
              <p>写下第一条评价，开启这里的对话。</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function GuestbookAdminBar({
  token,
  connected,
  error,
  onLogin,
  onLogout,
}: {
  token: string;
  connected: boolean;
  error: string;
  onLogin: (token: string) => void;
  onLogout: () => void;
}) {
  const [input, setInput] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (input.trim()) onLogin(input.trim());
    setInput("");
  }

  return (
    <div className="guestbook-admin">
      {token ? (
        <div className="guestbook-admin-row">
          <span>管理员模式：可删除任意留言</span>
          <button className="guestbook-admin-button" type="button" onClick={onLogout}>退出管理</button>
        </div>
      ) : (
        <form className="guestbook-admin-row" onSubmit={submit}>
          <input
            className="text-input"
            type="password"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="管理员口令"
            autoComplete="current-password"
            aria-label="管理员口令"
          />
          <button className="guestbook-admin-button" type="submit" disabled={!connected || !input.trim()}>进入管理</button>
        </form>
      )}
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
    </div>
  );
}

function formatGuestbookDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default Guestbook;
