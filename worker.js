/**
 * ============================================================================
 *  بوت تواصل مجهول  -  Cloudflare Worker  (قاعدة بيانات D1)
 * ============================================================================
 *  الفكرة: اي شخص يراسل البوت، فتصل رسالته للمالك بدون ان تظهر هويته.
 *  المالك يرد بمجرد عمل Reply على الرسالة فيصل الرد للشخص.
 *
 *  المتطلبات (Bindings / Variables):
 *    DB               قاعدة بيانات D1 (الجداول تُنشأ تلقائيا)
 *    BOT_TOKEN        توكن البوت (Secret)
 *    OWNER_ID         ايدي المالك الرقمي
 *    BROADCAST_BATCH  اختياري: عدد المستلمين في كل دفعة اذاعة (الافتراضي 35)
 *
 *  بعد النشر افتح:  https://اسم-الوركر.workers.dev/setup   لتفعيل الويب هوك.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
//  ثوابت
// ----------------------------------------------------------------------------
const TZ_OFFSET_HOURS = 3; // توقيت العراق (UTC+3 بدون توقيت صيفي)
const WEEKDAYS = ['الاحد', 'الاثنين', 'الثلاثاء', 'الاربعاء', 'الخميس', 'الجمعة', 'السبت'];

const COLOR_LABEL = { none: 'بدون لون', blue: 'ازرق', green: 'اخضر', red: 'احمر' };
const COLOR_STYLE = { blue: 'primary', green: 'success', red: 'danger' };
const COLOR_ORDER = ['none', 'blue', 'green', 'red'];

const CAPTION_TYPES = ['photo', 'video', 'animation', 'document', 'audio', 'voice'];
const EDITABLE_MEDIA = ['photo', 'video', 'animation', 'document', 'audio'];
const SPOILER_TYPES = ['photo', 'video', 'animation'];
const SEND_METHOD = {
  photo: ['sendPhoto', 'photo'],
  video: ['sendVideo', 'video'],
  animation: ['sendAnimation', 'animation'],
  document: ['sendDocument', 'document'],
  audio: ['sendAudio', 'audio'],
  voice: ['sendVoice', 'voice'],
  video_note: ['sendVideoNote', 'video_note'],
  sticker: ['sendSticker', 'sticker'],
};
const TYPE_LABEL = {
  text: 'نص',
  photo: 'صورة',
  video: 'فيديو',
  animation: 'متحركة (GIF)',
  document: 'ملف',
  audio: 'ملف صوتي',
  voice: 'رسالة صوتية',
  video_note: 'فيديو دائري',
  sticker: 'ملصق',
};

const DEFAULT_WELCOME = {
  t: 'text',
  x: 'مرحبا بك {name}.\nاكتب رسالتك هنا وستصل الي بشكل مجهول تماما، وساقوم بالرد عليك في اقرب وقت.',
  e: [],
};
const DEFAULT_SUB = {
  t: 'text',
  x: 'للاستمرار في استخدام البوت يجب عليك الاشتراك في القنوات والمجموعات التالية، ثم اضغط على زر التحقق.',
  e: [],
};

const DEFAULTS = {
  enabled: '1',
  welcome: JSON.stringify(DEFAULT_WELCOME),
  off_msg: 'البوت متوقف مؤقتا. حاول مرة اخرى لاحقا.',
  sent_msg: 'تم ارسال رسالتك بنجاح.',
  ban_msg: 'تم حظرك من استخدام هذا البوت.',
  rate_msg: 'ارسلت رسائل كثيرة بسرعة. انتظر قليلا ثم حاول مرة اخرى.',
  deny_msg: 'هذا النوع من الرسائل غير مسموح به.',
  sub_enabled: '1',
  sub_msg: JSON.stringify(DEFAULT_SUB),
  sub_mode: 'buttons', // buttons | text
  sub_color: 'blue',
  sub_check_color: 'green',
  sub_check_label: 'تحقق من الاشتراك',
  sub_cache: '120',
  back_label: 'رجوع',
  back_color: 'none',
  confirm_on: '1',
  reply_ok: '1',
  header_mode: 'message', // message | button
  time_style: 'detailed', // detailed | ampm
  rate_limit: '15',
  text_only: '0',
  block_links: '0',
};

const TOGGLE_LABEL = {
  sub_enabled: 'الاشتراك الاجباري',
  confirm_on: 'تأكيد الاستلام للمرسل',
  reply_ok: 'اشعار نجاح الرد للمالك',
  text_only: 'قبول النصوص فقط (منع الوسائط)',
  block_links: 'منع الروابط من المرسلين',
};
const CYCLES = {
  header_mode: { label: 'طريقة عرض الوقت', opts: [['message', 'رسالة منفصلة'], ['button', 'زر مدمج']] },
  time_style: { label: 'صيغة الوقت', opts: [['detailed', 'تفصيلية (ليلا/فجرا/ظهرا)'], ['ampm', 'صباحا ومساء']] },
  sub_mode: { label: 'طريقة عرض الاشتراك', opts: [['buttons', 'نوافذ (ازرار)'], ['text', 'رسالة نصية']] },
};
const TEXT_KEYS = {
  off_msg: 'رسالة ايقاف البوت',
  sent_msg: 'رسالة تأكيد الاستلام',
  ban_msg: 'رسالة المحظور',
  rate_msg: 'رسالة تجاوز الحد',
  deny_msg: 'رسالة منع نوع الرسالة',
  sub_check_label: 'نص زر التحقق',
  back_label: 'نص زر الرجوع',
};
const NUM_KEYS = { rate_limit: 'عدد الرسائل المسموح بالدقيقة (0 = بدون حد)' };
const COLOR_KEYS = {
  sub_color: 'لون ازرار القنوات',
  sub_check_color: 'لون زر التحقق',
  back_color: 'لون زر الرجوع',
};
const CLEARABLE = ['off_msg', 'sent_msg', 'ban_msg', 'rate_msg', 'deny_msg'];
const SCREEN_OF = {
  off_msg: 'msgs', sent_msg: 'msgs', ban_msg: 'msgs', rate_msg: 'msgs', deny_msg: 'msgs',
  sub_check_label: 'subs', sub_color: 'subs', sub_check_color: 'subs', sub_mode: 'subs',
  back_label: 'sys', back_color: 'sys',
  rate_limit: 'set', header_mode: 'set', time_style: 'set', confirm_on: 'set', reply_ok: 'set',
  text_only: 'set', block_links: 'set', sub_enabled: 'sub',
};

const UNSUPPORTED =
  'هذا النوع غير مدعوم هنا. ارسل نصا او صورة او فيديو او ملفا او متحركة او ملصقا او رسالة صوتية.';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, code TEXT UNIQUE, first_seen INTEGER, last_seen INTEGER,
    msgs INTEGER DEFAULT 0, banned INTEGER DEFAULT 0, blocked INTEGER DEFAULT 0,
    sub_ok_until INTEGER DEFAULT 0, last_ack INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS msgmap (
    owner_msg_id INTEGER PRIMARY KEY, user_id INTEGER, user_msg_id INTEGER, created INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_msgmap_user ON msgmap(user_id, user_msg_id)`,
  `CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, chat_id TEXT, title TEXT, link TEXT,
    color TEXT, last_error TEXT, pos INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS buttons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, parent INTEGER DEFAULT 0, label TEXT, kind TEXT,
    url TEXT, content TEXT, color TEXT DEFAULT 'none', row_no REAL DEFAULT 0, pos REAL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_buttons_parent ON buttons(parent)`,
  `CREATE TABLE IF NOT EXISTS state (uid INTEGER PRIMARY KEY, name TEXT, data TEXT, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, src_chat INTEGER, src_msg INTEGER, mode TEXT,
    silent INTEGER DEFAULT 0, status TEXT, total INTEGER DEFAULT 0, sent INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0, blocked INTEGER DEFAULT 0, cursor INTEGER DEFAULT 0,
    status_msg INTEGER, lock_until INTEGER DEFAULT 0, created INTEGER, finished INTEGER)`,
  `CREATE TABLE IF NOT EXISTS rate (uid INTEGER, win INTEGER, cnt INTEGER, PRIMARY KEY (uid, win))`,
  `CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, msgs INTEGER DEFAULT 0)`,
];

// ----------------------------------------------------------------------------
//  ادوات عامة
// ----------------------------------------------------------------------------
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (s, n) => {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '...' : s;
};
function parseJson(s, d = null) {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
}
function randCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => chars[b % chars.length]).join('');
}
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function webhookSecret(env) {
  return (await sha256Hex('wh:' + env.BOT_TOKEN)).slice(0, 48);
}
const botId = (env) => Number(String(env.BOT_TOKEN).split(':')[0]);
const batchSize = (env) => Math.max(5, Math.min(2000, parseInt(env.BROADCAST_BATCH, 10) || 35));

// ----------------------------------------------------------------------------
//  الوقت بتوقيت العراق
// ----------------------------------------------------------------------------
function iraqParts(ts) {
  const d = new Date((ts + TZ_OFFSET_HOURS * 3600) * 1000);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    H: d.getUTCHours(), M: d.getUTCMinutes(), wd: d.getUTCDay(),
  };
}
function fmtTime(ts, style) {
  const p = iraqParts(ts);
  const h12 = p.H % 12 || 12;
  const mm = String(p.M).padStart(2, '0');
  let period;
  if (style === 'ampm') {
    period = p.H < 12 ? 'صباحا' : 'مساء';
  } else {
    const t = p.H * 60 + p.M;
    if (t < 270) period = 'ليلا';
    else if (t < 360) period = 'فجرا';
    else if (t < 720) period = 'صباحا';
    else if (t < 900) period = 'ظهرا';
    else if (t < 1080) period = 'عصرا';
    else if (t < 1200) period = 'مساء';
    else period = 'ليلا';
  }
  return `${h12}:${mm} ${period}`;
}
function fmtDate(ts) {
  const p = iraqParts(ts);
  return `${WEEKDAYS[p.wd]} ${p.y}/${String(p.mo).padStart(2, '0')}/${String(p.d).padStart(2, '0')}`;
}
function dayKey(ts) {
  const p = iraqParts(ts);
  return `${p.y}${String(p.mo).padStart(2, '0')}${String(p.d).padStart(2, '0')}`;
}
function startOfDay(ts) {
  return Math.floor((ts + TZ_OFFSET_HOURS * 3600) / 86400) * 86400 - TZ_OFFSET_HOURS * 3600;
}

// ----------------------------------------------------------------------------
//  قاعدة البيانات
// ----------------------------------------------------------------------------
const dbReady = new WeakSet();
async function initDb(env) {
  if (dbReady.has(env.DB)) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  dbReady.add(env.DB);
}
function dbHelper(env) {
  const prep = (sql, p) => env.DB.prepare(sql).bind(...p.map((v) => (v === undefined ? null : v)));
  return {
    all: async (sql, ...p) => (await prep(sql, p).all()).results || [],
    one: async (sql, ...p) => (await prep(sql, p).first()) || null,
    run: async (sql, ...p) => prep(sql, p).run(),
    batch: async (list) => (list.length ? env.DB.batch(list.map(([sql, ...p]) => prep(sql, p))) : []),
  };
}
async function loadSettings(env) {
  const rows = (await env.DB.prepare('SELECT k, v FROM settings').all()).results || [];
  const S = { ...DEFAULTS };
  for (const r of rows) S[r.k] = r.v;
  return S;
}
async function setSetting(c, k, v) {
  v = String(v);
  await c.db.run('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v);
  c.S[k] = v;
}
async function getState(c) {
  const r = await c.db.one('SELECT name, data FROM state WHERE uid = ?', c.ownerId);
  return r ? { name: r.name, data: parseJson(r.data, {}) } : null;
}
async function setState(c, name, data = {}) {
  await c.db.run(
    'INSERT INTO state (uid, name, data, updated) VALUES (?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET name = excluded.name, data = excluded.data, updated = excluded.updated',
    c.ownerId, name, JSON.stringify(data), now(),
  );
}
async function clearState(c) {
  await c.db.run('DELETE FROM state WHERE uid = ?', c.ownerId);
}

// ----------------------------------------------------------------------------
//  Telegram API
// ----------------------------------------------------------------------------
function stripStyle(markup) {
  if (!markup || !markup.inline_keyboard) return markup;
  return {
    ...markup,
    inline_keyboard: markup.inline_keyboard.map((row) =>
      row.map((b) => {
        const { style, ...rest } = b;
        return rest;
      }),
    ),
  };
}
const hasStyle = (m) => !!(m && m.inline_keyboard && m.inline_keyboard.some((r) => r.some((b) => b.style)));

async function tg(env, method, payload = {}, opts = {}) {
  const retries = opts.retries ?? 1;
  const send = async (body) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => null);
      return j || { ok: false, error_code: res.status, description: 'bad response' };
    } catch (e) {
      return { ok: false, error_code: 0, description: 'network: ' + (e && e.message) };
    }
  };
  let body = payload;
  if (globalThis.__noStyle && hasStyle(body.reply_markup)) body = { ...body, reply_markup: stripStyle(body.reply_markup) };
  let r = await send(body);
  if (!r.ok && r.error_code === 400 && hasStyle(body.reply_markup) && /style|button|markup|keyboard/i.test(r.description || '')) {
    globalThis.__noStyle = true;
    r = await send({ ...body, reply_markup: stripStyle(body.reply_markup) });
  }
  if (!r.ok && r.error_code === 429 && retries > 0) {
    const wait = (r.parameters && r.parameters.retry_after) || 1;
    if (wait <= (opts.maxWait ?? 5)) {
      await sleep(wait * 1000 + 100);
      return tg(env, method, body, { ...opts, retries: retries - 1 });
    }
  }
  return r;
}

const cb = (text, data, color) => {
  const b = { text: String(text), callback_data: data };
  if (COLOR_STYLE[color]) b.style = COLOR_STYLE[color];
  return b;
};
const ub = (text, url, color) => {
  const b = { text: String(text), url };
  if (COLOR_STYLE[color]) b.style = COLOR_STYLE[color];
  return b;
};
const ans = (c, id, text, alert) =>
  tg(c.env, 'answerCallbackQuery', { callback_query_id: id, text: text || undefined, show_alert: alert ? true : undefined });
const replyTo = (id) => ({ message_id: id, allow_sending_without_reply: true });

async function sendPlain(c, chatId, text, extra = {}) {
  if (!text) return null;
  return tg(c.env, 'sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true }, ...extra });
}
/** يعرض واجهة للمالك: تعديل رسالة اللوحة الحالية او ارسال رسالة جديدة */
async function ui(c, text, rows) {
  const markup = rows ? { inline_keyboard: rows } : undefined;
  if (c.cbMsg && c.cbMsg.chat) {
    const r = await tg(c.env, 'editMessageText', {
      chat_id: c.cbMsg.chat.id, message_id: c.cbMsg.message_id, text, parse_mode: 'HTML',
      reply_markup: markup, link_preview_options: { is_disabled: true },
    });
    if (r.ok || /not modified/i.test(r.description || '')) return;
  }
  await tg(c.env, 'sendMessage', {
    chat_id: c.ownerId, text, parse_mode: 'HTML', reply_markup: markup, link_preview_options: { is_disabled: true },
  });
}

