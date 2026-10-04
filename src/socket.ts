import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/types";

// 默认连接页面同源地址：开发时由 Vite 代理到 3000，线上由 Caddy 转发。
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: false,
  reconnection: true,
});
