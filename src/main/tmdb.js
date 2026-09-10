'use strict';

/**
 * TMDB metadata enrichment.
 *
 * Provider VOD metadata is thin and inconsistent — often just a title and a
 * low-resolution poster, frequently neither. TMDB fills in a proper backdrop,
 * synopsis, cast, runtime, certification and trailer, which is the difference
 * between a file listing and something that browses like a streaming service.
 *
 * Enrichment happens on demand, when a detail sheet is opened. Batch-enriching
 * a 158,000-title library would be a six-figure number of API calls for titles
 * nobody will ever open; results are cached in the catalogue database so each
 * title is looked up at most once.
 */

const IMAGE_BASE = 'https://image.tmdb.org/t/p';

class TmdbClient {
  constructor(apiKey = '', language = 'en-GB') {
    this.apiKey = apiKey;
    this.language = language;
    /** Serialises requests so a burst of card hovers cannot trip rate limiting. */
    this.queue = Promise.resolve();
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  _url(path, params = {}) {
    const url = new URL(`https://api.themoviedb.org/3${path}`);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('language', this.language);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  async _get(path, params) {
    if (!this.enabled) throw new Error('No TMDB API key is set.');

    // Chain onto the queue so requests go out one at a time.
    const run = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(this._url(path, params), { signal: controller.signal });
        if (res.status === 401) throw new Error('TMDB rejected the API key.');
        if (res.status === 429) throw new Error('TMDB rate limit reached — try again shortly.');
        if (!res.ok) throw new Error(`TMDB responded ${res.status}.`);
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    };

    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async verifyKey() {
    const data = await this._get('/configuration');
    return Boolean(data && data.images);
  }

  /**
   * Provider titles are messy: "EN - The Matrix (1999) [4K]". Strip the noise
   * before searching, or TMDB will not match anything.
   */
  static cleanTitle(raw) {
    let name = String(raw || '');
    name = name.replace(/^\s*[A-Z]{2,3}\s*[-|:]\s*/, '');          // leading country code
    name = name.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');              // bracketed tags
    name = name.replace(/\b(4K|UHD|FHD|HD|SD|HEVC|H265|H264|MULTI|VOSTFR|SUB|DUB)\b/gi, ' ');
    name = name.replace(/\b(19|20)\d{2}\b/g, ' ');                  // year, searched separately
    name = name.replace(/[._]+/g, ' ');
    return name.replace(/\s{2,}/g, ' ').trim();
  }

  static extractYear(raw) {
    const match = String(raw || '').match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : '';
  }

  static image(pathPart, size) {
    return pathPart ? `${IMAGE_BASE}/${size}${pathPart}` : null;
  }

  /** @param {'movie'|'tv'} kind */
  async search(kind, rawTitle, hintYear) {
    const query = TmdbClient.cleanTitle(rawTitle);
    if (!query) return null;
    const year = hintYear || TmdbClient.extractYear(rawTitle);

    const params = { query, include_adult: 'false' };
    if (year) params[kind === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = year;

    let data = await this._get(`/search/${kind}`, params);
    // A wrong year is worse than no year — retry without it before giving up.
    if ((!data.results || !data.results.length) && year) {
      data = await this._get(`/search/${kind}`, { query, include_adult: 'false' });
    }
    return (data.results && data.results[0]) || null;
  }

  async details(kind, id) {
    return this._get(`/${kind}/${id}`, { append_to_response: 'credits,videos,release_dates,content_ratings' });
  }

  /**
   * @returns {object|null} normalised metadata, shaped the same for films and
   *   series so the detail sheet does not need to care which it is.
   */
  async enrich(kind, rawTitle, hintYear) {
    const hit = await this.search(kind, rawTitle, hintYear);
    if (!hit) return null;

    const full = await this.details(kind, hit.id).catch(() => hit);
    const credits = full.credits || {};
    const cast = (credits.cast || []).slice(0, 12).map((c) => c.name);
    const crew = credits.crew || [];
    const director = crew.filter((c) => c.job === 'Director').map((c) => c.name).slice(0, 2);
    const creators = (full.created_by || []).map((c) => c.name);

    const trailer = (full.videos && full.videos.results || [])
      .filter((v) => v.site === 'YouTube' && /trailer|teaser/i.test(v.type))
      .sort((a, b) => (b.type === 'Trailer' ? 1 : 0) - (a.type === 'Trailer' ? 1 : 0))[0];

    return {
      tmdbId: hit.id,
      kind,
      title: full.title || full.name || hit.title || hit.name || '',
      originalTitle: full.original_title || full.original_name || null,
      overview: full.overview || hit.overview || null,
      poster: TmdbClient.image(full.poster_path || hit.poster_path, 'w500'),
      backdrop: TmdbClient.image(full.backdrop_path || hit.backdrop_path, 'w1280'),
      rating: Number(full.vote_average || hit.vote_average || 0) || 0,
      votes: Number(full.vote_count || 0) || 0,
      year: String(full.release_date || full.first_air_date || hit.release_date || hit.first_air_date || '').slice(0, 4) || null,
      runtime: full.runtime || (Array.isArray(full.episode_run_time) ? full.episode_run_time[0] : 0) || 0,
      genres: (full.genres || []).map((g) => g.name),
      cast,
      director: director.length ? director : creators,
      tagline: full.tagline || null,
      certification: extractCertification(full, kind),
      trailerKey: trailer ? trailer.key : null,
      seasons: full.number_of_seasons || null,
      episodes: full.number_of_episodes || null,
      fetchedAt: Date.now()
    };
  }
}

function extractCertification(full, kind) {
  try {
    if (kind === 'movie') {
      const results = (full.release_dates && full.release_dates.results) || [];
      const preferred = results.find((r) => r.iso_3166_1 === 'GB') || results.find((r) => r.iso_3166_1 === 'US');
      const cert = preferred && preferred.release_dates.find((d) => d.certification);
      return cert ? cert.certification : null;
    }
    const results = (full.content_ratings && full.content_ratings.results) || [];
    const preferred = results.find((r) => r.iso_3166_1 === 'GB') || results.find((r) => r.iso_3166_1 === 'US');
    return preferred ? preferred.rating : null;
  } catch {
    return null;
  }
}

module.exports = { TmdbClient };