// ----------------------------------------------------------------------------
//  المحتوى (نص / وسائط) + المتغيرات
// ----------------------------------------------------------------------------
function captureContent(msg) {
  const clean = (e) => (e || []).filter((x) => x.type !== 'custom_emoji');
  if (msg.text) return { t: 'text', x: msg.text, e: clean(msg.entities) };
  const cap = { x: msg.caption || '', e: clean(msg.caption_entities), sp: !!msg.has_media_spoiler, ca: !!msg.show_caption_above_media };
  if (msg.photo && msg.photo.length) return { t: 'photo', f: msg.photo[msg.photo.length - 1].file_id, ...cap };
  if (msg.animation) return { t: 'animation', f: msg.animation.file_id, ...cap };
  if (msg.video) return { t: 'video', f: msg.video.file_id, ...cap };
  if (msg.document) return { t: 'document', f: msg.document.file_id, ...cap };
  if (msg.audio) return { t: 'audio', f: msg.audio.file_id, ...cap };
  if (msg.voice) return { t: 'voice', f: msg.voice.file_id, ...cap };
  if (msg.video_note) return { t: 'video_note', f: msg.video_note.file_id };
  if (msg.sticker) return { t: 'sticker', f: msg.sticker.file_id };
  return null;
}
function msgType(m) {
  if (m.text !== undefined) return 'text';
  for (const k of ['animation', 'photo', 'video', 'document', 'audio', 'voice', 'video_note', 'sticker']) if (m[k]) return k;
  return 'other';
}
function applyVars(text, entities, vars) {
  if (!text || text.indexOf('{') === -1) return { text, entities };
  const re = /\{(name|date|time)\}/g;
  let out = '';
  let last = 0;
  const shifts = [];
  for (const m of text.matchAll(re)) {
    const rep = String(vars[m[1]] ?? '');
    out += text.slice(last, m.index) + rep;
    last = m.index + m[0].length;
    shifts.push({ s: m.index, e: last, d: rep.length - m[0].length });
  }
  if (!shifts.length) return { text, entities };
  out += text.slice(last);
  const map = (p) => {
    let d = 0;
    for (const sh of shifts) {
      if (sh.e <= p) d += sh.d;
      else break;
    }
    return p + d;
  };
  const ents = (entities || [])
    .map((en) => {
      const s = map(en.offset);
      const e = map(en.offset + en.length);
      return { ...en, offset: s, length: Math.max(0, e - s) };
    })
    .filter((en) => en.length > 0);
  return { text: out, entities: ents };
}
function withVars(content, vars) {
  if (!content || !content.x) return content;
  const r = applyVars(content.x, content.e, vars || {});
  return { ...content, x: r.text, e: r.entities };
}
function mkVars(from) {
  const t = now();
  return { name: (from && from.first_name) || '', date: fmtDate(t), time: '' };
}
function varsFor(c, from) {
  const v = mkVars(from);
  v.time = fmtTime(now(), c.S.time_style);
  return v;
}

async function sendContent(c, chatId, content, markup, extra = {}) {
  const base = { chat_id: chatId, ...extra };
  if (markup) base.reply_markup = markup;
  const ents = content.e && content.e.length ? content.e : undefined;
  if (content.t === 'text') {
    return tg(c.env, 'sendMessage', { ...base, text: content.x || ' ', entities: ents, link_preview_options: { is_disabled: true } });
  }
  const sm = SEND_METHOD[content.t];
  if (!sm) return { ok: false, description: 'unsupported type' };
  const [method, field] = sm;
  const p = { ...base, [field]: content.f };
  if (CAPTION_TYPES.includes(content.t) && content.x) {
    if (content.x.length <= 1024) {
      p.caption = content.x;
      if (ents) p.caption_entities = ents;
    } else {
      // كابشن طويل: ارسل الوسائط ثم النص
      await tg(c.env, method, { chat_id: chatId, [field]: content.f, ...extra });
      return tg(c.env, 'sendMessage', { ...base, text: content.x, entities: ents, link_preview_options: { is_disabled: true } });
    }
  }
  if (SPOILER_TYPES.includes(content.t)) {
    if (content.sp) p.has_spoiler = true;
    if (content.ca && p.caption) p.show_caption_above_media = true;
  }
  return tg(c.env, method, p);
}

/** يعرض محتوى: يعدل الرسالة الحالية اذا امكن، والا يحذفها ويرسل جديدة */
async function renderContent(c, chatId, existing, content, markup, vars) {
  const cc = withVars(content, vars);
  if (existing && existing.date !== 0 && existing.message_id) {
    const et = msgType(existing);
    const ents = cc.e && cc.e.length ? cc.e : undefined;
    const mk = markup || { inline_keyboard: [] };
    let r = null;
    if (cc.t === 'text' && et === 'text') {
      r = await tg(c.env, 'editMessageText', {
        chat_id: chatId, message_id: existing.message_id, text: cc.x || ' ', entities: ents,
        link_preview_options: { is_disabled: true }, reply_markup: mk,
      });
    } else if (EDITABLE_MEDIA.includes(cc.t) && EDITABLE_MEDIA.includes(et) && (!cc.x || cc.x.length <= 1024)) {
      const media = { type: cc.t, media: cc.f };
      if (cc.x) {
        media.caption = cc.x;
        if (ents) media.caption_entities = ents;
      }
      if (SPOILER_TYPES.includes(cc.t)) {
        if (cc.sp) media.has_spoiler = true;
        if (cc.ca && cc.x) media.show_caption_above_media = true;
      }
      r = await tg(c.env, 'editMessageMedia', { chat_id: chatId, message_id: existing.message_id, media, reply_markup: mk });
    }
    if (r && (r.ok || /not modified/i.test(r.description || ''))) return r;
    await tg(c.env, 'deleteMessage', { chat_id: chatId, message_id: existing.message_id });
  }
  return sendContent(c, chatId, cc, markup);
}

// ----------------------------------------------------------------------------
//  ازرار الترحيب والنوافذ الداخلية
// ----------------------------------------------------------------------------
async function nodeMarkup(c, nodeId) {
  const rows = await c.db.all('SELECT * FROM buttons WHERE parent = ? ORDER BY row_no, pos, id', nodeId);
  const kb = [];
  let cur = null;
  let curRow = null;
  for (const b of rows) {
    if (curRow !== b.row_no) {
      cur = [];
      kb.push(cur);
      curRow = b.row_no;
    }
    cur.push(b.kind === 'url' ? ub(b.label, b.url, b.color) : cb(b.label, 'pg:' + b.id, b.color));
  }
  if (nodeId !== 0) {
    const node = await c.db.one('SELECT parent FROM buttons WHERE id = ?', nodeId);
    kb.push([cb(c.S.back_label || 'رجوع', 'bk:' + (node ? node.parent : 0), c.S.back_color)]);
  }
  return kb.length ? { inline_keyboard: kb } : undefined;
}
async function nodeContent(c, nodeId) {
  if (nodeId === 0) return parseJson(c.S.welcome, DEFAULT_WELCOME);
  const b = await c.db.one('SELECT content FROM buttons WHERE id = ?', nodeId);
  return b ? parseJson(b.content, null) : null;
}
async function showNode(c, chatId, existing, nodeId, from) {
  const content = await nodeContent(c, nodeId);
  if (!content) return null;
  const markup = await nodeMarkup(c, nodeId);
  return renderContent(c, chatId, existing, content, markup, varsFor(c, from));
}
async function showWelcome(c, chatId, from) {
  return showNode(c, chatId, null, 0, from);
}

