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
