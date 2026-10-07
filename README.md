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

## 账号与订阅

进游戏要登录且订阅有效；大厅本身（登录、付款、留言板）谁都能打开。数据都在服务端 `data/` 目录（不进 git），路径可用 `ACCOUNTS_FILE` / `CODES_FILE` / `SESSIONS_FILE` / `ORDERS_FILE` 改。

- **价格**：`shared/pricing.ts` 里改——现在是 5 元 / 月，可买 1 / 3 / 6 / 12 个月（不打折），新注册送 7 天试用。
- **注册 / 登录**：用户名 + 密码（scrypt 加盐）。会话 cookie `gc_session`（HttpOnly、SameSite=Lax、HTTPS 下 Secure），30 天有效，重启服务不掉线。忘记密码由管理员在管理页重置。
- **防刷**：同一 IP 一天最多注册 5 个号；同一 IP 或用户名 15 分钟内输错 10 次密码就先锁住；兑换码输错、下单也限次。
- **续费**：从原到期日往后顺延（试用剩下的天数也保留）。三种来源都算付费：在线支付、兑换码、管理员手动「＋1 月」。
- **在线支付**：`server/payments.ts` 里的 `PaymentProvider` 接口，环境变量 `PAY_PROVIDER` 选渠道；不设就关闭在线支付，只能用兑换码。下单 → 跳转渠道付款页 → 渠道回调里确认到账后调用 `fulfilOrder`（同一订单重复通知只记一次，实付少于订单金额拒绝）→ 回到 `/?order=<订单号>`，页面轮询结果。`PAY_PROVIDER=mock` 是本地测试用的模拟渠道，线上不要开。
- **永久会员**（自己人免费）：管理页里账号旁点「设为永久」，或生成「永久」兑换码发给朋友，朋友注册后兑换即可。永久会员不看到期时间，随时可以取消，取消后回到原来的到期时间。
- **管理页**：访问 `/?admin` 并输入 `ADMIN_TOKEN`：账号列表（试用 / 有效 / 永久 / 到期）、付费人数和本月在线收款、延长订阅、设为 / 取消永久、重置密码、生成兑换码（按月或永久）、订单列表（回调没到时可手动补单）。

### 爱发电

线上用爱发电收款（`PAY_PROVIDER=afdian`，代码在 `server/afdian.ts`）。需要的环境变量：`AFDIAN_USER_ID`、`AFDIAN_TOKEN`（开发者页面的 API Token，密钥）、`AFDIAN_PLAN_ID`（5 元 / 月的那个方案），可选 `AFDIAN_BASE`（默认 `https://afdian.com`）。三个没配全时在线支付自动关闭。

- 下单跳到 `https://afdian.com/order/create?plan_id=…&product_type=0&month=<月数>&custom_order_id=<订单号>`，爱发电按「5 元 × 月数」收钱。
- 爱发电的 Webhook 没有签名，所以收到通知只取 `out_trade_no`，再用开放 API（md5 签名）回查，以 API 结果为准：交易成功、是我们的方案、`custom_order_id` 对得上、实付不少于订单金额，才记账。
- Webhook 地址填 `https://gulugagame.com/api/pay/afdian/webhook`（保存时爱发电会发测试通知，接口要先上线）。不填也能用：玩家回到大厅查结果时、以及服务端每分钟，都会翻一遍最近 50 笔爱发电订单补账。
- 爱发电不会跳回来，跳走前浏览器记下订单号（localStorage），玩家回到大厅时接着查。
- 平台抽 6%（5 元到手 4.70），当月收入次月 1 号进余额。

本地测试付款流程：

```bash
PAY_PROVIDER=mock ADMIN_TOKEN=test npm run dev
```

### 网关（Caddy）

不在页面里拦，而是在 Caddy 层用 `forward_auth` 把每个游戏路径（网页、图片、socket.io 轮询和 WebSocket）先交给大厅的 `/api/auth/check` 校验会话：订阅有效回 200 放行；打开网页的回 302 到 `/?gate=login|expired&next=<游戏>`，大厅据此提示并在开通后给出「继续进入」；其他请求回 401。`forward_auth` 排在 `handle_path` 之前执行，所以写一条带路径匹配的就够：

```caddy
@games path /gem/* /guandan/* /poker/* /jingmai/* /camel/* /azul/* /ttr/*
forward_auth @games localhost:3000 {
    uri /api/auth/check
    # 去掉逐跳头，WebSocket 握手也按普通请求校验
    header_up -Connection
    header_up -Upgrade
}
handle /api/* {
    reverse_proxy localhost:3000
}
```

已在 Caddy 2.6.2（线上版本）实测：未登录访问网页 302、socket.io 轮询和 WebSocket 都 401；登录后三者都正常。

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