async function normalizeLayout(c, parent) {
  const list = await c.db.all('SELECT id, row_no, pos FROM buttons WHERE parent = ? ORDER BY row_no, pos, id', parent);
  const stm = [];
  let row = -1;
  let last = null;
  let pos = 0;
  for (const b of list) {
    if (b.row_no !== last) {
      row++;
      last = b.row_no;
      pos = 0;
    }
    stm.push(['UPDATE buttons SET row_no = ?, pos = ? WHERE id = ?', row, pos, b.id]);
    pos++;
  }
  await c.db.batch(stm);
}
async function moveButton(c, id, dir) {
  const b = await c.db.one('SELECT id, parent FROM buttons WHERE id = ?', id);
  if (!b) return;
  const list = await c.db.all('SELECT id, row_no, pos FROM buttons WHERE parent = ? ORDER BY row_no, pos, id', b.parent);
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  await c.db.batch([
    ['UPDATE buttons SET row_no = ?, pos = ? WHERE id = ?', list[j].row_no, list[j].pos, list[i].id],
    ['UPDATE buttons SET row_no = ?, pos = ? WHERE id = ?', list[i].row_no, list[i].pos, list[j].id],
  ]);
  await normalizeLayout(c, b.parent);
}
async function toggleRow(c, id) {
  const b = await c.db.one('SELECT * FROM buttons WHERE id = ?', id);
  if (!b) return false;
  const list = await c.db.all('SELECT id, row_no, pos FROM buttons WHERE parent = ? ORDER BY row_no, pos, id', b.parent);
  const sameRow = list.filter((x) => x.row_no === b.row_no);
  if (sameRow.length > 1) {
    await c.db.run('UPDATE buttons SET row_no = ?, pos = 0 WHERE id = ?', b.row_no + 0.5, id);
  } else {
    const prev = list.filter((x) => x.row_no < b.row_no).pop();
    if (!prev) return false;
    const inPrev = list.filter((x) => x.row_no === prev.row_no);
    if (inPrev.length >= 8) return false;
    await c.db.run('UPDATE buttons SET row_no = ?, pos = ? WHERE id = ?', prev.row_no, inPrev.length + 1, id);
  }
  await normalizeLayout(c, b.parent);
  return true;
}
async function deleteButtonTree(c, id) {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) {
    const kids = await c.db.all('SELECT id FROM buttons WHERE parent = ?', ids[i]);
    for (const k of kids) ids.push(k.id);
  }
  await c.db.batch(ids.map((x) => ['DELETE FROM buttons WHERE id = ?', x]));
}
async function createButton(c, d, placement) {
  const cnt = await c.db.one('SELECT COUNT(*) AS n FROM buttons WHERE parent = ?', d.parent);
  const last = await c.db.one(
    'SELECT row_no, MAX(pos) AS mp, COUNT(*) AS n FROM buttons WHERE parent = ? GROUP BY row_no ORDER BY row_no DESC LIMIT 1',
    d.parent,
  );
  let row = 0;
  let pos = 0;
  if (last) {
    if (placement === 'same' && last.n < 8) {
      row = last.row_no;
      pos = last.mp + 1;
    } else {
      row = last.row_no + 1;
    }
  }
  await c.db.run(
    'INSERT INTO buttons (parent, label, kind, url, content, color, row_no, pos) VALUES (?,?,?,?,?,?,?,?)',
    d.parent, d.label, d.kind, d.url || null, d.content || null, d.color || 'none', row, pos,
  );
  return cnt ? cnt.n + 1 : 1;
}

// ----------------------------------------------------------------------------
//  الاشتراك الاجباري
// ----------------------------------------------------------------------------
async function getMissing(c, uid) {
  if (c.S.sub_enabled !== '1') return [];
  const items = await c.db.all('SELECT * FROM channels ORDER BY pos, id');
  const verifiable = items.filter((i) => i.kind === 'chat');
  if (!verifiable.length) return [];
  const missingIds = new Set();
  await Promise.all(
    verifiable.map(async (ch) => {
      const r = await tg(c.env, 'getChatMember', { chat_id: ch.chat_id, user_id: uid });
      if (!r.ok) {
        const err = clip(r.description || 'error', 120);
        if (ch.last_error !== err) await c.db.run('UPDATE channels SET last_error = ? WHERE id = ?', err, ch.id);
        return; // لا نمنع المستخدمين اذا تعذر الفحص
      }
      if (ch.last_error) await c.db.run('UPDATE channels SET last_error = NULL WHERE id = ?', ch.id);
      const st = r.result.status;
      const ok = st === 'creator' || st === 'administrator' || st === 'member' || (st === 'restricted' && r.result.is_member);
      if (!ok) missingIds.add(ch.id);
    }),
  );
  if (!missingIds.size) return [];
  return items.filter((i) => i.kind === 'link' || missingIds.has(i.id));
}
async function renderGate(c, chatId, existing, list, from) {
  let content = parseJson(c.S.sub_msg, DEFAULT_SUB);
  let mode = c.S.sub_mode;
  if (content.t === 'sticker' || content.t === 'video_note') mode = 'buttons';
  const rows = [];
  if (mode === 'text') {
    const lines = list.map((i, n) => `${n + 1}. ${i.title}\n${i.link}`).join('\n\n');
    content = { ...content, x: (content.x || '') + (content.x ? '\n\n' : '') + lines };
  } else {
    for (const i of list) rows.push([ub(i.title, i.link, i.color || c.S.sub_color)]);
  }
  rows.push([cb(c.S.sub_check_label || 'تحقق من الاشتراك', 'chk', c.S.sub_check_color)]);
  return renderContent(c, chatId, existing, content, { inline_keyboard: rows }, varsFor(c, from));
}
async function passGate(c, u, chatId, from) {
  if (c.S.sub_enabled !== '1') return true;
  if (u.sub_ok_until > now()) return true;
  const list = await getMissing(c, u.id);
  if (!list.length) {
    await c.db.run('UPDATE users SET sub_ok_until = ? WHERE id = ?', now() + (parseInt(c.S.sub_cache, 10) || 120), u.id);
    return true;
  }
  await renderGate(c, chatId, null, list, from);
  return false;
}

// ----------------------------------------------------------------------------
//  جهة المستخدم
// ----------------------------------------------------------------------------
async function touchUser(c, from) {
  const t = now();
  let u = await c.db.one('SELECT * FROM users WHERE id = ?', from.id);
  if (!u) {
    for (let i = 0; i < 6; i++) {
      try {
        await c.db.run('INSERT INTO users (id, code, first_seen, last_seen) VALUES (?,?,?,?)', from.id, randCode(), t, t);
        break;
      } catch (e) {
        /* الكود مكرر: حاول مرة اخرى */
      }
    }
    u = await c.db.one('SELECT * FROM users WHERE id = ?', from.id);
  } else {
    await c.db.run('UPDATE users SET last_seen = ?, blocked = 0 WHERE id = ?', t, from.id);
    u.blocked = 0;
  }
  return u;
}
async function rateExceeded(c, uid) {
  const limit = parseInt(c.S.rate_limit, 10) || 0;
  if (!limit) return false;
  const win = Math.floor(now() / 60);
  await c.db.run('INSERT INTO rate (uid, win, cnt) VALUES (?, ?, 1) ON CONFLICT(uid, win) DO UPDATE SET cnt = cnt + 1', uid, win);
  const r = await c.db.one('SELECT cnt FROM rate WHERE uid = ? AND win = ?', uid, win);
  return !!r && r.cnt > limit;
}
function hasLink(msg) {
  const ents = [...(msg.entities || []), ...(msg.caption_entities || [])];
  return ents.some((e) => e.type === 'url' || e.type === 'text_link');
}

async function userMessage(c, msg, edited) {
  const chatId = msg.chat.id;
  const u = await touchUser(c, msg.from);
  if (u.banned) {
    if (!edited) await sendPlain(c, chatId, c.S.ban_msg);
    return;
  }
  if (c.S.enabled !== '1') {
    if (!edited) await sendPlain(c, chatId, c.S.off_msg);
    return;
  }
  if (!edited) {
    const ok = await passGate(c, u, chatId, msg.from);
    if (!ok) return;
  }
  if (!edited && msg.text && /^\/start(@\w+)?(\s|$)/i.test(msg.text)) {
    await showWelcome(c, chatId, msg.from);
    return;
  }
  if (c.S.text_only === '1' && !msg.text) {
    if (!edited) await sendPlain(c, chatId, c.S.deny_msg);
    return;
  }
  if (c.S.block_links === '1' && hasLink(msg)) {
    if (!edited) await sendPlain(c, chatId, c.S.deny_msg);
    return;
  }
  if (!edited && (await rateExceeded(c, u.id))) {
    await sendPlain(c, chatId, c.S.rate_msg);
    return;
  }
  const ok = await forwardToOwner(c, u, msg, edited);
  if (ok && !edited && c.S.confirm_on === '1' && c.S.sent_msg && now() - (u.last_ack || 0) >= 15) {
    await c.db.run('UPDATE users SET last_ack = ? WHERE id = ?', now(), u.id);
    await sendPlain(c, chatId, c.S.sent_msg, { reply_parameters: replyTo(msg.message_id) });
  }
}

async function forwardToOwner(c, u, msg, edited) {
  const ts = edited ? msg.edit_date || now() : msg.date || now();
  const t = fmtTime(ts, c.S.time_style);
  const d = fmtDate(ts);
  let count = u.msgs || 0;
  if (!edited) {
    await c.db.run('UPDATE users SET msgs = msgs + 1 WHERE id = ?', u.id);
    await c.db.run('INSERT INTO daily (day, msgs) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET msgs = msgs + 1', dayKey(ts));
    count++;
  }
  let replyId = null;
  if (edited) {
    const m = await c.db.one(
      'SELECT owner_msg_id FROM msgmap WHERE user_id = ? AND user_msg_id = ? ORDER BY owner_msg_id DESC LIMIT 1',
      u.id, msg.message_id,
    );
    replyId = m ? m.owner_msg_id : null;
  }
  const banRow = [cb('حظر المرسل', 'a:ban:' + u.code, 'red')];
  const owner = c.ownerId;
  const map = [];
  let copy;
  let headerId = null;
  if (c.S.header_mode === 'button') {
    const info = `${edited ? 'تعديل - ' : ''}مجهول ${u.code} - ${t}`;
    copy = await tg(c.env, 'copyMessage', {
      chat_id: owner, from_chat_id: u.id, message_id: msg.message_id,
      reply_markup: { inline_keyboard: [[cb(info, 'noop')], banRow] },
      reply_parameters: replyId ? replyTo(replyId) : undefined,
    });
  } else {
    const head =
      `<b>${edited ? 'تعديل رسالة من' : 'رسالة جديدة من'} مجهول</b> <code>${esc(u.code)}</code>\n` +
      `الوقت: <b>${esc(t)}</b>\nالتاريخ: ${esc(d)}` +
      (edited ? '' : `\nرقم الرسالة: ${count}`);
    const h = await tg(c.env, 'sendMessage', {
      chat_id: owner, text: head, parse_mode: 'HTML', reply_markup: { inline_keyboard: [banRow] },
      reply_parameters: replyId ? replyTo(replyId) : undefined,
    });
    if (!h.ok) {
      console.error('owner unreachable', h.description);
      return false;
    }
    headerId = h.result.message_id;
    map.push(['INSERT OR REPLACE INTO msgmap (owner_msg_id, user_id, user_msg_id, created) VALUES (?,?,?,?)', headerId, u.id, msg.message_id, now()]);
    copy = await tg(c.env, 'copyMessage', {
      chat_id: owner, from_chat_id: u.id, message_id: msg.message_id, reply_parameters: replyTo(headerId),
    });
  }
  if (copy.ok) {
    map.push(['INSERT OR REPLACE INTO msgmap (owner_msg_id, user_id, user_msg_id, created) VALUES (?,?,?,?)', copy.result.message_id, u.id, msg.message_id, now()]);
  } else {
    await sendPlain(c, owner, `وصلت رسالة من مجهول ${u.code} لكن لا يمكن عرضها (نوع غير مدعوم).`, headerId ? { reply_parameters: replyTo(headerId) } : {});
  }
  await c.db.batch(map);
  return copy.ok || headerId !== null;
}

async function onMyChatMember(c, upd) {
  if (!upd.chat || upd.chat.type !== 'private' || upd.chat.id === c.ownerId) return;
  const st = upd.new_chat_member && upd.new_chat_member.status;
  await c.db.run('UPDATE users SET blocked = ? WHERE id = ?', st === 'kicked' || st === 'left' ? 1 : 0, upd.chat.id);
}

