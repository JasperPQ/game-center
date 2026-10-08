export interface GuestbookEntry {
  readonly id: string;
  readonly name: string;
  readonly message: string;
  readonly createdAt: string;
}

export interface SubmitGuestbookEntry {
  readonly name?: string;
  readonly message: string;
}

export interface DeleteGuestbookEntry {
  readonly id: string;
  readonly token: string;
}

export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: string };
export type Ack<T> = (response: AckResponse<T>) => void;

export interface ClientToServerEvents {
  "guestbook:get": (ack: Ack<GuestbookEntry[]>) => void;
  "guestbook:post": (payload: SubmitGuestbookEntry, ack: Ack<GuestbookEntry[]>) => void;
  "admin:verify": (token: string, ack: Ack<void>) => void;
  "guestbook:delete": (payload: DeleteGuestbookEntry, ack: Ack<GuestbookEntry[]>) => void;
}

export interface ServerToClientEvents {
  "guestbook:updated": (entries: GuestbookEntry[]) => void;
}

/** 登录后的账号信息（不含密码）。subscribed 与 daysLeft 每次读取时按当前时间现算。 */
export interface PublicAccount {
  readonly username: string;
  readonly createdAt: string;
  /** 订阅到期时间，null 表示从未开通。 */
  readonly expiresAt: string | null;
  readonly subscribed: boolean;
  /** 还在注册送的试用期内（从没付过费）。 */
  readonly trial: boolean;
  readonly paid: boolean;
  /** 永久会员（管理员开的），不看到期时间。 */
  readonly lifetime: boolean;
  readonly daysLeft: number;
  readonly lastLoginAt: string | null;
  /** 绑定过公众号。 */
  readonly wechatBound: boolean;
  /** 领过试用（注册送的或公众号领的）；没领过的可以去公众号领。 */
  readonly trialClaimed: boolean;
}

/** 订单（给前端和管理页看的部分）。金额单位是分。 */
export interface PublicOrder {
  readonly id: string;
  readonly username: string;
  readonly months: number;
  readonly amountFen: number;
  readonly status: "pending" | "paid";
  readonly createdAt: string;
  readonly paidAt: string | null;
}

/** 管理页看到的一个游戏房间。 */
export interface AdminRoom {
  readonly id: string;
  /** waiting / playing / finished */
  readonly status: string;
  readonly capacity: number | null;
  readonly spectators: number;
  readonly players: ReadonlyArray<{ readonly name: string; readonly connected: boolean }>;
}

export interface AdminGameRooms {
  readonly game: string;
  readonly name: string;
  readonly rooms: readonly AdminRoom[];
  /** 连不上这个游戏的服务时的说明。 */
  readonly error: string | null;
}
