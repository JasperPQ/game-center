/*
 * 「写评价」悬浮窗：大厅和各游戏的首页、房间列表、等候房间右下角的一个小按钮，点开就能写评价，
 * 发到大厅的 POST /api/guestbook，出现在大厅最下面「来访者的声音」里（在游戏里写的会标「来自 某游戏」）。
 *
 * 用法：页面里加一行 <script src="/gc-feedback.js" defer></script>。
 * 牌桌和新手教程不显示：游戏在开局后的牌桌、教程最外层元素上加 data-gc-table 属性，悬浮窗看到它就藏起来。
 * 不依赖任何框架；样式自带，夜间 / 白天跟着 <html data-theme="day"> 变。
 */
(() => {
  if (window.gcFeedback) return;

  const source = (location.pathname.split("/")[1] || "").toLowerCase();
  const NAME_KEY = "gc-feedback-name";
  const css = `
.gcfb { --bg: #0e0c13; --panel: #1c1826; --text: #f1ece0; --muted: #9a93ad; --gold: #f0c050; --edge: #050408;
  --rim: #4a3f63; --shade: #0b0a10; --field-rim: #0b0a10; --field-shade: #332b44; --ok: #62c97a; --bad: #f25c5c;
  position: fixed; right: 16px; bottom: 16px; z-index: 900; display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
  color: var(--text); font-family: "Fusion Pixel", -apple-system, "PingFang SC", sans-serif; font-size: 12px; line-height: 1.5;
  -webkit-font-smoothing: none; }
html[data-theme="day"] .gcfb { --bg: #ffffff; --panel: #f6f4f9; --text: #26212f; --muted: #6c6580; --edge: #2b2536;
  --rim: #ffffff; --shade: #d5d0de; --field-rim: #d5d0de; --field-shade: #e2ddea; --ok: #1f8a45; --bad: #d1303f; }
.gcfb[hidden] { display: none; }
.gcfb * { box-sizing: border-box; font: inherit; letter-spacing: 0; }
.gcfb-box { box-shadow: 0 -2px 0 0 var(--edge), 0 2px 0 0 var(--edge), -2px 0 0 0 var(--edge), 2px 0 0 0 var(--edge),
  inset 2px 2px 0 0 var(--rim), inset -2px -2px 0 0 var(--shade); }
.gcfb-fab { --rim: #fff2b8; --shade: #7a5410; display: flex; align-items: center; gap: 6px; margin: 0; border: 0; border-radius: 0;
  padding: 6px 12px; color: #2a1c06; background: var(--gold); cursor: pointer; }
.gcfb-fab:hover { filter: brightness(1.1); }
.gcfb-fab:active { transform: translateY(2px); }
.gcfb-panel { width: min(320px, calc(100vw - 32px)); padding: 14px 16px 16px; background: var(--panel); --rim: #b3821c; }
html[data-theme="day"] .gcfb-panel { --rim: #e0b44a; }
.gcfb-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.gcfb-head strong { color: var(--gold); font-weight: 400; font-size: 12px; }
html[data-theme="day"] .gcfb-head strong { color: #94650a; }
.gcfb-close { border: 0; padding: 0 4px; color: var(--muted); background: none; cursor: pointer; font-size: 12px; }
.gcfb-label { display: block; margin: 8px 0 4px; color: var(--text); }
.gcfb-label span { color: var(--muted); }
.gcfb-field { --rim: var(--field-rim); --shade: var(--field-shade); display: block; width: 100%; margin: 0; border: 0; border-radius: 0;
  padding: 8px 10px; color: var(--text); background: var(--bg); outline: none; }
.gcfb-field::placeholder { color: var(--muted); opacity: 0.7; }
.gcfb-field:focus { outline: 2px solid var(--gold); }
textarea.gcfb-field { min-height: 88px; resize: vertical; }
.gcfb-meta { display: flex; justify-content: space-between; gap: 8px; margin-top: 4px; color: var(--muted); }
.gcfb-msg { margin: 8px 0 0; }
.gcfb-msg.error { color: var(--bad); }
.gcfb-msg.ok { color: var(--ok); }
.gcfb-msg a { color: inherit; }
.gcfb-send { --rim: #fff2b8; --shade: #7a5410; width: 100%; margin-top: 10px; border: 0; border-radius: 0; padding: 8px 12px;
  color: #2a1c06; background: var(--gold); cursor: pointer; }
.gcfb-send:disabled { cursor: default; filter: grayscale(0.6) brightness(0.8); }
@media (max-width: 520px) { .gcfb { right: 12px; bottom: 12px; } }
`;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of children || []) node.append(child);
    return node;
  }

  function readName() {
    try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
  }
  function storeName(value) {
    try { if (value) localStorage.setItem(NAME_KEY, value); else localStorage.removeItem(NAME_KEY); } catch { /* 存不了就算了 */ }
  }

  function mount() {
    const style = el("style", { text: css });
    document.head.append(style);

    const root = el("div", { class: "gcfb", "data-gc-feedback": "" });
    const fab = el("button", { type: "button", class: "gcfb-fab gcfb-box", "aria-expanded": "false" }, ["✎ 写评价"]);
    const panel = el("form", { class: "gcfb-panel gcfb-box", role: "dialog", "aria-label": "写评价", hidden: "" });
    const close = el("button", { type: "button", class: "gcfb-close", "aria-label": "收起", text: "✕" });
    const nameInput = el("input", { class: "gcfb-field gcfb-box", id: "gcfb-name", maxlength: "18", placeholder: "留空则显示为游客", autocomplete: "nickname" });
    const textarea = el("textarea", { class: "gcfb-field gcfb-box", id: "gcfb-message", maxlength: "280", placeholder: "好玩吗？哪里不顺手？想要什么新功能？" });
    const counter = el("span", { text: "0 / 280" });
    const message = el("p", { class: "gcfb-msg", role: "status", hidden: "" });
    const send = el("button", { type: "submit", class: "gcfb-send gcfb-box", text: "发布评价", disabled: "" });

    panel.append(
      el("div", { class: "gcfb-head" }, [el("strong", { text: "写下你的评价" }), close]),
      el("label", { class: "gcfb-label", for: "gcfb-message", text: "你的评价" }),
      textarea,
      el("div", { class: "gcfb-meta" }, [el("span", { text: "公开展示在大厅「来访者的声音」" }), counter]),
      el("label", { class: "gcfb-label", for: "gcfb-name" }, ["怎么称呼你？ ", el("span", { text: "可选" })]),
      nameInput,
      message,
      send,
    );
    root.append(panel, fab);
    document.body.append(root);

    // 昵称：上次填过的优先，没有就用登录的账号名。
    nameInput.value = readName();
    if (!nameInput.value) {
      fetch("/api/me", { credentials: "same-origin" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          const username = data && data.user && data.user.username;
          if (username && !nameInput.value && document.activeElement !== nameInput) nameInput.value = username;
        })
        .catch(() => {});
    }

    function setOpen(open) {
      panel.hidden = !open;
      fab.setAttribute("aria-expanded", String(open));
      fab.textContent = open ? "✕ 收起" : "✎ 写评价";
      if (open) textarea.focus();
    }
    function showMessage(text, kind, link) {
      message.hidden = !text;
      message.className = `gcfb-msg ${kind || ""}`;
      message.textContent = text;
      if (link) {
        message.append(" ", el("a", { href: link, text: "去看看" }));
      }
    }
    function refresh() {
      const length = textarea.value.trim().length;
      counter.textContent = `${textarea.value.length} / 280`;
      send.disabled = length < 2;
    }

    fab.addEventListener("click", () => setOpen(panel.hidden));
    close.addEventListener("click", () => setOpen(false));
    panel.addEventListener("keydown", (event) => { if (event.key === "Escape") setOpen(false); });
    textarea.addEventListener("input", () => { refresh(); if (message.classList.contains("ok")) showMessage(""); });
    panel.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      send.disabled = true;
      send.textContent = "正在发布…";
      showMessage("");
      fetch("/api/guestbook", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, message: textarea.value, source }),
      })
        .then((response) => response.json().catch(() => ({})).then((data) => ({ response, data })))
        .then(({ response, data }) => {
          if (!response.ok) throw new Error(data.error || "发布失败，请稍后再试。");
          storeName(name);
          textarea.value = "";
          showMessage("谢谢！评价已经贴到大厅的「来访者的声音」里了。", "ok", source ? "/#voices" : "#voices");
        })
        .catch((error) => showMessage(error.message || "发布失败，请稍后再试。", "error"))
        .finally(() => { send.textContent = "发布评价"; refresh(); });
    });

    // 牌桌和教程（带 data-gc-table 的元素）里不显示。
    let scheduled = false;
    function update() {
      scheduled = false;
      root.hidden = Boolean(document.querySelector("[data-gc-table]"));
    }
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(update);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-gc-table"] });
    update();

    window.gcFeedback = { open: () => setOpen(true), close: () => setOpen(false) };
  }

  window.gcFeedback = { open() {}, close() {} };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