// ----------------------------------------------------------------------------
//  استقبال التحديثات
// ----------------------------------------------------------------------------
async function handleUpdate(env, ec, update) {
  await initDb(env);
  const c = { env, ec, db: dbHelper(env), S: await loadSettings(env), ownerId: Number(String(env.OWNER_ID).trim()) };
  if (update.message) return onMessage(c, update.message, false);
  if (update.edited_message) return onMessage(c, update.edited_message, true);
  if (update.callback_query) return onCallback(c, update.callback_query);
  if (update.my_chat_member) return onMyChatMember(c, update.my_chat_member);
}
async function onMessage(c, msg, edited) {
  if (!msg.chat || msg.chat.type !== 'private' || !msg.from || msg.from.is_bot) return;
  if (msg.from.id === c.ownerId) {
    if (!edited) return ownerMessage(c, msg);
    return;
  }
  return userMessage(c, msg, edited);
}

async function onCallback(c, q) {
  const data = q.data || '';
  c.cbMsg = q.message && q.message.chat ? q.message : null;
  if (q.from.id === c.ownerId && data.startsWith('a:')) return ownerCallback(c, q, data);
  if (data === 'noop') return ans(c, q.id);
  const isOwner = q.from.id === c.ownerId;
  let u = null;
  if (!isOwner) {
    u = await touchUser(c, q.from);
    if (u.banned) return ans(c, q.id, c.S.ban_msg || 'محظور', true);
    if (c.S.enabled !== '1') return ans(c, q.id, c.S.off_msg || 'البوت متوقف', true);
  }
  const chatId = c.cbMsg ? c.cbMsg.chat.id : q.from.id;
  if (data === 'chk') {
    if (isOwner) return ans(c, q.id, 'هذه معاينة فقط', true);
    const list = await getMissing(c, q.from.id);
    if (!list.length) {
      await c.db.run('UPDATE users SET sub_ok_until = ? WHERE id = ?', now() + (parseInt(c.S.sub_cache, 10) || 120), q.from.id);
      await ans(c, q.id, 'تم التحقق من اشتراكك بنجاح');
      if (c.cbMsg) await tg(c.env, 'deleteMessage', { chat_id: chatId, message_id: c.cbMsg.message_id });
      await showWelcome(c, chatId, q.from);
    } else {
      await ans(c, q.id, 'لم تشترك بعد في جميع القنوات المطلوبة', true);
      await renderGate(c, chatId, c.cbMsg, list, q.from);
    }
    return;
  }
  const m = data.match(/^(pg|bk):(\d+)$/);
  if (m) {
    const nodeId = Number(m[2]);
    if (m[1] === 'pg') {
      const b = await c.db.one('SELECT id FROM buttons WHERE id = ?', nodeId);
      if (!b) return ans(c, q.id, 'هذا الزر لم يعد متاحا', true);
    }
    await ans(c, q.id);
    const r = await showNode(c, chatId, c.cbMsg, nodeId, q.from);
    if (!r && nodeId !== 0) await showNode(c, chatId, c.cbMsg, 0, q.from);
    return;
  }
  return ans(c, q.id);
}

// ----------------------------------------------------------------------------
//  رسائل المالك
// ----------------------------------------------------------------------------
const BAN_WORDS = ['حظر', 'ban', 'بلوك', 'block'];
const UNBAN_WORDS = ['الغاء الحظر', 'الغاء حظر', 'فك الحظر', 'رفع الحظر', 'unban'];

async function ownerMessage(c, msg) {
  const text = (msg.text || '').trim();
  if (/^\/cancel(@\w+)?$/i.test(text)) {
    await clearState(c);
    return scMain(c, 'تم الغاء العملية.');
  }
  if (/^\/(start|panel)(@\w+)?(\s|$)/i.test(text)) {
    await clearState(c);
    return scMain(c);
  }
  const st = await getState(c);
  if (st) return handleOwnerInput(c, msg, st);
  let m = text.match(/^\/ban(?:@\w+)?\s+(\S+)/i);
  if (m) return banByCode(c, m[1].toUpperCase(), true, msg.message_id);
  m = text.match(/^\/unban(?:@\w+)?\s+(\S+)/i);
  if (m) return banByCode(c, m[1].toUpperCase(), false, msg.message_id);
  if (/^\/stats(@\w+)?$/i.test(text)) return scStats(c);
  if (msg.reply_to_message) {
    const map = await c.db.one('SELECT * FROM msgmap WHERE owner_msg_id = ?', msg.reply_to_message.message_id);
    if (map) return ownerReply(c, msg, map);
  }
  await sendPlain(c, c.ownerId, 'لفتح لوحة التحكم ارسل /start\nللرد على مرسل: اعمل رد (Reply) على رسالته.\nللحظر: رد عليها بكلمة حظر. ولالغاء الحظر: رد عليها بكلمة الغاء الحظر.');
}

async function banByCode(c, code, ban, replyId) {
  const u = await c.db.one('SELECT id, code FROM users WHERE code = ?', code);
  if (!u) return sendPlain(c, c.ownerId, 'لم يتم العثور على مرسل بهذا الكود.', replyId ? { reply_parameters: replyTo(replyId) } : {});
  await c.db.run('UPDATE users SET banned = ? WHERE id = ?', ban ? 1 : 0, u.id);
  return sendPlain(c, c.ownerId, ban ? `تم حظر المرسل ${u.code}.` : `تم الغاء حظر المرسل ${u.code}.`, replyId ? { reply_parameters: replyTo(replyId) } : {});
}

