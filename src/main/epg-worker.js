'use strict';

/**
 * Worker thread: downloads xmltv.php and turns it into a compact, time-windowed
 * index. Full guides are routinely 50-200 MB of XML, so this never runs on the
 * main thread and everything outside the requested window is dropped.
 */

const zlib = require('zlib');
const { parentPort, workerData } = require('worker_threads');

const { url, userAgent, fromMs, toMs } = workerData;

const post = (msg) => parentPort.postMessage(msg);

(async () => {
  try {
    post({ type: 'progress', phase: 'download', text: 'Contacting guide server…', pct: 2 });

    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': userAgent, Accept: '*/*' }
    });
    if (!res.ok) throw new Error(`Guide server responded ${res.status}`);

    const total = Number(res.headers.get('content-length')) || 0;
    const chunks = [];
    let received = 0;

    for await (const chunk of res.body) {
      chunks.push(chunk);
      received += chunk.length;
      const pct = total ? Math.min(60, 2 + (received / total) * 58) : Math.min(55, 2 + received / 900000);
      post({
        type: 'progress',
        phase: 'download',
        text: `Downloading guide — ${formatBytes(received)}${total ? ` of ${formatBytes(total)}` : ''}`,
        pct
      });
    }

    let buf = Buffer.concat(chunks);
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      post({ type: 'progress', phase: 'parse', text: 'Decompressing…', pct: 62 });
      buf = zlib.gunzipSync(buf);
    }

    post({ type: 'progress', phase: 'parse', text: 'Reading channels…', pct: 66 });
    const xml = buf.toString('utf8');
    buf = null;

    const result = parseXmltv(xml, fromMs, toMs, (pct, text) =>
      post({ type: 'progress', phase: 'parse', text, pct: 66 + pct * 0.33 })
    );

    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
})();

// ------------------------------------------------------------------ parsing

function parseXmltv(xml, fromMs, toMs, onProgress) {
  const channels = Object.create(null);
  const programmes = Object.create(null);
  const displayNameIndex = Object.create(null);

  // ---- <channel id="..."> blocks
  let cursor = 0;
  for (;;) {
    const open = xml.indexOf('<channel ', cursor);
    if (open === -1) break;
    const close = xml.indexOf('</channel>', open);
    if (close === -1) break;

    const block = xml.slice(open, close);
    const id = attr(block, 'id');
    if (id) {
      const name = decode(tagText(block, 'display-name') || id);
      const icon = attrOfTag(block, 'icon', 'src') || '';
      channels[id] = { id, name, icon };
      const key = normalize(name);
      if (key && !displayNameIndex[key]) displayNameIndex[key] = id;
    }
    cursor = close + 10;
  }

  onProgress(0.1, `Indexed ${Object.keys(channels).length.toLocaleString()} guide channels`);

  // ---- <programme start="..." stop="..." channel="...">
  cursor = 0;
  let seen = 0;
  let kept = 0;
  const len = xml.length;

  for (;;) {
    const open = xml.indexOf('<programme', cursor);
    if (open === -1) break;
    const headEnd = xml.indexOf('>', open);
    if (headEnd === -1) break;

    const selfClosing = xml.charAt(headEnd - 1) === '/';
    const head = xml.slice(open, headEnd);

    let body = '';
    if (selfClosing) {
      cursor = headEnd + 1;
    } else {
      const close = xml.indexOf('</programme>', headEnd);
      if (close === -1) break;
      body = xml.slice(headEnd + 1, close);
      cursor = close + 12;
    }

    seen += 1;
    if ((seen & 0x3fff) === 0) {
      onProgress(0.1 + (open / len) * 0.9, `Parsing programmes — ${kept.toLocaleString()} in window`);
    }

    const channelId = attr(head, 'channel');
    if (!channelId) continue;

    const start = parseXmltvTime(attr(head, 'start'));
    const stop = parseXmltvTime(attr(head, 'stop'));
    if (!start || !stop) continue;
    if (stop <= fromMs || start >= toMs) continue;

    const entry = { s: start, e: stop, t: decode(tagText(body, 'title')) || 'No information' };
    const desc = decode(tagText(body, 'desc'));
    if (desc) entry.d = desc.length > 900 ? `${desc.slice(0, 900)}…` : desc;
    const cat = decode(tagText(body, 'category'));
    if (cat) entry.c = cat;

    (programmes[channelId] || (programmes[channelId] = [])).push(entry);
    kept += 1;
  }

  for (const list of Object.values(programmes)) list.sort((a, b) => a.s - b.s);

  return {
    channels,
    programmes,
    displayNameIndex,
    stats: {
      channels: Object.keys(channels).length,
      channelsWithData: Object.keys(programmes).length,
      programmes: kept,
      from: fromMs,
      to: toMs,
      builtAt: Date.now()
    }
  };
}

function attr(source, name) {
  let i = source.indexOf(`${name}="`);
  let quote = '"';
  if (i === -1) {
    i = source.indexOf(`${name}='`);
    if (i === -1) return '';
    quote = "'";
  }
  const start = i + name.length + 2;
  const end = source.indexOf(quote, start);
  if (end === -1) return '';
  return decode(source.slice(start, end));
}

function tagText(source, tag) {
  const open = source.indexOf(`<${tag}`);
  if (open === -1) return '';
  const headEnd = source.indexOf('>', open);
  if (headEnd === -1) return '';
  if (source.charAt(headEnd - 1) === '/') return '';
  const close = source.indexOf(`</${tag}>`, headEnd);
  if (close === -1) return '';
  return source.slice(headEnd + 1, close).trim();
}

function attrOfTag(source, tag, name) {
  const open = source.indexOf(`<${tag}`);
  if (open === -1) return '';
  const headEnd = source.indexOf('>', open);
  if (headEnd === -1) return '';
  return attr(source.slice(open, headEnd), name);
}

/** "20240131203000 +0100" -> epoch ms */
function parseXmltvTime(value) {
  if (!value || value.length < 14) return 0;
  const y = +value.slice(0, 4);
  const mo = +value.slice(4, 6) - 1;
  const d = +value.slice(6, 8);
  const h = +value.slice(8, 10);
  const mi = +value.slice(10, 12);
  const s = +value.slice(12, 14) || 0;
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return 0;

  let ms = Date.UTC(y, mo, d, h, mi, s);
  const tz = value.slice(14).trim();
  if (tz && (tz.charAt(0) === '+' || tz.charAt(0) === '-')) {
    const sign = tz.charAt(0) === '-' ? 1 : -1;
    const oh = +tz.slice(1, 3) || 0;
    const om = +tz.slice(3, 5) || 0;
    ms += sign * (oh * 60 + om) * 60000;
  }
  return ms;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(str) {
  if (!str || str.indexOf('&') === -1) return str || '';
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code) => {
    if (code.charAt(0) === '#') {
      const hex = code.charAt(1) === 'x' || code.charAt(1) === 'X';
      const num = hex ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(num) && num > 0 ? String.fromCodePoint(num) : match;
    }
    const hit = ENTITIES[code.toLowerCase()];
    return hit === undefined ? match : hit;
  });
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
