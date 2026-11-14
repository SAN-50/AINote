const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');

const DISCOVERY_PORT = 49872;
const LOCAL_PORT_CANDIDATES = [49873, 49874, 49875, 49876, 49877];
const MAX_HTTP_BODY_BYTES = 8 * 1024 * 1024; // 8MB max per packet
const MAX_OAUTH_RESPONSE_BYTES = 1024 * 1024; // 1MB max for OAuth token response
const MAX_SSE_CLIENTS = 30;
const MAX_CHAT_MESSAGES = 300;
const MAX_SHARED_NOTES = 500;
const MAX_JOIN_ATTEMPTS = 5;
const JOIN_LOCKOUT_MS = 30 * 1000;
const BLOCKED_INVITE_PORTS = new Set([3306, 5432, 6379, 27017, 9200, 11211]);

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

function getLocalLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function encodeInviteCode(host, port) {
  return Buffer.from(`${host}:${port}`, 'utf8').toString('base64url');
}

function decodeInviteCode(code) {
  try {
    const raw = String(code || '').trim();
    if (!raw) return null;
    if (/^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(raw) || /^localhost:\d{2,5}$/i.test(raw)) {
      const [h, p] = raw.split(':');
      const host = h.toLowerCase() === 'localhost' ? '127.0.0.1' : h;
      const portNum = Number(p);
      if (isSafeInviteTarget(host, portNum)) {
        return { host, port: portNum };
      }
      return null;
    }
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const [host, portStr] = decoded.split(':');
    const port = Number(portStr);
    if (isSafeInviteTarget(host, port)) {
      return { host, port };
    }
    return null;
  } catch (_e) {
    return null;
  }
}

function sanitizeAuthor(author) {
  if (!author || typeof author !== 'object') {
    return {
      uid: 'anonymous',
      name: '익명 멤버',
      email: '',
      picture: '',
      avatarColor: '#2563EB'
    };
  }
  const email = typeof author.email === 'string' ? author.email.trim().slice(0, 120) : '';
  const name =
    typeof author.name === 'string' && author.name.trim()
      ? author.name.trim().slice(0, 40)
      : email
      ? email.split('@')[0]
      : '멤버';
  const uid =
    typeof author.uid === 'string' && author.uid.trim()
      ? author.uid.trim().slice(0, 80)
      : `google:${crypto.createHash('sha256').update(email || name).digest('hex').slice(0, 20)}`;
  const picture =
    typeof author.picture === 'string' &&
    /^https:\/\/[a-z0-9.-]*googleusercontent\.com\//i.test(author.picture)
      ? author.picture.slice(0, 400)
      : '';
  const avatarColor =
    typeof author.avatarColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(author.avatarColor)
      ? author.avatarColor
      : pickAvatarColor(uid);

  return { uid, name, email, picture, avatarColor };
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

function sanitizeChatMessage(raw, fallbackAuthor) {
  if (!raw || typeof raw !== 'object') return null;
  const author = sanitizeAuthor(raw.author || fallbackAuthor);
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 4000) : '';
  const imageDataUrl = isSafeSharedImage(raw.imageDataUrl) ? raw.imageDataUrl : '';
  const sharedNoteRef =
    raw.sharedNoteRef && typeof raw.sharedNoteRef === 'object'
      ? {
          id: String(raw.sharedNoteRef.id || '').slice(0, 64),
          title: String(raw.sharedNoteRef.title || '공유 노트').slice(0, 120),
          sectionId: String(raw.sharedNoteRef.sectionId || 'idea').slice(0, 40),
          statusBadge: String(raw.sharedNoteRef.statusBadge || '').slice(0, 20)
        }
      : null;

  if (!text && !imageDataUrl && !sharedNoteRef) return null;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : crypto.randomUUID(),
    text,
    imageDataUrl,
    sharedNoteRef,
    author,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    isSystem: Boolean(raw.isSystem),
    pinnedToNoteId: typeof raw.pinnedToNoteId === 'string' ? raw.pinnedToNoteId.slice(0, 64) : ''
  };
}