async function ownerReply(c, msg, map) {
  const word = (msg.text || '').trim().replace(/^\//, '').toLowerCase();
  const user = await c.db.one('SELECT id, code FROM users WHERE id = ?', map.user_id);
  if (!user) return sendPlain(c, c.ownerId, 'المرسل غير موجود.');
  if (msg.text && BAN_WORDS.includes(word)) {
    await c.db.run('UPDATE users SET banned = 1 WHERE id = ?', user.id);
    return sendPlain(c, c.ownerId, `تم حظر المرسل ${user.code}.`, { reply_parameters: replyTo(msg.message_id) });
  }
  if (msg.text && UNBAN_WORDS.includes(word)) {
    await c.db.run('UPDATE users SET banned = 0 WHERE id = ?', user.id);
    return sendPlain(c, c.ownerId, `تم الغاء حظر المرسل ${user.code}.`, { reply_parameters: replyTo(msg.message_id) });
  }
  const r = await tg(c.env, 'copyMessage', {
    chat_id: user.id, from_chat_id: c.ownerId, message_id: msg.message_id,
    reply_parameters: replyTo(map.user_msg_id),
  });
  if (r.ok) {
    if (c.S.reply_ok === '1') await sendPlain(c, c.ownerId, `تم ارسال ردك الى ${user.code}.`, { reply_parameters: replyTo(msg.message_id) });
    return;
  }
  if (r.error_code === 403) {
    await c.db.run('UPDATE users SET blocked = 1 WHERE id = ?', user.id);
    return sendPlain(c, c.ownerId, `تعذر الارسال: المرسل ${user.code} قام بحظر البوت.`, { reply_parameters: replyTo(msg.message_id) });
  }
  return sendPlain(c, c.ownerId, `تعذر ارسال الرد: ${clip(r.description || 'خطأ غير معروف', 150)}`, { reply_parameters: replyTo(msg.message_id) });
}

// ----------------------------------------------------------------------------
//  مدخلات المالك (الحالات)
// ----------------------------------------------------------------------------
function parseChatRef(msg) {
  const fo = msg.forward_origin;
  if (fo && fo.type === 'channel' && fo.chat) return fo.chat.id;
  if (fo && fo.type === 'chat' && fo.sender_chat) return fo.sender_chat.id;
  if (msg.forward_from_chat) return msg.forward_from_chat.id;
  const t = (msg.text || '').trim();
  if (/^-?\d{5,}$/.test(t)) return Number(t);
  let m = t.match(/^@([A-Za-z0-9_]{4,})$/);
  if (m) return '@' + m[1];
  m = t.match(/^(?:https?:\/\/)?(?:t|telegram)\.me\/([A-Za-z0-9_]{4,})\/?$/);
  if (m && !/^joinchat$/i.test(m[1])) return '@' + m[1];
  return null;
}
const validUrl = (u) => /^(https?:\/\/|tg:\/\/)\S+$/i.test(u) || /^(t|telegram)\.me\/\S+$/i.test(u);
const fixUrl = (u) => (/^(t|telegram)\.me\//i.test(u) ? 'https://' + u : u);
const cancelRow = [[cb('الغاء', 'a:cancel')]];

async function handleOwnerInput(c, msg, st) {
  const text = (msg.text || '').trim();
  const d = st.data || {};
  const owner = c.ownerId;
  switch (st.name) {
    case 'welcome': {
      const content = captureContent(msg);
      if (!content) return sendPlain(c, owner, UNSUPPORTED);
      await setSetting(c, 'welcome', JSON.stringify(content));
      await clearState(c);
      return scWelcome(c, 'تم تحديث رسالة الترحيب.');
    }
    case 'sub_msg': {
      const content = captureContent(msg);
      if (!content) return sendPlain(c, owner, UNSUPPORTED);
      await setSetting(c, 'sub_msg', JSON.stringify(content));
      await clearState(c);
      return scSub(c, 'تم تحديث رسالة الاشتراك الاجباري.');
    }
    case 'ask': {
      const key = d.key;
      if (NUM_KEYS[key]) {
        if (!/^\d{1,4}$/.test(text)) return sendPlain(c, owner, 'ارسل رقما صحيحا فقط.');
        await setSetting(c, key, String(parseInt(text, 10)));
      } else {
        if (!msg.text) return sendPlain(c, owner, 'ارسل نصا فقط.');
        if (text === '-' && CLEARABLE.includes(key)) await setSetting(c, key, '');
        else if (!text || text === '-') return sendPlain(c, owner, 'ارسل النص الجديد.');
        else await setSetting(c, key, clip(text, key.endsWith('label') ? 40 : 1000));
      }
      await clearState(c);
      return showScreen(c, SCREEN_OF[key] || 'main', 'تم الحفظ.');
    }
    case 'bc': {
      await setState(c, 'bc_confirm', { src_msg: msg.message_id, mode: 'copy', silent: 0 });
      return scBcConfirm(c);
    }
    case 'ch_add':
      return addChannelFromInput(c, msg);
    case 'ch_link': {
      if (!validUrl(text)) return sendPlain(c, owner, 'ارسل رابط دعوة صحيحا يبدأ بـ https://t.me/');
      await c.db.run('INSERT INTO channels (kind, chat_id, title, link, pos) VALUES (?,?,?,?,?)', 'chat', String(d.chat_id), d.title, fixUrl(text), Date.now() % 1000000);
      await clearState(c);
      return scSub(c, 'تمت اضافة القناة.');
    }
    case 'lnk_url': {
      if (!validUrl(text)) return sendPlain(c, owner, 'ارسل رابطا صحيحا يبدأ بـ https://');
      await setState(c, 'lnk_label', { url: fixUrl(text) });
      return ui(c, 'ارسل الان اسم الزر الذي سيظهر لهذا الرابط.', cancelRow);
    }
    case 'lnk_label': {
      if (!text) return sendPlain(c, owner, 'ارسل اسم الزر كنص.');
      await c.db.run('INSERT INTO channels (kind, chat_id, title, link, pos) VALUES (?,?,?,?,?)', 'link', null, clip(text, 64), d.url, Date.now() % 1000000);
      await clearState(c);
      return scSub(c, 'تمت اضافة الرابط.');
    }
    case 'ch_rename': {
      if (!text) return sendPlain(c, owner, 'ارسل الاسم الجديد كنص.');
      await c.db.run('UPDATE channels SET title = ? WHERE id = ?', clip(text, 64), d.id);
      await clearState(c);
      return scChannel(c, d.id, 'تم تغيير الاسم.');
    }
    case 'btn_label': {
      if (!text) return sendPlain(c, owner, 'ارسل اسم الزر كنص.');
      await setState(c, 'btn_kind', { parent: d.parent, label: clip(text, 64) });
      return ui(c, `اسم الزر: <b>${esc(clip(text, 64))}</b>\n\nاختر نوع الزر:`, [
        [cb('رابط خارجي', 'a:kind:url'), cb('نافذة داخلية (رسالة)', 'a:kind:page')],
        [cb('الغاء', 'a:cancel')],
      ]);
    }
    case 'btn_url': {
      if (!validUrl(text)) return sendPlain(c, owner, 'ارسل رابطا صحيحا يبدأ بـ https:// او t.me/');
      await setState(c, 'btn_color', { ...d, url: fixUrl(text) });
      return scColorPick(c, 'اختر لون الزر:', 'a:col:');
    }
    case 'btn_content': {
      const content = captureContent(msg);
      if (!content) return sendPlain(c, owner, UNSUPPORTED);
      await setState(c, 'btn_color', { ...d, content: JSON.stringify(content) });
      return scColorPick(c, 'اختر لون الزر:', 'a:col:');
    }
    case 'btn_edit': {
      const b = await c.db.one('SELECT * FROM buttons WHERE id = ?', d.id);
      if (!b) {
        await clearState(c);
        return scMain(c);
      }
      if (d.field === 'label') {
        if (!text) return sendPlain(c, owner, 'ارسل اسم الزر كنص.');
        await c.db.run('UPDATE buttons SET label = ? WHERE id = ?', clip(text, 64), b.id);
      } else if (d.field === 'url') {
        if (!validUrl(text)) return sendPlain(c, owner, 'ارسل رابطا صحيحا يبدأ بـ https:// او t.me/');
        await c.db.run('UPDATE buttons SET url = ? WHERE id = ?', fixUrl(text), b.id);
      } else if (d.field === 'content') {
        const content = captureContent(msg);
        if (!content) return sendPlain(c, owner, UNSUPPORTED);
        await c.db.run('UPDATE buttons SET content = ? WHERE id = ?', JSON.stringify(content), b.id);
      }
      await clearState(c);
      return scButton(c, b.id, 'تم الحفظ.');
    }
    default:
      await clearState(c);
      return scMain(c);
  }
}

async function addChannelFromInput(c, msg) {
  const owner = c.ownerId;
  const ref = parseChatRef(msg);
  if (ref === null) {
    return sendPlain(c, owner, 'لم افهم المدخل. ارسل معرف القناة او المجموعة (مثل @name) او الايدي الرقمي (-100...) او وجّه رسالة من القناة الى هنا.');
  }
  const info = await tg(c.env, 'getChat', { chat_id: ref });
  if (!info.ok) {
    return sendPlain(c, owner, `تعذر الوصول لهذه المحادثة: ${clip(info.description || '', 150)}\nتأكد ان البوت مضاف فيها كمشرف ثم حاول مرة اخرى.`);
  }
  const chat = info.result;
  if (chat.type === 'private') return sendPlain(c, owner, 'هذه محادثة خاصة وليست قناة او مجموعة.');
  const me = await tg(c.env, 'getChatMember', { chat_id: chat.id, user_id: botId(c.env) });
  if (!me.ok || !['administrator', 'creator'].includes(me.result.status)) {
    return sendPlain(c, owner, 'البوت ليس مشرفا في هذه القناة او المجموعة. ارفعه مشرفا ثم ارسل المعرف مرة اخرى.');
  }
  const exists = await c.db.one('SELECT id FROM channels WHERE chat_id = ?', String(chat.id));
  if (exists) {
    await clearState(c);
    return scSub(c, 'هذه القناة مضافة مسبقا.');
  }
  let link = null;
  const uname = chat.username || (chat.active_usernames && chat.active_usernames[0]);
  if (uname) link = `https://t.me/${uname}`;
  else if (chat.invite_link) link = chat.invite_link;
  if (!link) {
    const ex = await tg(c.env, 'createChatInviteLink', { chat_id: chat.id, name: 'forced-sub' });
    if (ex.ok) link = ex.result.invite_link;
  }
  const title = clip(chat.title || String(chat.id), 64);
  if (!link) {
    await setState(c, 'ch_link', { chat_id: chat.id, title });
    return ui(c, `القناة: <b>${esc(title)}</b>\nتعذر انشاء رابط دعوة تلقائيا. ارسل الان رابط الدعوة بنفسك.`, cancelRow);
  }
  await c.db.run('INSERT INTO channels (kind, chat_id, title, link, pos) VALUES (?,?,?,?,?)', 'chat', String(chat.id), title, link, Date.now() % 1000000);
  await clearState(c);
  return scSub(c, `تمت اضافة: ${title}`);
}

// ----------------------------------------------------------------------------
//  لوحة التحكم: الشاشات
// ----------------------------------------------------------------------------
async function showScreen(c, name, note) {
  switch (name) {
    case 'wel': return scWelcome(c, note);
    case 'sub': return scSub(c, note);
    case 'subs': return scSubStyle(c, note);
    case 'msgs': return scMsgs(c, note);
    case 'set': return scSettings(c, note);
    case 'sys': return scSys(c, note);
    case 'bc': return scBroadcast(c, note);
    case 'stats': return scStats(c);
    default: return scMain(c, note);
  }
}

async function getStats(c) {
  const t = now();
  const sod = startOfDay(t);
  const r = await c.db.one(
    `SELECT COUNT(*) AS users,
       COALESCE(SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END), 0) AS a24,
       COALESCE(SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END), 0) AS a7,
       COALESCE(SUM(CASE WHEN first_seen >= ? THEN 1 ELSE 0 END), 0) AS new_today,
       COALESCE(SUM(banned), 0) AS banned, COALESCE(SUM(blocked), 0) AS blocked,
       COALESCE(SUM(msgs), 0) AS msgs FROM users`,
    t - 86400, t - 7 * 86400, sod,
  );
  const td = await c.db.one('SELECT msgs FROM daily WHERE day = ?', dayKey(t));
  return { ...r, today: td ? td.msgs : 0 };
}

async function scMain(c, note) {
  const s = await getStats(c);
  const on = c.S.enabled === '1';
  const text =
    `<b>لوحة تحكم البوت</b>\n` +
    (note ? `\n${esc(note)}\n` : '') +
    `\nحالة البوت: <b>${on ? 'يعمل' : 'متوقف'}</b>\nعدد المستخدمين: <b>${s.users}</b>\nنشطون خلال 24 ساعة: <b>${s.a24}</b>\nرسائل اليوم: <b>${s.today}</b>\n\n` +
    `للرد على اي رسالة: اعمل رد (Reply) عليها.\nللحظر: رد عليها بكلمة <b>حظر</b>.\nلالغاء الحظر: رد عليها بكلمة <b>الغاء الحظر</b>.`;
  return ui(c, text, [
    [cb(on ? 'ايقاف البوت' : 'تشغيل البوت', 'a:toggle', on ? 'red' : 'green')],
    [cb('رسالة الترحيب', 'a:wel'), cb('ازرار الترحيب', 'a:bt:0')],
    [cb('الاشتراك الاجباري', 'a:sub'), cb('الاذاعة', 'a:bc')],
    [cb('المحظورون', 'a:bans:0'), cb('الاحصائيات', 'a:stats')],
    [cb('رسائل البوت', 'a:msgs'), cb('الاعدادات', 'a:set')],
    [cb('معاينة كما يراها المستخدم', 'a:wel_prev')],
  ]);
}

async function scStats(c) {
  const s = await getStats(c);
  const week = await c.db.all('SELECT day, msgs FROM daily ORDER BY day DESC LIMIT 7');
  let text =
    `<b>الاحصائيات</b>\n\nاجمالي المستخدمين: <b>${s.users}</b>\nنشطون خلال 24 ساعة: <b>${s.a24}</b>\nنشطون خلال 7 ايام: <b>${s.a7}</b>\nمستخدمون جدد اليوم: <b>${s.new_today}</b>\nالمحظورون: <b>${s.banned}</b>\nحظروا البوت: <b>${s.blocked}</b>\nاجمالي الرسائل: <b>${s.msgs}</b>\nرسائل اليوم: <b>${s.today}</b>`;
  if (week.length) {
    text += '\n\n<b>اخر الايام:</b>\n' + week.map((w) => `${esc(w.day.slice(0, 4))}/${esc(w.day.slice(4, 6))}/${esc(w.day.slice(6))} : ${w.msgs}`).join('\n');
  }
  return ui(c, text, [[cb('تحديث', 'a:stats')], [cb('رجوع', 'a:main')]]);
}

async function scWelcome(c, note) {
  const w = parseJson(c.S.welcome, DEFAULT_WELCOME);
  const nb = await c.db.one('SELECT COUNT(*) AS n FROM buttons WHERE parent = 0');
  const text =
    `<b>رسالة الترحيب</b>\n` + (note ? `\n${esc(note)}\n` : '') +
    `\nالنوع: <b>${TYPE_LABEL[w.t] || w.t}</b>\nعدد الازرار: <b>${nb.n}</b>\nالنص: ${esc(clip(w.x || '(بدون نص)', 300))}\n\n` +
    `يمكنك استخدام المتغيرات داخل النص:\n<code>{name}</code> اسم المستخدم\n<code>{date}</code> التاريخ\n<code>{time}</code> الوقت بتوقيت العراق`;
  return ui(c, text, [
    [cb('تغيير رسالة الترحيب', 'a:wel_set')],
    [cb('ازرار الترحيب', 'a:bt:0'), cb('معاينة', 'a:wel_prev')],
    [cb('استعادة الافتراضي', 'a:wel_reset')],
    [cb('رجوع', 'a:main')],
  ]);
}

async function scButtons(c, node, note) {
  const rows = await c.db.all('SELECT * FROM buttons WHERE parent = ? ORDER BY row_no, pos, id', node);
  let title = 'ازرار رسالة الترحيب';
  if (node !== 0) {
    const b = await c.db.one('SELECT label FROM buttons WHERE id = ?', node);
    title = `ازرار النافذة: ${b ? b.label : ''}`;
  }
  const kb = [];
  let cur = null;
  let curRow = null;
  for (const b of rows) {
    if (curRow !== b.row_no) {
      cur = [];
      kb.push(cur);
      curRow = b.row_no;
    }
    cur.push(cb(b.label, 'a:bn:' + b.id, b.color));
  }
  kb.push([cb('اضافة زر', 'a:add:' + node)]);
  kb.push([cb('معاينة', node === 0 ? 'a:wel_prev' : 'a:bn_prev:' + node)]);
  kb.push([cb('رجوع', node === 0 ? 'a:wel' : 'a:bn:' + node)]);
  const text =
    `<b>${esc(title)}</b>\n` + (note ? `\n${esc(note)}\n` : '') +
    `\nعدد الازرار: <b>${rows.length}</b>\n` +
    (rows.length ? 'اضغط على اي زر لتعديله او حذفه او تحريكه.' : 'لا توجد ازرار. ويمكنك ترك الرسالة بدون ازرار.') +
    `\n\nالازرار تظهر هنا بنفس ترتيبها وألوانها.`;
  return ui(c, text, kb);
}

async function scButton(c, id, note) {
  const b = await c.db.one('SELECT * FROM buttons WHERE id = ?', id);
  if (!b) return scMain(c);
  const isUrl = b.kind === 'url';
  let text =
    `<b>الزر: ${esc(b.label)}</b>\n` + (note ? `\n${esc(note)}\n` : '') +
    `\nالنوع: <b>${isUrl ? 'رابط خارجي' : 'نافذة داخلية'}</b>\nاللون: <b>${COLOR_LABEL[b.color] || 'بدون لون'}</b>`;
  if (isUrl) text += `\nالرابط: ${esc(b.url)}`;
  else {
    const ct = parseJson(b.content, {});
    const kids = await c.db.one('SELECT COUNT(*) AS n FROM buttons WHERE parent = ?', b.id);
    text += `\nنوع المحتوى: <b>${TYPE_LABEL[ct.t] || ct.t}</b>\nعدد ازرار النافذة: <b>${kids.n}</b>`;
  }
  const rows = [[cb('تغيير الاسم', 'a:bn_lbl:' + id), cb('تغيير اللون', 'a:bn_colm:' + id, b.color)]];
  if (isUrl) rows.push([cb('تغيير الرابط', 'a:bn_url:' + id)]);
  else {
    rows.push([cb('تغيير محتوى النافذة', 'a:bn_cnt:' + id), cb('معاينة النافذة', 'a:bn_prev:' + id)]);
    rows.push([cb('ادارة ازرار هذه النافذة', 'a:bt:' + id)]);
  }
  rows.push([cb('تحريك للاول', 'a:bn_up:' + id), cb('تحريك للاخر', 'a:bn_dn:' + id)]);
  rows.push([cb('تبديل: صف جديد / بجانب السابق', 'a:bn_row:' + id)]);
  rows.push([cb('حذف الزر', 'a:bn_del:' + id, 'red')]);
  rows.push([cb('رجوع', 'a:bt:' + b.parent)]);
  return ui(c, text, rows);
}

function scColorPick(c, text, prefix, extraRows = [], backData = 'a:cancel') {
  const rows = [COLOR_ORDER.map((k) => cb(COLOR_LABEL[k], prefix + k, k))];
  return ui(c, text, [...rows, ...extraRows, [cb(backData === 'a:cancel' ? 'الغاء' : 'رجوع', backData)]]);
}

async function scSub(c, note) {
  const items = await c.db.all('SELECT * FROM channels ORDER BY pos, id');
  const on = c.S.sub_enabled === '1';
  const text =
    `<b>الاشتراك الاجباري</b>\n` + (note ? `\n${esc(note)}\n` : '') +
    `\nالحالة: <b>${on ? 'مفعل' : 'معطل'}</b>\nطريقة العرض: <b>${c.S.sub_mode === 'text' ? 'رسالة نصية' : 'نوافذ (ازرار)'}</b>\nعدد العناصر: <b>${items.length}</b>\n\n` +
    `يجب ان يكون البوت مشرفا في القناة او المجموعة حتى يتحقق من المشتركين. العناصر من نوع رابط تظهر فقط ولا يتم التحقق منها.`;
  const rows = [[cb(on ? 'تعطيل الاشتراك الاجباري' : 'تفعيل الاشتراك الاجباري', 'a:tg:sub_enabled', on ? 'red' : 'green')]];
  for (const i of items) {
    const warn = i.last_error ? ' (خطأ)' : '';
    rows.push([cb(`${i.kind === 'link' ? 'رابط' : 'قناة'}: ${i.title}${warn}`, 'a:ch:' + i.id, i.color || 'none')]);
  }
  rows.push([cb('اضافة قناة او مجموعة', 'a:ch_add'), cb('اضافة رابط اضافي', 'a:lnk_add')]);
  rows.push([cb('تعديل رسالة الاشتراك', 'a:sub_msg'), cb('معاينة', 'a:sub_prev')]);
  rows.push([cb('شكل وعرض الاشتراك', 'a:subs')]);
  rows.push([cb('رجوع', 'a:main')]);
  return ui(c, text, rows);
}
async function scSubStyle(c, note) {
  const text =
    `<b>شكل وعرض الاشتراك الاجباري</b>\n` + (note ? `\n${esc(note)}\n` : '') +
    `\nطريقة العرض: <b>${c.S.sub_mode === 'text' ? 'رسالة نصية (الروابط داخل النص)' : 'نوافذ (ازرار تحت الرسالة)'}</b>\nلون ازرار القنوات: <b>${COLOR_LABEL[c.S.sub_color]}</b>\nلون زر التحقق: <b>${COLOR_LABEL[c.S.sub_check_color]}</b>\nنص زر التحقق: <b>${esc(c.S.sub_check_label)}</b>\n\nيمكنك ايضا تغيير لون كل قناة على حدة من قائمة القناة.`;
  return ui(c, text, [
    [cb('طريقة العرض: ' + CYCLES.sub_mode.opts.find((o) => o[0] === c.S.sub_mode)[1], 'a:cyc:sub_mode')],
    [cb('لون ازرار القنوات', 'a:clrm:sub_color', c.S.sub_color), cb('لون زر التحقق', 'a:clrm:sub_check_color', c.S.sub_check_color)],
    [cb('تغيير نص زر التحقق', 'a:ask:sub_check_label')],
    [cb('رجوع', 'a:sub')],
  ]);
}
async function scChannel(c, id, note) {
  const i = await c.db.one('SELECT * FROM channels WHERE id = ?', id);
  if (!i) return scSub(c);
  const text =
    `<b>${esc(i.title)}</b>\n` + (note ? `\n${esc(note)}\n` : '') +
    `\nالنوع: <b>${i.kind === 'link' ? 'رابط اضافي (بدون تحقق)' : 'قناة / مجموعة (يتم التحقق)'}</b>\nاللون: <b>${i.color ? COLOR_LABEL[i.color] : 'افتراضي (حسب الاعداد العام)'}</b>\nالرابط: ${esc(i.link)}` +
    (i.last_error ? `\n\nاخر خطأ في الفحص: ${esc(i.last_error)}` : '');
  const rows = [[cb('تغيير الاسم', 'a:ch_ren:' + id), cb('تغيير اللون', 'a:ch_clrm:' + id, i.color || 'none')]];
  if (i.kind === 'chat') rows.push([cb('فحص صلاحيات البوت', 'a:ch_test:' + id)]);
  rows.push([cb('حذف', 'a:ch_del:' + id, 'red')]);
  rows.push([cb('رجوع', 'a:sub')]);
  return ui(c, text, rows);
}

async function scBans(c, page) {
  const per = 8;
  const total = (await c.db.one('SELECT COUNT(*) AS n FROM users WHERE banned = 1')).n;
  const list = await c.db.all('SELECT code FROM users WHERE banned = 1 ORDER BY first_seen LIMIT ? OFFSET ?', per, page * per);
  const text =
    `<b>المحظورون</b>\n\nالعدد: <b>${total}</b>\n` +
    (total ? 'اضغط على الزر لالغاء حظر المرسل.' : 'لا يوجد محظورون.') +
    `\n\nيمكنك ايضا الغاء الحظر بالرد على رسالة المرسل بكلمة الغاء الحظر، او بالامر /unban الكود.`;
  const rows = list.map((u) => [cb(`الغاء حظر ${u.code}`, `a:ubl:${u.code}:${page}`, 'green')]);
  const nav = [];
  if (page > 0) nav.push(cb('السابق', 'a:bans:' + (page - 1)));
  if ((page + 1) * per < total) nav.push(cb('التالي', 'a:bans:' + (page + 1)));
  if (nav.length) rows.push(nav);
  rows.push([cb('رجوع', 'a:main')]);
  return ui(c, text, rows);
}

async function scMsgs(c, note) {
  const show = (k) => esc(clip(c.S[k] || '(معطلة)', 120));
  const text =
    `<b>رسائل البوت</b>\n` + (note ? `\n${esc(note)}\n` : '') +
    `\nرسالة ايقاف البوت:\n${show('off_msg')}\n\nرسالة تأكيد الاستلام:\n${show('sent_msg')}\n\nرسالة المحظور:\n${show('ban_msg')}\n\nرسالة تجاوز الحد:\n${show('rate_msg')}\n\nرسالة منع نوع الرسالة:\n${show('deny_msg')}\n\nعند التعديل ارسل <code>-</code> لتعطيل الرسالة.`;
  return ui(c, text, [
    [cb('رسالة ايقاف البوت', 'a:ask:off_msg'), cb('رسالة التأكيد', 'a:ask:sent_msg')],
    [cb('رسالة المحظور', 'a:ask:ban_msg'), cb('رسالة تجاوز الحد', 'a:ask:rate_msg')],
    [cb('رسالة منع نوع الرسالة', 'a:ask:deny_msg')],
    [cb('رجوع', 'a:main')],
  ]);
}

async function scSettings(c, note) {
  const onoff = (k) => (c.S[k] === '1' ? 'مفعل' : 'معطل');
  const cyc = (k) => CYCLES[k].opts.find((o) => o[0] === c.S[k])[1];
  const text =
    `<b>الاعدادات</b>\n` + (note ? `\n${esc(note)}\n` : '') +
    `\nتأكيد الاستلام للمرسل: <b>${onoff('confirm_on')}</b>\nاشعار نجاح الرد: <b>${onoff('reply_ok')}</b>\nطريقة عرض الوقت: <b>${cyc('header_mode')}</b>\nصيغة الوقت: <b>${cyc('time_style')}</b>\nحد الرسائل بالدقيقة: <b>${c.S.rate_limit}</b>\nقبول النصوص فقط: <b>${onoff('text_only')}</b>\nمنع الروابط: <b>${onoff('block_links')}</b>\n\nالتوقيت المستخدم: العراق (بغداد).`;
  const tgBtn = (k) => cb(`${TOGGLE_LABEL[k]}: ${onoff(k)}`, 'a:tg:' + k, c.S[k] === '1' ? 'green' : 'none');
  return ui(c, text, [
    [tgBtn('confirm_on')],
    [tgBtn('reply_ok')],
    [cb('طريقة عرض الوقت: ' + cyc('header_mode'), 'a:cyc:header_mode')],
    [cb('صيغة الوقت: ' + cyc('time_style'), 'a:cyc:time_style')],
    [cb('حد الرسائل بالدقيقة: ' + c.S.rate_limit, 'a:ask:rate_limit')],
    [tgBtn('text_only')],
    [tgBtn('block_links')],
    [cb('ازرار النظام (الرجوع)', 'a:sys')],
    [cb('رجوع', 'a:main')],
  ]);
}
async function scSys(c, note) {
  const text =
    `<b>ازرار النظام</b>\n` + (note ? `\n${esc(note)}\n` : '') +
    `\nنص زر الرجوع في النوافذ الداخلية: <b>${esc(c.S.back_label)}</b>\nلون زر الرجوع: <b>${COLOR_LABEL[c.S.back_color]}</b>`;
  return ui(c, text, [
    [cb('تغيير نص زر الرجوع', 'a:ask:back_label'), cb('لون زر الرجوع', 'a:clrm:back_color', c.S.back_color)],
    [cb('رجوع', 'a:set')],
  ]);
}

// ----------------------------------------------------------------------------
//  الاذاعة
// ----------------------------------------------------------------------------
async function scBroadcast(c, note) {
  const job = await c.db.one("SELECT * FROM broadcasts ORDER BY id DESC LIMIT 1");
  const elig = (await c.db.one('SELECT COUNT(*) AS n FROM users WHERE banned = 0 AND blocked = 0')).n;
  let text = `<b>الاذاعة</b>\n` + (note ? `\n${esc(note)}\n` : '') + `\nعدد المستلمين المتاحين: <b>${elig}</b>\n`;
  const rows = [];
  if (job && job.status === 'running') {
    text += '\n' + bcStatusText(job);
    rows.push([cb('ايقاف الاذاعة الحالية', 'a:bc_stop', 'red')], [cb('تحديث', 'a:bc')]);
  } else {
    if (job) text += '\n<b>اخر اذاعة:</b>\n' + bcStatusText(job);
    rows.push([cb('اذاعة جديدة', 'a:bc_new', 'green')]);
  }
  rows.push([cb('رجوع', 'a:main')]);
  return ui(c, text, rows);
}
function bcStatusText(j) {
  const st = { running: 'قيد الارسال', done: 'اكتملت', cancelled: 'متوقفة' }[j.status] || j.status;
  return `الحالة: <b>${st}</b>\nالاجمالي: ${j.total}\nتم الارسال: ${j.sent}\nفشل: ${j.failed}\nحظروا البوت: ${j.blocked}`;
}
async function scBcConfirm(c) {
  const st = await getState(c);
  if (!st || st.name !== 'bc_confirm') return scBroadcast(c);
  const d = st.data;
  const elig = (await c.db.one('SELECT COUNT(*) AS n FROM users WHERE banned = 0 AND blocked = 0')).n;
  const text =
    `<b>تاكيد الاذاعة</b>\n\nسترسل الرسالة التي ارسلتها الان الى <b>${elig}</b> مستخدم.\nطريقة الارسال: <b>${d.mode === 'forward' ? 'توجيه (يظهر انها موجهة)' : 'نسخ (بدون اسم)'}</b>\nالاشعار: <b>${d.silent ? 'صامت' : 'عادي'}</b>\n\nملاحظة: لا تحذف رسالتك الاصلية حتى تنتهي الاذاعة. كل رسالة تُذاع بشكل مستقل (الالبومات ترسل كرسائل منفصلة).`;
  return ui(c, text, [
    [cb('الطريقة: ' + (d.mode === 'forward' ? 'توجيه' : 'نسخ'), 'a:bc_mode'), cb('الاشعار: ' + (d.silent ? 'صامت' : 'عادي'), 'a:bc_silent')],
    [cb(`ارسال الى ${elig} مستخدم`, 'a:bc_go', 'green')],
    [cb('الغاء', 'a:cancel', 'red')],
  ]);
}
async function startBroadcast(c, d) {
  const running = await c.db.one("SELECT id FROM broadcasts WHERE status = 'running' LIMIT 1");
  if (running) return false;
  const total = (await c.db.one('SELECT COUNT(*) AS n FROM users WHERE banned = 0 AND blocked = 0')).n;
  const r = await c.db.run(
    "INSERT INTO broadcasts (src_chat, src_msg, mode, silent, status, total, status_msg, created) VALUES (?,?,?,?, 'running', ?, ?, ?)",
    c.ownerId, d.src_msg, d.mode, d.silent ? 1 : 0, total, c.cbMsg ? c.cbMsg.message_id : null, now(),
  );
  return r;
}

async function runBroadcastBatch(env, limit) {
  const db = dbHelper(env);
  const job = await db.one("SELECT * FROM broadcasts WHERE status = 'running' ORDER BY id LIMIT 1");
  if (!job) return;
  const t = now();
  const lock = await db.run('UPDATE broadcasts SET lock_until = ? WHERE id = ? AND lock_until <= ?', t + 50, job.id, t);
  if (!lock.meta || lock.meta.changes !== 1) return;
  const users = await db.all('SELECT id FROM users WHERE id > ? AND banned = 0 AND blocked = 0 ORDER BY id LIMIT ?', job.cursor, limit);
  let sent = 0;
  let failed = 0;
  let blockedN = 0;
  let cursor = job.cursor;
  let retryAfter = 0;
  const blockedIds = [];
  const CH = 5;
  const method = job.mode === 'forward' ? 'forwardMessage' : 'copyMessage';
  outer: for (let i = 0; i < users.length; i += CH) {
    const chunk = users.slice(i, i + CH);
    const res = await Promise.all(
      chunk.map((u) =>
        tg(env, method, {
          chat_id: u.id, from_chat_id: job.src_chat, message_id: job.src_msg,
          disable_notification: job.silent ? true : undefined,
        }, { retries: 2, maxWait: 8 }),
      ),
    );
    const firstRetry = res.findIndex((r) => !r.ok && r.error_code === 429);
    const upto = firstRetry === -1 ? res.length : firstRetry;
    for (let k = 0; k < upto; k++) {
      const r = res[k];
      if (r.ok) sent++;
      else if (r.error_code === 403 || /chat not found|user is deactivated|bot was blocked|PEER_ID_INVALID/i.test(r.description || '')) {
        blockedN++;
        blockedIds.push(chunk[k].id);
      } else failed++;
      cursor = chunk[k].id;
    }
    if (firstRetry !== -1) {
      retryAfter = (res[firstRetry].parameters && res[firstRetry].parameters.retry_after) || 5;
      break outer;
    }
  }
  const stm = [];
  for (let i = 0; i < blockedIds.length; i += 90) {
    const part = blockedIds.slice(i, i + 90);
    stm.push([`UPDATE users SET blocked = 1 WHERE id IN (${part.map(() => '?').join(',')})`, ...part]);
  }
  stm.push([
    'UPDATE broadcasts SET sent = sent + ?, failed = failed + ?, blocked = blocked + ?, cursor = ?, lock_until = ? WHERE id = ?',
    sent, failed, blockedN, cursor, retryAfter ? now() + retryAfter : 0, job.id,
  ]);
  await db.batch(stm);
  let cur = await db.one('SELECT * FROM broadcasts WHERE id = ?', job.id);
  const finished = !retryAfter && users.length < limit;
  if (finished && cur.status === 'running') {
    await db.run("UPDATE broadcasts SET status = 'done', finished = ?, lock_until = 0 WHERE id = ?", now(), job.id);
    cur = await db.one('SELECT * FROM broadcasts WHERE id = ?', job.id);
    const final = `<b>اكتملت الاذاعة</b>\n\n${bcStatusText(cur)}`;
    if (cur.status_msg) {
      await tg(env, 'editMessageText', { chat_id: cur.src_chat, message_id: cur.status_msg, text: final, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[cb('رجوع للوحة', 'a:main')]] } });
    }
    await tg(env, 'sendMessage', { chat_id: cur.src_chat, text: final, parse_mode: 'HTML' });
  } else if (cur.status_msg) {
    await tg(env, 'editMessageText', {
      chat_id: cur.src_chat, message_id: cur.status_msg, text: `<b>الاذاعة قيد التنفيذ</b>\n\n${bcStatusText(cur)}`, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[cb('ايقاف الاذاعة', 'a:bc_stop', 'red')]] },
    });
  }
}

