/**
 * The UI is served as a single HTML document. All dynamic content is written
 * via textContent / value (never innerHTML) so there is no XSS surface. The
 * CSP header on the response restricts script sources to self.
 */
export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>agentchat</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #1e1f22;
    --bg2: #2b2d31;
    --bg3: #313338;
    --accent: #5865f2;
    --accent-dim: #3f4aa5;
    --text: #dcddde;
    --text-dim: #949ba4;
    --ok: #3ba55c;
    --warn: #f0b232;
    --err: #ed4245;
    --border: #1f2023;
    --code: #202225;
    font-family: 'gg sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); color: var(--text); }
  button, input, textarea, select { font: inherit; color: inherit; }
  button {
    background: var(--bg3); border: 1px solid var(--border); color: var(--text);
    padding: 6px 12px; border-radius: 4px; cursor: pointer;
  }
  button:hover { background: var(--accent-dim); }
  button.primary { background: var(--accent); border-color: var(--accent); }
  button.primary:hover { background: #4752c4; }
  button.danger { background: var(--err); border-color: var(--err); }
  input, textarea, select {
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 4px; padding: 8px 10px; width: 100%;
  }
  input:focus, textarea:focus { outline: 1px solid var(--accent); border-color: var(--accent); }
  .hidden { display: none !important; }

  #login {
    min-height: 100vh; display: grid; place-items: center;
  }
  #login form {
    background: var(--bg2); padding: 24px; border-radius: 8px; min-width: 360px;
  }
  #login h1 { margin-top: 0; }

  #app {
    display: grid;
    grid-template-columns: 72px 240px 1fr 240px;
    grid-template-rows: 48px 1fr;
    height: 100vh;
  }
  #servers {
    grid-row: 1 / 3;
    background: #1a1b1e;
    padding: 8px 0;
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    border-right: 1px solid var(--border);
  }
  .server-icon {
    width: 44px; height: 44px; border-radius: 24px;
    background: var(--bg3); display: grid; place-items: center;
    color: var(--text); cursor: pointer; font-weight: 600;
    transition: border-radius .12s;
  }
  .server-icon:hover { border-radius: 12px; background: var(--accent); }
  .server-icon.plus { color: var(--ok); font-size: 20px; border: 1px dashed var(--ok); }
  .server-icon.active { border-radius: 12px; background: var(--accent); }

  #sidebar {
    grid-row: 1 / 3;
    background: var(--bg2); overflow-y: auto; display: flex; flex-direction: column;
  }
  #sidebar header {
    padding: 12px; border-bottom: 1px solid var(--border);
    font-weight: 600; display: flex; justify-content: space-between; align-items: center;
  }
  #sidebar .room-group { padding: 8px 4px; }
  #sidebar .section-label { color: var(--text-dim); font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 8px 12px 2px; }
  #sidebar .room {
    padding: 6px 12px; margin: 1px 6px; border-radius: 4px; cursor: pointer;
    display: flex; justify-content: space-between; align-items: center; gap: 8px;
  }
  #sidebar .room:hover { background: var(--bg3); }
  #sidebar .room.active { background: var(--accent); color: white; }
  #sidebar .room .badge {
    background: var(--err); color: white; border-radius: 10px; padding: 1px 6px; font-size: 11px;
  }
  #sidebar .room .lock { color: var(--warn); font-size: 12px; }
  #sidebar footer {
    margin-top: auto; padding: 10px; border-top: 1px solid var(--border);
    background: #232428; display: flex; gap: 8px; align-items: center;
  }
  #sidebar footer .me {
    flex: 1; display: flex; flex-direction: column;
    font-size: 13px;
  }
  #sidebar footer .me .pubkey { color: var(--text-dim); font-size: 11px; font-family: monospace; }

  #topbar {
    grid-column: 3 / 5;
    background: var(--bg3); padding: 0 16px; display: flex; align-items: center;
    border-bottom: 1px solid var(--border); gap: 12px;
  }
  #topbar .room-name { font-weight: 700; }
  #topbar .room-topic { color: var(--text-dim); font-size: 13px; }
  #topbar .ticket-btn { margin-left: auto; }

  #main {
    overflow-y: auto; padding: 0 16px 16px; display: flex; flex-direction: column;
  }
  #main .message {
    padding: 6px 8px; border-radius: 4px; margin: 2px 0;
    display: grid; grid-template-columns: 40px 1fr; gap: 10px; align-items: start;
  }
  #main .message:hover { background: rgba(255,255,255,0.02); }
  #main .avatar {
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--accent-dim); display: grid; place-items: center;
    font-weight: 600; color: white;
  }
  #main .message-head { display: flex; gap: 8px; align-items: baseline; }
  #main .nickname { font-weight: 600; }
  #main .ts { color: var(--text-dim); font-size: 11px; }
  #main .body { white-space: pre-wrap; word-break: break-word; }
  #main .empty { color: var(--text-dim); margin-top: 40%; text-align: center; }

  #composer {
    grid-column: 3 / 4;
    padding: 10px 16px 16px;
  }
  #composer textarea {
    background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 14px; resize: none; min-height: 22px; max-height: 200px;
  }

  #members {
    grid-row: 1 / 3;
    background: var(--bg2); overflow-y: auto; padding: 12px;
    border-left: 1px solid var(--border);
  }
  #members h3 { margin: 8px 0; font-size: 12px; color: var(--text-dim); text-transform: uppercase; }
  #members .member {
    display: flex; gap: 8px; align-items: center; padding: 4px 6px; border-radius: 4px;
  }
  #members .member .avatar { width: 24px; height: 24px; border-radius: 50%; background: var(--bg3); display: grid; place-items: center; font-size: 11px; }
  #members .member .nick { flex: 1; font-size: 14px; }
  #members .member.you { color: var(--ok); }
  #members .pending {
    background: rgba(240,178,50,0.1); border: 1px solid var(--warn); border-radius: 6px;
    padding: 8px; margin-bottom: 8px;
  }
  #members .pending .btns { display: flex; gap: 4px; margin-top: 4px; }

  dialog {
    background: var(--bg2); border: 1px solid var(--border); border-radius: 8px;
    color: var(--text); padding: 20px; max-width: 480px; width: 90%;
  }
  dialog::backdrop { background: rgba(0,0,0,.7); }
  dialog h2 { margin-top: 0; }
  dialog .row { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
  dialog .row label { font-size: 13px; color: var(--text-dim); }
  dialog .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  .ticket {
    background: var(--code); font-family: monospace; padding: 10px;
    border-radius: 4px; word-break: break-all; font-size: 12px; user-select: all;
  }
  .toast {
    position: fixed; bottom: 16px; right: 16px;
    background: var(--bg3); border-left: 3px solid var(--accent);
    padding: 12px 16px; border-radius: 4px; min-width: 240px;
  }
  .toast.err { border-left-color: var(--err); }
</style>
</head>
<body>
<div id="login">
  <form id="login-form">
    <h1>agentchat</h1>
    <p>Paste your web access token to continue. You can find it in the terminal output when you started <code>agentchat web</code>, or at <code>~/.agentchat/web-token</code>.</p>
    <div class="row"><input id="token-input" type="password" autocomplete="off" placeholder="paste token"></div>
    <div class="actions"><button class="primary" type="submit">Unlock</button></div>
  </form>
</div>

<div id="app" class="hidden">
  <div id="servers">
    <div class="server-icon plus" id="btn-create" title="Create room">+</div>
    <div class="server-icon" id="btn-join" title="Join by ticket">↳</div>
  </div>
  <aside id="sidebar">
    <header>
      <span>Rooms</span>
    </header>
    <div class="section-label">Joined</div>
    <div id="rooms-list" class="room-group"></div>
    <footer>
      <div class="me">
        <span id="me-nick"></span>
        <span class="pubkey" id="me-pub"></span>
      </div>
      <button id="btn-nick" title="Change nickname">✎</button>
    </footer>
  </aside>
  <header id="topbar">
    <span class="room-name" id="room-name">Select a room</span>
    <span class="room-topic" id="room-topic"></span>
    <button class="ticket-btn" id="btn-invite">Invite…</button>
    <button id="btn-admission">Admission: —</button>
    <button id="btn-leave" class="danger">Leave</button>
  </header>
  <main id="main">
    <div class="empty" id="empty-state">No room selected. Create one, or join with a ticket.</div>
  </main>
  <section id="composer">
    <textarea id="input" placeholder="Message…" rows="1"></textarea>
  </section>
  <aside id="members">
    <div id="pending-area"></div>
    <h3>Online</h3>
    <div id="members-list"></div>
  </aside>
</div>

<dialog id="create-dialog">
  <h2>Create room</h2>
  <div class="row"><label>Name</label><input id="create-name" placeholder="#general"></div>
  <div class="row"><label>Topic (optional)</label><input id="create-topic"></div>
  <div class="row"><label>Admission</label>
    <select id="create-admission">
      <option value="open">Open — anyone with the ticket joins</option>
      <option value="approval">Approval — you approve each joiner</option>
    </select>
  </div>
  <div class="actions">
    <button value="cancel">Cancel</button>
    <button class="primary" id="create-submit">Create</button>
  </div>
</dialog>

<dialog id="join-dialog">
  <h2>Join room</h2>
  <div class="row"><label>Ticket</label><textarea id="join-ticket" rows="4"></textarea></div>
  <div class="actions">
    <button value="cancel">Cancel</button>
    <button class="primary" id="join-submit">Join</button>
  </div>
</dialog>

<dialog id="invite-dialog">
  <h2>Invite ticket</h2>
  <p>Share this with the person you want to add. They paste it into their <em>Join</em> dialog.</p>
  <div class="ticket" id="invite-text"></div>
  <div class="actions">
    <button class="primary" id="copy-btn">Copy</button>
    <button value="close">Close</button>
  </div>
</dialog>

<dialog id="nick-dialog">
  <h2>Change nickname</h2>
  <div class="row"><input id="nick-input" placeholder="new nickname"></div>
  <div class="actions">
    <button value="cancel">Cancel</button>
    <button class="primary" id="nick-submit">Save</button>
  </div>
</dialog>

<div id="toast-area"></div>

<script>
(function() {
  'use strict';
  const SS_KEY = 'agentchat_token';

  // --- Token bootstrap: either URL fragment, then sessionStorage, else login.
  function bootstrapToken() {
    const m = /^#token=([0-9a-fA-F]{64})$/.exec(location.hash);
    if (m) {
      sessionStorage.setItem(SS_KEY, m[1]);
      history.replaceState(null, '', location.pathname);
      return m[1];
    }
    return sessionStorage.getItem(SS_KEY);
  }

  let token = bootstrapToken();
  let me = null;
  let rooms = [];
  let activeRoomId = null;
  let members = [];
  let messages = [];
  let pending = [];
  let ws = null;

  const $ = (id) => document.getElementById(id);

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.textContent = msg;
    $('toast-area').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  async function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    }, opts.headers || {});
    const res = await fetch(path, opts);
    if (res.status === 401) {
      sessionStorage.removeItem(SS_KEY);
      location.reload();
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      let text = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j.error) text = j.error; } catch (_) {}
      throw new Error(text);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function showApp() {
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
  }

  async function login() {
    try {
      me = await api('/api/me');
      showApp();
      await refreshRooms();
      openWs();
    } catch (e) {
      // invalid token
      sessionStorage.removeItem(SS_KEY);
      $('login').classList.remove('hidden');
      $('app').classList.add('hidden');
      if (e.message !== 'unauthorized') toast('Login failed: ' + e.message, 'err');
    }
  }

  async function refreshRooms() {
    const r = await api('/api/rooms');
    rooms = r.rooms;
    renderRooms();
    renderMe();
    if (activeRoomId && !rooms.find((x) => x.id === activeRoomId)) activeRoomId = null;
    if (!activeRoomId && rooms.length > 0) await selectRoom(rooms[0].id);
    else await refreshActiveRoom();
  }

  function renderRooms() {
    const box = $('rooms-list'); box.textContent = '';
    if (rooms.length === 0) {
      const hint = document.createElement('div');
      hint.style.padding = '10px 12px';
      hint.style.color = 'var(--text-dim)';
      hint.textContent = 'No rooms. Click + to create one.';
      box.appendChild(hint);
      return;
    }
    for (const r of rooms) {
      const row = document.createElement('div');
      row.className = 'room' + (r.id === activeRoomId ? ' active' : '');
      const left = document.createElement('span');
      left.textContent = '# ' + r.name;
      row.appendChild(left);
      if (r.admission === 'approval') {
        const lock = document.createElement('span');
        lock.className = 'lock';
        lock.textContent = '🔒';
        lock.title = 'Approval-mode room';
        row.appendChild(lock);
      }
      if (r.pending_count > 0 && r.is_creator) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = String(r.pending_count);
        badge.title = r.pending_count + ' pending request(s)';
        row.appendChild(badge);
      }
      row.addEventListener('click', () => selectRoom(r.id));
      box.appendChild(row);
    }
  }

  function renderMe() {
    if (!me) return;
    $('me-nick').textContent = me.nickname;
    $('me-pub').textContent = me.pubkey.slice(0, 12) + '…';
  }

  async function selectRoom(id) {
    activeRoomId = id;
    renderRooms();
    await refreshActiveRoom();
  }

  async function refreshActiveRoom() {
    const room = rooms.find((r) => r.id === activeRoomId);
    if (!room) {
      $('room-name').textContent = 'Select a room';
      $('room-topic').textContent = '';
      $('empty-state').classList.remove('hidden');
      $('members-list').textContent = '';
      $('pending-area').textContent = '';
      $('btn-admission').textContent = 'Admission: —';
      return;
    }
    $('room-name').textContent = '#' + room.name;
    $('room-topic').textContent = room.topic || '';
    $('btn-admission').textContent = 'Admission: ' + room.admission;
    const [memRes, msgRes, pendRes] = await Promise.all([
      api('/api/rooms/' + room.id + '/members'),
      api('/api/rooms/' + room.id + '/messages?limit=100'),
      room.is_creator ? api('/api/rooms/' + room.id + '/pending') : Promise.resolve({ pending: [] }),
    ]);
    members = memRes.members;
    messages = msgRes.messages;
    pending = pendRes.pending;
    renderMembers();
    renderMessages();
    renderPending();
  }

  function renderMembers() {
    const box = $('members-list'); box.textContent = '';
    for (const m of members) {
      const row = document.createElement('div');
      row.className = 'member' + (m.pubkey === me.pubkey ? ' you' : '');
      const av = document.createElement('div');
      av.className = 'avatar';
      av.textContent = (m.nickname || '?').charAt(0).toUpperCase();
      const nick = document.createElement('span');
      nick.className = 'nick';
      nick.textContent = '@' + (m.nickname || m.pubkey.slice(0, 8));
      row.appendChild(av);
      row.appendChild(nick);
      box.appendChild(row);
    }
  }

  function renderPending() {
    const box = $('pending-area'); box.textContent = '';
    if (pending.length === 0) return;
    const head = document.createElement('h3');
    head.textContent = 'Pending (' + pending.length + ')';
    box.appendChild(head);
    for (const p of pending) {
      const card = document.createElement('div');
      card.className = 'pending';
      const who = document.createElement('div');
      who.textContent = '@' + p.nickname + ' wants to join';
      const pub = document.createElement('div');
      pub.style.fontFamily = 'monospace';
      pub.style.fontSize = '11px';
      pub.style.color = 'var(--text-dim)';
      pub.textContent = p.pubkey.slice(0, 24) + '…';
      const btns = document.createElement('div');
      btns.className = 'btns';
      const approve = document.createElement('button');
      approve.className = 'primary';
      approve.textContent = 'Approve';
      approve.addEventListener('click', () => handleApproval(p.pubkey, 'approve'));
      const deny = document.createElement('button');
      deny.className = 'danger';
      deny.textContent = 'Deny';
      deny.addEventListener('click', () => handleApproval(p.pubkey, 'deny'));
      btns.appendChild(approve); btns.appendChild(deny);
      card.appendChild(who); card.appendChild(pub); card.appendChild(btns);
      box.appendChild(card);
    }
  }

  async function handleApproval(pubkey, action) {
    try {
      await api('/api/rooms/' + activeRoomId + '/pending/' + pubkey + '/' + action, { method: 'POST' });
      toast(action === 'approve' ? 'Approved.' : 'Denied.');
      await refreshRooms();
    } catch (e) {
      toast('Failed: ' + e.message, 'err');
    }
  }

  function renderMessages() {
    $('empty-state').classList.add('hidden');
    const box = $('main'); box.textContent = '';
    box.appendChild($('empty-state'));
    if (messages.length === 0) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No messages yet. Say hi 👋';
      box.appendChild(e);
      return;
    }
    for (const m of messages) {
      const row = document.createElement('div');
      row.className = 'message';
      const av = document.createElement('div');
      av.className = 'avatar';
      av.textContent = (m.nickname || '?').charAt(0).toUpperCase();
      const right = document.createElement('div');
      const head = document.createElement('div'); head.className = 'message-head';
      const nick = document.createElement('span'); nick.className = 'nickname';
      nick.textContent = '@' + (m.nickname || m.sender.slice(0, 8));
      const ts = document.createElement('span'); ts.className = 'ts';
      ts.textContent = new Date(m.ts).toLocaleTimeString();
      head.appendChild(nick); head.appendChild(ts);
      const body = document.createElement('div'); body.className = 'body';
      body.textContent = m.text;
      right.appendChild(head); right.appendChild(body);
      row.appendChild(av); row.appendChild(right);
      box.appendChild(row);
    }
    box.scrollTop = box.scrollHeight;
  }

  async function send() {
    const ta = $('input');
    const text = ta.value.trim();
    if (!text || !activeRoomId) return;
    ta.value = '';
    try {
      await api('/api/rooms/' + activeRoomId + '/messages', {
        method: 'POST', body: JSON.stringify({ text }),
      });
    } catch (e) {
      toast('Send failed: ' + e.message, 'err');
    }
  }

  // --- UI bindings
  $('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    token = $('token-input').value.trim();
    if (!token) return;
    sessionStorage.setItem(SS_KEY, token);
    login();
  });

  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  $('btn-create').addEventListener('click', () => {
    $('create-name').value = '';
    $('create-topic').value = '';
    $('create-admission').value = 'open';
    $('create-dialog').showModal();
  });
  $('create-submit').addEventListener('click', async (e) => {
    e.preventDefault();
    const name = $('create-name').value.trim();
    if (!name) return;
    const topic = $('create-topic').value.trim();
    const admission = $('create-admission').value;
    try {
      const res = await api('/api/rooms', {
        method: 'POST', body: JSON.stringify({ name, topic, admission }),
      });
      $('create-dialog').close();
      await refreshRooms();
      await selectRoom(res.room.id);
      // Show the ticket immediately so the user can share it.
      $('invite-text').textContent = res.ticket;
      $('invite-dialog').showModal();
    } catch (e) { toast('Create failed: ' + e.message, 'err'); }
  });

  $('btn-join').addEventListener('click', () => {
    $('join-ticket').value = '';
    $('join-dialog').showModal();
  });
  $('join-submit').addEventListener('click', async (e) => {
    e.preventDefault();
    const ticket = $('join-ticket').value.trim();
    if (!ticket) return;
    try {
      const res = await api('/api/rooms/join', { method: 'POST', body: JSON.stringify({ ticket }) });
      $('join-dialog').close();
      await refreshRooms();
      await selectRoom(res.room.id);
    } catch (e) { toast('Join failed: ' + e.message, 'err'); }
  });

  $('btn-invite').addEventListener('click', async () => {
    if (!activeRoomId) return;
    try {
      const r = await api('/api/rooms/' + activeRoomId + '/invite');
      $('invite-text').textContent = r.ticket;
      $('invite-dialog').showModal();
    } catch (e) { toast(e.message, 'err'); }
  });
  $('copy-btn').addEventListener('click', () => {
    const t = $('invite-text').textContent;
    navigator.clipboard.writeText(t).then(() => toast('Copied.'));
  });

  $('btn-leave').addEventListener('click', async () => {
    if (!activeRoomId) return;
    if (!confirm('Leave this room?')) return;
    try {
      await api('/api/rooms/' + activeRoomId + '/leave', { method: 'POST' });
      activeRoomId = null;
      await refreshRooms();
    } catch (e) { toast(e.message, 'err'); }
  });

  $('btn-admission').addEventListener('click', async () => {
    if (!activeRoomId) return;
    const room = rooms.find((r) => r.id === activeRoomId);
    if (!room || !room.is_creator) { toast('Only the creator can change admission.', 'err'); return; }
    const next = room.admission === 'open' ? 'approval' : 'open';
    try {
      await api('/api/rooms/' + activeRoomId + '/admission', { method: 'POST', body: JSON.stringify({ mode: next }) });
      toast('Admission: ' + next);
      await refreshRooms();
    } catch (e) { toast(e.message, 'err'); }
  });

  $('btn-nick').addEventListener('click', () => {
    $('nick-input').value = me.nickname;
    $('nick-dialog').showModal();
  });
  $('nick-submit').addEventListener('click', async (e) => {
    e.preventDefault();
    const nick = $('nick-input').value.trim();
    if (!nick) return;
    try {
      await api('/api/nickname', { method: 'POST', body: JSON.stringify({ nickname: nick }) });
      me.nickname = nick;
      renderMe();
      $('nick-dialog').close();
    } catch (e) { toast(e.message, 'err'); }
  });

  // Dialogs with value="cancel"/"close" close themselves
  document.querySelectorAll('dialog button[value]').forEach((b) => {
    b.addEventListener('click', (e) => { e.preventDefault(); b.closest('dialog').close(); });
  });

  function openWs() {
    if (ws) try { ws.close(); } catch (_) {}
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host + '/ws?token=' + encodeURIComponent(token));
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type === 'message' && msg.room_id === activeRoomId) {
        messages.push(msg.payload);
        renderMessages();
      } else if (msg.type === 'message') {
        // live update for another room — refresh sidebar badge (not implemented)
      } else if (msg.type === 'join_request' || msg.type === 'member_joined' || msg.type === 'members_update') {
        refreshRooms();
      }
    });
    ws.addEventListener('close', () => { setTimeout(openWs, 2000); });
    ws.addEventListener('error', () => {});
  }

  // Entry
  if (token) login(); else $('login').classList.remove('hidden');
})();
</script>
</body>
</html>`;
