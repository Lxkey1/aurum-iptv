'use strict';

/**
 * Xtream Codes / XUI.one player_api.php client.
 * Runs in the main process so the renderer never has to deal with CORS or
 * credentials, and so responses can be cached across window reloads.
 */

const DEFAULT_TIMEOUT = 25000;

class XtreamError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'XtreamError';
    this.code = code || 'XTREAM_ERROR';
  }
}

/**
 * Accepts anything a provider might hand a user and returns a clean origin plus
 * any credentials embedded in the URL.
 *   http://line.example.com:8080
 *   line.example.com:8080
 *   http://line.example.com:8080/get.php?username=u&password=p&type=m3u_plus
 *   http://line.example.com:8080/player_api.php?username=u&password=p
 */
function parseServerInput(input) {
  const out = { host: '', username: '', password: '' };
  let raw = String(input || '').trim();
  if (!raw) return out;

  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return out;
  }

  out.username = url.searchParams.get('username') || '';
  out.password = url.searchParams.get('password') || '';

  // /live/user/pass/123.ts style links also carry credentials
  const segs = url.pathname.split('/').filter(Boolean);
  const kindIdx = segs.findIndex((s) => ['live', 'movie', 'series'].includes(s.toLowerCase()));
  if (!out.username && kindIdx >= 0 && segs.length >= kindIdx + 3) {
    out.username = segs[kindIdx + 1];
    out.password = segs[kindIdx + 2];
  }

  const port = url.port ? `:${url.port}` : '';
  out.host = `${url.protocol}//${url.hostname}${port}`;
  return out;
}

class XtreamClient {
  /** @param {{host:string, username:string, password:string, userAgent?:string}} cfg */
  constructor(cfg) {
    const parsed = parseServerInput(cfg.host);
    this.host = (parsed.host || String(cfg.host || '')).replace(/\/+$/, '');
    this.username = cfg.username || parsed.username;
    this.password = cfg.password || parsed.password;
    this.userAgent = cfg.userAgent || 'VLC/3.0.20 LibVLC/3.0.20';
  }

  get credentials() {
    return { host: this.host, username: this.username, password: this.password };
  }

  apiUrl(params = {}) {
    const url = new URL(`${this.host}/player_api.php`);
    url.searchParams.set('username', this.username);
    url.searchParams.set('password', this.password);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  xmltvUrl() {
    const url = new URL(`${this.host}/xmltv.php`);
    url.searchParams.set('username', this.username);
    url.searchParams.set('password', this.password);
    return url.toString();
  }

  /** Direct playback URL for a stream. */
  streamUrl(type, id, ext) {
    const u = encodeURIComponent(this.username);
    const p = encodeURIComponent(this.password);
    if (type === 'live') return `${this.host}/live/${u}/${p}/${id}.${ext || 'ts'}`;
    if (type === 'movie') return `${this.host}/movie/${u}/${p}/${id}.${ext || 'mp4'}`;
    if (type === 'series') return `${this.host}/series/${u}/${p}/${id}.${ext || 'mp4'}`;
    return `${this.host}/${type}/${u}/${p}/${id}.${ext || 'ts'}`;
  }

  /**
   * Timeshift / catch-up URL.
   * @param {number} durationMinutes
   * @param {string} start "YYYY-MM-DD:HH-MM"
   */
  catchupUrl(streamId, durationMinutes, start) {
    const u = encodeURIComponent(this.username);
    const p = encodeURIComponent(this.password);
    return `${this.host}/streaming/timeshift.php?username=${u}&password=${p}&stream=${streamId}&start=${encodeURIComponent(start)}&duration=${durationMinutes}`;
  }

  async request(params, { timeout = DEFAULT_TIMEOUT } = {}) {
    const url = this.apiUrl(params);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json, text/plain, */*'
        }
      });
      if (!res.ok) {
        throw new XtreamError(`Server responded ${res.status} ${res.statusText}`, `HTTP_${res.status}`);
      }
      const text = await res.text();
      if (!text.trim()) return null;
      try {
        return JSON.parse(text);
      } catch {
        // some panels wrap output in HTML when the line is blocked
        throw new XtreamError('The server returned an unexpected (non-JSON) response.', 'BAD_RESPONSE');
      }
    } catch (err) {
      if (err.name === 'AbortError') throw new XtreamError('The server took too long to respond.', 'TIMEOUT');
      if (err instanceof XtreamError) throw err;
      throw new XtreamError(err.message || 'Could not reach the server.', 'NETWORK');
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------ calls

  async authenticate() {
    const data = await this.request({});
    if (!data || !data.user_info) {
      throw new XtreamError('Login failed — the server did not return account details.', 'NO_USER_INFO');
    }
    const info = data.user_info;
    if (String(info.auth) === '0') {
      throw new XtreamError('Incorrect username or password.', 'BAD_CREDENTIALS');
    }
    if (info.status && !/active|trial/i.test(String(info.status))) {
      throw new XtreamError(`This account is ${info.status}.`, 'INACTIVE');
    }
    return { userInfo: info, serverInfo: data.server_info || {} };
  }

  liveCategories() { return this.request({ action: 'get_live_categories' }); }
  vodCategories() { return this.request({ action: 'get_vod_categories' }); }
  seriesCategories() { return this.request({ action: 'get_series_categories' }); }

  liveStreams(categoryId) { return this.request({ action: 'get_live_streams', category_id: categoryId }); }
  vodStreams(categoryId) { return this.request({ action: 'get_vod_streams', category_id: categoryId }); }
  seriesList(categoryId) { return this.request({ action: 'get_series', category_id: categoryId }); }

  seriesInfo(seriesId) { return this.request({ action: 'get_series_info', series_id: seriesId }); }
  vodInfo(vodId) { return this.request({ action: 'get_vod_info', vod_id: vodId }); }

  shortEpg(streamId, limit = 8) {
    return this.request({ action: 'get_short_epg', stream_id: streamId, limit });
  }

  fullEpgForChannel(streamId) {
    return this.request({ action: 'get_simple_data_table', stream_id: streamId });
  }
}

module.exports = { XtreamClient, XtreamError, parseServerInput };