// ----------------------------------------------------------------------------
//  استدعاءات لوحة التحكم
// ----------------------------------------------------------------------------
const KEEP_STATE = ['bc_mode', 'bc_silent', 'bc_go', 'kind', 'col', 'plc'];

async function ownerCallback(c, q, data) {
  const p = data.split(':');
  const act = p[1];
  const deferred = ['ban', 'unb', 'ubl', 'ch_test'].includes(act);
  if (!deferred) await ans(c, q.id);
  if (!KEEP_STATE.includes(act)) await clearState(c);

  switch (act) {
    case 'main': return scMain(c);
    case 'cancel': return scMain(c, 'تم الغاء العملية.');
    case 'noop': return;
    case 'toggle': {
      await setSetting(c, 'enabled', c.S.enabled === '1' ? '0' : '1');
      return scMain(c, c.S.enabled === '1' ? 'تم تشغيل البوت.' : 'تم ايقاف البوت. لن يستقبل رسائل جديدة.');
    }
    case 'stats': return scStats(c);

    // ---- الترحيب
    case 'wel': return scWelcome(c);
    case 'wel_set':
      await setState(c, 'welcome');
      return ui(c, '<b>تغيير رسالة الترحيب</b>\n\nارسل الان رسالة الترحيب الجديدة. يمكنك ارسال نص، او صورة، او فيديو، او ملف، او متحركة، او ملصق، او صوت، ويمكنك كتابة نص مع الوسائط وتنسيقه (غامق، مائل، رابط...).\n\nالمتغيرات: <code>{name}</code> <code>{date}</code> <code>{time}</code>', cancelRow);
    case 'wel_prev': {
      await showWelcome(c, c.ownerId, q.from);
      return;
    }
    case 'wel_reset':
      await setSetting(c, 'welcome', JSON.stringify(DEFAULT_WELCOME));
      return scWelcome(c, 'تمت استعادة رسالة الترحيب الافتراضية.');

    // ---- ازرار الترحيب والنوافذ
    case 'bt': return scButtons(c, Number(p[2] || 0));
    case 'bn': return scButton(c, Number(p[2]));
    case 'bn_prev': {
      await showNode(c, c.ownerId, null, Number(p[2]), q.from);
      return;
    }
    case 'add': {
      const parent = Number(p[2] || 0);
      const n = (await c.db.one('SELECT COUNT(*) AS n FROM buttons WHERE parent = ?', parent)).n;
      if (n >= 50) return scButtons(c, parent, 'وصلت للحد الاقصى من الازرار (50).');
      await setState(c, 'btn_label', { parent });
      return ui(c, '<b>اضافة زر</b>\n\nارسل اسم الزر (النص الذي سيظهر عليه).', cancelRow);
    }
    case 'kind': {
      const st = await getState(c);
      if (!st || st.name !== 'btn_kind') return scMain(c);
      const kind = p[2] === 'url' ? 'url' : 'page';
      await setState(c, kind === 'url' ? 'btn_url' : 'btn_content', { ...st.data, kind });
      return ui(c, kind === 'url'
        ? 'ارسل الان الرابط الذي سيفتحه الزر (يبدأ بـ https://).'
        : 'ارسل الان محتوى النافذة الداخلية: نص او صورة او فيديو او ملف او اي وسائط. عند ضغط المستخدم على الزر سيظهر هذا المحتوى مع زر رجوع.', cancelRow);
    }
    case 'col': {
      const st = await getState(c);
      if (!st || st.name !== 'btn_color') return scMain(c);
      const color = COLOR_ORDER.includes(p[2]) ? p[2] : 'none';
      const data2 = { ...st.data, color };
      const n = (await c.db.one('SELECT COUNT(*) AS n FROM buttons WHERE parent = ?', data2.parent)).n;
      if (!n) {
        await createButton(c, data2, 'new');
        await clearState(c);
        return scButtons(c, data2.parent, 'تمت اضافة الزر.');
      }
      await setState(c, 'btn_place', data2);
      return ui(c, 'اين تريد وضع الزر؟', [
        [cb('في صف جديد', 'a:plc:new'), cb('بجانب الزر الاخير', 'a:plc:same')],
        [cb('الغاء', 'a:cancel')],
      ]);
    }
    case 'plc': {
      const st = await getState(c);
      if (!st || st.name !== 'btn_place') return scMain(c);
      await createButton(c, st.data, p[2] === 'same' ? 'same' : 'new');
      await clearState(c);
      return scButtons(c, st.data.parent, 'تمت اضافة الزر.');
    }
    case 'bn_lbl':
      await setState(c, 'btn_edit', { id: Number(p[2]), field: 'label' });
      return ui(c, 'ارسل الاسم الجديد للزر.', cancelRow);
    case 'bn_url':
      await setState(c, 'btn_edit', { id: Number(p[2]), field: 'url' });
      return ui(c, 'ارسل الرابط الجديد.', cancelRow);
    case 'bn_cnt':
      await setState(c, 'btn_edit', { id: Number(p[2]), field: 'content' });
      return ui(c, 'ارسل المحتوى الجديد للنافذة (نص او وسائط).', cancelRow);
    case 'bn_colm': {
      const id = Number(p[2]);
      return scColorPick(c, 'اختر لون الزر:', `a:bn_col:${id}:`, [], 'a:bn:' + id);
    }
    case 'bn_col': {
      const id = Number(p[2]);
      await c.db.run('UPDATE buttons SET color = ? WHERE id = ?', COLOR_ORDER.includes(p[3]) ? p[3] : 'none', id);
      return scButton(c, id, 'تم تغيير اللون.');
    }
    case 'bn_up':
    case 'bn_dn': {
      const id = Number(p[2]);
      await moveButton(c, id, act === 'bn_up' ? -1 : 1);
      const b = await c.db.one('SELECT parent FROM buttons WHERE id = ?', id);
      return scButtons(c, b ? b.parent : 0, 'تم التحريك.');
    }
    case 'bn_row': {
      const id = Number(p[2]);
      const ok = await toggleRow(c, id);
      const b = await c.db.one('SELECT parent FROM buttons WHERE id = ?', id);
      return scButtons(c, b ? b.parent : 0, ok ? 'تم تغيير موضع الزر.' : 'لا يمكن تغيير موضع هذا الزر.');
    }
    case 'bn_del': {
      const id = Number(p[2]);
      const b = await c.db.one('SELECT label FROM buttons WHERE id = ?', id);
      if (!b) return scMain(c);
      return ui(c, `هل تريد حذف الزر <b>${esc(b.label)}</b>؟\nاذا كان نافذة داخلية فسيتم حذف كل ازرارها ايضا.`, [
        [cb('نعم، احذف', 'a:bn_delok:' + id, 'red'), cb('لا', 'a:bn:' + id)],
      ]);
    }
    case 'bn_delok': {
      const id = Number(p[2]);
      const b = await c.db.one('SELECT parent FROM buttons WHERE id = ?', id);
      if (b) await deleteButtonTree(c, id);
      return scButtons(c, b ? b.parent : 0, 'تم حذف الزر.');
    }

    // ---- الاشتراك الاجباري
    case 'sub': return scSub(c);
    case 'subs': return scSubStyle(c);
    case 'sub_msg':
      await setState(c, 'sub_msg');
      return ui(c, '<b>تعديل رسالة الاشتراك الاجباري</b>\n\nارسل الان الرسالة الجديدة (نص او صورة او فيديو او اي وسائط). ستظهر تحتها ازرار القنوات وزر التحقق تلقائيا.', cancelRow);
    case 'sub_prev': {
      const items = await c.db.all('SELECT * FROM channels ORDER BY pos, id');
      if (!items.length) return ui(c, 'لا توجد قنوات مضافة للمعاينة.', [[cb('رجوع', 'a:sub')]]);
      await renderGate(c, c.ownerId, null, items, q.from);
      return;
    }
    case 'ch_add':
      await setState(c, 'ch_add');
      return ui(c, '<b>اضافة قناة او مجموعة</b>\n\nارسل معرف القناة (مثل @name) او الايدي الرقمي، او وجّه رسالة من القناة الى هنا.\nيجب ان يكون البوت مشرفا فيها.', cancelRow);
    case 'lnk_add':
      await setState(c, 'lnk_url');
      return ui(c, '<b>اضافة رابط اضافي</b>\n\nارسل الرابط (يظهر كزر ولا يتم التحقق منه).', cancelRow);
    case 'ch': return scChannel(c, Number(p[2]));
    case 'ch_ren':
      await setState(c, 'ch_rename', { id: Number(p[2]) });
      return ui(c, 'ارسل الاسم الجديد لهذا العنصر.', cancelRow);
    case 'ch_clrm': {
      const id = Number(p[2]);
      return scColorPick(c, 'اختر لون زر هذه القناة:', `a:ch_clr:${id}:`, [[cb('افتراضي (حسب الاعداد العام)', `a:ch_clr:${id}:def`)]], 'a:ch:' + id);
    }
    case 'ch_clr': {
      const id = Number(p[2]);
      await c.db.run('UPDATE channels SET color = ? WHERE id = ?', COLOR_ORDER.includes(p[3]) ? p[3] : null, id);
      return scChannel(c, id, 'تم تغيير اللون.');
    }
    case 'ch_del': {
      const id = Number(p[2]);
      return ui(c, 'هل تريد حذف هذا العنصر من الاشتراك الاجباري؟', [[cb('نعم، احذف', 'a:ch_delok:' + id, 'red'), cb('لا', 'a:ch:' + id)]]);
    }
    case 'ch_delok':
      await c.db.run('DELETE FROM channels WHERE id = ?', Number(p[2]));
      await c.db.run('UPDATE users SET sub_ok_until = 0');
      return scSub(c, 'تم الحذف.');
    case 'ch_test': {
      const i = await c.db.one('SELECT * FROM channels WHERE id = ?', Number(p[2]));
      if (!i) return ans(c, q.id, 'غير موجود', true);
      const me = await tg(c.env, 'getChatMember', { chat_id: i.chat_id, user_id: botId(c.env) });
      const ok = me.ok && ['administrator', 'creator'].includes(me.result.status);
      if (ok && i.last_error) await c.db.run('UPDATE channels SET last_error = NULL WHERE id = ?', i.id);
      return ans(c, q.id, ok ? 'البوت مشرف ويستطيع التحقق من المشتركين.' : 'البوت ليس مشرفا او لا يستطيع الوصول. ارفعه مشرفا.', true);
    }

    // ---- الاذاعة
    case 'bc': return scBroadcast(c);
    case 'bc_new': {
      const running = await c.db.one("SELECT id FROM broadcasts WHERE status = 'running' LIMIT 1");
      if (running) return scBroadcast(c, 'توجد اذاعة قيد التنفيذ. انتظر انتهاءها او اوقفها.');
      await setState(c, 'bc');
      return ui(c, '<b>اذاعة جديدة</b>\n\nارسل الان الرسالة التي تريد اذاعتها لجميع المستخدمين. يمكن ان تكون نصا او صورة او فيديو او ملفا او ملصقا او صوتا او استفتاء او موقعا او اي شيء.', cancelRow);
    }
    case 'bc_mode':
    case 'bc_silent': {
      const st = await getState(c);
      if (!st || st.name !== 'bc_confirm') return scBroadcast(c);
      const d = st.data;
      if (act === 'bc_mode') d.mode = d.mode === 'forward' ? 'copy' : 'forward';
      else d.silent = d.silent ? 0 : 1;
      await setState(c, 'bc_confirm', d);
      return scBcConfirm(c);
    }
    case 'bc_go': {
      const st = await getState(c);
      if (!st || st.name !== 'bc_confirm') return scBroadcast(c);
      const r = await startBroadcast(c, st.data);
      await clearState(c);
      if (r === false) return scBroadcast(c, 'توجد اذاعة قيد التنفيذ.');
      await ui(c, '<b>بدأت الاذاعة</b>\n\nجاري الارسال...', [[cb('ايقاف الاذاعة', 'a:bc_stop', 'red')]]);
      c.ec.waitUntil(runBroadcastBatch(c.env, Math.min(batchSize(c.env), 25)).catch((e) => console.error('bc', e && e.stack || e)));
      return;
    }
    case 'bc_stop':
      await c.db.run("UPDATE broadcasts SET status = 'cancelled', finished = ? WHERE status = 'running'", now());
      return scBroadcast(c, 'تم ايقاف الاذاعة.');

    // ---- المحظورون
    case 'bans': return scBans(c, Number(p[2] || 0));
    case 'ban':
    case 'unb': {
      const code = p[2];
      const u = await c.db.one('SELECT id FROM users WHERE code = ?', code);
      if (!u) return ans(c, q.id, 'المرسل غير موجود', true);
      const ban = act === 'ban';
      await c.db.run('UPDATE users SET banned = ? WHERE id = ?', ban ? 1 : 0, u.id);
      await ans(c, q.id, ban ? `تم حظر المرسل ${code}` : `تم الغاء حظر المرسل ${code}`, false);
      if (c.cbMsg) {
        const old = (c.cbMsg.reply_markup && c.cbMsg.reply_markup.inline_keyboard) || [];
        const keep = old.filter((r) => r[0] && r[0].callback_data === 'noop');
        const btn = ban ? cb('الغاء حظر المرسل', 'a:unb:' + code, 'green') : cb('حظر المرسل', 'a:ban:' + code, 'red');
        await tg(c.env, 'editMessageReplyMarkup', {
          chat_id: c.cbMsg.chat.id, message_id: c.cbMsg.message_id, reply_markup: { inline_keyboard: [...keep, [btn]] },
        });
      }
      return;
    }
    case 'ubl': {
      const code = p[2];
      const u = await c.db.one('SELECT id FROM users WHERE code = ?', code);
      if (u) await c.db.run('UPDATE users SET banned = 0 WHERE id = ?', u.id);
      await ans(c, q.id, `تم الغاء حظر المرسل ${code}`);
      return scBans(c, Number(p[3] || 0));
    }

    // ---- رسائل واعدادات عامة
    case 'msgs': return scMsgs(c);
    case 'set': return scSettings(c);
    case 'sys': return scSys(c);
    case 'tg': {
      const k = p[2];
      if (!TOGGLE_LABEL[k]) return;
      await setSetting(c, k, c.S[k] === '1' ? '0' : '1');
      return showScreen(c, SCREEN_OF[k]);
    }
    case 'cyc': {
      const k = p[2];
      const cy = CYCLES[k];
      if (!cy) return;
      const i = cy.opts.findIndex((o) => o[0] === c.S[k]);
      await setSetting(c, k, cy.opts[(i + 1) % cy.opts.length][0]);
      return showScreen(c, SCREEN_OF[k]);
    }
    case 'clrm': {
      const k = p[2];
      if (!COLOR_KEYS[k]) return;
      return scColorPick(c, `${COLOR_KEYS[k]}:`, `a:clr:${k}:`, [], 'a:' + (SCREEN_OF[k] || 'main'));
    }
    case 'clr': {
      const k = p[2];
      if (!COLOR_KEYS[k] || !COLOR_ORDER.includes(p[3])) return;
      await setSetting(c, k, p[3]);
      return showScreen(c, SCREEN_OF[k], 'تم تغيير اللون.');
    }
    case 'ask': {
      const k = p[2];
      if (!TEXT_KEYS[k] && !NUM_KEYS[k]) return;
      await setState(c, 'ask', { key: k });
      const label = TEXT_KEYS[k] || NUM_KEYS[k];
      const cur = esc(clip(c.S[k] || '(معطلة)', 200));
      const hint = CLEARABLE.includes(k) ? '\nارسل <code>-</code> لتعطيل الرسالة.' : '';
      return ui(c, `<b>${esc(label)}</b>\n\nالقيمة الحالية:\n${cur}\n\nارسل القيمة الجديدة الان.${hint}`, cancelRow);
    }
    default:
      return scMain(c);
  }
}

