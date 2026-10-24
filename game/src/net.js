// Peer-to-peer rooms over WebRTC using PeerJS (free hosted matchmaking,
// no game server). The host's device runs the simulation; others send
// inputs and receive snapshots. Add a TURN server in ICE_SERVERS if players
// on strict mobile networks can't connect (e.g. a free metered.ca account).
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const PREFIX = 'mmx-room-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

// Add ?debug to the page URL to log connection details to the console.
const DEBUG = new URLSearchParams(location.search).has('debug') ? 3 : 1;

function newPeer(id) {
  const opts = { config: { iceServers: ICE_SERVERS }, debug: DEBUG };
  // eslint-disable-next-line no-undef
  return id ? new Peer(id, opts) : new Peer(opts);
}

export class Host {
  constructor(code, handlers) {
    this.code = code;
    this.conns = new Map();   // player id -> DataConnection
    this.peer = newPeer(PREFIX + code);
    this.peer.on('open', () => handlers.onOpen());
    this.peer.on('error', err => handlers.onError(err));
    this.peer.on('connection', conn => {
      const id = 'p-' + conn.peer.slice(-8);
      conn.on('data', msg => {
        if (msg.t === 'join') {
          this.conns.set(id, conn);
          handlers.onJoin(id, msg.name, conn);
        } else if (msg.t === 'in') {
          handlers.onInput(id, msg.i);
        }
      });
      conn.on('close', () => { this.conns.delete(id); handlers.onLeave(id); });
      conn.on('error', () => { this.conns.delete(id); handlers.onLeave(id); });
    });
  }

  send(id, msg) {
    const c = this.conns.get(id);
    if (c && c.open) c.send(msg);
  }

  broadcast(msg) {
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }

  close() { this.peer.destroy(); }
}

export class Client {
  constructor(code, name, handlers) {
    this.peer = newPeer();
    this.peer.on('error', err => handlers.onError(err));
    this.peer.on('open', () => {
      const conn = this.conn = this.peer.connect(PREFIX + code, { reliable: true });
      conn.on('open', () => conn.send({ t: 'join', name }));
      conn.on('data', msg => handlers.onMessage(msg));
      conn.on('close', () => handlers.onClose());
    });
  }

  sendInput(i) {
    if (this.conn && this.conn.open) this.conn.send({ t: 'in', i });
  }

  close() { this.peer.destroy(); }
}
