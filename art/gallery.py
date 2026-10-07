"""晶脉彩蛋入口的挑选页：生成 out/gallery.html，用 python -m http.server 8770 --directory art/out 打开。

点「选这张」或「都不满意，重画」，选择存在浏览器的 localStorage；页面每 30 秒自动刷新（正在打字时不刷新）。
最下面汇总成一段文字，复制回来就行。效果截图放在 out/preview/（手动截的，用推荐的那颗蛋）。
"""
from __future__ import annotations

import html
import json
import pathlib

from export import fit

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"

# id, 名字, 说明, 是否推荐
CANDIDATES = [
    ("geode-c2", "晶洞蛋", "蛋顶裂开，里面长出紫色和青色的水晶。既是彩蛋，又露出晶脉的水晶，一看就和晶脉有关；浅色在深色页面上最显眼。", True),
    ("paint-c2", "彩绘彩蛋", "经典的复活节彩蛋：青、红、紫、金的波浪纹和圆点。", False),
    ("vein-c1", "晶脉石蛋", "深色石蛋，蛋壳上嵌着青、赤、金的晶片。深色页面上不太显眼，更像藏起来的彩蛋。", False),
    ("jewel-c3", "宝石金蛋", "金蛋上镶着菱格宝石，像法贝热彩蛋。", False),
]
UNDERSTANDING = [
    "晶脉的卡片从游戏列表里去掉，入口只剩标题右边这颗彩蛋，不写任何说明。鼠标指上去它会左右晃，像要孵出来。",
    "点彩蛋直接进 /jingmai/，也就是晶脉建房间、进房间的那一页。",
    "原版和像素版都放这颗蛋，不然切回原版就进不去晶脉。",
    "手机上标题已经占满一行，蛋改成蹲在标题右上方的空白里。",
]
PREVIEWS = [("desktop-pixel", "电脑 · 像素版"), ("desktop-classic", "电脑 · 原版"), ("phone-pixel", "手机 · 像素版"), ("phone-classic", "手机 · 原版")]

PAGE = """<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>晶脉彩蛋挑选</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@700&display=swap">
<style>
@font-face { font-family: "Fusion Pixel"; src: url("fusion-pixel-12px-zh_hans.woff2") format("woff2"); }
:root { --bg: #0e0c13; --panel: #1c1826; --panel-2: #262033; --rim: #4a3f63; --text: #f1ece0; --muted: #9a93ad; --gold: #f0c050; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 12px/1.75 "Fusion Pixel", -apple-system, "PingFang SC", sans-serif; }
main { max-width: 1120px; margin: 0 auto; padding: 24px 16px 64px; }
h1, h2 { font-weight: 400; color: var(--gold); }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 24px; margin: 36px 0 12px; }
.muted { color: var(--muted); }
ul { margin: 8px 0; padding-left: 20px; }
.previews { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.previews figure { margin: 0; }
.previews img { display: block; width: 100%; box-shadow: 0 0 0 2px var(--rim); }
.previews .phones { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
figcaption { color: var(--muted); margin-top: 4px; }
.card { display: grid; grid-template-columns: 1fr 300px; gap: 16px; margin-bottom: 16px; padding: 12px; background: var(--panel); box-shadow: 0 0 0 2px var(--rim); }
.card.picked, .redo.picked { box-shadow: 0 0 0 4px var(--gold); }
.stage { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 24px; overflow: hidden; }
.stage.dark { background: var(--bg); }
.stage.dark .title { color: var(--gold); font-size: 72px; line-height: 1.1; text-shadow: 4px 4px 0 #050408; white-space: nowrap; }
.stage.light { background: #f4f2ec; margin-top: 8px; }
.stage.light .title { color: #1e3d32; font: 700 64px/1.1 "Noto Serif SC", Georgia, serif; letter-spacing: -0.03em; white-space: nowrap; }
.egg2 { width: 84px; height: 116px; image-rendering: pixelated; flex: none; }
.info b { font-size: 24px; font-weight: 400; }
.tag { margin-left: 8px; padding: 0 6px; color: var(--bg); background: var(--gold); }
.zoom { display: flex; align-items: end; gap: 16px; margin: 12px 0; }
.zoom img { image-rendering: pixelated; }
button { font: inherit; color: var(--bg); background: var(--gold); border: 0; padding: 6px 16px; cursor: pointer; box-shadow: 0 0 0 2px #050408; }
button.secondary { color: var(--text); background: var(--panel-2); }
textarea { display: block; width: 100%; min-height: 64px; margin-top: 8px; padding: 8px; font: inherit; color: var(--text); background: var(--panel-2); border: 0; box-shadow: 0 0 0 2px var(--rim); }
.redo { margin-top: 8px; padding: 12px; background: var(--panel); box-shadow: 0 0 0 2px var(--rim); }
.summary { white-space: pre-wrap; padding: 12px; background: var(--panel-2); box-shadow: 0 0 0 2px var(--rim); user-select: all; }
@media (max-width: 820px) { .card, .previews { grid-template-columns: 1fr; } .stage .title { font-size: 40px !important; } }
</style></head>
<body><main>
<h1>晶脉彩蛋入口 · 挑一颗蛋</h1>
<p class="muted">选择存在这个浏览器里，页面每 30 秒自动刷新。选完把最下面那段文字复制回来。</p>

<h2>我的理解（不对的话写在最下面的「其他意见」里）</h2>
<ul>__UNDERSTANDING__</ul>

<h2>放在页面上的效果（用的是推荐的晶洞蛋，选别的就换成你选的）</h2>
<div class="previews">
  <div>__DESKTOP__</div>
  <div class="phones">__PHONES__</div>
</div>

<h2>候选（四种风格，各挑了最好的一张）</h2>
__CARDS__
<div class="redo" id="redo">
  <button class="secondary" onclick="pick('redo')">都不满意，重画</button>
  <textarea id="redoNote" placeholder="想要什么样的蛋？（颜色、风格、大小……）"></textarea>
</div>

<h2>其他意见</h2>
<textarea id="otherNote" placeholder="位置、大小、要不要动画、我的理解哪里不对……没有就空着"></textarea>

<h2>汇总（复制回来）</h2>
<div class="summary" id="summary"></div>
<p><button onclick="copySummary()">复制</button> <span class="muted" id="copied"></span></p>
</main>
<script>
const KEY = "gc-egg-gallery-v1";
const NAMES = __NAMES__;
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} render(); }
function pick(id) { state.pick = id; save(); }
function summaryText() {
  const lines = ["【游戏中心 · 晶脉彩蛋入口】"];
  if (state.pick === "redo") lines.push("- 彩蛋：都不满意，重画" + (state.redoNote ? "；备注：" + state.redoNote.trim() : ""));
  else if (state.pick) lines.push("- 彩蛋：选 " + state.pick + "（" + NAMES[state.pick] + "）");
  else lines.push("- 彩蛋：（还没选）");
  if (state.otherNote && state.otherNote.trim()) lines.push("- 其他意见：" + state.otherNote.trim());
  return lines.join("\\n");
}
function render() {
  document.querySelectorAll(".card").forEach((card) => card.classList.toggle("picked", card.dataset.id === state.pick));
  document.getElementById("redo").classList.toggle("picked", state.pick === "redo");
  document.getElementById("summary").textContent = summaryText();
}
function copySummary() {
  navigator.clipboard.writeText(summaryText()).then(() => { document.getElementById("copied").textContent = "已复制"; });
}
for (const id of ["redoNote", "otherNote"]) {
  const box = document.getElementById(id);
  box.value = state[id] || "";
  box.addEventListener("input", () => { state[id] = box.value; save(); });
}
render();
setInterval(() => { if (document.activeElement?.tagName !== "TEXTAREA") location.reload(); }, 30000);
</script>
</body></html>
"""


