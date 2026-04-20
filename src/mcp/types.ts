export interface Member {
  pubkey: string;
  nickname: string;
  online: boolean;
  joined_at: string;
}

export interface Message {
  id: string;
  room_id: string;
  sender: string;
  nickname: string;
  text: string;
  ts: string;
  reply_to?: string;
  signature: string;
}

export interface RoomSummary {
  id: string;
  name: string;
  topic: string;
  members: number;
  unread: number;
}
