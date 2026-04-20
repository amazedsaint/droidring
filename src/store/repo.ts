import type { DB } from './db.js';

export interface RoomRow {
  id: string;
  name: string;
  topic: string;
  creator_pubkey: string;
  root_secret: string;
  epoch: number;
  current_key: string;
  joined_at: string;
  left_at: string | null;
  admission_mode: string;
}

export interface JoinRequestRow {
  room_id: string;
  pubkey: string;
  x25519_pub: string;
  nickname: string;
  client: string;
  ts: number;
}

export interface MemberRow {
  room_id: string;
  pubkey: string;
  nickname: string;
  joined_at: string;
  online: number;
  x25519_pub: string;
}

export interface MessageRow {
  id: string;
  room_id: string;
  sender: string;
  nickname: string;
  text: string;
  ts: string;
  reply_to: string | null;
  signature: string;
}

export class Repo {
  constructor(readonly db: DB) {}

  upsertRoom(r: RoomRow): void {
    this.db
      .prepare(
        `INSERT INTO rooms (id, name, topic, creator_pubkey, root_secret, epoch, current_key, joined_at, left_at, admission_mode)
         VALUES (@id, @name, @topic, @creator_pubkey, @root_secret, @epoch, @current_key, @joined_at, @left_at, @admission_mode)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           topic=excluded.topic,
           epoch=excluded.epoch,
           current_key=excluded.current_key,
           left_at=excluded.left_at,
           admission_mode=excluded.admission_mode`,
      )
      .run(r);
  }

  getRoom(id: string): RoomRow | undefined {
    return this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as RoomRow | undefined;
  }

  getRoomByName(name: string): RoomRow | undefined {
    return this.db
      .prepare('SELECT * FROM rooms WHERE name = ? ORDER BY joined_at DESC LIMIT 1')
      .get(name) as RoomRow | undefined;
  }

  resolveRoom(roomIdOrName: string): RoomRow | undefined {
    return this.getRoom(roomIdOrName) || this.getRoomByName(roomIdOrName);
  }

  listRooms(): RoomRow[] {
    return this.db
      .prepare('SELECT * FROM rooms WHERE left_at IS NULL ORDER BY joined_at DESC')
      .all() as RoomRow[];
  }

  setRoomTopic(id: string, topic: string): void {
    this.db.prepare('UPDATE rooms SET topic = ? WHERE id = ?').run(topic, id);
  }

  setRoomKey(id: string, epoch: number, keyB32: string): void {
    this.db
      .prepare('UPDATE rooms SET epoch = ?, current_key = ? WHERE id = ?')
      .run(epoch, keyB32, id);
  }