def main() -> None:
    (OUT / "egg-fit").mkdir(parents=True, exist_ok=True)
    cards = []
    for egg_id, name, note, recommended in CANDIDATES:
        fit(OUT / "egg" / f"{egg_id}.png").save(OUT / "egg-fit" / f"{egg_id}.png")
        src = f"egg-fit/{egg_id}.png"
        tag = '<span class="tag">推荐</span>' if recommended else ""
        cards.append(f"""<div class="card" data-id="{egg_id}">
  <div>
    <div class="stage dark"><span class="title">Game Center</span><img class="egg2" src="{src}" alt=""></div>
    <div class="stage light"><span class="title">Game Center</span><img class="egg2" src="{src}" alt=""></div>
  </div>
  <div class="info">
    <b>{html.escape(name)}</b>{tag} <span class="muted">{egg_id}</span>
    <p class="muted">{html.escape(note)}</p>
    <div class="zoom"><img src="{src}" width="168" height="232" alt=""><img src="{src}" width="42" height="58" alt=""></div>
    <p class="muted">左边放大 4 倍看细节，右边是手机上的实际大小。</p>
    <button onclick="pick('{egg_id}')">选这张</button>
  </div>
</div>""")
    shots = {key: f'<figure><img src="preview/{key}.png" alt=""><figcaption>{label}</figcaption></figure>' for key, label in PREVIEWS}
    page = (PAGE
            .replace("__UNDERSTANDING__", "".join(f"<li>{html.escape(item)}</li>" for item in UNDERSTANDING))
            .replace("__DESKTOP__", shots["desktop-pixel"] + shots["desktop-classic"])
            .replace("__PHONES__", shots["phone-pixel"] + shots["phone-classic"])
            .replace("__CARDS__", "\n".join(cards))
            .replace("__NAMES__", json.dumps({c[0]: c[1] for c in CANDIDATES}, ensure_ascii=False)))
    (OUT / "gallery.html").write_text(page)
    print(OUT / "gallery.html")


if __name__ == "__main__":
    main()
