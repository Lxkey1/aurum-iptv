/** Formatting helpers shared across views. */

const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');

/** Seconds -> "1:02:03" or "02:03". */
export function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Minutes -> "2h 14m". */
export function runtime(minutes) {
  const total = Math.round(Number(minutes) || 0);
  if (!total) return '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${m ? `${m}m` : ''}`.trim() : `${m}m`;
}

/** Accepts "01:42:30", "6120" (seconds) or a number of minutes. */
export function parseDuration(value) {
  if (value === null || value === undefined || value === '') return 0;
  const str = String(value).trim();
  if (str.includes(':')) {
    const parts = str.split(':').map(Number);
    if (parts.some(Number.isNaN)) return 0;
    return parts.reduce((acc, part) => acc * 60 + part, 0);
  }
  const num = Number(str);
  return Number.isFinite(num) ? num : 0;
}

export const timeHM = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export const dateShort = (ms) =>
  new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

export function relativeDay(ms) {
  const d = new Date(ms);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(today)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}

export function bitrate(bps) {
  if (!bps || !Number.isFinite(bps)) return '—';
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mbps`;
  return `${(bps / 1e3).toFixed(0)} kbps`;
}

export function bytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Xtream "exp_date" is a unix timestamp string; may be null for unlimited. */
export function expiryText(expDate) {
  if (!expDate || expDate === 'null') return { text: 'Unlimited', tone: 'ok' };
  const ms = Number(expDate) * 1000;
  if (!Number.isFinite(ms)) return { text: '—', tone: '' };
  const days = Math.ceil((ms - Date.now()) / 86400000);
  const label = new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  if (days < 0) return { text: `Expired ${label}`, tone: 'bad' };
  if (days <= 7) return { text: `${label} · ${days}d left`, tone: 'warn' };
  return { text: `${label} · ${days}d left`, tone: 'ok' };
}

/** Provider channel names are noisy — strip the country/quality prefixes for display. */
export function tidyChannelName(name) {
  return String(name || '')
    .replace(/^\s*[|[(]?\s*[A-Z]{2,3}\s*[|\])]\s*[:-]?\s*/, '')
    .trim() || String(name || '');
}

/** A stable, filesystem-safe key for continue-watching entries. */
export function progressKey(type, id, extra) {
  return [type, id, extra].filter(Boolean).join(':');
}

/** Strip HTML that some panels embed in plot fields. */
export function plainText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalise the many shapes Xtream returns for a list of names. */
export function listOf(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function firstOf(obj, keys, fallback = '') {
  for (const key of keys) {
    const value = obj && obj[key];
    if (value !== undefined && value !== null && value !== '' && value !== '0') return value;
  }
  return fallback;
}

/** Sort helper that keeps numeric-ish channel numbers in order. */
export function byNumber(a, b) {
  return (Number(a) || 0) - (Number(b) || 0);
}

export function debounce(fn, ms = 240) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function throttle(fn, ms = 100) {
  let last = 0;
  let queued = null;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!queued) {
      queued = setTimeout(() => {
        queued = null;
        last = Date.now();
        fn(...args);
      }, ms - (now - last));
    }
  };
}
