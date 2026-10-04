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
