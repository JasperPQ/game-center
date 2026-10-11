export interface GuestbookEntry {
  readonly id: string;
  readonly name: string;
  readonly message: string;
  readonly createdAt: string;
  /** 管理员置顶的时间；置顶的排在最上面，越晚置顶越靠前。 */
  readonly pinnedAt?: string;
}

export interface SubmitGuestbookEntry {
  readonly name?: string;
  readonly message: string;
}

export interface DeleteGuestbookEntry {
  readonly id: string;
  readonly token: string;
}

/** 管理员置顶 / 取消置顶（留言板和许愿池共用）。 */
export interface PinEntry {
  readonly id: string;
  readonly token: string;
  readonly pinned: boolean;
}

/** 许愿池里的一条愿望：想在站上玩到的游戏。 */
export interface Wish {
  readonly id: string;
  readonly name: string;
  /** 想要的游戏名。 */
  readonly game: string;
  /** 补充说明，可以为空。 */
  readonly note: string;
  readonly createdAt: string;
  /** 「我也想要」的人数（含许愿的人自己）。 */
  readonly votes: number;
  readonly pinnedAt?: string;
}

export interface SubmitWish {
  readonly name?: string;
  readonly game: string;
  readonly note?: string;
  /** 浏览器里随机生成、存在 localStorage 的投票人编号，同一个编号每条愿望只算一票。 */
  readonly voterId: string;
}

export interface VoteWish {
  readonly id: string;
  readonly voterId: string;
  /** true 是 +1，false 是撤回。 */
  readonly voted: boolean;
}

export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: string };
export type Ack<T> = (response: AckResponse<T>) => void;

export interface ClientToServerEvents {
  "guestbook:get": (ack: Ack<GuestbookEntry[]>) => void;
  "guestbook:post": (payload: SubmitGuestbookEntry, ack: Ack<GuestbookEntry[]>) => void;
  "admin:verify": (token: string, ack: Ack<void>) => void;
  "guestbook:delete": (payload: DeleteGuestbookEntry, ack: Ack<GuestbookEntry[]>) => void;
  "guestbook:pin": (payload: PinEntry, ack: Ack<GuestbookEntry[]>) => void;
  "wishes:get": (ack: Ack<Wish[]>) => void;
  "wishes:post": (payload: SubmitWish, ack: Ack<Wish[]>) => void;
  "wishes:vote": (payload: VoteWish, ack: Ack<Wish[]>) => void;
  "wishes:delete": (payload: DeleteGuestbookEntry, ack: Ack<Wish[]>) => void;
  "wishes:pin": (payload: PinEntry, ack: Ack<Wish[]>) => void;
}

export interface ServerToClientEvents {
  "guestbook:updated": (entries: GuestbookEntry[]) => void;
  "wishes:updated": (wishes: Wish[]) => void;
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
  /** 最多同时登录几个浏览器/设备。 */
  readonly maxSessions: number;
  /** 现在登录着的浏览器/设备数。 */
  readonly activeSessions: number;
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