class SharedRoomManager {
  constructor({ getAppDataDir, sendToRenderer, openExternalUrl }) {
    this.getAppDataDir = getAppDataDir;
    this.sendToRenderer = sendToRenderer;
    this.openExternalUrl = openExternalUrl;

    this.storeData = this.loadStore();
    this.activeSession = null; // { mode: 'host' | 'guest', roomId, roomName, cipherKey, authToken, ... }
    this.httpServer = null;
    this.udpSocket = null;
    this.sseClients = new Map(); // memberUid -> { res, profile, lastSeen }
    this.failedJoinMap = new Map(); // ip -> { count, lockoutUntil }
    this.guestEventReq = null;
    this.oauthServer = null;
  }

  getStoreFilePath() {
    return path.join(this.getAppDataDir(), 'shared-space-data.json');
  }

  loadStore() {
    const filePath = this.getStoreFilePath();
    const defaultStore = {
      googleAccount: null,
      oauthConfig: { clientId: '', clientSecret: '' },
      hostedRooms: {}, // roomId -> persisted room object
      recentRooms: [] // [{ roomId, roomName, isHost, lastJoinedAt, hostCode, memberCount }]
    };
    if (!fs.existsSync(filePath)) return defaultStore;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const savedGoogleAccount =
        parsed.googleAccount && parsed.googleAccount.oauthVerified === true
          ? { ...sanitizeAuthor(parsed.googleAccount), oauthVerified: true }
          : null;
      return {
        googleAccount: savedGoogleAccount,
        oauthConfig: {
          clientId:
            typeof parsed.oauthConfig?.clientId === 'string'
              ? parsed.oauthConfig.clientId.trim()
              : '',
          clientSecret:
            typeof parsed.oauthConfig?.clientSecret === 'string'
              ? parsed.oauthConfig.clientSecret.trim()
              : ''
        },
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

  getPublicState() {
    const effectiveClientId =
      this.storeData.oauthConfig?.clientId || process.env.TREENOTE_GOOGLE_CLIENT_ID || '';
    const effectiveClientSecret =
      this.storeData.oauthConfig?.clientSecret || process.env.TREENOTE_GOOGLE_CLIENT_SECRET || '';
    return {
      googleAccount: this.storeData.googleAccount,
      hasOAuthClientId: Boolean(effectiveClientId),
      hasOAuthClientSecret: Boolean(effectiveClientSecret),
      oauthClientId: effectiveClientId,
      recentRooms: this.storeData.recentRooms || [],
      activeRoom: this.getActiveRoomSnapshot()
    };
  }

  getActiveRoomSnapshot() {
    if (!this.activeSession) return null;
    const room = this.activeSession.room;
    if (!room) return null;
    return {
      mode: this.activeSession.mode,
      roomId: room.roomId,
      roomName: room.roomName,
      hostProfile: room.hostProfile,
      permissionMode: room.permissionMode || 'all',
      inviteCode: this.activeSession.inviteCode || '',
      localPort: this.activeSession.port || 0,
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
      const list = [{ ...hostProfile, isHost: true, online: true }];
      for (const [uid, client] of this.sseClients.entries()) {
        if (uid !== hostProfile.uid) {
          list.push({ ...client.profile, isHost: false, online: true });
        }
      }
      return list;
    }
    return this.activeSession.room.members || [];
  }

  // ============================================================================
  // 1. Google Account Login (Official OAuth 2.0 PKCE Loopback Only)
  // ============================================================================
  saveOAuthConfig({ clientId, clientSecret }) {
    const cleanClientId = typeof clientId === 'string' ? clientId.trim() : '';
    const rawSecret = typeof clientSecret === 'string' ? clientSecret.trim() : '';
    if (!cleanClientId) {
      return { ok: false, error: 'Google Cloud OAuth Client ID를 입력해 주세요.' };
    }
    const prevConfig = this.storeData.oauthConfig || {};
    const nextSecret =
      rawSecret || (prevConfig.clientId === cleanClientId ? prevConfig.clientSecret || '' : '');

    this.storeData.oauthConfig = {
      clientId: cleanClientId,
      clientSecret: nextSecret
    };
    this.saveStore();
    return {
      ok: true,
      hasOAuthClientId: Boolean(this.storeData.oauthConfig.clientId),
      hasOAuthClientSecret: Boolean(this.storeData.oauthConfig.clientSecret),
      oauthClientId: this.storeData.oauthConfig.clientId
    };
  }

  async startGoogleOAuthBrowserFlow() {
    const clientId =
      this.storeData.oauthConfig?.clientId || process.env.TREENOTE_GOOGLE_CLIENT_ID || '';
    const clientSecret =
      this.storeData.oauthConfig?.clientSecret || process.env.TREENOTE_GOOGLE_CLIENT_SECRET || '';
    if (!clientId) {
      return {
        ok: false,
        needsConfig: true,
        error: 'Google Cloud OAuth Client ID가 설정되지 않았습니다. OAuth 설정에서 Client ID를 먼저 입력해 주세요.'
      };
    }

    if (this.oauthServer) {
      try {
        this.oauthServer.close();
      } catch (_e) {
        // ignore
      }
      this.oauthServer = null;
    }

    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const stateToken = crypto.randomBytes(16).toString('hex');

    return new Promise((resolve) => {
      let settled = false;
      let callbackReceived = false;
      let timeoutId = null;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        resolve(result);
      };

      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url, 'http://127.0.0.1');
          if (reqUrl.pathname !== '/oauth2callback') {
            res.writeHead(404);
            res.end();
            return;
          }

          callbackReceived = true;
          const returnedState = reqUrl.searchParams.get('state');
          const code = reqUrl.searchParams.get('code');
          const errParam = reqUrl.searchParams.get('error');

          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            Connection: 'close'
          });
          res.end(`<!DOCTYPE html>
            <html lang="ko">
              <head><meta charset="utf-8"><title>나무 노트 - Google 로그인</title></head>
              <body style="font-family:sans-serif;background:#0F1014;color:#F3F4F6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
                <div style="background:#1C1E26;padding:32px 40px;border-radius:16px;border:1px solid #2A2D3A;text-align:center;">
                  <h2 style="margin:0 0 8px 0;">🌲 나무 노트 Google 인증 처리 완료</h2>
                  <p style="margin:0;color:#9CA3AF;font-size:14px;">이 브라우저 창을 닫고 나무 노트 앱으로 돌아가세요.</p>
                </div>
              </body>
            </html>`);

          server.close();
          if (this.oauthServer === server) {
            this.oauthServer = null;
          }

          if (errParam || !code || returnedState !== stateToken) {
            finish({ ok: false, error: 'Google 로그인이 취소되었거나 상태 검증에 실패했습니다.' });
            return;
          }

          const tokenData = await this.exchangeGoogleCodeForProfile({
            code,
            clientId,
            clientSecret,
            codeVerifier,
            redirectUri
          });

          if (tokenData.ok) {
            this.storeData.googleAccount = tokenData.profile;
            this.saveStore();
            this.sendToRenderer('shared:auth-updated', {
              googleAccount: tokenData.profile
            });
            finish({ ok: true, googleAccount: tokenData.profile });
          } else {
            finish({ ok: false, error: tokenData.error });
          }
        } catch (err) {
          finish({ ok: false, error: err.message });
        }
      });

      server.on('close', () => {
        if (this.oauthServer === server) {
          this.oauthServer = null;
        }
        if (!callbackReceived) {
          finish({ ok: false, error: 'Google 로그인이 중단되었습니다.' });
        }
      });

      this.oauthServer = server;
      let redirectUri = '';

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        redirectUri = `http://127.0.0.1:${addr.port}/oauth2callback`;
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', 'openid email profile');
        authUrl.searchParams.set('state', stateToken);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('prompt', 'select_account');

        this.openExternalUrl(authUrl.toString());
      });

      timeoutId = setTimeout(() => {
        if (!callbackReceived && this.oauthServer === server) {
          try {
            server.close();
          } catch (_e) {
            // ignore
          }
          this.oauthServer = null;
          finish({ ok: false, error: 'Google 로그인 응답 시간이 초과되었습니다.' });
        }
      }, 180 * 1000);
    });
  }

  exchangeGoogleCodeForProfile({ code, clientId, clientSecret, codeVerifier, redirectUri }) {
    return new Promise((resolve) => {
      const postParams = new URLSearchParams({
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier
      });
      if (clientSecret) {
        postParams.set('client_secret', clientSecret);
      }
      const postData = postParams.toString();

      const req = https.request(
        'https://oauth2.googleapis.com/token',
        {
          method: 'POST',
          timeout: 10000,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        },
        (res) => {
          const chunks = [];
          let totalBytes = 0;
          let oversized = false;
          res.on('data', (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_OAUTH_RESPONSE_BYTES) {
              oversized = true;
              req.destroy();
              resolve({ ok: false, error: 'Google 인증 응답 크기가 허용 한도를 초과했습니다.' });
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (oversized) return;
            try {
              const body = Buffer.concat(chunks).toString('utf8');
              const parsed = JSON.parse(body);
              if (!parsed.id_token && !parsed.access_token) {
                const rawDesc = String(parsed.error_description || parsed.error || '');
                const friendlyError = rawDesc.includes('client_secret')
                  ? 'Google OAuth Client Secret이 누락되었거나 일치하지 않습니다. OAuth 설정에서 Client Secret을 함께 입력해 주세요.'
                  : rawDesc || 'Google 토큰 발급에 실패했습니다.';
                resolve({
                  ok: false,
                  error: friendlyError
                });
                return;
              }
              // Parse & validate ID token JWT claims
              if (parsed.id_token) {
                const parts = parsed.id_token.split('.');
                if (parts.length === 3) {
                  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
                  const validIssuer =
                    claims.iss === 'https://accounts.google.com' ||
                    claims.iss === 'accounts.google.com';
                  const validAudience = claims.aud === clientId;
                  const validExp =
                    typeof claims.exp === 'number' && claims.exp * 1000 > Date.now();

                  if (!validIssuer || !validAudience || !validExp) {
                    resolve({
                      ok: false,
                      error: 'Google ID 토큰 클레임 검증에 실패했습니다. (발급자/대상/만료 확인)'
                    });
                    return;
                  }

                  const email = String(claims.email || '').toLowerCase();
                  if (!email || claims.email_verified === false) {
                    resolve({ ok: false, error: '인증된 Google 계정 이메일 정보를 확인할 수 없습니다.' });
                    return;
                  }
                  const uid = `google:${claims.sub || email}`;
                  const profile = {
                    ...sanitizeAuthor({
                      uid,
                      email,
                      name: claims.name || email.split('@')[0],
                      picture: claims.picture || '',
                      avatarColor: pickAvatarColor(uid)
                    }),
                    oauthVerified: true
                  };
                  resolve({ ok: true, profile });
                  return;
                }
              }
              resolve({ ok: false, error: '프로필 정보를 읽을 수 없습니다.' });
            } catch (e) {
              resolve({ ok: false, error: e.message });
            }
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Google 인증 서버 응답 시간이 초과되었습니다.' });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.write(postData);
      req.end();
    });
  }

  signOutGoogle() {
    this.leaveCurrentRoom();
    this.storeData.googleAccount = null;
    this.saveStore();
    return { ok: true };
  }

  // ============================================================================
  // 2. Host a Shared Room (방 만들기 & 호스트 서버 가동)
  // ============================================================================
  async hostRoom({ roomName, password, permissionMode }) {
    const account = this.storeData.googleAccount;
    if (!account) {
      return { ok: false, error: '공유 스페이스를 사용하려면 먼저 Google 계정으로 로그인해 주세요.' };
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
      roomId,
      roomName: cleanName,
      cipherKey,
      authToken,
      port: serverInfo.port,
      inviteCode: serverInfo.inviteCode,
      room
    };

    this.recordRecentRoom({
      roomId,
      roomName: cleanName,
      isHost: true,
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

  async startHostNetworkServer(room, cipherKey) {
    this.sseClients.clear();

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
    const lanIp = getLocalLanIp();
    const inviteCode = encodeInviteCode(lanIp, port);

    // Start UDP LAN Auto-Discovery responder so guests only need Room Name + Password
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
          roomName: room.roomName
        })
      );
      return;
    }

    // 1) POST /api/join
    if (req.method === 'POST' && reqUrl.pathname === '/api/join') {
      const rate = this.checkJoinRateLimit(remoteIp);
      if (!rate.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: rate.error }));
        return;
      }

      try {
        const body = await this.readJsonBody(req);
        if (body.roomId !== room.roomId || !safeTimingEqualHex(body.authToken, room.authToken)) {
          this.recordJoinAttempt(remoteIp, false);
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: false,
              error: '방 이름 또는 비밀번호가 일치하지 않습니다.'
            })
          );
          return;
        }

        const decrypted = decryptPayload(body.envelope, cipherKey);
        const guestProfile = sanitizeAuthor(decrypted.profile);

        if ((room.kickedUids || []).includes(guestProfile.uid)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: '호스트에 의해 입장이 제한된 계정입니다.' }));
          return;
        }

        this.recordJoinAttempt(remoteIp, true);

        const joinSysMsg = {
          id: crypto.randomUUID(),
          text: `${guestProfile.name}님이 방에 입장했습니다.`,
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
            room: {
              roomId: room.roomId,
              roomName: room.roomName,
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

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, envelope: responseEnvelope }));

        this.broadcastRoomUpdate();
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

      let guestProfile;
      try {
        const profileEnv = JSON.parse(req.headers['x-treenote-profile'] || '{}');
        guestProfile = sanitizeAuthor(decryptPayload(profileEnv, cipherKey));
      } catch (_e) {
        this.recordJoinAttempt(remoteIp, false);
        res.writeHead(400);
        res.end();
        return;
      }

      if ((room.kickedUids || []).includes(guestProfile.uid)) {
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

      try {
        const body = await this.readJsonBody(req);
        const actionPayload = decryptPayload(body.envelope, cipherKey);
        const actor = sanitizeAuthor(actionPayload.actor);
        this.recordJoinAttempt(remoteIp, true);

        if ((room.kickedUids || []).includes(actor.uid)) {
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

    // Broadcast encrypted state to all connected guests
    const envelope = encryptPayload(
      {
        type: 'ROOM_STATE',
        room: {
          roomId: room.roomId,
          roomName: room.roomName,
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
  }

  persistHostedRoom(room) {
    if (!room || !room.roomId) return;
    this.storeData.hostedRooms[room.roomId] = room;
    this.saveStore();
  }

  // ============================================================================
  // 3. Join an Existing Shared Room (방 이름 + 비밀번호로 참가하기)
  // ============================================================================
  async joinRoom({ roomName, password, hostCode }) {
    const account = this.storeData.googleAccount;
    if (!account) {
      return { ok: false, error: '공유 스페이스를 사용하려면 먼저 Google 계정으로 로그인해 주세요.' };
    }

    const cleanName = String(roomName || '').trim().slice(0, 60);
    const cleanPwd = String(password || '').trim();
    if (cleanName.length < 2 || cleanPwd.length < 2) {
      return { ok: false, error: '방 이름과 비밀번호를 정확히 입력해 주세요.' };
    }

    const roomId = deriveRoomId(cleanName);
    const { authToken, cipherKey } = deriveRoomSecrets(cleanName, cleanPwd);

    await this.leaveCurrentRoom();

    // 1) Find active host on network (Invite Code -> Localhost Ports -> UDP LAN Broadcast)
    const endpoint = await this.locateActiveRoomHost(roomId, hostCode);

    if (!endpoint) {
      // Check if this room exists locally on this PC (previously hosted on this PC)
      const localHosted = this.storeData.hostedRooms[roomId];
      if (localHosted && safeTimingEqualHex(localHosted.authToken, authToken)) {
        return await this.hostRoom({
          roomName: localHosted.roomName,
          password: cleanPwd,
          permissionMode: localHosted.permissionMode
        });
      }
      return {
        ok: false,
        error:
          '현재 열려 있는 해당 이름의 방을 찾을 수 없습니다. 호스트가 방을 열었는지 확인하거나 초대 코드를 입력해 주세요.'
      };
    }

    // 2) Perform encrypted handshake with Host
    try {
      const joinEnvelope = encryptPayload({ profile: account }, cipherKey);
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

      const inviteCode = encodeInviteCode(endpoint.host, endpoint.port);
      this.activeSession = {
        mode: 'guest',
        roomId,
        roomName: roomData.roomName,
        cipherKey,
        authToken,
        hostEndpoint: endpoint,
        inviteCode,
        room: roomData
      };

      this.recordRecentRoom({
        roomId,
        roomName: roomData.roomName,
        isHost: false,
        hostCode: inviteCode
      });
      this.saveStore();

      this.connectGuestEventStream(endpoint, authToken, cipherKey, account);

      return {
        ok: true,
        room: this.getActiveRoomSnapshot()
      };
    } catch (err) {
      return {
        ok: false,
        error: `방 연결 중 오류가 발생했습니다: ${err.message}`
      };
    }
  }

  async locateActiveRoomHost(roomId, hostCode) {
    // 1. If user supplied an explicit invite code or IP:Port
    const decoded = decodeInviteCode(hostCode);
    if (decoded) {
      const ok = await this.pingHostCandidate(decoded.host, decoded.port, roomId);
      if (ok) return decoded;
    }

    // 2. Probe localhost ports (for testing/using across instances on same PC)
    for (const port of LOCAL_PORT_CANDIDATES) {
      const ok = await this.pingHostCandidate('127.0.0.1', port, roomId);
      if (ok) return { host: '127.0.0.1', port };
    }

    // 3. Broadcast UDP discovery packet on LAN
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
          client.send(packet, DISCOVERY_PORT, '255.255.255.255');
          client.send(packet, DISCOVERY_PORT, '127.0.0.1');
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
      }, 900);
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

  connectGuestEventStream(endpoint, authToken, cipherKey, account) {
    if (this.guestEventReq) {
      try {
        this.guestEventReq.destroy();
      } catch (_e) {
        // ignore
      }
      this.guestEventReq = null;
    }

    const profileEnv = JSON.stringify(encryptPayload(account, cipherKey));
    const req = http.request(
      {
        hostname: endpoint.host,
        port: endpoint.port,
        path: '/api/events',
        method: 'GET',
        headers: {
          'x-treenote-auth': authToken,
          'x-treenote-profile': profileEnv
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
    if (!this.activeSession || !this.storeData.googleAccount) {
      return { ok: false, error: '참여 중인 방이 없습니다.' };
    }
    const actor = this.storeData.googleAccount;

    if (this.activeSession.mode === 'host') {
      const res = this.applyRoomActionInternal(this.activeSession.room, action, actor, true);
      return { ...res, room: this.getActiveRoomSnapshot() };
    }

    // Guest sends encrypted action to Host
    try {
      const { hostEndpoint, authToken, cipherKey } = this.activeSession;
      const envelope = encryptPayload({ actor, action }, cipherKey);
      const res = await this.httpPostJson(
        `http://${hostEndpoint.host}:${hostEndpoint.port}/api/action`,
        { envelope },
        { 'x-treenote-auth': authToken }
      );
      return res;
    } catch (err) {
      return { ok: false, error: `호스트에 요청을 전달하지 못했습니다: ${err.message}` };
    }
  }

  applyRoomActionInternal(room, action, actor, isHostActor) {
    if (!action || typeof action !== 'object') {
      return { ok: false, error: '잘못된 요청입니다.' };
    }

    const isOwner = isHostActor || actor.uid === room.hostProfile?.uid;
    const perm = room.permissionMode || 'all';

    // Check readonly mode (except chat messages which are still allowed in readonly rooms)
    if (perm === 'readonly' && !isOwner && action.type !== 'SEND_CHAT') {
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

        const firstLine = (msg.text || '채팅에서 박제된 노트').split(/\r?\n/)[0].slice(0, 50);
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
            imageDataUrl: msg.imageDataUrl || '',
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
        break;
      }

      default:
        return { ok: false, error: '알 수 없는 작업입니다.' };
    }

    this.persistHostedRoom(room);
    this.broadcastRoomUpdate();
    return { ok: true };
  }

  async leaveCurrentRoom() {
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
