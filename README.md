# Game Center · 游戏中心

站点首页：各游戏的入口，以及所有游戏共用的游客留言墙。

## 本地运行

```bash
npm install
ADMIN_TOKEN=test npm run dev
```

打开 http://localhost:5175 。页面在 5175，留言服务在 3000。游戏卡片在本地会链接到宝石商人（5173）和掼蛋（5174），需要分别在各自目录里运行 `npm run dev`。

## 留言管理

服务端设置环境变量 `ADMIN_TOKEN` 后，访问 `/?admin` 并输入口令，每条留言旁会出现「删除」按钮；未设置时管理功能关闭。留言保存在 `data/guestbook.json`（不进 git），最多保留最近 200 条。

## 线上路径

- `/` → 游戏中心
- `/gem/` → 宝石商人（构建时 `BASE_PATH=/gem/ npm run build`）
- `/guandan/` → 掼蛋（构建时 `BASE_PATH=/guandan/ npm run build`）

## 晶脉的入口（彩蛋）

晶脉不放游戏卡片。首页标题「Game Center」右边的空白处只有一颗像素彩蛋（晶洞蛋），不写任何说明；鼠标指上去会左右晃，点进去就是 `/jingmai/` 的房间页。原版和像素版都显示；手机上标题占满一行，蛋改成蹲在标题右上方。样式在 `src/egg.css`，图在 `src/assets/pixel/egg.png`（42×58，电脑上 2 倍、手机上 1 倍显示，整数倍才清晰）。

## 美术（`art/`）

PixelLab 出图，密钥只在 `~/.config/pixellab/api_key`，不进仓库；每次调用记进 `art/ledger.jsonl`，`pixellab.py` 里有预算上限。`egg.py` 出彩蛋候选，`gallery.py` 生成挑选页（`python -m http.server 8770 --directory art/out`），`selection.json` 记选了哪张，`export.py` 裁好放进 `src/assets/pixel/egg.png`。原图和中间文件在被 gitignore 的 `art/out/`。

## 服务器上的启动方式

pm2 按仓库根目录的 `ecosystem.config.cjs` 直接启动一个 `node --import tsx` 进程跑服务端（不经过 `npm start`），每个游戏省下约 50 MB 内存（实测，原来被几层包装进程占掉的部分）。端口和密钥存在 pm2 里，不进仓库；`deploy.sh` 照旧 `pm2 restart`。改了 `ecosystem.config.cjs` 之后，要在服务器上带着原来的环境变量 `pm2 delete` 再 `pm2 start ecosystem.config.cjs` 一次。