  markRoomLeft(id: string): void {
    this.db.prepare('UPDATE rooms SET left_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  upsertMember(m: MemberRow): void {
    this.db
      .prepare(
        `INSERT INTO members (room_id, pubkey, nickname, joined_at, online, x25519_pub)
         VALUES (@room_id, @pubkey, @nickname, @joined_at, @online, @x25519_pub)
         ON CONFLICT(room_id, pubkey) DO UPDATE SET
           nickname=excluded.nickname,
           online=excluded.online,
           x25519_pub=CASE WHEN excluded.x25519_pub != '' THEN excluded.x25519_pub ELSE members.x25519_pub END`,
      )
      .run(m);
  }

  removeMember(room_id: string, pubkey: string): void {
    this.db.prepare('DELETE FROM members WHERE room_id = ? AND pubkey = ?').run(room_id, pubkey);
  }

  listMembers(room_id: string): MemberRow[] {
    return this.db
      .prepare('SELECT * FROM members WHERE room_id = ? ORDER BY joined_at ASC')
      .all(room_id) as MemberRow[];
  }

  setMemberOnline(room_id: string, pubkey: string, online: boolean): void {
    this.db
      .prepare('UPDATE members SET online = ? WHERE room_id = ? AND pubkey = ?')
      .run(online ? 1 : 0, room_id, pubkey);
  }

  insertMessage(m: MessageRow): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO messages (id, room_id, sender, nickname, text, ts, reply_to, signature)
         VALUES (@id, @room_id, @sender, @nickname, @text, @ts, @reply_to, @signature)`,
      )
      .run(m);
  }

  fetchMessages(room_id: string, limit = 50, before?: string): MessageRow[] {
    const rows = before
      ? (this.db
          .prepare('SELECT * FROM messages WHERE room_id = ? AND ts < ? ORDER BY ts DESC LIMIT ?')
          .all(room_id, before, limit) as MessageRow[])
      : (this.db
          .prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY ts DESC LIMIT ?')
          .all(room_id, limit) as MessageRow[]);
    return rows.reverse();
  }

  fetchSince(room_id: string, since?: string): MessageRow[] {
    if (!since)
      return this.db
        .prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY ts ASC')
        .all(room_id) as MessageRow[];
    return this.db
      .prepare('SELECT * FROM messages WHERE room_id = ? AND ts > ? ORDER BY ts ASC')
      .all(room_id, since) as MessageRow[];
  }

  touchContact(pubkey: string, nickname: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO contacts (pubkey, nickname, first_seen, last_seen, muted)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(pubkey) DO UPDATE SET nickname=excluded.nickname, last_seen=excluded.last_seen`,
      )
      .run(pubkey, nickname, now, now);
  }

  setMuted(pubkey: string, muted: boolean): void {
    this.db.prepare('UPDATE contacts SET muted = ? WHERE pubkey = ?').run(muted ? 1 : 0, pubkey);
  }

  getContact(pubkey: string): { pubkey: string; nickname: string; muted: number } | undefined {
    return this.db
      .prepare('SELECT pubkey, nickname, muted FROM contacts WHERE pubkey = ?')
      .get(pubkey) as any;
  }

  findContactByNick(nick: string): { pubkey: string; nickname: string } | undefined {
    return this.db
      .prepare(
        'SELECT pubkey, nickname FROM contacts WHERE nickname = ? ORDER BY last_seen DESC LIMIT 1',
      )
      .get(nick) as any;
  }

  // -------- notes (LWW) ---------------------------------------------------

  /**
   * Apply a note put. Returns true if the local row was changed.
   * LWW: (updated_at, author) pair — later ts wins, ties broken by higher
   * author pubkey string. Tombstoned rows with deleted_at >= updated_at
   * remain tombstones (replay-safe).
   */
  applyNotePut(row: {
    room_id: string;
    id: string;
    author: string;
    title: string;
    body: string;
    tags: string[];
    updated_at: number;
  }): boolean {
    const existing = this.db
      .prepare(
        'SELECT updated_at, author, deleted, deleted_at FROM notes WHERE room_id = ? AND id = ?',
      )
      .get(row.room_id, row.id) as
      | { updated_at: number; author: string; deleted: number; deleted_at: number | null }
      | undefined;
    if (existing) {
      if (existing.deleted && (existing.deleted_at ?? 0) >= row.updated_at) return false;
      if (
        existing.updated_at > row.updated_at ||
        (existing.updated_at === row.updated_at && existing.author >= row.author)
      ) {
        return false;
      }
    }
    this.db
      .prepare(
        `INSERT INTO notes (room_id, id, author, title, body, tags, updated_at, deleted, deleted_at)
         VALUES (@room_id, @id, @author, @title, @body, @tags, @updated_at, 0, NULL)
         ON CONFLICT(room_id, id) DO UPDATE SET
           author=excluded.author,
           title=excluded.title,
           body=excluded.body,
           tags=excluded.tags,
           updated_at=excluded.updated_at,
           deleted=0,
           deleted_at=NULL`,
      )
      .run({ ...row, tags: JSON.stringify(row.tags) });
    return true;
  }

  applyNoteDelete(row: { room_id: string; id: string; deleted_at: number }): boolean {
    const existing = this.db
      .prepare('SELECT updated_at, deleted, deleted_at FROM notes WHERE room_id = ? AND id = ?')
      .get(row.room_id, row.id) as
      | { updated_at: number; deleted: number; deleted_at: number | null }
      | undefined;
    if (existing) {
      if (existing.deleted && (existing.deleted_at ?? 0) >= row.deleted_at) return false;
      this.db
        .prepare(
          "UPDATE notes SET deleted = 1, deleted_at = ?, body = '', title = '' WHERE room_id = ? AND id = ?",
        )
        .run(row.deleted_at, row.room_id, row.id);
      return true;
    }
    // tombstone for a note we've never seen — persist a minimal row so a
    // late-arriving put with smaller ts can still be rejected.
    this.db
      .prepare(
        `INSERT INTO notes (room_id, id, author, title, body, tags, updated_at, deleted, deleted_at)
         VALUES (?, ?, '', '', '', '[]', ?, 1, ?)`,
      )
      .run(row.room_id, row.id, row.deleted_at, row.deleted_at);
    return true;
  }

  getNote(
    room_id: string,
    id: string,
  ):
    | {
        id: string;
        author: string;
        title: string;
        body: string;
        tags: string[];
        updated_at: number;
        deleted: boolean;
      }
    | undefined {
    const r = this.db
      .prepare(
        'SELECT id, author, title, body, tags, updated_at, deleted FROM notes WHERE room_id = ? AND id = ?',
      )
      .get(room_id, id) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      author: r.author,
      title: r.title,
      body: r.body,
      tags: JSON.parse(r.tags || '[]'),
      updated_at: r.updated_at,
      deleted: !!r.deleted,
    };
  }

  listNotes(
    room_id: string,
    opts?: { tag?: string; query?: string; limit?: number; includeDeleted?: boolean },
  ) {
    const limit = opts?.limit ?? 50;
    const like = opts?.query ? `%${opts.query}%` : null;
    const tag = opts?.tag || null;
    const rows = this.db
      .prepare(
        `SELECT id, author, title, body, tags, updated_at, deleted
           FROM notes
          WHERE room_id = ?
            AND (? = 1 OR deleted = 0)
            AND (? IS NULL OR title LIKE ? OR body LIKE ?)
            AND (? IS NULL OR tags LIKE ?)
          ORDER BY updated_at DESC
          LIMIT ?`,
      )
      .all(
        room_id,
        opts?.includeDeleted ? 1 : 0,
        like,
        like,
        like,
        tag,
        tag ? `%"${tag}"%` : null,
        limit,
      ) as any[];
    return rows.map((r) => ({
      id: r.id,
      author: r.author,
      title: r.title,
      body: r.body,
      tags: JSON.parse(r.tags || '[]') as string[],
      updated_at: r.updated_at,
      deleted: !!r.deleted,
    }));
  }

  // -------- graph (LWW) ---------------------------------------------------

  /** Apply a batch of asserts inside a single transaction. */
  applyGraphAssertBatch(
    rows: Array<{
      room_id: string;
      id: string;
      src: string;
      predicate: string;
      dst: string;
      src_type: string;
      dst_type: string;
      src_label: string;
      dst_label: string;
      props: Record<string, unknown>;
      author: string;
      updated_at: number;
    }>,
  ): void {
    const tx = this.db.transaction((rs: typeof rows) => {
      for (const r of rs) this.applyGraphAssert(r);
    });
    tx(rows);
  }

  /** Apply a batch of retracts inside a single transaction. */
  applyGraphRetractBatch(room_id: string, ids: string[], retracted_at: number): void {
    const tx = this.db.transaction((xs: string[]) => {
      for (const id of xs) this.applyGraphRetract(room_id, id, retracted_at);
    });
    tx(ids);
  }

  applyGraphAssert(row: {
    room_id: string;
    id: string;
    src: string;
    predicate: string;
    dst: string;
    src_type: string;
    dst_type: string;
    src_label: string;
    dst_label: string;
    props: Record<string, unknown>;
    author: string;
    updated_at: number;
  }): boolean {
    const existing = this.db
      .prepare(
        'SELECT updated_at, author, retracted, retracted_at FROM graph_edges WHERE room_id = ? AND id = ?',
      )
      .get(row.room_id, row.id) as
      | { updated_at: number; author: string; retracted: number; retracted_at: number | null }
      | undefined;
    if (existing) {
      if (existing.retracted && (existing.retracted_at ?? 0) >= row.updated_at) return false;
      if (
        existing.updated_at > row.updated_at ||
        (existing.updated_at === row.updated_at && existing.author >= row.author)
      ) {
        return false;
      }
    }
    this.db
      .prepare(
        `INSERT INTO graph_edges
           (room_id, id, src, predicate, dst, src_type, dst_type, src_label, dst_label, props, author, updated_at, retracted, retracted_at)
         VALUES (@room_id, @id, @src, @predicate, @dst, @src_type, @dst_type, @src_label, @dst_label, @props, @author, @updated_at, 0, NULL)
         ON CONFLICT(room_id, id) DO UPDATE SET
           src=excluded.src,
           predicate=excluded.predicate,
           dst=excluded.dst,
           src_type=excluded.src_type,
           dst_type=excluded.dst_type,
           src_label=excluded.src_label,
           dst_label=excluded.dst_label,
           props=excluded.props,
           author=excluded.author,
           updated_at=excluded.updated_at,
           retracted=0,
           retracted_at=NULL`,
      )
      .run({ ...row, props: JSON.stringify(row.props) });
    return true;
  }

  applyGraphRetract(room_id: string, id: string, retracted_at: number): boolean {
    const existing = this.db
      .prepare('SELECT retracted, retracted_at FROM graph_edges WHERE room_id = ? AND id = ?')
      .get(room_id, id) as { retracted: number; retracted_at: number | null } | undefined;
    if (existing) {
      if (existing.retracted && (existing.retracted_at ?? 0) >= retracted_at) return false;
      this.db
        .prepare(
          'UPDATE graph_edges SET retracted = 1, retracted_at = ? WHERE room_id = ? AND id = ?',
        )
        .run(retracted_at, room_id, id);
      return true;
    }
    // tombstone for an edge we've never seen
    this.db
      .prepare(
        `INSERT INTO graph_edges
           (room_id, id, src, predicate, dst, src_type, dst_type, src_label, dst_label, props, author, updated_at, retracted, retracted_at)
         VALUES (?, ?, '', '', '', '', '', '', '', '{}', '', ?, 1, ?)`,
      )
      .run(room_id, id, retracted_at, retracted_at);
    return true;
  }

  queryGraph(
    room_id: string,
    filter: {
      src?: string;
      predicate?: string;
      dst?: string;
      src_type?: string;
      dst_type?: string;
      limit?: number;
    },
  ) {
    const limit = filter.limit ?? 100;
    const rows = this.db
      .prepare(
        `SELECT id, src, predicate, dst, src_type, dst_type, src_label, dst_label, props, author, updated_at
           FROM graph_edges
          WHERE room_id = ? AND retracted = 0
            AND (? IS NULL OR src = ?)
            AND (? IS NULL OR predicate = ?)
            AND (? IS NULL OR dst = ?)
            AND (? IS NULL OR src_type = ?)
            AND (? IS NULL OR dst_type = ?)
          ORDER BY updated_at DESC
          LIMIT ?`,
      )
      .all(
        room_id,
        filter.src || null,
        filter.src || null,
        filter.predicate || null,
        filter.predicate || null,
        filter.dst || null,
        filter.dst || null,
        filter.src_type || null,
        filter.src_type || null,
        filter.dst_type || null,
        filter.dst_type || null,
        limit,
      ) as any[];
    return rows.map((r) => ({
      id: r.id,
      src: r.src,
      predicate: r.predicate,
      dst: r.dst,
      src_type: r.src_type,
      dst_type: r.dst_type,
      src_label: r.src_label,
      dst_label: r.dst_label,
      props: JSON.parse(r.props || '{}') as Record<string, unknown>,
      author: r.author,
      updated_at: r.updated_at,
    }));
  }

  /** Returns neighbors (outgoing + incoming) of a node, up to `depth`. */
  neighbors(room_id: string, nodeId: string, depth = 1, limit = 100) {
    const visited = new Set<string>([nodeId]);
    let frontier = [nodeId];
    const edges: ReturnType<Repo['queryGraph']> = [];
    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const n of frontier) {
        const out = this.queryGraph(room_id, { src: n, limit });
        const incoming = this.queryGraph(room_id, { dst: n, limit });
        for (const e of [...out, ...incoming]) {
          edges.push(e);
          if (!visited.has(e.src)) {
            visited.add(e.src);
            next.push(e.src);
          }
          if (!visited.has(e.dst)) {
            visited.add(e.dst);
            next.push(e.dst);
          }
        }
      }
      frontier = next;
    }
    return { edges, nodes: [...visited] };
  }

  // -------- join requests ------------------------------------------------

  upsertJoinRequest(r: JoinRequestRow): void {
    this.db
      .prepare(
        `INSERT INTO join_requests (room_id, pubkey, x25519_pub, nickname, client, ts)
         VALUES (@room_id, @pubkey, @x25519_pub, @nickname, @client, @ts)
         ON CONFLICT(room_id, pubkey) DO UPDATE SET
           x25519_pub=excluded.x25519_pub,
           nickname=excluded.nickname,
           client=excluded.client,
           ts=excluded.ts`,
      )
      .run(r);
  }

  removeJoinRequest(room_id: string, pubkey: string): void {
    this.db
      .prepare('DELETE FROM join_requests WHERE room_id = ? AND pubkey = ?')
      .run(room_id, pubkey);
  }

  listJoinRequests(room_id: string): JoinRequestRow[] {
    return this.db
      .prepare('SELECT * FROM join_requests WHERE room_id = ? ORDER BY ts ASC')
      .all(room_id) as JoinRequestRow[];
  }

  setKv(k: string, v: string): void {
    this.db
      .prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')
      .run(k, v);
  }

  getKv(k: string): string | undefined {
    const row = this.db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined;
    return row?.v;
  }
}
