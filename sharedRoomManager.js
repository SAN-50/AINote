const fs = require('fs');
const path = require('path');
const http = require('http');
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');

const DISCOVERY_PORT = 49872;
const LOCAL_PORT_CANDIDATES = [49873, 49874, 49875, 49876, 49877];
const MAX_HTTP_BODY_BYTES = 8 * 1024 * 1024; // 8MB max per packet
const MAX_SSE_CLIENTS = 30;
const MAX_CHAT_MESSAGES = 300;
const MAX_SHARED_NOTES = 500;
const MAX_CHAT_ATTACHMENT_BYTES = 3 * 1024 * 1024; // 3MB per attached file/GIF
const MAX_CHAT_ATTACHMENT_DATAURL_LEN = 4.6 * 1024 * 1024;
const ALLOWED_CHAT_REACTIONS = new Set(['👍', '❤️', '✅', '😂', '🎉', '🔥', '👀']);
const MAX_JOIN_ATTEMPTS = 5;
const JOIN_LOCKOUT_MS = 30 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 30 * 1000;
const PASSWORD_MIN_LEN = 6;
const PASSWORD_MAX_LEN = 128;
const ACCOUNT_ID_RE = /^[a-z0-9_-]{3,24}$/;
const RESERVED_ACCOUNT_IDS = new Set([
  'anonymous',
  'system',
  'admin',
  'host',
  'root',
  'null',
  'undefined'
]);
const BLOCKED_INVITE_PORTS = new Set([3306, 5432, 6379, 27017, 9200, 11211]);
const RELAY_ENDPOINTS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt'
];
const RELAY_CHUNK_CHARS = 24 * 1024;
const RELAY_REASSEMBLY_TTL_MS = 25 * 1000;
const RELAY_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

function normalizeAccountId(rawId) {
  return String(rawId || '')
    .trim()
    .toLowerCase();
}

function computePublicKeyFingerprint(publicKeyPem) {
  return crypto
    .createHash('sha256')
    .update(String(publicKeyPem || '').trim())
    .digest('hex')
    .slice(0, 12);
}

function encryptSecretWithPassword(plainText, password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plainText, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString('hex'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  };
}

function decryptSecretWithPassword(envelope, password) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Invalid key envelope');
  }
  const salt = Buffer.from(String(envelope.salt || ''), 'hex');
  const key = crypto.scryptSync(String(password), salt, 32);
  const iv = Buffer.from(String(envelope.iv || ''), 'base64');
  const tag = Buffer.from(String(envelope.tag || ''), 'base64');
  const data = Buffer.from(String(envelope.data || ''), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeInviteTarget(host, port) {
  if (!host || typeof host !== 'string') return false;
  const cleanHost = host.trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(cleanHost)) return false;
  if (
    cleanHost === '0.0.0.0' ||
    cleanHost.startsWith('169.254.') ||
    cleanHost === 'metadata' ||
    cleanHost === 'metadata.google.internal'
  ) {
    return false;
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return false;
  if (BLOCKED_INVITE_PORTS.has(port)) return false;
  return true;
}

const DEFAULT_SECTIONS = [
  { id: 'notice', title: '📌 공지 / 필독', color: 'blue' },
  { id: 'idea', title: '💡 아이디어', color: 'amber' },
  { id: 'progress', title: '🔨 진행 중', color: 'purple' },
  { id: 'done', title: '✅ 완료 / 확정', color: 'emerald' },
  { id: 'archive', title: '📦 자료실', color: 'zinc' }
];

const DEFAULT_FOLDERS = [
  { id: 'all-notes', name: '전체 공유 노트', icon: '📂' },
  { id: 'meeting', name: '회의록 · 공지', icon: '📋' },
  { id: 'reference', name: '참고 레퍼런스', icon: '🔖' },
  { id: 'deliverable', name: '산출물 · 시안', icon: '🎨' }
];

const AVATAR_COLORS = [
  '#2563EB',
  '#7C3AED',
  '#059669',
  '#D97706',
  '#DC2626',
  '#0891B2',
  '#4F46E5',
  '#DB2777'
];

function pickAvatarColor(seedStr) {
  const hash = crypto.createHash('sha256').update(String(seedStr || '')).digest();
  return AVATAR_COLORS[hash[0] % AVATAR_COLORS.length];
}

function normalizeRoomSlug(roomName) {
  return String(roomName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function deriveRoomId(roomName) {
  const slug = normalizeRoomSlug(roomName);
  return crypto.createHash('sha256').update(`treenote-room-id:${slug}`).digest('hex').slice(0, 24);
}

function deriveRoomSecrets(roomName, password) {
  const slug = normalizeRoomSlug(roomName);
  const pwd = String(password || '').trim();
  const authToken = crypto
    .scryptSync(pwd, `treenote-room-auth:${slug}`, 32)
    .toString('hex');
  const cipherKey = crypto.scryptSync(pwd, `treenote-room-cipher:${slug}`, 32);
  return { authToken, cipherKey };
}

function encryptPayload(obj, cipherKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey, iv);
  const plainBuf = Buffer.from(JSON.stringify(obj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  };
}

function decryptPayload(envelope, cipherKey) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Invalid encrypted envelope');
  }
  const iv = Buffer.from(String(envelope.iv || ''), 'base64');
  const tag = Buffer.from(String(envelope.tag || ''), 'base64');
  const data = Buffer.from(String(envelope.data || ''), 'base64');
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('Invalid IV or auth tag length');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

function safeTimingEqualHex(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex || ''), 'hex');
    const b = Buffer.from(String(bHex || ''), 'hex');
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_e) {
    return false;
  }
}

function isSafeSharedImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) return false;
  if (dataUrl.length > 7 * 1024 * 1024) return false; // max ~5MB image for real-time room sync
  return /^data:image\/(png|jpeg|jpg|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i.test(dataUrl);
}

function ipToInt(ip) {
  const parts = String(ip || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return (((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + parts[3]) >>> 0;
}

function intToIp(num) {
  return [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join('.');
}

function computeBroadcastAddress(ip, netmask) {
  const ipInt = ipToInt(ip);
  const maskInt = ipToInt(netmask);
  if (ipInt === null || maskInt === null) return null;
  const bcast = (ipInt | (~maskInt >>> 0)) >>> 0;
  return intToIp(bcast);
}

function isVirtualInterface(ifName, ip) {
  const name = String(ifName || '').toLowerCase();
  if (
    /vethernet|virtualbox|vbox|vmware|hyper-v|wsl|docker|bridge|tun|tap|tailscale|zerotier|hamachi|loopback|nordlynx|wireguard|teredo|isatap/.test(
      name
    )
  ) {
    return true;
  }
  if (/^192\.168\.56\.|^192\.168\.99\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) {
    return true;
  }
  return false;
}

function getAllLanInterfaces() {
  const interfaces = os.networkInterfaces();
  const list = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address) {
        const virtual = isVirtualInterface(name, iface.address);
        const physicalBoost = /wi-fi|wifi|wlan|ethernet|이더넷|wireless|en0|eth0/i.test(name) ? 0 : 1;
        list.push({
          name,
          address: iface.address,
          netmask: iface.netmask || '255.255.255.0',
          broadcast: computeBroadcastAddress(iface.address, iface.netmask || '255.255.255.0'),
          isVirtual: virtual,
          rank: (virtual ? 10 : 0) + physicalBoost
        });
      }
    }
  }
  list.sort((a, b) => a.rank - b.rank);
  return list;
}

function getLocalLanIp() {
  const list = getAllLanInterfaces();
  return list.length > 0 ? list[0].address : '127.0.0.1';
}

function encodeInviteCode(endpointsOrHost, port) {
  if (Array.isArray(endpointsOrHost)) {
    const seen = new Set();
    const parts = [];
    for (const item of endpointsOrHost) {
      if (!item || !item.host || !item.port) continue;
      const key = `${item.host}:${item.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(key);
      if (parts.length >= 5) break;
    }
    return Buffer.from(parts.join(','), 'utf8').toString('base64url');
  }
  return Buffer.from(`${endpointsOrHost}:${port}`, 'utf8').toString('base64url');
}

function parseEndpointPairList(str) {
  const out = [];
  const seen = new Set();
  for (const token of String(str || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const lastColon = token.lastIndexOf(':');
    if (lastColon <= 0) continue;
    let host = token.slice(0, lastColon).trim();
    const port = Number(token.slice(lastColon + 1).trim());
    if (host.toLowerCase() === 'localhost') host = '127.0.0.1';
    if (isSafeInviteTarget(host, port)) {
      const key = `${host}:${port}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ host, port });
      }
    }
  }
  return out;
}

function decodeInviteCode(code) {
  const results = [];
  const seen = new Set();
  const pushAll = (items) => {
    for (const item of items) {
      const key = `${item.host}:${item.port}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(item);
      }
    }
  };

  try {
    const raw = String(code || '').trim();
    if (!raw) return [];

    // 1) Support pasting the entire multi-line invitation message copied from Share button
    const candidates = [raw];
    const inviteLineMatch = raw.match(/초대\s*코드\s*:\s*([A-Za-z0-9_.:-]+)/i);
    if (inviteLineMatch) candidates.unshift(inviteLineMatch[1].trim());
    const directMatches = raw.match(/(?:localhost|\d{1,3}(?:\.\d{1,3}){3}):\d{2,5}/gi);
    if (directMatches) candidates.push(...directMatches);

    for (const cand of candidates) {
      const clean = cand.trim();
      if (!clean) continue;
      // Direct host:port or comma-separated list
      if (clean.includes(':')) {
        pushAll(parseEndpointPairList(clean));
        continue;
      }
      // Base64url single or comma-separated host:port list
      if (/^[A-Za-z0-9_-]{8,}$/.test(clean)) {
        try {
          const decoded = Buffer.from(clean, 'base64url').toString('utf8');
          pushAll(parseEndpointPairList(decoded));
        } catch (_e) {
          // ignore invalid base64url segment
        }
      }
    }
  } catch (_e) {
    // ignore parse failures
  }
  return results;
}

function encodeFullInviteToken({ roomName, authToken, cipherKeyHex, endpointCode = '' }) {
  const payload = {
    v: 1,
    n: String(roomName || '').trim().slice(0, 60),
    a: String(authToken || '').trim().toLowerCase(),
    k: String(cipherKeyHex || '').trim().toLowerCase(),
    e: String(endpointCode || '').trim()
  };
  return `TN1-${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

function decodeFullInviteToken(rawInput) {
  const text = String(rawInput || '').trim();
  if (!text) return null;
  const match = text.match(/TN1-([A-Za-z0-9_-]+)/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
    if (!parsed || parsed.v !== 1) return null;
    const roomName = String(parsed.n || '').trim().slice(0, 60);
    const authToken = String(parsed.a || '').trim().toLowerCase();
    const cipherKeyHex = String(parsed.k || '').trim().toLowerCase();
    const hostCode = String(parsed.e || '').trim();
    if (
      roomName.length < 2 ||
      !/^[a-f0-9]{64}$/.test(authToken) ||
      !/^[a-f0-9]{64}$/.test(cipherKeyHex)
    ) {
      return null;
    }
    return {
      roomName,
      authToken,
      cipherKeyHex,
      cipherKey: Buffer.from(cipherKeyHex, 'hex'),
      hostCode
    };
  } catch (_e) {
    return null;
  }
}

function deriveRelayTopic(roomId, authToken) {
  const tag = crypto
    .createHmac('sha256', 'treenote-relay-v1')
    .update(`${roomId}:${authToken}`)
    .digest('hex')
    .slice(0, 32);
  return `treenote/room/v1/${tag}`;
}

function encodeMqttVarInt(num) {
  const bytes = [];
  let x = num;
  do {
    let encoded = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) encoded |= 0x80;
    bytes.push(encoded);
  } while (x > 0);
  return Buffer.from(bytes);
}

function encodeMqttString(str) {
  const strBuf = Buffer.from(String(str || ''), 'utf8');
  const lenBuf = Buffer.allocUnsafe(2);
  lenBuf.writeUInt16BE(strBuf.length, 0);
  return Buffer.concat([lenBuf, strBuf]);
}

function buildMqttPacket(typeFlags, varHeader, payload) {
  const vh = varHeader || Buffer.alloc(0);
  const pl = payload || Buffer.alloc(0);
  const remLen = encodeMqttVarInt(vh.length + pl.length);
  return Buffer.concat([Buffer.from([typeFlags]), remLen, vh, pl]);
}

class MqttWsRelayClient {
  constructor({ topic, endpoints, onMessage, onClose, onConnected }) {
    this.topic = topic;
    this.endpoints = Array.isArray(endpoints) && endpoints.length > 0 ? endpoints : RELAY_ENDPOINTS;
    this.onMessage = typeof onMessage === 'function' ? onMessage : () => {};
    this.onClose = typeof onClose === 'function' ? onClose : () => {};
    this.onConnected = typeof onConnected === 'function' ? onConnected : () => {};
    this.clientId = `tn_${crypto.randomBytes(6).toString('hex')}`;
    this.ws = null;
    this.activeEndpoint = '';
    this.connected = false;
    this.closed = false;
    this.rxBuf = Buffer.alloc(0);
    this.keepaliveTimer = null;
    this.chunkMap = new Map();
    this.lastPongAt = 0;
    this.lastPingAt = 0;
  }

  _buildConnectPacket() {
    const varHeader = Buffer.concat([
      encodeMqttString('MQTT'),
      Buffer.from([0x04, 0x02, 0x00, 0x1e]) // MQTT 3.1.1, clean session, keepalive 30s
    ]);
    return buildMqttPacket(0x10, varHeader, encodeMqttString(this.clientId));
  }

  _buildSubscribePacket() {
    const varHeader = Buffer.from([0x00, 0x01]);
    const payload = Buffer.concat([encodeMqttString(this.topic), Buffer.from([0x00])]);
    return buildMqttPacket(0x82, varHeader, payload);
  }

  _buildPublishPacket(payloadBuf) {
    return buildMqttPacket(0x30, encodeMqttString(this.topic), payloadBuf);
  }

  _handleIncomingBytes(chunk) {
    this.rxBuf = Buffer.concat([this.rxBuf, chunk]);
    if (this.rxBuf.length > RELAY_MAX_TOTAL_BYTES) {
      this.rxBuf = Buffer.alloc(0);
      return null;
    }
    const events = [];
    while (this.rxBuf.length >= 2) {
      let multiplier = 1;
      let remLen = 0;
      let offset = 1;
      let encodedByte = 0;
      let incomplete = false;
      do {
        if (offset >= this.rxBuf.length) {
          incomplete = true;
          break;
        }
        encodedByte = this.rxBuf[offset++];
        remLen += (encodedByte & 0x7f) * multiplier;
        multiplier *= 128;
        if (multiplier > 128 * 128 * 128) {
          this.rxBuf = Buffer.alloc(0);
          return events;
        }
      } while ((encodedByte & 0x80) !== 0);

      if (incomplete || this.rxBuf.length < offset + remLen) break;

      const packetTypeByte = this.rxBuf[0];
      const packetType = packetTypeByte >> 4;
      const body = this.rxBuf.subarray(offset, offset + remLen);
      this.rxBuf = this.rxBuf.subarray(offset + remLen);

      if (packetType === 2 && body.length >= 2) {
        events.push({ type: 'CONNACK', rc: body[1] });
      } else if (packetType === 9) {
        events.push({ type: 'SUBACK' });
      } else if (packetType === 13) {
        events.push({ type: 'PINGRESP' });
      } else if (packetType === 3 && body.length >= 2) {
        const topicLen = body.readUInt16BE(0);
        const qos = (packetTypeByte >> 1) & 0x03;
        let payloadStart = 2 + topicLen + (qos > 0 ? 2 : 0);
        if (payloadStart <= body.length) {
          const msgStr = body.subarray(payloadStart).toString('utf8');
          events.push({ type: 'PUBLISH', msgStr });
        }
      }
    }
    return events;
  }

  _processPublishedMessage(msgStr) {
    let parsed;
    try {
      parsed = JSON.parse(msgStr);
    } catch (_e) {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    if (parsed.s === this.clientId && !parsed.__tnChunk) return;

    if (parsed.__tnChunk) {
      if (parsed.s === this.clientId) return;
      const now = Date.now();
      for (const [k, entry] of this.chunkMap.entries()) {
        if (now - entry.ts > RELAY_REASSEMBLY_TTL_MS) this.chunkMap.delete(k);
      }
      const key = `${parsed.s}:${parsed.__tnChunk}`;
      const total = Number(parsed.n);
      const idx = Number(parsed.i);
      const data = typeof parsed.d === 'string' ? parsed.d : '';
      if (!Number.isInteger(total) || total < 1 || total > 300 || idx < 0 || idx >= total) return;

      let entry = this.chunkMap.get(key);
      if (!entry) {
        entry = { total, parts: new Array(total), received: 0, totalBytes: 0, ts: now };
        this.chunkMap.set(key, entry);
      }
      if (entry.parts[idx] === undefined) {
        entry.totalBytes += data.length;
        if (entry.totalBytes > RELAY_MAX_TOTAL_BYTES) {
          this.chunkMap.delete(key);
          return;
        }
        entry.parts[idx] = data;
        entry.received += 1;
        entry.ts = now;
      }
      if (entry.received === entry.total) {
        this.chunkMap.delete(key);
        try {
          const fullObj = JSON.parse(entry.parts.join(''));
          this.onMessage(fullObj);
        } catch (_e) {
          // ignore malformed reassembled JSON
        }
      }
      return;
    }

    this.onMessage(parsed);
  }

  _connectSingle(endpointUrl, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('Client closed'));
        return;
      }
      let settled = false;
      let ws;
      try {
        ws = new globalThis.WebSocket(endpointUrl, 'mqtt');
      } catch (err) {
        reject(err);
        return;
      }
      ws.binaryType = 'arraybuffer';
      let localRx = Buffer.alloc(0);

      const finishErr = (msg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch (_e) {}
        reject(new Error(msg));
      };

      const timer = setTimeout(() => finishErr(`Timeout connecting to ${endpointUrl}`), timeoutMs);

      ws.addEventListener('open', () => {
        if (settled || this.closed) {
          finishErr('Closed before open');
          return;
        }
        try {
          ws.send(this._buildConnectPacket());
        } catch (_e) {
          finishErr('Failed to send MQTT CONNECT');
        }
      });

      ws.addEventListener('message', async (ev) => {
        let buf;
        if (ev.data instanceof ArrayBuffer) {
          buf = Buffer.from(ev.data);
        } else if (Buffer.isBuffer(ev.data)) {
          buf = ev.data;
        } else if (ev.data && typeof ev.data.arrayBuffer === 'function') {
          buf = Buffer.from(await ev.data.arrayBuffer());
        } else {
          return;
        }

        if (this.ws === ws && this.connected) {
          const evs = this._handleIncomingBytes(buf) || [];
          for (const item of evs) {
            if (item.type === 'PINGRESP') {
              this.lastPongAt = Date.now();
            } else if (item.type === 'PUBLISH') {
              this._processPublishedMessage(item.msgStr);
            }
          }
          return;
        }

        if (settled) return;
        this.rxBuf = localRx;
        const evs = this._handleIncomingBytes(buf) || [];
        localRx = this.rxBuf;

        for (const item of evs) {
          if (item.type === 'CONNACK') {
            if (item.rc === 0) {
              try {
                ws.send(this._buildSubscribePacket());
              } catch (_e) {
                finishErr('Failed to send MQTT SUBSCRIBE');
              }
            } else {
              finishErr(`CONNACK error code ${item.rc}`);
            }
          } else if (item.type === 'SUBACK' && !settled && !this.closed) {
            settled = true;
            clearTimeout(timer);
            this.ws = ws;
            this.activeEndpoint = endpointUrl;
            this.connected = true;
            this.lastPongAt = Date.now();
            this.lastPingAt = 0;
            this.rxBuf = localRx;
            this.keepaliveTimer = setInterval(() => {
              if (!this.connected || !this.ws || this.ws.readyState !== 1) return;
              // Detect silent half-open TCP drops when prior PINGREQ went unacknowledged
              if (this.lastPingAt > this.lastPongAt && Date.now() - this.lastPingAt > 20000) {
                try {
                  this.ws.close();
                } catch (_e) {}
                return;
              }
              try {
                this.lastPingAt = Date.now();
                this.ws.send(Buffer.from([0xc0, 0x00]));
              } catch (_e) {}
            }, 15000);
            this.onConnected(endpointUrl);
            resolve(endpointUrl);
          }
        }
      });

      ws.addEventListener('error', () => {
        if (this.ws !== ws) finishErr(`WebSocket error on ${endpointUrl}`);
      });

      ws.addEventListener('close', () => {
        if (this.ws === ws) {
          const wasConnected = this.connected;
          this.connected = false;
          if (this.keepaliveTimer) {
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = null;
          }
          if (wasConnected && !this.closed) {
            this.onClose();
          }
        } else if (!settled) {
          finishErr(`WebSocket closed before ready on ${endpointUrl}`);
        }
      });
    });
  }

  async connectSingleEndpoint(endpointUrl, timeoutMs = 2600) {
    if (typeof globalThis.WebSocket !== 'function') {
      throw new Error('WebSocket runtime not available');
    }
    this.closed = false;
    return await this._connectSingle(endpointUrl, timeoutMs);
  }

  async connect(timeoutMs = 5000) {
    if (typeof globalThis.WebSocket !== 'function') {
      throw new Error('WebSocket runtime not available');
    }
    const perBrokerTimeout = Math.max(1800, Math.min(timeoutMs, 2600));
    let lastErr = null;
    for (const endpointUrl of this.endpoints) {
      if (this.closed) throw new Error('Relay client closed');
      try {
        return await this._connectSingle(endpointUrl, perBrokerTimeout);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('All relay brokers unreachable');
  }

  publishJson(obj) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return false;
    try {
      const payload = { ...obj, s: this.clientId };
      const json = JSON.stringify(payload);
      if (json.length <= RELAY_CHUNK_CHARS) {
        this.ws.send(this._buildPublishPacket(Buffer.from(json, 'utf8')));
        return true;
      }
      const msgId = crypto.randomBytes(6).toString('hex');
      const total = Math.ceil(json.length / RELAY_CHUNK_CHARS);
      for (let i = 0; i < total; i++) {
        const chunkPayload = JSON.stringify({
          __tnChunk: msgId,
          s: this.clientId,
          i,
          n: total,
          d: json.slice(i * RELAY_CHUNK_CHARS, (i + 1) * RELAY_CHUNK_CHARS)
        });
        this.ws.send(this._buildPublishPacket(Buffer.from(chunkPayload, 'utf8')));
      }
      return true;
    } catch (_e) {
      return false;
    }
  }

  close() {
    this.closed = true;
    this.connected = false;
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.ws) {
      try {
        if (this.ws.readyState === 1) {
          this.ws.send(Buffer.from([0xe0, 0x00]));
        }
        this.ws.close();
      } catch (_e) {}
      this.ws = null;
    }
  }
}