// ----------------------------------------------------------------------------
//  نقاط الدخول
// ----------------------------------------------------------------------------
const textResp = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

async function route(request, env, ec) {
  const url = new URL(request.url);
  if (!env.BOT_TOKEN || !env.OWNER_ID || !env.DB) {
    return textResp('Missing configuration: BOT_TOKEN, OWNER_ID and the DB binding are required.', 500);
  }
  if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/webhook')) {
    const secret = await webhookSecret(env);
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) return textResp('forbidden', 403);
    let update;
    try {
      update = await request.json();
    } catch {
      return textResp('bad request', 400);
    }
    ec.waitUntil(handleUpdate(env, ec, update).catch((e) => console.error('update error', (e && e.stack) || e)));
    return textResp('ok');
  }
  if (url.pathname === '/setup') {
    const secret = await webhookSecret(env);
    const hook = await tg(env, 'setWebhook', {
      url: `${url.origin}/webhook`,
      secret_token: secret,
      allowed_updates: ['message', 'edited_message', 'callback_query', 'my_chat_member'],
      drop_pending_updates: url.searchParams.get('drop') === '1',
    });
    const owner = Number(String(env.OWNER_ID).trim());
    await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'بدء' }] });
    await tg(env, 'setMyCommands', {
      commands: [
        { command: 'start', description: 'لوحة التحكم' },
        { command: 'cancel', description: 'الغاء العملية الحالية' },
        { command: 'stats', description: 'الاحصائيات' },
      ],
      scope: { type: 'chat', chat_id: owner },
    });
    await initDb(env);
    return new Response(JSON.stringify({ webhook: hook, webhook_url: `${url.origin}/webhook`, note: 'ارسل /start للبوت من حساب المالك لفتح لوحة التحكم' }, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  return textResp('Anonymous contact bot is running.');
}

async function tick(env) {
  await initDb(env);
  const db = dbHelper(env);
  if (new Date().getUTCMinutes() === 0) {
    await db.run('DELETE FROM msgmap WHERE created < ?', now() - 45 * 86400);
    await db.run('DELETE FROM rate WHERE win < ?', Math.floor(now() / 60) - 5);
  }
  await runBroadcastBatch(env, batchSize(env));
}

export default {
  async fetch(request, env, ec) {
    try {
      return await route(request, env, ec);
    } catch (e) {
      console.error('fetch error', (e && e.stack) || e);
      return textResp('error', 500);
    }
  },
  async scheduled(event, env, ec) {
    ec.waitUntil(tick(env).catch((e) => console.error('tick error', (e && e.stack) || e)));
  },
};

// للاختبار فقط
export { fmtTime, fmtDate, applyVars, normalizeLayout, handleUpdate, tick, runBroadcastBatch };
