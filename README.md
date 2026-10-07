# Game Center · 游戏中心

站点首页：选择游戏（宝石商人、掼蛋）的入口，以及所有游戏共用的游客留言墙。

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

## 服务器上的启动方式

pm2 按仓库根目录的 `ecosystem.config.cjs` 直接启动一个 `node --import tsx` 进程跑服务端（不经过 `npm start`），每个游戏省下一百多 MB 内存。端口和密钥存在 pm2 里，不进仓库；`deploy.sh` 照旧 `pm2 restart`。改了 `ecosystem.config.cjs` 之后，要在服务器上带着原来的环境变量 `pm2 delete` 再 `pm2 start ecosystem.config.cjs` 一次。