function sanitizeAuthor(author) {
  if (!author || typeof author !== 'object') {
    return {
      uid: 'anonymous',
      accountId: '',
      name: '익명 멤버',
      avatarColor: '#2563EB'
    };
  }
  const accountId =
    typeof author.accountId === 'string' && ACCOUNT_ID_RE.test(author.accountId.trim().toLowerCase())
      ? author.accountId.trim().toLowerCase()
      : '';
  const name =
    typeof author.name === 'string' && author.name.trim()
      ? author.name.trim().slice(0, 40)
      : accountId || '멤버';
  const uid =
    typeof author.uid === 'string' && author.uid.trim()
      ? author.uid.trim().slice(0, 80)
      : `acct:${accountId || crypto.createHash('sha256').update(name).digest('hex').slice(0, 20)}`;
  const avatarColor =
    typeof author.avatarColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(author.avatarColor)
      ? author.avatarColor
      : pickAvatarColor(uid);

  return { uid, accountId, name, avatarColor };
}

function sanitizeChecklist(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 60)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const text = typeof item.text === 'string' ? item.text.trim().slice(0, 200) : '';
      if (!text) return null;
      return {
        id: typeof item.id === 'string' && item.id ? item.id.slice(0, 48) : crypto.randomUUID(),
        text,
        done: Boolean(item.done)
      };
    })
    .filter(Boolean);
}

function sanitizeSharedNote(raw, fallbackAuthor) {
  if (!raw || typeof raw !== 'object') return null;
  const now = Date.now();
  const author = sanitizeAuthor(raw.author || fallbackAuthor);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : crypto.randomUUID(),
    title: typeof raw.title === 'string' ? raw.title.slice(0, 160) : '제목 없는 공유 노트',
    content: typeof raw.content === 'string' ? raw.content.slice(0, 200000) : '',
    category: typeof raw.category === 'string' ? raw.category.slice(0, 32) : '💡 아이디어',
    sectionId: typeof raw.sectionId === 'string' && raw.sectionId ? raw.sectionId.slice(0, 40) : 'idea',
    folderId: typeof raw.folderId === 'string' && raw.folderId ? raw.folderId.slice(0, 40) : 'all-notes',
    statusBadge:
      typeof raw.statusBadge === 'string' &&
      ['', '중요', '검토필요', '확정', '질문'].includes(raw.statusBadge)
        ? raw.statusBadge
        : '',
    checklist: sanitizeChecklist(raw.checklist),
    tags: Array.isArray(raw.tags)
      ? raw.tags
          .filter((t) => typeof t === 'string')
          .map((t) => t.trim().slice(0, 24))
          .filter(Boolean)
          .slice(0, 15)
      : [],
    pinned: Boolean(raw.pinned),
    imageDataUrl: isSafeSharedImage(raw.imageDataUrl) ? raw.imageDataUrl : '',
    author,
    updatedBy: sanitizeAuthor(raw.updatedBy || author),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now
  };
}

function sanitizeChatAttachment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const dataUrl = typeof raw.dataUrl === 'string' ? raw.dataUrl.trim() : '';
  if (!dataUrl || dataUrl.length > MAX_CHAT_ATTACHMENT_DATAURL_LEN) return null;
  const mimeMatch = dataUrl.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=\s]+$/i);
  if (!mimeMatch) return null;
  const detectedMime = mimeMatch[1].toLowerCase();
  if (detectedMime === 'text/html' || detectedMime === 'image/svg+xml' || detectedMime === 'application/xhtml+xml') {
    return null;
  }
  const safeName = String(raw.name || '첨부파일')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .trim()
    .slice(0, 120) || '첨부파일';
  const rawSize = Number(raw.size);
  const approxSize = Math.floor((dataUrl.length * 3) / 4);
  const size = Number.isFinite(rawSize) && rawSize > 0 ? Math.min(rawSize, MAX_CHAT_ATTACHMENT_BYTES) : approxSize;
  if (size > MAX_CHAT_ATTACHMENT_BYTES + 4096) return null;
  const isImage = /^image\/(png|jpeg|jpg|gif|webp|bmp)$/.test(detectedMime);
  const isGif = detectedMime === 'image/gif';

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 48) : crypto.randomUUID(),
    name: safeName,
    mime: detectedMime,
    size,
    dataUrl,
    isImage,
    isGif
  };
}

function sanitizeChatReply(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const text = String(raw.text ?? raw.preview ?? '').trim().slice(0, 140);
  return {
    id: String(raw.id || '').slice(0, 64),
    authorName: String(raw.authorName || '멤버').slice(0, 40),
    text,
    hasAttachment: Boolean(raw.hasAttachment)
  };
}

function sanitizeChatReactions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [emoji, uids] of Object.entries(raw)) {
    if (!ALLOWED_CHAT_REACTIONS.has(emoji) || !Array.isArray(uids)) continue;
    const cleanUids = Array.from(
      new Set(uids.filter((u) => typeof u === 'string' && u.trim()).map((u) => u.slice(0, 80)))
    ).slice(0, 100);
    if (cleanUids.length > 0) out[emoji] = cleanUids;
  }
  return out;
}

function sanitizeChatMessage(raw, fallbackAuthor) {
  if (!raw || typeof raw !== 'object') return null;
  const author = sanitizeAuthor(raw.author || fallbackAuthor);
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 4000) : '';
  const imageDataUrl = isSafeSharedImage(raw.imageDataUrl) ? raw.imageDataUrl : '';
  const attachments = [];
  let totalAttLen = 0;
  if (Array.isArray(raw.attachments)) {
    for (const item of raw.attachments.slice(0, 4)) {
      const clean = sanitizeChatAttachment(item);
      if (clean && totalAttLen + clean.dataUrl.length <= 6.2 * 1024 * 1024) {
        attachments.push(clean);
        totalAttLen += clean.dataUrl.length;
      }
    }
  }
  const sharedNoteRef =
    raw.sharedNoteRef && typeof raw.sharedNoteRef === 'object'
      ? {
          id: String(raw.sharedNoteRef.id || '').slice(0, 64),
          title: String(raw.sharedNoteRef.title || '공유 노트').slice(0, 120),
          sectionId: String(raw.sharedNoteRef.sectionId || 'idea').slice(0, 40),
          statusBadge: String(raw.sharedNoteRef.statusBadge || '').slice(0, 20)
        }
      : null;

  if (!text && !imageDataUrl && attachments.length === 0 && !sharedNoteRef) return null;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : crypto.randomUUID(),
    text,
    imageDataUrl,
    attachments,
    replyTo: sanitizeChatReply(raw.replyTo),
    reactions: sanitizeChatReactions(raw.reactions),
    sharedNoteRef,
    author,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    isSystem: Boolean(raw.isSystem),
    pinnedToNoteId: typeof raw.pinnedToNoteId === 'string' ? raw.pinnedToNoteId.slice(0, 64) : ''
  };
}

class SharedRoomManager {
  constructor({ getAppDataDir, sendToRenderer, relayEndpoints } = {}) {
    this.getAppDataDir = getAppDataDir;
    this.sendToRenderer = sendToRenderer;
    this.relayEndpointsOverride = Array.isArray(relayEndpoints) && relayEndpoints.length > 0 ? relayEndpoints : null;

    this.storeData = this.loadStore();
    this.authenticatedSession = null; // { account: publicProfile, publicKeyPem, privateKeyPem }
    this.failedLoginState = { count: 0, lockoutUntil: 0 };
    this.activeSession = null; // { mode: 'host' | 'guest', transport: 'lan' | 'relay', roomId, roomName, cipherKey, authToken, ... }
    this.httpServer = null;
    this.udpSocket = null;
    this.hostRelayClient = null;
    this.guestRelayClient = null;
    this.relayClients = new Map(); // memberUid -> { clientId, profile, lastSeen }
    this.pendingRelayReplies = new Map(); // reqId -> { resolve, reject, timer }
    this.sseClients = new Map(); // memberUid -> { res, profile, lastSeen }
    this.verifiedSessions = new Map(); // sessionToken -> { profile, issuedAt }
    this.joinNonces = new Map(); // nonce -> { expiresAt }
    this.failedJoinMap = new Map(); // ip -> { count, lockoutUntil }
    this.guestEventReq = null;
  }

  getStoreFilePath() {
    return path.join(this.getAppDataDir(), 'shared-space-data.json');
  }

