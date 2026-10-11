import { useState, type FormEvent } from "react";
import type { GuestbookEntry } from "../shared/types";
import { socket } from "./socket";

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
  adminToken,
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
  /** 管理员口令；非空时每条留言旁出现「置顶」「删除」。 */
  adminToken: string;
}) {
  const [adminError, setAdminError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  function deleteEntry(entry: GuestbookEntry) {
    if (!window.confirm(`确定删除 ${entry.name} 的这条留言吗？删除后无法恢复。`)) return;
    setAdminError("");
    setBusyId(entry.id);
    // 删除成功后服务端会广播 guestbook:updated，列表随之刷新。
    socket.emit("guestbook:delete", { id: entry.id, token: adminToken }, (response) => {
      setBusyId(null);
      if (!response.ok) setAdminError(response.error);
    });
  }

  function togglePin(entry: GuestbookEntry) {
    setAdminError("");
    setBusyId(entry.id);
    socket.emit("guestbook:pin", { id: entry.id, token: adminToken, pinned: !entry.pinnedAt }, (response) => {
      setBusyId(null);
      if (!response.ok) setAdminError(response.error);
    });
  }

  return (
    <>
      {adminError && <p className="feedback feedback-error" role="alert">{adminError}</p>}

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

        <div className="guestbook-list" aria-live="polite" aria-label="大家的评价">
          {entries.length > 0 ? entries.map((entry) => (
            <article className={entry.pinnedAt ? "guestbook-entry pinned" : "guestbook-entry"} key={entry.id}>
              <div className="guestbook-entry-avatar">{entry.name.slice(0, 1).toUpperCase()}</div>
              <div className="guestbook-entry-content">
                <div className="guestbook-entry-meta">
                  <strong>{entry.name}</strong>
                  {entry.pinnedAt && <span className="pin-badge">置顶</span>}
                  {entry.source && <span className="source-badge">来自 {entry.source}</span>}
                  <time dateTime={entry.createdAt}>{formatGuestbookDate(entry.createdAt)}</time>
                  {adminToken && (
                    <>
                      <button
                        className="guestbook-pin"
                        type="button"
                        disabled={!connected || busyId === entry.id}
                        onClick={() => togglePin(entry)}
                      >
                        {entry.pinnedAt ? "取消置顶" : "置顶"}
                      </button>
                      <button
                        className="guestbook-delete"
                        type="button"
                        disabled={!connected || busyId === entry.id}
                        onClick={() => deleteEntry(entry)}
                      >
                        删除
                      </button>
                    </>
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
    </>
  );
}

/** 留言板和许愿池共用的管理员入口（网址带 ?admin 时显示）。 */
export function BoardAdminBar({
  token,
  connected,
  onTokenChange,
}: {
  token: string;
  connected: boolean;
  onTokenChange: (token: string) => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = input.trim();
    setInput("");
    if (!candidate) return;
    setError("");
    socket.emit("admin:verify", candidate, (response) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      onTokenChange(candidate);
    });
  }

  return (
    <div className="guestbook-admin">
      {token ? (
        <div className="guestbook-admin-row">
          <span>管理员模式：许愿池和留言板里可以置顶、删除</span>
          <button className="guestbook-admin-button" type="button" onClick={() => onTokenChange("")}>退出管理</button>
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

export function formatGuestbookDate(value: string): string {
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