  loadStore() {
    const filePath = this.getStoreFilePath();
    const defaultStore = {
      accounts: {}, // accountId -> { accountId, displayName, uid, passwordSalt, passwordHash, publicKeyPem, privateKeyEncrypted, avatarColor, createdAt, lastLoginAt }
      lastAccountId: '',
      hostedRooms: {}, // roomId -> persisted room object
      recentRooms: [] // [{ roomId, roomName, isHost, lastJoinedAt, hostCode }]
    };
    if (!fs.existsSync(filePath)) return defaultStore;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const cleanAccounts = {};
      if (parsed.accounts && typeof parsed.accounts === 'object' && !Array.isArray(parsed.accounts)) {
        for (const [key, acc] of Object.entries(parsed.accounts)) {
          const cleanId = normalizeAccountId(acc?.accountId || key);
          if (
            ACCOUNT_ID_RE.test(cleanId) &&
            acc &&
            typeof acc.passwordSalt === 'string' &&
            typeof acc.passwordHash === 'string' &&
            typeof acc.publicKeyPem === 'string' &&
            acc.privateKeyEncrypted
          ) {
            cleanAccounts[cleanId] = {
              accountId: cleanId,
              displayName:
                typeof acc.displayName === 'string' && acc.displayName.trim()
                  ? acc.displayName.trim().slice(0, 20)
                  : cleanId,
              uid: typeof acc.uid === 'string' ? acc.uid : `acct:${cleanId}:${computePublicKeyFingerprint(acc.publicKeyPem)}`,
              passwordSalt: acc.passwordSalt,
              passwordHash: acc.passwordHash,
              publicKeyPem: acc.publicKeyPem,
              privateKeyEncrypted: acc.privateKeyEncrypted,
              avatarColor:
                typeof acc.avatarColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(acc.avatarColor)
                  ? acc.avatarColor
                  : pickAvatarColor(cleanId),
              createdAt: typeof acc.createdAt === 'number' ? acc.createdAt : Date.now(),
              lastLoginAt: typeof acc.lastLoginAt === 'number' ? acc.lastLoginAt : 0,
              rememberedRoomsVault:
                acc.rememberedRoomsVault && typeof acc.rememberedRoomsVault === 'object'
                  ? acc.rememberedRoomsVault
                  : null
            };
          }
        }
      }
      const lastId = normalizeAccountId(parsed.lastAccountId || '');
      return {
        accounts: cleanAccounts,
        lastAccountId: cleanAccounts[lastId] ? lastId : '',
        hostedRooms:
          parsed.hostedRooms && typeof parsed.hostedRooms === 'object' ? parsed.hostedRooms : {},
        recentRooms: Array.isArray(parsed.recentRooms) ? parsed.recentRooms.slice(0, 20) : []
      };
    } catch (_e) {
      return defaultStore;
    }
  }

  saveStore() {
    try {
      const filePath = this.getStoreFilePath();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.storeData, null, 2), 'utf8');
      fs.renameSync(tempPath, filePath);
    } catch (err) {
      console.warn('[SharedRoomManager] Failed to save store:', err.message);
    }
  }

  getRegisteredAccountList() {
    return Object.values(this.storeData.accounts || {})
      .map((acc) => ({
        accountId: acc.accountId,
        displayName: acc.displayName || acc.accountId,
        avatarColor: acc.avatarColor || pickAvatarColor(acc.uid),
        lastLoginAt: acc.lastLoginAt || 0
      }))
      .sort((a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0));
  }

  getAccountVaultKey() {
    if (!this.authenticatedSession?.privateKeyPem) return null;
    return crypto
      .createHash('sha256')
      .update('treenote-room-vault-v1:')
      .update(String(this.authenticatedSession.privateKeyPem))
      .digest();
  }

  readAccountRememberedRooms() {
    const accountId = this.authenticatedSession?.account?.accountId;
    const vaultKey = this.getAccountVaultKey();
    if (!accountId || !vaultKey) return {};
    const storedAcc = this.storeData.accounts?.[accountId];
    if (!storedAcc?.rememberedRoomsVault) return {};
    try {
      const decrypted = decryptPayload(storedAcc.rememberedRoomsVault, vaultKey);
      return decrypted && typeof decrypted === 'object' && !Array.isArray(decrypted) ? decrypted : {};
    } catch (_e) {
      return {};
    }
  }

  writeAccountRememberedRooms(roomsMap) {
    const accountId = this.authenticatedSession?.account?.accountId;
    const vaultKey = this.getAccountVaultKey();
    if (!accountId || !vaultKey) return;
    const storedAcc = this.storeData.accounts?.[accountId];
    if (!storedAcc) return;
    storedAcc.rememberedRoomsVault = encryptPayload(roomsMap || {}, vaultKey);
    this.saveStore();
  }

  rememberJoinedRoom({
    room,
    password = '',
    authToken = '',
    cipherKeyHex = '',
    role = 'guest',
    hostCode = ''
  }) {
    const myUid = this.authenticatedSession?.account?.uid || '';
    const hasSecret = Boolean(password) || (Boolean(authToken) && Boolean(cipherKeyHex));
    if (!room || !room.roomId || !hasSecret) return;
    const map = this.readAccountRememberedRooms();
    const prev = map[room.roomId] || {};
    const hostUid = room.hostProfile?.uid || '';
    const isActuallyHost = role === 'host' && (!hostUid || !myUid || hostUid === myUid);

    map[room.roomId] = {
      roomId: room.roomId,
      roomName: room.roomName,
      password: password ? String(password) : prev.password || '',
      authToken: authToken || prev.authToken || '',
      cipherKeyHex: cipherKeyHex || prev.cipherKeyHex || '',
      role: isActuallyHost ? 'host' : 'guest',
      permissionMode: room.permissionMode || 'all',
      hostName: room.hostProfile?.name || '',
      hostAccountId: room.hostProfile?.accountId || '',
      hostCode: hostCode || prev.hostCode || '',
      noteCount: Array.isArray(room.notes) ? room.notes.length : 0,
      messageCount: Array.isArray(room.messages) ? room.messages.length : 0,
      lastEnteredAt: Date.now()
    };
    this.writeAccountRememberedRooms(map);
  }

  getJoinedRoomsList() {
    const map = this.readAccountRememberedRooms();
    return Object.values(map)
      .map((entry) => {
        const localRoom =
          this.storeData.hostedRooms?.[entry.roomId] ||
          this.storeData.guestSnapshots?.[entry.roomId];
        return {
          roomId: entry.roomId,
          roomName: localRoom?.roomName || entry.roomName,
          role: entry.role || 'guest',
          permissionMode: localRoom?.permissionMode || entry.permissionMode || 'all',
          hostName: localRoom?.hostProfile?.name || entry.hostName || '',
          hostAccountId: localRoom?.hostProfile?.accountId || entry.hostAccountId || '',
          noteCount: localRoom ? (localRoom.notes || []).length : entry.noteCount || 0,
          messageCount: localRoom ? (localRoom.messages || []).length : entry.messageCount || 0,
          lastEnteredAt: entry.lastEnteredAt || 0
        };
      })
      .sort((a, b) => (b.lastEnteredAt || 0) - (a.lastEnteredAt || 0));
  }

  removeJoinedRoom(roomId) {
    const targetId = String(roomId || '').trim();
    if (!targetId || !this.authenticatedSession) {
      return { ok: false, error: '로그인이 필요합니다.' };
    }
    const map = this.readAccountRememberedRooms();
    if (map[targetId]) {
      delete map[targetId];
      this.writeAccountRememberedRooms(map);
    }
    return { ok: true, state: this.getPublicState() };
  }

  async quickEnterRoom({ roomId }) {
    if (!this.authenticatedSession) {
      return { ok: false, error: '먼저 TreeNote 계정에 로그인해 주세요.' };
    }
    const targetId = String(roomId || '').trim();
    if (!targetId) return { ok: false, error: '입장할 방을 선택해 주세요.' };
    if (this.activeSession && this.activeSession.roomId === targetId) {
      return { ok: true, room: this.getActiveRoomSnapshot() };
    }
    const map = this.readAccountRememberedRooms();
    const entry = map[targetId];
    const hasPassword = Boolean(entry && entry.roomName && entry.password);
    const hasTokenSecret = Boolean(
      entry && entry.roomName && entry.authToken && entry.cipherKeyHex
    );
    if (!hasPassword && !hasTokenSecret) {
      return {
        ok: false,
        error: '저장된 방 입장 정보가 없습니다. 초대 코드 또는 방 이름과 비밀번호로 한 번 입장해 주세요.'
      };
    }

    const derived = hasPassword
      ? deriveRoomSecrets(entry.roomName, entry.password)
      : {
          authToken: entry.authToken,
          cipherKey: Buffer.from(entry.cipherKeyHex, 'hex')
        };

    // Split-brain recovery: even if role was previously recorded as 'host', check if a live host
    // from another user is already running for this room. If so, auto-heal to Guest and join them!
    if (entry.role === 'host') {
      const liveProbe = await this.probeLiveRoomHost({
        roomId: targetId,
        authToken: derived.authToken,
        hostCode: entry.hostCode || '',
        timeoutMs: 1200
      });
      if (liveProbe.found && liveProbe.hostUid && liveProbe.hostUid !== this.authenticatedSession.account.uid) {
        return await this.joinRoomWithSecrets({
          roomName: entry.roomName,
          password: entry.password || '',
          roomId: targetId,
          authToken: derived.authToken,
          cipherKey: derived.cipherKey,
          hostCode: entry.hostCode || ''
        });
      }
      if (hasPassword) {
        return await this.hostRoom({
          roomName: entry.roomName,
          password: entry.password,
          permissionMode: entry.permissionMode || 'all'
        });
      }
    }

    return await this.joinRoomWithSecrets({
      roomName: entry.roomName,
      password: entry.password || '',
      roomId: targetId,
      authToken: derived.authToken,
      cipherKey: derived.cipherKey,
      hostCode: entry.hostCode || ''
    });
  }

  getSavedRoomsList() {
    return Object.values(this.storeData.hostedRooms || {})
      .map((room) => ({
        roomId: room.roomId,
        roomName: room.roomName,
        hostProfile: room.hostProfile || null,
        permissionMode: room.permissionMode || 'all',
        noteCount: Array.isArray(room.notes) ? room.notes.length : 0,
        messageCount: Array.isArray(room.messages) ? room.messages.length : 0,
        createdAt: room.createdAt || 0,
        updatedAt: room.updatedAt || room.createdAt || 0
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  getPublicState() {
    return {
      currentAccount: this.authenticatedSession ? this.authenticatedSession.account : null,
      registeredAccounts: this.getRegisteredAccountList(),
      lastAccountId: this.storeData.lastAccountId || '',
      recentRooms: this.storeData.recentRooms || [],
      savedRooms: this.getSavedRoomsList(),
      joinedRooms: this.getJoinedRoomsList(),
      activeRoom: this.getActiveRoomSnapshot()
    };
  }

  getActiveRoomSnapshot() {
    if (!this.activeSession) return null;
    const room = this.activeSession.room;
    if (!room) return null;
    const relayConnected =
      this.activeSession.mode === 'host'
        ? Boolean(this.hostRelayClient && this.hostRelayClient.connected)
        : Boolean(this.guestRelayClient && this.guestRelayClient.connected);
    const inviteToken =
      this.activeSession.authToken && this.activeSession.cipherKey
        ? encodeFullInviteToken({
            roomName: room.roomName,
            authToken: this.activeSession.authToken,
            cipherKeyHex: Buffer.from(this.activeSession.cipherKey).toString('hex'),
            endpointCode: this.activeSession.inviteCode || ''
          })
        : '';
    return {
      mode: this.activeSession.mode,
      transport: this.activeSession.transport || 'lan',
      relayConnected,
      roomId: room.roomId,
      roomName: room.roomName,
      rev: Number(room.rev || 0),
      hostProfile: room.hostProfile,
      permissionMode: room.permissionMode || 'all',
      inviteCode: this.activeSession.inviteCode || '',
      inviteToken,
      localPort: this.activeSession.port || 0,
      lastSavedAt: this.activeSession.lastSavedAt || room.updatedAt || Date.now(),
      sections: room.sections || DEFAULT_SECTIONS,
      folders: room.folders || DEFAULT_FOLDERS,
      notes: room.notes || [],
      messages: room.messages || [],
      members: this.getActiveMembersList()
    };
  }

  getActiveMembersList() {
    if (!this.activeSession || !this.activeSession.room) return [];
    if (this.activeSession.mode === 'host') {
      const hostProfile = this.activeSession.room.hostProfile;
      const seen = new Set([hostProfile.uid]);
      const list = [{ ...hostProfile, isHost: true, online: true }];
      for (const [uid, client] of this.sseClients.entries()) {
        if (!seen.has(uid)) {
          seen.add(uid);
          list.push({ ...client.profile, isHost: false, online: true });
        }
      }
      for (const [uid, client] of this.relayClients.entries()) {
        if (!seen.has(uid)) {
          seen.add(uid);
          list.push({ ...client.profile, isHost: false, online: true, viaRelay: true });
        }
      }
      return list;
    }
    return this.activeSession.room.members || [];
  }

  saveRoomNow() {
    if (!this.activeSession || !this.activeSession.room) {
      return { ok: false, error: '저장할 활성 공유 방이 없습니다.' };
    }
    const room = this.activeSession.room;
    const now = Date.now();
    room.updatedAt = now;
    if (this.activeSession.mode === 'host') {
      this.persistHostedRoom(room);
    } else {
      // Guest saves a read-only local snapshot copy separately from hostedRooms
      // so it NEVER triggers accidental split-brain hosting later!
      if (!this.storeData.guestSnapshots || typeof this.storeData.guestSnapshots !== 'object') {
        this.storeData.guestSnapshots = {};
      }
      const existing = this.storeData.guestSnapshots[room.roomId];
      if (!existing) {
        this.storeData.guestSnapshots[room.roomId] = {
          roomId: room.roomId,
          roomName: room.roomName,
          authToken: this.activeSession.authToken,
          hostProfile: room.hostProfile,
          permissionMode: room.permissionMode || 'all',
          sections: room.sections || DEFAULT_SECTIONS,
          folders: room.folders || DEFAULT_FOLDERS,
          notes: room.notes || [],
          messages: room.messages || [],
          kickedUids: [],
          createdAt: room.createdAt || now,
          updatedAt: now
        };
      } else {
        existing.hostProfile = room.hostProfile || existing.hostProfile;
        existing.permissionMode = room.permissionMode || existing.permissionMode;
        existing.notes = room.notes || [];
        existing.messages = room.messages || [];
        existing.sections = room.sections || DEFAULT_SECTIONS;
        existing.folders = room.folders || DEFAULT_FOLDERS;
        existing.updatedAt = now;
      }
      this.saveStore();
    }
    this.activeSession.lastSavedAt = now;
    this.sendToRenderer('shared:room-updated', this.getActiveRoomSnapshot());
    return { ok: true, savedAt: now, room: this.getActiveRoomSnapshot(), state: this.getPublicState() };
  }

  exportHostedRoomBackup(roomId) {
    const targetId = String(roomId || this.activeSession?.roomId || '').trim();
    const room =
      (this.activeSession && this.activeSession.roomId === targetId && this.activeSession.room) ||
      this.storeData.hostedRooms[targetId] ||
      this.storeData.guestSnapshots?.[targetId];
    if (!room) {
      return { ok: false, error: '내보낼 공유 방 데이터를 찾을 수 없습니다.' };
    }
    return {
      ok: true,
      suggestedFilename: `${String(room.roomName || 'treenote-room').replace(/[\\/:*?"<>|]/g, '_')}-backup.json`,
      backup: {
        app: 'TreeNote',
        version: 1,
        exportedAt: Date.now(),
        room: {
          roomId: room.roomId,
          roomName: room.roomName,
          hostProfile: room.hostProfile || null,
          permissionMode: room.permissionMode || 'all',
          sections: Array.isArray(room.sections) ? room.sections : DEFAULT_SECTIONS,
          folders: Array.isArray(room.folders) ? room.folders : DEFAULT_FOLDERS,
          notes: Array.isArray(room.notes) ? room.notes : [],
          messages: Array.isArray(room.messages) ? room.messages : [],
          createdAt: room.createdAt || Date.now(),
          updatedAt: room.updatedAt || Date.now()
        }
      }
    };
  }

  importHostedRoomBackup({ backupData, roomName, password } = {}) {
    const authSess = this.authenticatedSession;
    const account = authSess?.account;
    if (!account) {
      return { ok: false, error: '방 백업을 불러오려면 먼저 계정으로 로그인해 주세요.' };
    }
    const rawRoom = backupData?.room;
    if (!rawRoom || typeof rawRoom !== 'object') {
      return { ok: false, error: '올바른 나무 노트 공유 방 백업 파일이 아닙니다.' };
    }
    const cleanName = String(roomName || rawRoom.roomName || '').trim().slice(0, 60);
    const cleanPwd = String(password || '').trim();
    if (cleanName.length < 2) {
      return { ok: false, error: '방 이름은 2자 이상이어야 합니다.' };
    }
    if (cleanPwd.length < 2) {
      return { ok: false, error: '복원할 방의 입장 비밀번호(2자 이상)를 설정해 주세요.' };
    }

    const roomId = deriveRoomId(cleanName);
    const { authToken } = deriveRoomSecrets(cleanName, cleanPwd);
    const now = Date.now();
    const sections =
      Array.isArray(rawRoom.sections) && rawRoom.sections.length > 0
        ? rawRoom.sections
            .slice(0, 12)
            .map((s) => ({
              id: String(s.id || `sec-${Date.now()}`).slice(0, 40),
              title: String(s.title || '섹션').slice(0, 32),
              color: ['blue', 'amber', 'purple', 'emerald', 'zinc', 'rose'].includes(s.color)
                ? s.color
                : 'blue'
            }))
        : DEFAULT_SECTIONS;

    const folders =
      Array.isArray(rawRoom.folders) && rawRoom.folders.length > 0
        ? rawRoom.folders.slice(0, 20).map((f) => ({
            id: String(f.id || `fld-${Date.now()}`).slice(0, 40),
            name: String(f.name || '폴더').slice(0, 32),
            icon: String(f.icon || '📁').slice(0, 4)
          }))
        : DEFAULT_FOLDERS;

    const notes = Array.isArray(rawRoom.notes)
      ? rawRoom.notes.slice(0, MAX_SHARED_NOTES).map((n) => sanitizeSharedNote(n, account)).filter(Boolean)
      : [];
    const messages = Array.isArray(rawRoom.messages)
      ? rawRoom.messages
          .slice(-MAX_CHAT_MESSAGES)
          .map((m) => sanitizeChatMessage(m, account))
          .filter(Boolean)
      : [];

    const restoredRoom = {
      roomId,
      roomName: cleanName,
      authToken,
      hostProfile: account,
      permissionMode: ['all', 'host-delete', 'readonly'].includes(rawRoom.permissionMode)
        ? rawRoom.permissionMode
        : 'all',
      sections,
      folders,
      notes,
      messages,
      kickedUids: [],
      createdAt: typeof rawRoom.createdAt === 'number' ? rawRoom.createdAt : now,
      updatedAt: now
    };

    this.storeData.hostedRooms[roomId] = restoredRoom;
    this.recordRecentRoom({
      roomId,
      roomName: cleanName,
      isHost: true,
      hostCode: ''
    });
    this.rememberJoinedRoom({ room: restoredRoom, password: cleanPwd, role: 'host' });
    this.saveStore();
    return { ok: true, roomId, roomName: cleanName, state: this.getPublicState() };
  }

  async deleteSavedRoom(roomId) {
    const targetId = String(roomId || '').trim();
    if (!targetId) return { ok: false, error: '삭제할 방 ID가 없습니다.' };

    if (this.activeSession && this.activeSession.roomId === targetId) {
      await this.leaveCurrentRoom();
    }
    if (this.storeData.hostedRooms && this.storeData.hostedRooms[targetId]) {
      delete this.storeData.hostedRooms[targetId];
    }
    this.storeData.recentRooms = (this.storeData.recentRooms || []).filter(
      (r) => r.roomId !== targetId
    );
    const map = this.readAccountRememberedRooms();
    if (map[targetId]) {
      delete map[targetId];
      this.writeAccountRememberedRooms(map);
    }
    this.saveStore();
    return { ok: true, state: this.getPublicState() };
  }

  // ============================================================================
  // 1. TreeNote Account Authentication (회원가입 · 로그인 · 계정 관리)
  // ============================================================================
  checkLoginRateLimit() {
    const now = Date.now();
    if (this.failedLoginState.lockoutUntil > now) {
      const secs = Math.ceil((this.failedLoginState.lockoutUntil - now) / 1000);
      return {
        allowed: false,
        error: `비밀번호 입력 시도가 너무 많습니다. ${secs}초 후에 다시 시도해 주세요.`
      };
    }
    return { allowed: true };
  }

  recordLoginAttempt(success) {
    if (success) {
      this.failedLoginState = { count: 0, lockoutUntil: 0 };
      return;
    }
    this.failedLoginState.count += 1;
    if (this.failedLoginState.count >= MAX_LOGIN_ATTEMPTS) {
      this.failedLoginState.lockoutUntil = Date.now() + LOGIN_LOCKOUT_MS;
      this.failedLoginState.count = 0;
    }
  }

  verifyAccountPasswordHash(password, saltHex, expectedHashHex) {
    if (!password || !saltHex || !expectedHashHex) return false;
    try {
      const computed = crypto.scryptSync(String(password), saltHex, 64);
      const expected = Buffer.from(expectedHashHex, 'hex');
      if (computed.length === 0 || computed.length !== expected.length) return false;
      return crypto.timingSafeEqual(computed, expected);
    } catch (_e) {
      return false;
    }
  }

  registerAccount({ accountId, displayName, password, confirmPassword }) {
    const cleanId = normalizeAccountId(accountId);
    if (!ACCOUNT_ID_RE.test(cleanId)) {
      return {
        ok: false,
        error: '아이디는 영문 소문자, 숫자, 밑줄(_), 하이픈(-) 조합 3~24자로 입력해 주세요.'
      };
    }
    if (RESERVED_ACCOUNT_IDS.has(cleanId)) {
      return { ok: false, error: '사용할 수 없는 예약어 아이디입니다.' };
    }
    if (this.storeData.accounts[cleanId]) {
      return { ok: false, error: `'${cleanId}' 아이디는 이미 가입되어 있습니다. 로그인을 진행해 주세요.` };
    }

    const rawPwd = typeof password === 'string' ? password : '';
    const trimmedPwd = rawPwd.trim();
    if (trimmedPwd.length < PASSWORD_MIN_LEN || rawPwd.length > PASSWORD_MAX_LEN) {
      return {
        ok: false,
        error: `비밀번호는 공백 제외 ${PASSWORD_MIN_LEN}자 이상 ${PASSWORD_MAX_LEN}자 이하로 입력해 주세요.`
      };
    }
    if (typeof confirmPassword === 'string' && rawPwd !== confirmPassword) {
      return { ok: false, error: '비밀번호와 비밀번호 확인이 일치하지 않습니다.' };
    }

    const cleanName =
      typeof displayName === 'string' && displayName.trim()
        ? displayName.trim().slice(0, 20)
        : cleanId;

    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(rawPwd, passwordSalt, 64).toString('hex');

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const fingerprint = computePublicKeyFingerprint(publicKey);
    const uid = `acct:${cleanId}:${fingerprint}`;
    const avatarColor = pickAvatarColor(uid);
    const privateKeyEncrypted = encryptSecretWithPassword(privateKey, rawPwd);

    this.storeData.accounts[cleanId] = {
      accountId: cleanId,
      displayName: cleanName,
      uid,
      passwordSalt,
      passwordHash,
      publicKeyPem: publicKey,
      privateKeyEncrypted,
      avatarColor,
      createdAt: Date.now(),
      lastLoginAt: 0
    };
    this.storeData.lastAccountId = cleanId;
    this.saveStore();

    return {
      ok: true,
      accountId: cleanId,
      registeredAccounts: this.getRegisteredAccountList()
    };
  }

  loginAccount({ accountId, password }) {
    const rate = this.checkLoginRateLimit();
    if (!rate.allowed) {
      return { ok: false, error: rate.error };
    }

    const cleanId = normalizeAccountId(accountId);
    const rawPwd = typeof password === 'string' ? password : '';
    if (!cleanId || !rawPwd) {
      return { ok: false, error: '아이디와 비밀번호를 모두 입력해 주세요.' };
    }

    const storedAcc = this.storeData.accounts[cleanId];
    if (!storedAcc) {
      this.recordLoginAttempt(false);
      return { ok: false, error: '존재하지 않는 아이디이거나 비밀번호가 일치하지 않습니다.' };
    }

    const matched = this.verifyAccountPasswordHash(
      rawPwd,
      storedAcc.passwordSalt,
      storedAcc.passwordHash
    );
    if (!matched) {
      this.recordLoginAttempt(false);
      return { ok: false, error: '존재하지 않는 아이디이거나 비밀번호가 일치하지 않습니다.' };
    }

    let privateKeyPem = '';
    try {
      privateKeyPem = decryptSecretWithPassword(storedAcc.privateKeyEncrypted, rawPwd);
    } catch (_e) {
      return { ok: false, error: '계정 보안 키를 복호화할 수 없습니다.' };
    }

    this.recordLoginAttempt(true);
    storedAcc.lastLoginAt = Date.now();
    this.storeData.lastAccountId = cleanId;
    this.saveStore();

    const publicProfile = sanitizeAuthor({
      uid: storedAcc.uid,
      accountId: storedAcc.accountId,
      name: storedAcc.displayName,
      avatarColor: storedAcc.avatarColor
    });

    this.authenticatedSession = {
      account: publicProfile,
      publicKeyPem: storedAcc.publicKeyPem,
      privateKeyPem
    };

    return {
      ok: true,
      currentAccount: publicProfile,
      registeredAccounts: this.getRegisteredAccountList(),
      lastAccountId: cleanId,
      savedRooms: this.getSavedRoomsList(),
      joinedRooms: this.getJoinedRoomsList()
    };
  }

  async logoutAccount() {
    await this.leaveCurrentRoom();
    this.authenticatedSession = null;
    return {
      ok: true,
      registeredAccounts: this.getRegisteredAccountList(),
      lastAccountId: this.storeData.lastAccountId || ''
    };
  }

  updateAccount({ displayName, currentPassword, newPassword }) {
    if (!this.authenticatedSession) {
      return { ok: false, error: '먼저 로그인해 주세요.' };
    }
    const cleanId = this.authenticatedSession.account.accountId;
    const storedAcc = this.storeData.accounts[cleanId];
    if (!storedAcc) {
      return { ok: false, error: '계정 정보를 찾을 수 없습니다.' };
    }

    const nextDisplayName =
      typeof displayName === 'string' && displayName.trim()
        ? displayName.trim().slice(0, 20)
        : storedAcc.displayName;

    if (newPassword) {
      const rate = this.checkLoginRateLimit();
      if (!rate.allowed) return { ok: false, error: rate.error };

      const validCurrent = this.verifyAccountPasswordHash(
        currentPassword,
        storedAcc.passwordSalt,
        storedAcc.passwordHash
      );
      if (!validCurrent) {
        this.recordLoginAttempt(false);
        return { ok: false, error: '현재 비밀번호가 일치하지 않습니다.' };
      }
      this.recordLoginAttempt(true);

      const rawNewPwd = String(newPassword);
      if (rawNewPwd.trim().length < PASSWORD_MIN_LEN || rawNewPwd.length > PASSWORD_MAX_LEN) {
        return {
          ok: false,
          error: `새 비밀번호는 공백 제외 ${PASSWORD_MIN_LEN}자 이상 ${PASSWORD_MAX_LEN}자 이하로 입력해 주세요.`
        };
      }

      storedAcc.passwordSalt = crypto.randomBytes(16).toString('hex');
      storedAcc.passwordHash = crypto
        .scryptSync(rawNewPwd, storedAcc.passwordSalt, 64)
        .toString('hex');
      storedAcc.privateKeyEncrypted = encryptSecretWithPassword(
        this.authenticatedSession.privateKeyPem,
        rawNewPwd
      );
    }

    storedAcc.displayName = nextDisplayName;
    this.saveStore();

    this.authenticatedSession.account = {
      ...this.authenticatedSession.account,
      name: nextDisplayName
    };
    if (this.activeSession?.mode === 'host' && this.activeSession.room) {
      this.activeSession.room.hostProfile = this.authenticatedSession.account;
      this.broadcastRoomUpdate();
    }

    return {
      ok: true,
      currentAccount: this.authenticatedSession.account,
      registeredAccounts: this.getRegisteredAccountList()
    };
  }

  async deleteAccount({ currentPassword }) {
    if (!this.authenticatedSession) {
      return { ok: false, error: '먼저 로그인해 주세요.' };
    }
    const rate = this.checkLoginRateLimit();
    if (!rate.allowed) return { ok: false, error: rate.error };

    const cleanId = this.authenticatedSession.account.accountId;
    const storedAcc = this.storeData.accounts[cleanId];
    if (!storedAcc) {
      return { ok: false, error: '계정 정보를 찾을 수 없습니다.' };
    }
    const valid = this.verifyAccountPasswordHash(
      currentPassword,
      storedAcc.passwordSalt,
      storedAcc.passwordHash
    );
    if (!valid) {
      this.recordLoginAttempt(false);
      return { ok: false, error: '현재 비밀번호가 일치하지 않습니다.' };
    }
    this.recordLoginAttempt(true);

    await this.leaveCurrentRoom();
    delete this.storeData.accounts[cleanId];
    if (this.storeData.lastAccountId === cleanId) {
      const remaining = Object.keys(this.storeData.accounts);
      this.storeData.lastAccountId = remaining[0] || '';
    }
    this.authenticatedSession = null;
    this.saveStore();

    return {
      ok: true,
      registeredAccounts: this.getRegisteredAccountList(),
      lastAccountId: this.storeData.lastAccountId
    };
  }

  // ============================================================================
  // 2. Host a Shared Room (방 만들기 & 호스트 서버 가동)
  // ============================================================================
  async hostRoom({ roomName, password, permissionMode }) {
    const account = this.authenticatedSession?.account;
    if (!account) {
      return { ok: false, error: '공유 스페이스를 사용하려면 먼저 계정으로 로그인해 주세요.' };
    }

    const cleanName = String(roomName || '').trim().slice(0, 60);
    const cleanPwd = String(password || '').trim();
    if (cleanName.length < 2) {
      return { ok: false, error: '방 이름을 2자 이상 입력해 주세요.' };
    }
    if (cleanPwd.length < 2) {
      return { ok: false, error: '방 비밀번호를 2자 이상 입력해 주세요.' };
    }

    await this.leaveCurrentRoom();

    const roomId = deriveRoomId(cleanName);
    const { authToken, cipherKey } = deriveRoomSecrets(cleanName, cleanPwd);

    // Split-brain protection: check if another user is currently hosting this exact room live
    const liveHost = await this.probeLiveRoomHost({
      roomId,
      authToken,
      timeoutMs: 1100
    });
    if (liveHost.found && liveHost.hostUid && liveHost.hostUid !== account.uid) {
      return {
        ok: false,
        error: `이미 '${liveHost.hostName || '다른 사용자'}'님이 동일한 방 이름과 비밀번호로 방을 호스트하고 있습니다. '방 참가하기' 또는 초대 코드로 입장해 주세요.`
      };
    }

    const existingRoom = this.storeData.hostedRooms[roomId];

    let room;
    if (existingRoom) {
      // 기존 동명의 방을 다시 열 때는 항상 기존 비밀번호 일치 여부를 상수 시간으로 검증
      if (!safeTimingEqualHex(existingRoom.authToken, authToken)) {
        return {
          ok: false,
          error: '기존에 생성된 동명의 방 비밀번호가 일치하지 않습니다.'
        };
      }
      room = {
        ...existingRoom,
        roomId,
        roomName: cleanName,
        authToken,
        rev: Number(existingRoom.rev || 1),
        hostProfile: account,
        permissionMode: ['all', 'host-delete', 'readonly'].includes(permissionMode)
          ? permissionMode
          : existingRoom.permissionMode || 'all',
        sections:
          Array.isArray(existingRoom.sections) && existingRoom.sections.length > 0
            ? existingRoom.sections
            : DEFAULT_SECTIONS,
        folders:
          Array.isArray(existingRoom.folders) && existingRoom.folders.length > 0
            ? existingRoom.folders
            : DEFAULT_FOLDERS,
        notes: Array.isArray(existingRoom.notes) ? existingRoom.notes : [],
        messages: Array.isArray(existingRoom.messages) ? existingRoom.messages : [],
        kickedUids: Array.isArray(existingRoom.kickedUids) ? existingRoom.kickedUids : [],
        updatedAt: Date.now()
      };
    } else {
      const welcomeNote = sanitizeSharedNote(
        {
          id: crypto.randomUUID(),
          title: `👋 '${cleanName}' 공유 스페이스에 오신 것을 환영합니다!`,
          content:
            '<div><b>그룹 공유 노트 활용 팁:</b></div><div>1. 상단 <b>[섹션 보드 뷰]</b>에서 노트를 진행 상태별로 분류해 보세요.</div><div>2. 우측 <b>실시간 그룹 채팅</b>에서 대화하다가 중요한 메시지는 <b>[📌 노트로 박제]</b>를 눌러 즉시 노트로 만들 수 있습니다.</div><div>3. 여러 노트를 선택한 뒤 <b>[✨ 선택 노트 병합]</b>으로 깔끔하게 하나로 합칠 수 있습니다.</div>',
          category: '📌 공지',
          sectionId: 'notice',
          folderId: 'meeting',
          statusBadge: '중요',
          checklist: [
            { id: crypto.randomUUID(), text: '방 이름과 비밀번호로 팀원 초대하기', done: true },
            { id: crypto.randomUUID(), text: '첫 번째 공유 노트 또는 회의록 작성하기', done: false }
          ],
          tags: ['환영합니다', '공지'],
          pinned: true,
          author: account
        },
        account
      );

      room = {
        roomId,
        roomName: cleanName,
        authToken,
        rev: 1,
        hostProfile: account,
        permissionMode: ['all', 'host-delete', 'readonly'].includes(permissionMode)
          ? permissionMode
          : 'all',
        sections: DEFAULT_SECTIONS,
        folders: DEFAULT_FOLDERS,
        notes: [welcomeNote],
        messages: [
          {
            id: crypto.randomUUID(),
            text: `${account.name}님이 '${cleanName}' 방을 호스트했습니다.`,
            imageDataUrl: '',
            sharedNoteRef: null,
            author: account,
            createdAt: Date.now(),
            isSystem: true,
            pinnedToNoteId: ''
          }
        ],
        kickedUids: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }

    this.storeData.hostedRooms[roomId] = room;
    const serverInfo = await this.startHostNetworkServer(room, cipherKey);

    this.activeSession = {
      mode: 'host',
      transport: 'hybrid',
      roomId,
      roomName: cleanName,
      cipherKey,
      authToken,
      port: serverInfo.port,
      inviteCode: serverInfo.inviteCode,
      lastSavedAt: room.updatedAt || Date.now(),
      room
    };

    // Start End-to-End Encrypted Relay so guests on different networks/firewalls can join with Room Name + Password
    await this.startHostRelay(room, cipherKey);

    this.recordRecentRoom({
      roomId,
      roomName: cleanName,
      isHost: true,
      hostCode: serverInfo.inviteCode
    });
    this.rememberJoinedRoom({
      room,
      password: cleanPwd,
      role: 'host',
      hostCode: serverInfo.inviteCode
    });
    this.saveStore();

    return {
      ok: true,
      room: this.getActiveRoomSnapshot()
    };
  }

  recordRecentRoom({ roomId, roomName, isHost, hostCode }) {
    const filtered = (this.storeData.recentRooms || []).filter((r) => r.roomId !== roomId);
    filtered.unshift({
      roomId,
      roomName,
      isHost: Boolean(isHost),
      hostCode: hostCode || '',
      lastJoinedAt: Date.now()
    });
    this.storeData.recentRooms = filtered.slice(0, 15);
  }

  async startHostRelay(room, cipherKey) {
    if (this._hostHeartbeatTimer) {
      clearInterval(this._hostHeartbeatTimer);
      this._hostHeartbeatTimer = null;
    }
    if (this.hostRelayClient) {
      this.hostRelayClient.close();
      this.hostRelayClient = null;
    }
    const topic = deriveRelayTopic(room.roomId, room.authToken);

    const launchClient = () => {
      const client = new MqttWsRelayClient({
        topic,
        endpoints: this.relayEndpointsOverride,
        onConnected: () => {
          if (this.activeSession?.mode === 'host' && this.activeSession.roomId === room.roomId) {
            this.sendToRenderer('shared:room-updated', this.getActiveRoomSnapshot());
            client.publishJson({
              op: 'HOST_HEARTBEAT',
              rev: Number(room.rev || 0),
              hostUid: room.hostProfile?.uid || '',
              ts: Date.now()
            });
          }
        },
        onClose: () => {
          if (this.activeSession?.mode === 'host' && this.activeSession.roomId === room.roomId) {
            setTimeout(() => {
              if (
                this.activeSession?.mode === 'host' &&
                this.activeSession.roomId === room.roomId &&
                (!this.hostRelayClient || !this.hostRelayClient.connected)
              ) {
                this.startHostRelay(room, cipherKey).catch(() => {});
              }
            }, 3000);
          }
        },
        onMessage: (msg) => {
          this.handleHostRelayMessage(msg, room, cipherKey, client);
        }
      });
      this.hostRelayClient = client;
      return client;
    };

    const client = launchClient();
    this._hostHeartbeatTimer = setInterval(() => {
      if (
        this.activeSession?.mode === 'host' &&
        this.activeSession.roomId === room.roomId &&
        this.hostRelayClient &&
        this.hostRelayClient.connected
      ) {
        this.hostRelayClient.publishJson({
          op: 'HOST_HEARTBEAT',
          rev: Number(room.rev || 0),
          hostUid: room.hostProfile?.uid || '',
          ts: Date.now()
        });
      }
    }, 12000);

    try {
      await Promise.race([
        client.connect(4500),
        new Promise((resolve) => setTimeout(resolve, 2500))
      ]);
    } catch (_e) {
      // Offline / broker unreachable; LAN hosting continues normally
    }
  }

  handleHostRelayMessage(msg, room, cipherKey, relayClient) {
    if (!msg || typeof msg !== 'object') return;
    if (!this.activeSession || this.activeSession.mode !== 'host' || this.activeSession.roomId !== room.roomId) {
      return;
    }

    const remoteKey = `relay:${String(msg.s || 'anon').slice(0, 32)}`;

    if (msg.op === 'PING') {
      relayClient.publishJson({
        op: 'PONG',
        reqId: msg.reqId,
        roomId: room.roomId,
        roomName: room.roomName,
        hostUid: room.hostProfile?.uid || '',
        hostName: room.hostProfile?.name || '',
        rev: Number(room.rev || 0)
      });
      return;
    }

    if (msg.op === 'SYNC_STATE') {
      if (!safeTimingEqualHex(msg.authToken || '', room.authToken)) return;
      const verified = this.verifiedSessions.get(String(msg.sessionToken || ''));
      if (!verified || !verified.profile) return;
      if ((room.kickedUids || []).includes(verified.profile.uid)) return;
      const snapshot = this.getActiveRoomSnapshot();
      const envelope = encryptPayload(
        {
          type: 'ROOM_STATE',
          room: {
            roomId: room.roomId,
            roomName: room.roomName,
            rev: Number(room.rev || 0),
            hostProfile: room.hostProfile,
            permissionMode: room.permissionMode,
            sections: room.sections,
            folders: room.folders,
            notes: room.notes,
            messages: room.messages,
            members: snapshot.members
          }
        },
        cipherKey
      );
      relayClient.publishJson({
        op: 'ROOM_STATE',
        reqId: msg.reqId || undefined,
        envelope
      });
      return;
    }

    if (msg.op === 'CHALLENGE') {
      const nonce = this.issueJoinNonce();
      relayClient.publishJson({
        op: 'CHALLENGE_RES',
        reqId: msg.reqId,
        ok: true,
        nonce,
        roomId: room.roomId
      });
      return;
    }

    if (msg.op === 'JOIN') {
      const result = this.processGuestJoinRequest({
        room,
        cipherKey,
        remoteKey,
        body: msg,
        viaRelayClientId: String(msg.s || '')
      });
      relayClient.publishJson({
        op: 'JOIN_RES',
        reqId: msg.reqId,
        ...result
      });
      if (result.ok) {
        this.broadcastRoomUpdate();
      }
      return;
    }

    if (msg.op === 'ACTION') {
      const rate = this.checkJoinRateLimit(remoteKey);
      if (!rate.allowed) {
        relayClient.publishJson({
          op: 'ACTION_RES',
          reqId: msg.reqId,
          res: { ok: false, error: rate.error }
        });
        return;
      }
      if (!safeTimingEqualHex(msg.authToken || '', room.authToken)) {
        this.recordJoinAttempt(remoteKey, false);
        relayClient.publishJson({
          op: 'ACTION_RES',
          reqId: msg.reqId,
          res: { ok: false, error: '인증 실패' }
        });
        return;
      }
      const verified = this.verifiedSessions.get(String(msg.sessionToken || ''));
      if (!verified || !verified.profile) {
        this.recordJoinAttempt(remoteKey, false);
        relayClient.publishJson({
          op: 'ACTION_RES',
          reqId: msg.reqId,
          res: { ok: false, error: '유효하지 않거나 만료된 멤버 세션입니다.' }
        });
        return;
      }
      const actor = verified.profile;
      try {
        const actionPayload = decryptPayload(msg.envelope, cipherKey);
        this.recordJoinAttempt(remoteKey, true);
        if ((room.kickedUids || []).includes(actor.uid)) {
          this.verifiedSessions.delete(String(msg.sessionToken || ''));
          relayClient.publishJson({
            op: 'ACTION_RES',
            reqId: msg.reqId,
            res: { ok: false, error: '강퇴된 사용자입니다.' }
          });
          return;
        }
        const existingRelay = this.relayClients.get(actor.uid);
        if (existingRelay) existingRelay.lastSeen = Date.now();
        const res = this.applyRoomActionInternal(room, actionPayload.action, actor, false, {
          deferBroadcast: true
        });
        relayClient.publishJson({
          op: 'ACTION_RES',
          reqId: msg.reqId,
          res
        });
        if (res.ok) {
          setImmediate(() => {
            if (this.activeSession?.mode === 'host' && this.activeSession.roomId === room.roomId) {
              this.broadcastRoomUpdate();
            }
          });
        }
      } catch (err) {
        this.recordJoinAttempt(remoteKey, false);
        relayClient.publishJson({
          op: 'ACTION_RES',
          reqId: msg.reqId,
          res: { ok: false, error: err.message }
        });
      }
      return;
    }

    if (msg.op === 'LEAVE') {
      const sessionToken = String(msg.sessionToken || '');
      const verified = this.verifiedSessions.get(sessionToken);
      if (verified && verified.profile) {
        this.verifiedSessions.delete(sessionToken);
        this.relayClients.delete(verified.profile.uid);
        this.broadcastRoomUpdate();
      }
    }
  }

  async startHostNetworkServer(room, cipherKey) {
    this.sseClients.clear();
    this.relayClients.clear();
    this.verifiedSessions.clear();
    this.joinNonces.clear();

    const server = http.createServer((req, res) => {
      this.handleHostHttpRequest(req, res, room, cipherKey);
    });

    const port = await new Promise((resolve) => {
      let idx = 0;
      const tryListen = () => {
        const candidate =
          idx < LOCAL_PORT_CANDIDATES.length ? LOCAL_PORT_CANDIDATES[idx++] : 0;
        server.once('error', () => {
          tryListen();
        });
        server.listen(candidate, '0.0.0.0', () => {
          resolve(server.address().port);
        });
      };
      tryListen();
    });

    this.httpServer = server;
    const lanInterfaces = getAllLanInterfaces();
    const endpointList = lanInterfaces.map((iface) => ({ host: iface.address, port }));
    if (endpointList.length === 0) endpointList.push({ host: '127.0.0.1', port });
    const inviteCode = encodeInviteCode(endpointList);

    // Start UDP LAN Auto-Discovery responder so guests on the same LAN only need Room Name + Password
    try {
      const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      udp.on('message', (msg, rinfo) => {
        try {
          const parsed = JSON.parse(msg.toString('utf8'));
          if (parsed?.type === 'TREENOTE_DISCOVER' && parsed.roomId === room.roomId) {
            const reply = Buffer.from(
              JSON.stringify({
                type: 'TREENOTE_ROOM_HERE',
                roomId: room.roomId,
                roomName: room.roomName,
                port
              }),
              'utf8'
            );
            udp.send(reply, rinfo.port, rinfo.address);
          }
        } catch (_e) {
          // ignore malformed UDP packet
        }
      });
      udp.on('error', () => {});
      udp.bind(DISCOVERY_PORT);
      this.udpSocket = udp;
    } catch (_e) {
      // ignore if UDP port unavailable
    }

    return { port, inviteCode };
  }

  readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let total = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_HTTP_BODY_BYTES) {
          reject(new Error('Payload too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? JSON.parse(raw) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }

  checkJoinRateLimit(remoteIp) {
    const now = Date.now();
    const entry = this.failedJoinMap.get(remoteIp);
    if (entry && entry.lockoutUntil > now) {
      const waitSec = Math.ceil((entry.lockoutUntil - now) / 1000);
      return {
        allowed: false,
        error: `비밀번호 오류가 누적되어 ${waitSec}초 동안 입장이 제한됩니다.`
      };
    }
    return { allowed: true };
  }

  recordJoinAttempt(remoteIp, success) {
    if (success) {
      this.failedJoinMap.delete(remoteIp);
      return;
    }
    const entry = this.failedJoinMap.get(remoteIp) || { count: 0, lockoutUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_JOIN_ATTEMPTS) {
      entry.lockoutUntil = Date.now() + JOIN_LOCKOUT_MS;
      entry.count = 0;
    }
    this.failedJoinMap.set(remoteIp, entry);
  }

  issueJoinNonce() {
    const now = Date.now();
    for (const [k, v] of this.joinNonces.entries()) {
      if (v.expiresAt <= now) this.joinNonces.delete(k);
    }
    if (this.joinNonces.size >= 100) {
      const oldestKey = this.joinNonces.keys().next().value;
      if (oldestKey) this.joinNonces.delete(oldestKey);
    }
    const nonce = crypto.randomBytes(32).toString('hex');
    this.joinNonces.set(nonce, { expiresAt: now + 60 * 1000 });
    return nonce;
  }

  processGuestJoinRequest({ room, cipherKey, remoteKey, body, viaRelayClientId = '' }) {
    const rate = this.checkJoinRateLimit(remoteKey);
    if (!rate.allowed) {
      return { status: 429, ok: false, error: rate.error };
    }

    try {
      if (!body || body.roomId !== room.roomId || !safeTimingEqualHex(body.authToken, room.authToken)) {
        this.recordJoinAttempt(remoteKey, false);
        return {
          status: 403,
          ok: false,
          error: '방 이름 또는 비밀번호가 일치하지 않습니다.'
        };
      }

      const decrypted = decryptPayload(body.envelope, cipherKey);
      const guestProfile = sanitizeAuthor(decrypted.profile);
      const publicKeyPem = typeof decrypted.publicKeyPem === 'string' ? decrypted.publicKeyPem : '';
      const nonce = typeof decrypted.nonce === 'string' ? decrypted.nonce : '';
      const signature = typeof decrypted.signature === 'string' ? decrypted.signature : '';

      const nonceEntry = this.joinNonces.get(nonce);
      this.joinNonces.delete(nonce);
      if (!nonceEntry || nonceEntry.expiresAt <= Date.now()) {
        this.recordJoinAttempt(remoteKey, false);
        return {
          status: 403,
          ok: false,
          error: '인증 챌린지가 만료되었거나 유효하지 않습니다.'
        };
      }

      let signatureVerified = false;
      try {
        const expectedFp = computePublicKeyFingerprint(publicKeyPem);
        const expectedUid = `acct:${guestProfile.accountId}:${expectedFp}`;
        if (
          guestProfile.accountId &&
          guestProfile.uid === expectedUid &&
          signature &&
          publicKeyPem
        ) {
          const signMsg = Buffer.from(
            `${room.roomId}:${room.authToken}:${nonce}:${guestProfile.uid}`,
            'utf8'
          );
          signatureVerified = crypto.verify(
            null,
            signMsg,
            publicKeyPem,
            Buffer.from(signature, 'base64')
          );
        }
      } catch (_sigErr) {
        signatureVerified = false;
      }

      if (!signatureVerified) {
        this.recordJoinAttempt(remoteKey, false);
        return {
          status: 403,
          ok: false,
          error: '계정 전자서명 검증에 실패했습니다.'
        };
      }

      if ((room.kickedUids || []).includes(guestProfile.uid)) {
        return {
          status: 403,
          ok: false,
          error: '호스트에 의해 입장이 제한된 계정입니다.'
        };
      }

      this.recordJoinAttempt(remoteKey, true);

      const memberSessionToken = crypto.randomBytes(32).toString('hex');
      this.verifiedSessions.set(memberSessionToken, {
        profile: guestProfile,
        issuedAt: Date.now()
      });

      if (viaRelayClientId) {
        this.relayClients.set(guestProfile.uid, {
          clientId: viaRelayClientId,
          profile: guestProfile,
          lastSeen: Date.now()
        });
      }

      const joinSysMsg = {
        id: crypto.randomUUID(),
        text: `${guestProfile.name} (@${guestProfile.accountId})님이 방에 입장했습니다.`,
        imageDataUrl: '',
        sharedNoteRef: null,
        author: guestProfile,
        createdAt: Date.now(),
        isSystem: true,
        pinnedToNoteId: ''
      };
      room.messages = [...(room.messages || []), joinSysMsg].slice(-MAX_CHAT_MESSAGES);
      this.persistHostedRoom(room);

      const responseEnvelope = encryptPayload(
        {
          memberSessionToken,
          room: {
            roomId: room.roomId,
            roomName: room.roomName,
            rev: Number(room.rev || 0),
            hostProfile: room.hostProfile,
            permissionMode: room.permissionMode,
            sections: room.sections,
            folders: room.folders,
            notes: room.notes,
            messages: room.messages,
            members: this.getActiveMembersList()
          }
        },
        cipherKey
      );

      return { status: 200, ok: true, envelope: responseEnvelope };
    } catch (_err) {
      this.recordJoinAttempt(remoteKey, false);
      return {
        status: 400,
        ok: false,
        error: '암호화 검증에 실패했습니다.'
      };
    }
  }

  async handleHostHttpRequest(req, res, room, cipherKey) {
    const remoteIp = req.socket.remoteAddress || 'unknown';
    const reqUrl = new URL(req.url, 'http://127.0.0.1');

    // Quick room probe endpoint for localhost / LAN discovery
    if (req.method === 'GET' && reqUrl.pathname === '/api/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          roomId: room.roomId,
          roomName: room.roomName,
          hostUid: room.hostProfile?.uid || '',
          hostName: room.hostProfile?.name || '',
          rev: Number(room.rev || 0)
        })
      );
      return;
    }

    // 0) GET /api/challenge (Single-use nonce for Ed25519 identity verification)
    if (req.method === 'GET' && reqUrl.pathname === '/api/challenge') {
      const nonce = this.issueJoinNonce();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, nonce, roomId: room.roomId }));
      return;
    }

    // 1) POST /api/join
    if (req.method === 'POST' && reqUrl.pathname === '/api/join') {
      try {
        const body = await this.readJsonBody(req);
        const result = this.processGuestJoinRequest({
          room,
          cipherKey,
          remoteKey: remoteIp,
          body
        });
        res.writeHead(result.status || (result.ok ? 200 : 400), { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            result.ok ? { ok: true, envelope: result.envelope } : { ok: false, error: result.error }
          )
        );
        if (result.ok) {
          this.broadcastRoomUpdate();
        }
      } catch (_err) {
        this.recordJoinAttempt(remoteIp, false);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '암호화 검증에 실패했습니다.' }));
      }
      return;
    }

    // 2) GET /api/events (SSE Real-Time Encrypted Stream)
    if (req.method === 'GET' && reqUrl.pathname === '/api/events') {
      const rate = this.checkJoinRateLimit(remoteIp);
      if (!rate.allowed) {
        res.writeHead(429);
        res.end();
        return;
      }

      const authHeader = req.headers['x-treenote-auth'] || '';
      if (!safeTimingEqualHex(authHeader, room.authToken)) {
        this.recordJoinAttempt(remoteIp, false);
        res.writeHead(403);
        res.end();
        return;
      }

      const sessionToken = String(req.headers['x-treenote-session'] || '');
      const verified = this.verifiedSessions.get(sessionToken);
      if (!verified || !verified.profile) {
        this.recordJoinAttempt(remoteIp, false);
        res.writeHead(403);
        res.end();
        return;
      }
      const guestProfile = verified.profile;

      if ((room.kickedUids || []).includes(guestProfile.uid)) {
        this.verifiedSessions.delete(sessionToken);
        res.writeHead(403);
        res.end();
        return;
      }

      if (!this.sseClients.has(guestProfile.uid) && this.sseClients.size >= MAX_SSE_CLIENTS) {
        res.writeHead(503);
        res.end();
        return;
      }

      this.recordJoinAttempt(remoteIp, true);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });

      this.sseClients.set(guestProfile.uid, {
        res,
        profile: guestProfile,
        lastSeen: Date.now()
      });

      this.broadcastRoomUpdate();

      req.on('close', () => {
        this.sseClients.delete(guestProfile.uid);
        this.broadcastRoomUpdate();
      });
      return;
    }

    // 3) POST /api/action (Guest performs note/chat/folder/section action)
    if (req.method === 'POST' && reqUrl.pathname === '/api/action') {
      const rate = this.checkJoinRateLimit(remoteIp);
      if (!rate.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: rate.error }));
        return;
      }

      const authHeader = req.headers['x-treenote-auth'] || '';
      if (!safeTimingEqualHex(authHeader, room.authToken)) {
        this.recordJoinAttempt(remoteIp, false);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '인증 실패' }));
        return;
      }

      const sessionToken = String(req.headers['x-treenote-session'] || '');
      const verified = this.verifiedSessions.get(sessionToken);
      if (!verified || !verified.profile) {
        this.recordJoinAttempt(remoteIp, false);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '유효하지 않거나 만료된 멤버 세션입니다.' }));
        return;
      }
      const actor = verified.profile;

      try {
        const body = await this.readJsonBody(req);
        const actionPayload = decryptPayload(body.envelope, cipherKey);
        this.recordJoinAttempt(remoteIp, true);

        if ((room.kickedUids || []).includes(actor.uid)) {
          this.verifiedSessions.delete(sessionToken);
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: '강퇴된 사용자입니다.' }));
          return;
        }

        const result = this.applyRoomActionInternal(room, actionPayload.action, actor, false);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        this.recordJoinAttempt(remoteIp, false);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  }

  broadcastRoomUpdate() {
    if (!this.activeSession || this.activeSession.mode !== 'host') return;
    const room = this.activeSession.room;
    const cipherKey = this.activeSession.cipherKey;
    const snapshot = this.getActiveRoomSnapshot();

    // Update host's own UI immediately
    this.sendToRenderer('shared:room-updated', snapshot);

    // Broadcast encrypted state to all connected guests (LAN SSE + Online Relay)
    const envelope = encryptPayload(
      {
        type: 'ROOM_STATE',
        room: {
          roomId: room.roomId,
          roomName: room.roomName,
          rev: Number(room.rev || 0),
          hostProfile: room.hostProfile,
          permissionMode: room.permissionMode,
          sections: room.sections,
          folders: room.folders,
          notes: room.notes,
          messages: room.messages,
          members: snapshot.members
        }
      },
      cipherKey
    );
    const sseLine = `data: ${JSON.stringify(envelope)}\n\n`;
    for (const [, client] of this.sseClients.entries()) {
      try {
        client.res.write(sseLine);
      } catch (_e) {
        // ignore disconnected socket
      }
    }
    if (this.hostRelayClient && this.hostRelayClient.connected) {
      this.hostRelayClient.publishJson({ op: 'ROOM_STATE', envelope });
    }
  }

  persistHostedRoom(room) {
    if (!room || !room.roomId) return;
    this.storeData.hostedRooms[room.roomId] = room;
    if (this.activeSession && this.activeSession.roomId === room.roomId) {
      this.activeSession.lastSavedAt = Date.now();
    }
    this.saveStore();
  }

  // ============================================================================
  // 3. Join an Existing Shared Room (방 이름 + 비밀번호로 참가하기)
  // ============================================================================
  async probeLiveRoomHost({ roomId, authToken, hostCode = '', timeoutMs = 1100 }) {
    try {
      const endpoint = await this.locateActiveRoomHost(roomId, hostCode);
      if (endpoint) {
        const pingRes = await this.httpGetJson(
          `http://${endpoint.host}:${endpoint.port}/api/ping`,
          700
        );
        if (pingRes && pingRes.ok && pingRes.roomId === roomId) {
          return {
            found: true,
            transport: 'lan',
            endpoint,
            hostUid: String(pingRes.hostUid || ''),
            hostName: String(pingRes.hostName || '')
          };
        }
      }
    } catch (_e) {
      // ignore LAN probe failure
    }

    if (!authToken) return { found: false };
    const topic = deriveRelayTopic(roomId, authToken);
    const endpoints = this.relayEndpointsOverride || RELAY_ENDPOINTS;

    const probes = endpoints.map(async (endpointUrl) => {
      const probeClient = new MqttWsRelayClient({
        topic,
        endpoints: [endpointUrl],
        onMessage: (msg) => {
          if (msg && msg.reqId && this.pendingRelayReplies.has(msg.reqId)) {
            const waiter = this.pendingRelayReplies.get(msg.reqId);
            if (!waiter.expectedOp || waiter.expectedOp === msg.op) {
              waiter.resolve(msg);
            }
          }
        }
      });
      try {
        await probeClient.connectSingleEndpoint(endpointUrl, Math.min(timeoutMs + 300, 1400));
        const pong = await this.sendRelayRequest(
          probeClient,
          { op: 'PING', roomId },
          'PONG',
          Math.min(timeoutMs, 1100)
        );
        if (pong && pong.roomId === roomId) {
          return {
            found: true,
            transport: 'relay',
            endpointUrl,
            hostUid: String(pong.hostUid || ''),
            hostName: String(pong.hostName || '')
          };
        }
        throw new Error('No room match');
      } finally {
        probeClient.close();
      }
    });

    try {
      return await Promise.any(probes);
    } catch (_e) {
      return { found: false };
    }
  }

  async joinRoomByInviteCode({ inviteCode, forceRelay = false }) {
    const authSess = this.authenticatedSession;
    const account = authSess?.account;
    if (!account || !authSess?.privateKeyPem || !authSess?.publicKeyPem) {
      return { ok: false, error: '공유 스페이스를 사용하려면 먼저 계정으로 로그인해 주세요.' };
    }

    const decoded = decodeFullInviteToken(inviteCode);
    if (!decoded) {
      return {
        ok: false,
        error:
          '유효한 초대 코드(TN1-...)가 아닙니다. 호스트에게 [초대 코드 복사] 버튼으로 받은 전체 코드를 입력해 주세요.'
      };
    }

    const roomId = deriveRoomId(decoded.roomName);
    return await this.joinRoomWithSecrets({
      roomName: decoded.roomName,
      password: '',
      roomId,
      authToken: decoded.authToken,
      cipherKey: decoded.cipherKey,
      hostCode: decoded.hostCode || '',
      forceRelay
    });
  }

  async joinRoom({ roomName, password, hostCode, forceRelay = false }) {
    const authSess = this.authenticatedSession;
    const account = authSess?.account;
    if (!account || !authSess?.privateKeyPem || !authSess?.publicKeyPem) {
      return { ok: false, error: '공유 스페이스를 사용하려면 먼저 계정으로 로그인해 주세요.' };
    }

    // Also allow TN1-... token if pasted into invite code or room field
    const tokenFromInput = decodeFullInviteToken(hostCode) || decodeFullInviteToken(roomName);
    if (tokenFromInput) {
      const roomId = deriveRoomId(tokenFromInput.roomName);
      return await this.joinRoomWithSecrets({
        roomName: tokenFromInput.roomName,
        password: String(password || '').trim(),
        roomId,
        authToken: tokenFromInput.authToken,
        cipherKey: tokenFromInput.cipherKey,
        hostCode: tokenFromInput.hostCode || '',
        forceRelay
      });
    }

    const cleanName = String(roomName || '').trim().slice(0, 60);
    const cleanPwd = String(password || '').trim();
    if (cleanName.length < 2 || cleanPwd.length < 2) {
      return { ok: false, error: '방 이름과 비밀번호를 정확히 입력해 주세요.' };
    }

    const roomId = deriveRoomId(cleanName);
    const { authToken, cipherKey } = deriveRoomSecrets(cleanName, cleanPwd);
    return await this.joinRoomWithSecrets({
      roomName: cleanName,
      password: cleanPwd,
      roomId,
      authToken,
      cipherKey,
      hostCode: hostCode || '',
      forceRelay
    });
  }

  async joinRoomWithSecrets({
    roomName,
    password = '',
    roomId,
    authToken,
    cipherKey,
    hostCode = '',
    forceRelay = false
  }) {
    const authSess = this.authenticatedSession;
    const account = authSess?.account;
    if (!account || !authSess?.privateKeyPem || !authSess?.publicKeyPem) {
      return { ok: false, error: '공유 스페이스를 사용하려면 먼저 계정으로 로그인해 주세요.' };
    }

    const cleanName = String(roomName || '').trim().slice(0, 60);
    const cleanPwd = String(password || '').trim();
    const cipherKeyHex = Buffer.from(cipherKey).toString('hex');

    await this.leaveCurrentRoom();

    // 1) Try LAN / Direct Invite Code / Localhost discovery first (skipped if forceRelay)
    const endpoint = forceRelay ? null : await this.locateActiveRoomHost(roomId, hostCode);

    if (endpoint) {
      try {
        const challengeRes = await this.httpGetJson(
          `http://${endpoint.host}:${endpoint.port}/api/challenge`
        );
        if (!challengeRes?.ok || !challengeRes.nonce) {
          return { ok: false, error: '호스트 인증 챌린지를 받아오지 못했습니다.' };
        }

        const signMsg = Buffer.from(
          `${roomId}:${authToken}:${challengeRes.nonce}:${account.uid}`,
          'utf8'
        );
        const signature = crypto
          .sign(null, signMsg, authSess.privateKeyPem)
          .toString('base64');

        const joinEnvelope = encryptPayload(
          {
            profile: account,
            publicKeyPem: authSess.publicKeyPem,
            nonce: challengeRes.nonce,
            signature
          },
          cipherKey
        );
        const joinRes = await this.httpPostJson(
          `http://${endpoint.host}:${endpoint.port}/api/join`,
          {
            roomId,
            authToken,
            envelope: joinEnvelope
          }
        );

        if (!joinRes || !joinRes.ok) {
          return {
            ok: false,
            error: joinRes?.error || '방 이름 또는 비밀번호가 일치하지 않습니다.'
          };
        }

        const decrypted = decryptPayload(joinRes.envelope, cipherKey);
        const roomData = decrypted.room;
        const memberSessionToken = decrypted.memberSessionToken;

        const inviteCode = encodeInviteCode(endpoint.host, endpoint.port);
        this.activeSession = {
          mode: 'guest',
          transport: 'lan',
          roomId,
          roomName: roomData.roomName,
          cipherKey,
          authToken,
          memberSessionToken,
          hostEndpoint: endpoint,
          inviteCode,
          lastSavedAt: Date.now(),
          room: roomData
        };

        this.recordRecentRoom({
          roomId,
          roomName: roomData.roomName,
          isHost: false,
          hostCode: inviteCode
        });
        this.rememberJoinedRoom({
          room: roomData,
          password: cleanPwd,
          authToken,
          cipherKeyHex,
          role: 'guest',
          hostCode: inviteCode
        });
        this.saveStore();

        this.connectGuestEventStream(endpoint, authToken, cipherKey, memberSessionToken);

        return {
          ok: true,
          room: this.getActiveRoomSnapshot()
        };
      } catch (_err) {
        // LAN HTTP handshake failed unexpectedly; fall through cleanly to E2EE Relay
      }
    }

    // 2) Fallback / Cross-network discovery via End-to-End Encrypted Relay
    const relayResult = await this.joinRoomViaRelay({
      roomId,
      roomName: cleanName,
      password: cleanPwd,
      hostCode,
      authToken,
      cipherKey,
      authSess
    });
    if (relayResult.ok || relayResult.definiteAuthError) {
      return relayResult.ok ? { ok: true, room: relayResult.room } : { ok: false, error: relayResult.error };
    }

    // NOTE: Strictly NEVER promote a guest join attempt into a conflicting Host!
    return {
      ok: false,
      error:
        '현재 열려 있는 해당 이름의 방을 찾을 수 없습니다. 호스트가 방을 열고 온라인 상태인지 확인하거나 초대 코드가 최신인지 확인해 주세요.'
    };
  }

  sendRelayRequest(relayClient, opPayload, expectedOp, timeoutMs = 4000) {
    const reqId = crypto.randomBytes(8).toString('hex');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRelayReplies.delete(reqId);
        reject(new Error('요청 응답 시간이 초과되었습니다.'));
      }, timeoutMs);
      this.pendingRelayReplies.set(reqId, {
        expectedOp,
        resolve: (msg) => {
          clearTimeout(timer);
          this.pendingRelayReplies.delete(reqId);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.pendingRelayReplies.delete(reqId);
          reject(err);
        },
        timer
      });
      const ok = relayClient.publishJson({ ...opPayload, reqId });
      if (!ok) {
        clearTimeout(timer);
        this.pendingRelayReplies.delete(reqId);
        reject(new Error('온라인 중계 서버에 연결되어 있지 않습니다.'));
      }
    });
  }

  requestGuestRelaySync() {
    if (
      !this.activeSession ||
      this.activeSession.mode !== 'guest' ||
      this.activeSession.transport !== 'relay' ||
      !this.guestRelayClient ||
      !this.guestRelayClient.connected ||
      !this.activeSession.memberSessionToken
    ) {
      return;
    }
    const now = Date.now();
    if (this._lastSyncPullAt && now - this._lastSyncPullAt < 350) return;
    this._lastSyncPullAt = now;
    try {
      this.guestRelayClient.publishJson({
        op: 'SYNC_STATE',
        authToken: this.activeSession.authToken,
        sessionToken: this.activeSession.memberSessionToken
      });
    } catch (_e) {
      // ignore
    }
  }

  _createGuestRelayClient({ topic, roomId, cipherKey, account }) {
    return new MqttWsRelayClient({
      topic,
      endpoints: this.relayEndpointsOverride,
      onConnected: () => {
        if (this.activeSession?.mode === 'guest' && this.activeSession.roomId === roomId) {
          this.sendToRenderer('shared:room-updated', this.getActiveRoomSnapshot());
          this.requestGuestRelaySync();
        }
      },
      onMessage: (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.reqId && this.pendingRelayReplies.has(msg.reqId)) {
          const waiter = this.pendingRelayReplies.get(msg.reqId);
          if (!waiter.expectedOp || waiter.expectedOp === msg.op) {
            waiter.resolve(msg);
            return;
          }
        }
        if (
          msg.op === 'ROOM_STATE' &&
          this.activeSession?.mode === 'guest' &&
          this.activeSession?.roomId === roomId
        ) {
          try {
            const payload = decryptPayload(msg.envelope, cipherKey);
            if (payload.type === 'ROOM_STATE' && payload.room) {
              const currRev = Number(this.activeSession.room?.rev || 0);
              const nextRev = Number(payload.room.rev || 0);
              if (nextRev === 0 || nextRev >= currRev) {
                this.activeSession.room = payload.room;
                this.sendToRenderer('shared:room-updated', this.getActiveRoomSnapshot());
              }
            }
          } catch (_e) {
            // ignore corrupted relay state frame
          }
        } else if (
          msg.op === 'HOST_HEARTBEAT' &&
          this.activeSession?.mode === 'guest' &&
          this.activeSession?.roomId === roomId
        ) {
          const currRev = Number(this.activeSession.room?.rev || 0);
          const hostRev = Number(msg.rev || 0);
          if (hostRev > currRev) {
            this.requestGuestRelaySync();
          }
        } else if (
          msg.op === 'KICKED' &&
          this.activeSession?.mode === 'guest' &&
          this.activeSession?.roomId === roomId
        ) {
          try {
            const payload = decryptPayload(msg.envelope, cipherKey);
            if (!payload.targetUid || payload.targetUid === account.uid) {
              this.leaveCurrentRoom();
              this.sendToRenderer('shared:room-disconnected', { reason: '호스트에 의해 방에서 내보내졌습니다.' });
            }
          } catch (_e) {
            // ignore
          }
        } else if (
          msg.op === 'HOST_CLOSED' &&
          this.activeSession?.mode === 'guest' &&
          this.activeSession?.roomId === roomId
        ) {
          this.leaveCurrentRoom();
          this.sendToRenderer('shared:room-disconnected', { reason: '호스트가 공유 방을 종료했습니다.' });
        }
      },
      onClose: () => {
        if (
          this.activeSession?.mode === 'guest' &&
          this.activeSession?.transport === 'relay' &&
          this.activeSession?.roomId === roomId
        ) {
          this.sendToRenderer('shared:room-updated', this.getActiveRoomSnapshot());
          if (!this._guestRelayReconnectTimer) {
            this._guestRelayReconnectTimer = setTimeout(() => {
              this._guestRelayReconnectTimer = null;
              this.ensureGuestRelayConnected(false).catch(() => {});
            }, 1500);
          }
        }
      }
    });
  }

  async _connectAndHandshakeGuestRelay({
    roomId,
    authToken,
    cipherKey,
    authSess,
    preferredEndpoint = ''
  }) {
    const account = authSess.account;
    const topic = deriveRelayTopic(roomId, authToken);
    const baseEndpoints = this.relayEndpointsOverride || RELAY_ENDPOINTS;
    const orderedEndpoints = preferredEndpoint && baseEndpoints.includes(preferredEndpoint)
      ? [preferredEndpoint, ...baseEndpoints.filter((u) => u !== preferredEndpoint)]
      : [...baseEndpoints];

    let lastErr = null;
    for (const endpointUrl of orderedEndpoints) {
      const relayClient = this._createGuestRelayClient({ topic, roomId, cipherKey, account });
      try {
        await relayClient.connectSingleEndpoint(endpointUrl, 2800);
      } catch (err) {
        relayClient.close();
        lastErr = err;
        continue;
      }

      try {
        let challengeRes = null;
        try {
          challengeRes = await this.sendRelayRequest(
            relayClient,
            { op: 'CHALLENGE', roomId },
            'CHALLENGE_RES',
            2200
          );
        } catch (_firstTryErr) {
          challengeRes = await this.sendRelayRequest(
            relayClient,
            { op: 'CHALLENGE', roomId },
            'CHALLENGE_RES',
            2200
          );
        }

        if (!challengeRes?.ok || !challengeRes.nonce) {
          relayClient.close();
          lastErr = new Error('인증 챌린지를 받아오지 못했습니다.');
          continue;
        }

        const signMsg = Buffer.from(
          `${roomId}:${authToken}:${challengeRes.nonce}:${account.uid}`,
          'utf8'
        );
        const signature = crypto
          .sign(null, signMsg, authSess.privateKeyPem)
          .toString('base64');

        const joinEnvelope = encryptPayload(
          {
            profile: account,
            publicKeyPem: authSess.publicKeyPem,
            nonce: challengeRes.nonce,
            signature
          },
          cipherKey
        );

        const joinRes = await this.sendRelayRequest(
          relayClient,
          { op: 'JOIN', roomId, authToken, envelope: joinEnvelope },
          'JOIN_RES',
          6000
        );

        if (!joinRes || !joinRes.ok) {
          relayClient.close();
          return {
            ok: false,
            definiteAuthError: true,
            error: joinRes?.error || '방 이름 또는 비밀번호가 일치하지 않습니다.'
          };
        }

        const decrypted = decryptPayload(joinRes.envelope, cipherKey);
        return {
          ok: true,
          relayClient,
          endpointUrl,
          roomData: decrypted.room,
          memberSessionToken: decrypted.memberSessionToken
        };
      } catch (err) {
        relayClient.close();
        lastErr = err;
      }
    }

    return {
      ok: false,
      definiteAuthError: false,
      error: lastErr?.message || '온라인 중계 서버에 연결할 수 없습니다.'
    };
  }

  async ensureGuestRelayConnected(forceFresh = false) {
    if (
      !this.activeSession ||
      this.activeSession.mode !== 'guest' ||
      this.activeSession.transport !== 'relay'
    ) {
      return false;
    }
    if (!forceFresh && this.guestRelayClient && this.guestRelayClient.connected) {
      return true;
    }
    if (this._guestRelayReconnectPromise) {
      return await this._guestRelayReconnectPromise;
    }

    const sessionSnap = this.activeSession;
    const authSess = this.authenticatedSession;
    if (!authSess?.account || !authSess?.privateKeyPem || !authSess?.publicKeyPem) {
      return false;
    }

    this._guestRelayReconnectPromise = (async () => {
      try {
        if (this.guestRelayClient) {
          try {
            this.guestRelayClient.close();
          } catch (_e) {}
          this.guestRelayClient = null;
        }
        const handshake = await this._connectAndHandshakeGuestRelay({
          roomId: sessionSnap.roomId,
          authToken: sessionSnap.authToken,
          cipherKey: sessionSnap.cipherKey,
          authSess,
          preferredEndpoint: forceFresh ? '' : sessionSnap.relayEndpoint || ''
        });
        if (!handshake.ok) return false;
        if (
          !this.activeSession ||
          this.activeSession.mode !== 'guest' ||
          this.activeSession.roomId !== sessionSnap.roomId
        ) {
          handshake.relayClient.close();
          return false;
        }
        this.guestRelayClient = handshake.relayClient;
        this.activeSession.memberSessionToken = handshake.memberSessionToken;
        this.activeSession.relayEndpoint = handshake.endpointUrl;
        if (handshake.roomData) {
          this.activeSession.room = handshake.roomData;
        }
        this.sendToRenderer('shared:room-updated', this.getActiveRoomSnapshot());
        return true;
      } finally {
        this._guestRelayReconnectPromise = null;
      }
    })();

    return await this._guestRelayReconnectPromise;
  }

  async joinRoomViaRelay({ roomId, roomName, password, hostCode, authToken, cipherKey, authSess }) {
    const handshake = await this._connectAndHandshakeGuestRelay({
      roomId,
      authToken,
      cipherKey,
      authSess
    });
    if (!handshake.ok) {
      return {
        ok: false,
        definiteAuthError: Boolean(handshake.definiteAuthError),
        error: handshake.error
      };
    }

    const { relayClient, endpointUrl, roomData, memberSessionToken } = handshake;
    this.guestRelayClient = relayClient;
    this.activeSession = {
      mode: 'guest',
      transport: 'relay',
      roomId,
      roomName: roomData.roomName || roomName,
      cipherKey,
      authToken,
      memberSessionToken,
      relayEndpoint: endpointUrl,
      hostEndpoint: null,
      inviteCode: '',
      lastSavedAt: Date.now(),
      room: roomData
    };

    this.recordRecentRoom({
      roomId,
      roomName: roomData.roomName || roomName,
      isHost: false,
      hostCode: hostCode || ''
    });
    this.rememberJoinedRoom({
      room: roomData,
      password,
      authToken,
      cipherKeyHex: Buffer.from(cipherKey).toString('hex'),
      role: 'guest',
      hostCode: hostCode || ''
    });
    this.saveStore();

    return {
      ok: true,
      room: this.getActiveRoomSnapshot()
    };
  }

  async locateActiveRoomHost(roomId, hostCode) {
    // 1. If user supplied an explicit invite code, IP:Port, or pasted invite block (parallel probe)
    const decodedList = decodeInviteCode(hostCode);
    if (decodedList.length > 0) {
      const checks = await Promise.all(
        decodedList.map(async (c) => ((await this.pingHostCandidate(c.host, c.port, roomId)) ? c : null))
      );
      const hit = checks.find(Boolean);
      if (hit) return hit;
    }

    // 2. Probe localhost ports in parallel (for same-PC multi-instance testing)
    const localChecks = await Promise.all(
      LOCAL_PORT_CANDIDATES.map(async (port) =>
        (await this.pingHostCandidate('127.0.0.1', port, roomId)) ? { host: '127.0.0.1', port } : null
      )
    );
    const localHit = localChecks.find(Boolean);
    if (localHit) return localHit;

    // 3. Broadcast UDP discovery packet on LAN + directed subnet broadcasts
    const lanIfaces = getAllLanInterfaces();
    const broadcastTargets = new Set(['255.255.255.255', '127.0.0.1']);
    for (const iface of lanIfaces) {
      if (iface.broadcast) broadcastTargets.add(iface.broadcast);
    }

    const discovered = await new Promise((resolve) => {
      let settled = false;
      const client = dgram.createSocket('udp4');
      client.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString('utf8'));
          if (data?.type === 'TREENOTE_ROOM_HERE' && data.roomId === roomId && data.port) {
            if (!settled) {
              settled = true;
              client.close();
              resolve({ host: rinfo.address, port: Number(data.port) });
            }
          }
        } catch (_e) {
          // ignore
        }
      });
      client.on('error', () => {
        if (!settled) {
          settled = true;
          try {
            client.close();
          } catch (_e) {
            // ignore
          }
          resolve(null);
        }
      });
      client.bind(0, () => {
        try {
          client.setBroadcast(true);
          const packet = Buffer.from(
            JSON.stringify({ type: 'TREENOTE_DISCOVER', roomId }),
            'utf8'
          );
          for (const target of broadcastTargets) {
            try {
              client.send(packet, DISCOVERY_PORT, target);
            } catch (_sendErr) {}
          }
        } catch (_e) {
          // ignore
        }
      });
      setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            client.close();
          } catch (_e) {
            // ignore
          }
          resolve(null);
        }
      }, 550);
    });

    return discovered;
  }

  pingHostCandidate(host, port, expectedRoomId) {
    return new Promise((resolve) => {
      const req = http.get(
        {
          host,
          port,
          path: '/api/ping',
          timeout: 450
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(raw);
              resolve(Boolean(parsed?.ok && parsed.roomId === expectedRoomId));
            } catch (_e) {
              resolve(false);
            }
          });
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  httpGetJson(urlStr) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(urlStr);
      const req = http.get(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname + parsedUrl.search,
          timeout: 5000
        },
        (res) => {
          let totalBytes = 0;
          const chunks = [];
          let aborted = false;
          res.on('data', (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_HTTP_BODY_BYTES) {
              aborted = true;
              req.destroy();
              reject(new Error('응답 데이터 크기가 허용 한도를 초과했습니다.'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (aborted) return;
            try {
              const raw = Buffer.concat(chunks).toString('utf8');
              resolve(raw ? JSON.parse(raw) : {});
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('연결 시간이 초과되었습니다.'));
      });
    });
  }

  httpPostJson(urlStr, payloadObj, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(urlStr);
      const bodyStr = JSON.stringify(payloadObj);
      const req = http.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
          method: 'POST',
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            ...extraHeaders
          }
        },
        (res) => {
          let totalBytes = 0;
          const chunks = [];
          let aborted = false;
          res.on('data', (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_HTTP_BODY_BYTES) {
              aborted = true;
              req.destroy();
              reject(new Error('응답 데이터 크기가 허용 한도(8MB)를 초과했습니다.'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (aborted) return;
            try {
              const raw = Buffer.concat(chunks).toString('utf8');
              resolve(raw ? JSON.parse(raw) : {});
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('연결 시간이 초과되었습니다.'));
      });
      req.write(bodyStr);
      req.end();
    });
  }

  connectGuestEventStream(endpoint, authToken, cipherKey, memberSessionToken) {
    if (this.guestEventReq) {
      try {
        this.guestEventReq.destroy();
      } catch (_e) {
        // ignore
      }
      this.guestEventReq = null;
    }

    const req = http.request(
      {
        hostname: endpoint.host,
        port: endpoint.port,
        path: '/api/events',
        method: 'GET',
        headers: {
          'x-treenote-auth': authToken,
          'x-treenote-session': String(memberSessionToken || '')
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          this.sendToRenderer('shared:room-disconnected', {
            reason: '호스트와의 연결이 종료되었거나 접근이 거부되었습니다.'
          });
          return;
        }

        let buffer = '';
        res.on('data', (chunk) => {
          if (Buffer.byteLength(buffer, 'utf8') + chunk.length > MAX_HTTP_BODY_BYTES) {
            req.destroy();
            this.leaveCurrentRoom();
            this.sendToRenderer('shared:room-disconnected', {
              reason: '호스트로부터 허용 한도를 초과한 데이터가 수신되어 연결을 차단했습니다.'
            });
            return;
          }
          buffer += chunk.toString('utf8');
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            const line = part.trim();
            if (line.startsWith('data:')) {
              try {
                const env = JSON.parse(line.slice(5).trim());
                const decoded = decryptPayload(env, cipherKey);
                if (decoded.type === 'ROOM_STATE' && this.activeSession) {
                  this.activeSession.room = decoded.room;
                  this.sendToRenderer('shared:room-updated', this.getActiveRoomSnapshot());
                } else if (decoded.type === 'KICKED') {
                  this.leaveCurrentRoom();
                  this.sendToRenderer('shared:room-disconnected', {
                    reason: '호스트에 의해 방에서 내보내졌습니다.'
                  });
                }
              } catch (_e) {
                // ignore malformed event
              }
            }
          }
        });

        res.on('end', () => {
          if (this.activeSession && this.activeSession.mode === 'guest') {
            this.sendToRenderer('shared:room-disconnected', {
              reason: '호스트가 방을 닫았거나 연결이 끊어졌습니다.'
            });
          }
        });
      }
    );

    req.on('error', () => {});
    req.end();
    this.guestEventReq = req;
  }

  // ============================================================================
  // 4. Perform Room Actions (노트 작성/편집/정리/병합/채팅/노트박제/권한관리)
  // ============================================================================
  async dispatchRoomAction(action) {
    const actor = this.authenticatedSession?.account;
    if (!this.activeSession || !actor) {
      return { ok: false, error: '참여 중인 방이 없습니다.' };
    }

    if (this.activeSession.mode === 'host') {
      const res = this.applyRoomActionInternal(this.activeSession.room, action, actor, true);
      return { ...res, room: this.getActiveRoomSnapshot() };
    }

    // Guest sends encrypted action to Host (LAN HTTP or E2EE Relay; session verified server-side via memberSessionToken)
    try {
      const { authToken, cipherKey } = this.activeSession;
      const envelope = encryptPayload({ action }, cipherKey);

      if (this.activeSession.transport === 'relay') {
        const sendViaRelay = async () => {
          const connected = await this.ensureGuestRelayConnected(false);
          if (!connected || !this.guestRelayClient) {
            throw new Error('온라인 중계 서버에 연결되어 있지 않습니다.');
          }
          const sessionToken = String(this.activeSession?.memberSessionToken || '');
          return await this.sendRelayRequest(
            this.guestRelayClient,
            {
              op: 'ACTION',
              authToken,
              sessionToken,
              envelope
            },
            'ACTION_RES',
            12000
          );
        };

        let reply = null;
        try {
          reply = await sendViaRelay();
        } catch (firstErr) {
          // One transparent reconnect + retry if broker dropped socket or timed out
          const reconnected = await this.ensureGuestRelayConnected(true);
          if (!reconnected || !this.guestRelayClient) {
            throw firstErr;
          }
          const sessionToken = String(this.activeSession?.memberSessionToken || '');
          reply = await this.sendRelayRequest(
            this.guestRelayClient,
            {
              op: 'ACTION',
              authToken,
              sessionToken,
              envelope
            },
            'ACTION_RES',
            12000
          );
        }
        if (reply?.res?.ok && typeof reply.res.roomRev === 'number') {
          const expectedRev = reply.res.roomRev;
          const roomIdSnap = this.activeSession?.roomId;
          setTimeout(() => {
            if (
              this.activeSession?.mode === 'guest' &&
              this.activeSession?.roomId === roomIdSnap &&
              Number(this.activeSession.room?.rev || 0) < expectedRev
            ) {
              this.requestGuestRelaySync();
            }
          }, 650);
        }
        return reply?.res || { ok: false, error: '호스트 응답이 올바르지 않습니다.' };
      }

      const { hostEndpoint, memberSessionToken } = this.activeSession;
      if (!hostEndpoint) {
        return { ok: false, error: '호스트 연결 정보가 없습니다. 방에 다시 입장해 주세요.' };
      }
      const res = await this.httpPostJson(
        `http://${hostEndpoint.host}:${hostEndpoint.port}/api/action`,
        { envelope },
        {
          'x-treenote-auth': authToken,
          'x-treenote-session': String(memberSessionToken || '')
        }
      );
      return res;
    } catch (err) {
      return { ok: false, error: `호스트에 요청을 전달하지 못했습니다: ${err.message}` };
    }
  }

  applyRoomActionInternal(room, action, actor, isHostActor, options = {}) {
    if (!action || typeof action !== 'object') {
      return { ok: false, error: '잘못된 요청입니다.' };
    }

    const deferBroadcast = Boolean(options?.deferBroadcast);

    // STRICT: Only local Host IPC calls (isHostActor === true) get owner privileges
    const isOwner = Boolean(isHostActor);
    const perm = room.permissionMode || 'all';

    // Check readonly mode (except chat messages & chat reactions which are allowed in readonly rooms)
    if (perm === 'readonly' && !isOwner && action.type !== 'SEND_CHAT' && action.type !== 'REACT_CHAT') {
      return { ok: false, error: '이 방은 호스트 전용 편집(읽기 전용) 모드입니다.' };
    }

    switch (action.type) {
      case 'ADD_NOTE': {
        const cleanNote = sanitizeSharedNote(action.note, actor);
        if (!cleanNote) return { ok: false, error: '유효하지 않은 노트 데이터입니다.' };
        room.notes = [cleanNote, ...(room.notes || [])].slice(0, MAX_SHARED_NOTES);
        room.updatedAt = Date.now();
        break;
      }

      case 'UPDATE_NOTE': {
        const targetId = String(action.note?.id || '');
        const idx = (room.notes || []).findIndex((n) => n.id === targetId);
        if (idx === -1) return { ok: false, error: '대상 노트를 찾을 수 없습니다.' };
        const existing = room.notes[idx];
        if (
          perm === 'host-delete' &&
          !isOwner &&
          existing.author?.uid !== actor.uid &&
          (existing.sectionId === 'notice' || existing.pinned)
        ) {
          return {
            ok: false,
            error: '공지 또는 상단 고정된 노트는 호스트 또는 작성자만 수정할 수 있습니다.'
          };
        }
        const updated = sanitizeSharedNote(
          {
            ...existing,
            ...action.note,
            id: existing.id,
            author: existing.author,
            updatedBy: actor,
            createdAt: existing.createdAt,
            updatedAt: Date.now()
          },
          existing.author
        );
        room.notes[idx] = updated;
        room.updatedAt = Date.now();
        break;
      }

      case 'DELETE_NOTE': {
        const noteId = String(action.noteId || '');
        const target = (room.notes || []).find((n) => n.id === noteId);
        if (!target) return { ok: false, error: '노트를 찾을 수 없습니다.' };
        if (perm === 'host-delete' && !isOwner && target.author?.uid !== actor.uid) {
          return { ok: false, error: '호스트 또는 작성자만 삭제할 수 있습니다.' };
        }
        room.notes = (room.notes || []).filter((n) => n.id !== noteId);
        room.updatedAt = Date.now();
        break;
      }

      case 'DELETE_NOTES_BATCH': {
        const ids = Array.isArray(action.noteIds) ? action.noteIds : [];
        if (ids.length === 0) return { ok: false, error: '삭제할 노트를 선택해 주세요.' };
        let removedCount = 0;
        let blockedCount = 0;
        room.notes = (room.notes || []).filter((n) => {
          if (!ids.includes(n.id)) return true;
          if (perm === 'host-delete' && !isOwner && n.author?.uid !== actor.uid) {
            blockedCount += 1;
            return true;
          }
          removedCount += 1;
          return false;
        });
        if (removedCount === 0 && blockedCount > 0) {
          return { ok: false, error: '선택한 노트를 삭제할 권한이 없습니다.' };
        }
        room.updatedAt = Date.now();
        break;
      }

      case 'MOVE_NOTES': {
        const ids = new Set(Array.isArray(action.noteIds) ? action.noteIds : []);
        const nextSectionId = action.sectionId;
        const nextFolderId = action.folderId;
        const nextStatusBadge = action.statusBadge;
        room.notes = (room.notes || []).map((n) => {
          if (!ids.has(n.id)) return n;
          return {
            ...n,
            sectionId: typeof nextSectionId === 'string' && nextSectionId ? nextSectionId : n.sectionId,
            folderId: typeof nextFolderId === 'string' && nextFolderId ? nextFolderId : n.folderId,
            statusBadge:
              typeof nextStatusBadge === 'string' ? nextStatusBadge : n.statusBadge,
            updatedBy: actor,
            updatedAt: Date.now()
          };
        });
        room.updatedAt = Date.now();
        break;
      }

      case 'TOGGLE_CHECKLIST_ITEM': {
        const { noteId, itemId } = action;
        room.notes = (room.notes || []).map((n) => {
          if (n.id !== noteId) return n;
          const checklist = (n.checklist || []).map((item) =>
            item.id === itemId ? { ...item, done: !item.done } : item
          );
          return { ...n, checklist, updatedBy: actor, updatedAt: Date.now() };
        });
        room.updatedAt = Date.now();
        break;
      }

      case 'MERGE_NOTES': {
        const ids = Array.isArray(action.noteIds) ? action.noteIds : [];
        if (ids.length < 2) {
          return { ok: false, error: '병합할 노트를 2개 이상 선택해 주세요.' };
        }
        const selected = (room.notes || []).filter((n) => ids.includes(n.id));
        if (selected.length < 2) {
          return { ok: false, error: '선택한 노트를 찾을 수 없습니다.' };
        }

        const mergedTitle =
          typeof action.mergedTitle === 'string' && action.mergedTitle.trim()
            ? action.mergedTitle.trim().slice(0, 140)
            : `📑 [통합 정리] ${selected[0].title} 외 ${selected.length - 1}건`;

        const mergedHtmlParts = selected.map(
          (n, i) =>
            `<div><b>${i + 1}. ${escapeHtml(n.title)}</b> <span style="font-size:12px;">(작성: ${escapeHtml(
              n.author?.name || '멤버'
            )})</span></div><div>${n.content || ''}</div><div><br></div>`
        );
        const mergedChecklist = selected.flatMap((n) => n.checklist || []).slice(0, 60);
        const mergedTags = Array.from(
          new Set(selected.flatMap((n) => n.tags || []))
        ).slice(0, 15);
        const firstImage = selected.find((n) => n.imageDataUrl)?.imageDataUrl || '';

        const mergedNote = sanitizeSharedNote(
          {
            id: crypto.randomUUID(),
            title: mergedTitle,
            content: mergedHtmlParts.join('<hr>'),
            category: selected[0].category || '💡 아이디어',
            sectionId: action.targetSectionId || selected[0].sectionId || 'idea',
            folderId: action.targetFolderId || selected[0].folderId || 'all-notes',
            statusBadge: '확정',
            checklist: mergedChecklist,
            tags: mergedTags,
            pinned: selected.some((n) => n.pinned),
            imageDataUrl: firstImage,
            author: actor,
            updatedBy: actor
          },
          actor
        );

        const removeOriginal = Boolean(action.removeOriginal);
        const remaining = removeOriginal
          ? (room.notes || []).filter((n) => {
              if (!ids.includes(n.id)) return true;
              if (perm === 'host-delete' && !isOwner && n.author?.uid !== actor.uid) {
                return true;
              }
              return false;
            })
          : room.notes || [];
        room.notes = [mergedNote, ...remaining].slice(0, MAX_SHARED_NOTES);
        room.updatedAt = Date.now();
        break;
      }

      case 'ADD_SECTION': {
        const title = String(action.title || '').trim().slice(0, 32);
        if (!title) return { ok: false, error: '섹션 이름을 입력해 주세요.' };
        const newSec = {
          id: `sec-${Date.now()}`,
          title,
          color: ['blue', 'amber', 'purple', 'emerald', 'zinc', 'rose'].includes(action.color)
            ? action.color
            : 'blue'
        };
        room.sections = [...(room.sections || DEFAULT_SECTIONS), newSec].slice(0, 12);
        break;
      }

      case 'RENAME_SECTION': {
        if (!isOwner) return { ok: false, error: '호스트만 섹션 이름을 변경할 수 있습니다.' };
        const secId = String(action.sectionId || '');
        const title = String(action.title || '').trim().slice(0, 32);
        if (!title) return { ok: false, error: '섹션 이름을 입력해 주세요.' };
        room.sections = (room.sections || []).map((s) =>
          s.id === secId ? { ...s, title } : s
        );
        room.updatedAt = Date.now();
        break;
      }

      case 'DELETE_SECTION': {
        if (!isOwner) return { ok: false, error: '호스트만 섹션을 삭제할 수 있습니다.' };
        const secId = String(action.sectionId || '');
        if ((room.sections || []).length <= 1) {
          return { ok: false, error: '최소 1개의 섹션이 필요합니다.' };
        }
        room.sections = (room.sections || []).filter((s) => s.id !== secId);
        const fallbackSec = room.sections[0].id;
        room.notes = (room.notes || []).map((n) =>
          n.sectionId === secId ? { ...n, sectionId: fallbackSec } : n
        );
        break;
      }

      case 'ADD_FOLDER': {
        const name = String(action.name || '').trim().slice(0, 32);
        if (!name) return { ok: false, error: '폴더 이름을 입력해 주세요.' };
        const icon = String(action.icon || '📁').slice(0, 4);
        const newFolder = { id: `fld-${Date.now()}`, name, icon };
        room.folders = [...(room.folders || DEFAULT_FOLDERS), newFolder].slice(0, 20);
        break;
      }

      case 'RENAME_FOLDER': {
        if (!isOwner) return { ok: false, error: '호스트만 폴더 이름을 변경할 수 있습니다.' };
        const folderId = String(action.folderId || '');
        const name = String(action.name || '').trim().slice(0, 32);
        if (!name) return { ok: false, error: '폴더 이름을 입력해 주세요.' };
        room.folders = (room.folders || []).map((f) =>
          f.id === folderId ? { ...f, name } : f
        );
        room.updatedAt = Date.now();
        break;
      }

      case 'DELETE_FOLDER': {
        if (!isOwner) return { ok: false, error: '호스트만 폴더를 삭제할 수 있습니다.' };
        const folderId = String(action.folderId || '');
        if (folderId === 'all-notes') return { ok: false, error: '기본 폴더는 삭제할 수 없습니다.' };
        room.folders = (room.folders || []).filter((f) => f.id !== folderId);
        room.notes = (room.notes || []).map((n) =>
          n.folderId === folderId ? { ...n, folderId: 'all-notes' } : n
        );
        break;
      }

      case 'SEND_CHAT': {
        const msg = sanitizeChatMessage(action.message, actor);
        if (!msg) return { ok: false, error: '메시지 내용을 입력해 주세요.' };
        room.messages = [...(room.messages || []), msg].slice(-MAX_CHAT_MESSAGES);
        room.updatedAt = Date.now();
        break;
      }

      case 'PROMOTE_CHAT_TO_NOTE': {
        const msgId = String(action.messageId || '');
        const msg = (room.messages || []).find((m) => m.id === msgId);
        if (!msg) return { ok: false, error: '채팅 메시지를 찾을 수 없습니다.' };

        const firstImgAtt = Array.isArray(msg.attachments)
          ? msg.attachments.find((a) => a && a.isImage && a.dataUrl)
          : null;
        const firstLine = (msg.text || firstImgAtt?.name || '채팅에서 박제된 노트')
          .split(/\r?\n/)[0]
          .slice(0, 50);
        const newNote = sanitizeSharedNote(
          {
            id: crypto.randomUUID(),
            title: `💬 ${firstLine}`,
            content: `<div>${(msg.text || '')
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/\n/g, '<br>')}</div>`,
            category: '💬 채팅 박제',
            sectionId: action.sectionId || 'idea',
            folderId: action.folderId || 'meeting',
            statusBadge: '중요',
            tags: ['채팅박제', msg.author?.name || '멤버'],
            imageDataUrl: msg.imageDataUrl || firstImgAtt?.dataUrl || '',
            author: msg.author || actor,
            updatedBy: actor
          },
          actor
        );
        msg.pinnedToNoteId = newNote.id;
        room.notes = [newNote, ...(room.notes || [])].slice(0, MAX_SHARED_NOTES);
        room.updatedAt = Date.now();
        break;
      }

      case 'REACT_CHAT': {
        const msgId = String(action.messageId || '');
        const emoji = String(action.emoji || '');
        if (!ALLOWED_CHAT_REACTIONS.has(emoji)) {
          return { ok: false, error: '지원하지 않는 리액션입니다.' };
        }
        const msg = (room.messages || []).find((m) => m.id === msgId);
        if (!msg) return { ok: false, error: '대상 채팅 메시지를 찾을 수 없습니다.' };
        const reactions = sanitizeChatReactions(msg.reactions);
        const prevList = reactions[emoji] || [];
        if (prevList.includes(actor.uid)) {
          const filtered = prevList.filter((u) => u !== actor.uid);
          if (filtered.length > 0) reactions[emoji] = filtered;
          else delete reactions[emoji];
        } else {
          reactions[emoji] = [...prevList, actor.uid];
        }
        msg.reactions = reactions;
        room.updatedAt = Date.now();
        break;
      }

      case 'REORDER_NOTE': {
        const noteId = String(action.noteId || '');
        const notes = [...(room.notes || [])];
        const fromIdx = notes.findIndex((n) => n.id === noteId);
        if (fromIdx === -1) return { ok: false, error: '이동할 노트를 찾을 수 없습니다.' };

        const targetSectionId =
          typeof action.targetSectionId === 'string' && action.targetSectionId
            ? action.targetSectionId.slice(0, 40)
            : notes[fromIdx].sectionId;
        const movingNote = {
          ...notes[fromIdx],
          sectionId: targetSectionId,
          updatedBy: actor,
          updatedAt: Date.now()
        };
        notes.splice(fromIdx, 1);

        if (action.direction === 'up' || action.direction === 'down') {
          const sameSecIndices = [];
          notes.forEach((n, idx) => {
            if ((n.sectionId || 'idea') === (targetSectionId || 'idea')) sameSecIndices.push(idx);
          });
          // Re-insert near neighbor in same section
          if (action.targetNoteId) {
            const neighborIdx = notes.findIndex((n) => n.id === action.targetNoteId);
            if (neighborIdx !== -1) {
              const insertAt = action.direction === 'down' ? neighborIdx + 1 : neighborIdx;
              notes.splice(insertAt, 0, movingNote);
            } else {
              notes.splice(Math.min(fromIdx, notes.length), 0, movingNote);
            }
          } else {
            notes.splice(Math.min(fromIdx, notes.length), 0, movingNote);
          }
        } else if (action.targetNoteId && action.targetNoteId !== noteId) {
          const targetIdx = notes.findIndex((n) => n.id === action.targetNoteId);
          if (targetIdx !== -1) {
            const insertAt = action.position === 'after' ? targetIdx + 1 : targetIdx;
            notes.splice(insertAt, 0, movingNote);
          } else {
            notes.unshift(movingNote);
          }
        } else if (action.position === 'end') {
          notes.push(movingNote);
        } else {
          notes.unshift(movingNote);
        }

        room.notes = notes.slice(0, MAX_SHARED_NOTES);
        room.updatedAt = Date.now();
        break;
      }

      case 'REORDER_SECTIONS': {
        if (!isOwner) return { ok: false, error: '호스트만 섹션 순서를 변경할 수 있습니다.' };
        const sectionId = String(action.sectionId || '');
        const sections = [...(room.sections || [])];
        const fromIdx = sections.findIndex((s) => s.id === sectionId);
        if (fromIdx === -1) return { ok: false, error: '대상 섹션을 찾을 수 없습니다.' };

        const [moved] = sections.splice(fromIdx, 1);
        if (action.direction === 'left') {
          sections.splice(Math.max(0, fromIdx - 1), 0, moved);
        } else if (action.direction === 'right') {
          sections.splice(Math.min(sections.length, fromIdx + 1), 0, moved);
        } else if (action.targetSectionId && action.targetSectionId !== sectionId) {
          const targetIdx = sections.findIndex((s) => s.id === action.targetSectionId);
          if (targetIdx !== -1) {
            const insertAt = action.position === 'after' ? targetIdx + 1 : targetIdx;
            sections.splice(insertAt, 0, moved);
          } else {
            sections.push(moved);
          }
        } else {
          sections.splice(fromIdx, 0, moved);
        }
        room.sections = sections;
        room.updatedAt = Date.now();
        break;
      }

      case 'SET_PERMISSION_MODE': {
        if (!isOwner) return { ok: false, error: '호스트만 방 권한을 변경할 수 있습니다.' };
        if (['all', 'host-delete', 'readonly'].includes(action.permissionMode)) {
          room.permissionMode = action.permissionMode;
        }
        break;
      }

      case 'KICK_MEMBER': {
        if (!isOwner) return { ok: false, error: '호스트만 멤버를 내보낼 수 있습니다.' };
        const targetUid = String(action.targetUid || '');
        if (!targetUid || targetUid === room.hostProfile?.uid) {
          return { ok: false, error: '잘못된 대상입니다.' };
        }
        room.kickedUids = Array.from(new Set([...(room.kickedUids || []), targetUid]));
        for (const [sessToken, sessVal] of this.verifiedSessions.entries()) {
          if (sessVal.profile?.uid === targetUid) {
            this.verifiedSessions.delete(sessToken);
          }
        }
        const client = this.sseClients.get(targetUid);
        if (client) {
          try {
            const kickEnv = encryptPayload({ type: 'KICKED' }, this.activeSession.cipherKey);
            client.res.write(`data: ${JSON.stringify(kickEnv)}\n\n`);
            client.res.end();
          } catch (_e) {
            // ignore
          }
          this.sseClients.delete(targetUid);
        }
        if (this.relayClients.has(targetUid)) {
          this.relayClients.delete(targetUid);
          if (this.hostRelayClient && this.hostRelayClient.connected) {
            const kickEnv = encryptPayload(
              { type: 'KICKED', targetUid },
              this.activeSession.cipherKey
            );
            this.hostRelayClient.publishJson({ op: 'KICKED', envelope: kickEnv });
          }
        }
        break;
      }

      default:
        return { ok: false, error: '알 수 없는 작업입니다.' };
    }

    room.rev = (Number(room.rev) || 0) + 1;
    this.persistHostedRoom(room);
    if (!deferBroadcast) {
      this.broadcastRoomUpdate();
    }
    return { ok: true, roomRev: room.rev };
  }

  async leaveCurrentRoom() {
    if (this._hostHeartbeatTimer) {
      clearInterval(this._hostHeartbeatTimer);
      this._hostHeartbeatTimer = null;
    }
    if (this._guestRelayReconnectTimer) {
      clearTimeout(this._guestRelayReconnectTimer);
      this._guestRelayReconnectTimer = null;
    }
    this._guestRelayReconnectPromise = null;

    for (const [reqId, waiter] of this.pendingRelayReplies.entries()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('방에서 나가 연결이 종료되었습니다.'));
      this.pendingRelayReplies.delete(reqId);
    }

    if (this.guestRelayClient) {
      try {
        if (this.guestRelayClient.connected && this.activeSession?.memberSessionToken) {
          this.guestRelayClient.publishJson({
            op: 'LEAVE',
            sessionToken: this.activeSession.memberSessionToken
          });
        }
        this.guestRelayClient.close();
      } catch (_e) {
        // ignore
      }
      this.guestRelayClient = null;
    }

    if (this.hostRelayClient) {
      try {
        if (this.hostRelayClient.connected) {
          this.hostRelayClient.publishJson({ op: 'HOST_CLOSED' });
        }
        this.hostRelayClient.close();
      } catch (_e) {
        // ignore
      }
      this.hostRelayClient = null;
    }

    if (this.guestEventReq) {
      try {
        this.guestEventReq.destroy();
      } catch (_e) {
        // ignore
      }
      this.guestEventReq = null;
    }

    for (const [, client] of this.sseClients.entries()) {
      try {
        client.res.end();
      } catch (_e) {
        // ignore
      }
    }
    this.sseClients.clear();
    this.relayClients.clear();
    this.verifiedSessions.clear();
    this.joinNonces.clear();

    if (this.httpServer) {
      await new Promise((resolve) => {
        try {
          this.httpServer.close(() => resolve());
        } catch (_e) {
          resolve();
        }
      });
      this.httpServer = null;
    }

    if (this.udpSocket) {
      try {
        this.udpSocket.close();
      } catch (_e) {
        // ignore
      }
      this.udpSocket = null;
    }

    this.activeSession = null;
    return { ok: true };
  }
}

module.exports = { SharedRoomManager };
