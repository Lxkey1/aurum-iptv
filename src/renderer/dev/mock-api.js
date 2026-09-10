/**
 * DEV ONLY — a fake `window.aurum` so the whole UI can be exercised in a plain
 * browser without a real Xtream line. Loaded by dev-preview.html; never shipped
 * (see the "files" globs in package.json).
 *
 * Mirrors the SQLite-backed API: the renderer asks for pages, so this fakes a
 * catalogue big enough that paging actually engages.
 */
(function mockAurum() {
  const ok = (data) => Promise.resolve({ ok: true, data });
  const fail = (error) => Promise.resolve({ ok: false, error, code: 'MOCK' });

  const rand = (seed) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };

  // ---------------------------------------------------------- fake catalogue

  const CHANNEL_NAMES = [
    'BBC One HD', 'BBC Two HD', 'ITV1 HD', 'Channel 4 HD', 'Channel 5 HD', 'Sky Atlantic HD',
    'Sky Showcase', 'Sky Max HD', 'Dave', 'GOLD', 'Comedy Central', 'MTV HD',
    'Sky Sports Main Event 4K', 'Sky Sports Premier League HD', 'Sky Sports Football',
    'TNT Sports 1 HD', 'TNT Sports 2 HD', 'Eurosport 1', 'Sky Sports F1 HD', 'Sky Sports Cricket',
    'Sky Cinema Premiere HD', 'Sky Cinema Hits', 'Sky Cinema Action', 'Film4 HD', 'Great Movies',
    'BBC News HD', 'Sky News HD', 'CNN International', 'Al Jazeera English', 'GB News',
    'Discovery HD', 'National Geographic HD', 'History HD', 'Sky Nature', 'Animal Planet',
    'CBeebies HD', 'CBBC HD', 'Cartoon Network', 'Nickelodeon', 'Disney Channel'
  ];

  const MOVIE_TITLES = [
    'The Midnight Archive', 'Northern Lights', 'Cold Harbour', 'The Glass Quarter', 'Salt & Iron',
    'A Quiet Signal', 'The Long Descent', 'Paper Cities', 'Whitecap', 'The Gilded Room',
    'Static Bloom', 'Hollow Point', 'The Cartographer', 'Nine Lives of Winter', 'Redwood Falls',
    'The Amber Line', 'Dust and Ashes', 'Blue Hour', 'The Last Ferry', 'Ironwood',
    'Ember Court', 'The Silent Orchard', 'Nightjar', 'Copper Sky', 'The Third Bell',
    'Featherstone', 'Low Tide', 'The Errand', 'Marble Heart', 'Vanishing Point'
  ];

  const SERIES_TITLES = [
    'The Fold', 'Harrowgate', 'Signal Hill', 'The Pale Coast', 'Eastwater',
    'Chapter and Verse', 'The Understudy', 'Marram', 'Deep Field', 'The Quiet Part',
    'Ravensbourne', 'Sixth Sunday'
  ];

  const GENRES = ['Drama', 'Action', 'Comedy', 'Documentary', 'Thriller', 'Sci-Fi', 'Sport'];

  // A few hundred of each so paging actually kicks in during preview.
  // Placeholder artwork, so the preview shows the design as it will really look.
  const poster = (i) => `https://picsum.photos/seed/aurum${i}/400/600`;
  const logo = (i) => `https://picsum.photos/seed/logo${i}/160/120`;

  const channels = Array.from({ length: 400 }, (_, i) => ({
    id: String(1000 + i),
    name: CHANNEL_NAMES[i % CHANNEL_NAMES.length] + (i >= CHANNEL_NAMES.length ? ` ${Math.floor(i / CHANNEL_NAMES.length) + 1}` : ''),
    num: i + 1,
    logo: i % 4 === 0 ? '' : logo(i),
    cat: String(1 + (i % 6)),
    epg_id: `mock.${i}`,
    archive: i % 7 === 0 ? 1 : 0,
    added: 1700000000 - i,
    hidden: 0
  }));

  const movies = Array.from({ length: 300 }, (_, i) => ({
    id: String(5000 + i),
    name: MOVIE_TITLES[i % MOVIE_TITLES.length] + (i >= MOVIE_TITLES.length ? ` ${Math.floor(i / MOVIE_TITLES.length) + 1}` : ''),
    cover: poster(i),
    rating: Number((5 + rand(i) * 5).toFixed(1)),
    year: String(2015 + (i % 10)),
    cat: String(10 + (i % 4)),
    ext: 'mp4',
    added: 1700000000 - i * 400,
    genre: GENRES[i % GENRES.length],
    plot: 'A slow-burning story about people at the edge of something they cannot name, told across one long winter.'
  }));

  const series = Array.from({ length: 120 }, (_, i) => ({
    id: String(9000 + i),
    name: SERIES_TITLES[i % SERIES_TITLES.length] + (i >= SERIES_TITLES.length ? ` ${Math.floor(i / SERIES_TITLES.length) + 1}` : ''),
    cover: poster(500 + i),
    rating: Number((6 + rand(i + 99) * 4).toFixed(1)),
    year: String(2018 + (i % 7)),
    cat: String(20 + (i % 3)),
    modified: 1700000000 - i * 900,
    genre: GENRES[i % GENRES.length],
    plot: 'Six episodes of very good television about a town that keeps its secrets badly.'
  }));

  const categories = {
    live: [
      { id: '1', name: 'UK | Entertainment', count: 67 },
      { id: '2', name: 'UK | Sports', count: 67 },
      { id: '3', name: 'UK | Movies', count: 67 },
      { id: '4', name: 'US | News', count: 67 },
      { id: '5', name: 'Documentary', count: 66 },
      { id: '6', name: 'Kids', count: 66 }
    ],
    movie: [
      { id: '10', name: 'New Releases', count: 75 },
      { id: '11', name: 'Action & Adventure', count: 75 },
      { id: '12', name: 'Drama', count: 75 },
      { id: '13', name: '4K UHD', count: 75 }
    ],
    series: [
      { id: '20', name: 'Box Sets', count: 40 },
      { id: '21', name: 'Crime & Mystery', count: 40 },
      { id: '22', name: 'Comedy', count: 40 }
    ]
  };

  let groups = [{ id: 1, name: 'My Sports', count: 8 }];

  // ---------------------------------------------------------------- fake EPG

  const PROGRAMME_TITLES = [
    'Morning Report', 'The Nine O’Clock Show', 'Countryfile', 'Live Football: Match Day',
    'The News at Ten', 'Antiques Hour', 'Nature Documentary: Oceans', 'Late Night Talk',
    'Classic Film', 'Quiz Night', 'Drama Series', 'Weather and Travel'
  ];

  let epgReady = false;

  const programmesFor = (streamId) => {
    const idx = Number(streamId) - 1000;
    const out = [];
    let cursor = new Date().setMinutes(0, 0, 0) - 4 * 3600 * 1000;
    for (let i = 0; i < 60; i += 1) {
      const mins = [30, 45, 60, 90, 120][Math.floor(rand(idx * 100 + i) * 5)];
      out.push({
        s: cursor,
        e: cursor + mins * 60000,
        t: PROGRAMME_TITLES[(idx + i) % PROGRAMME_TITLES.length],
        d: 'A programme description supplied by the mock guide, long enough to show how the detail sheet wraps a couple of lines of copy.',
        c: GENRES[(idx + i) % GENRES.length]
      });
      cursor += mins * 60000;
    }
    return out;
  };

  const nowNextFor = (streamId) => {
    const list = programmesFor(streamId);
    const now = Date.now();
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].e > now) {
        const current = list[i].s <= now ? list[i] : null;
        return { now: current, next: current ? list[i + 1] || null : list[i] };
      }
    }
    return { now: null, next: null };
  };

  // ------------------------------------------------------------ local state

  const settings = {
    liveFormat: 'ts',
    userAgent: 'VLC/3.0.20 LibVLC/3.0.20',
    accent: 'gold',
    epgAutoLoad: false,
    epgWindowHoursBack: 6,
    epgWindowHoursForward: 72,
    hwAccel: true,
    volume: 1,
    muted: false,
    fitMode: 'contain',
    reduceMotion: false,
    startPage: 'home',
    catchupEnabled: true,
    tmdbKey: '',
    tmdbLanguage: 'en-GB',
    tmdbAuto: true
  };

  const favorites = { live: ['1000', '1012', '1025'], movie: ['5003', '5007'], series: ['9001'] };
  const continueWatching = {
    'movie:5001': {
      key: 'movie:5001', type: 'movie', id: '5001', name: MOVIE_TITLES[1],
      cover: 'https://picsum.photos/seed/aurum1/400/600', position: 1840, duration: 6900, updatedAt: Date.now() - 3600000, ext: 'mp4'
    },
    'episode:70011': {
      key: 'episode:70011', type: 'episode', id: '70011', seriesId: '9000',
      name: SERIES_TITLES[0], subtitle: 'S01E02 · The Second Door',
      cover: 'https://picsum.photos/seed/aurum500/400/600', position: 900, duration: 2700, updatedAt: Date.now() - 7200000,
      ext: 'mp4', meta: { season: '1', episode: 2 }
    }
  };

  const hidden = new Set();
  const customNames = new Map();
  const epgListeners = new Set();
  const syncListeners = new Set();

  const stats = () => ({
    channels: channels.length,
    movies: movies.length,
    series: series.length,
    hidden: hidden.size,
    groups: groups.length,
    updatedAt: Date.now(),
    sizeBytes: 83_400_000
  });

  const decorate = (c) => ({ ...c, name: customNames.get(c.id) || c.name, hidden: hidden.has(c.id) ? 1 : 0 });

  const filterChannels = ({ category, search, includeHidden, groupId }) => {
    let list = channels.map(decorate);
    if (groupId != null) list = list.slice(0, 8);
    if (!includeHidden) list = list.filter((c) => !c.hidden);
    if (category) list = list.filter((c) => c.cat === String(category));
    if (search) list = list.filter((c) => c.name.toLowerCase().includes(String(search).toLowerCase()));
    return list;
  };

  const sortTitles = (list, sort, recencyKey) => {
    const copy = [...list];
    if (sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'rating') return copy.sort((a, b) => b.rating - a.rating);
    if (sort === 'year') return copy.sort((a, b) => Number(b.year) - Number(a.year));
    return copy.sort((a, b) => b[recencyKey] - a[recencyKey]);
  };

  window.aurum = {
    window: {
      minimize() {}, maximize() {}, close() {}, setFullScreen() {},
      onState: () => () => {}
    },
    app: {
      openExternal: (url) => window.open(url, '_blank'),
      keepAwake() {},
      showError: (t, m) => { alert(`${t}\n\n${m}`); return ok(true); }
    },
    auth: {
      login: ({ server, username, password }) =>
        (!password || password === 'wrong')
          ? fail('Incorrect username or password.')
          : ok(accountPayload(server, username)),
      restore: () => ok(accountPayload('http://mock.provider.tv:8080', 'demo_user')),
      hasProfile: () => ok(window.__MOCK_SIGNED_IN__ !== false),
      logout: () => { window.__MOCK_SIGNED_IN__ = false; return ok(true); }
    },

    catalogue: {
      sync: () => new Promise((resolve) => {
        let pct = 0;
        const timer = setInterval(() => {
          pct += 15;
          syncListeners.forEach((fn) => fn({ text: pct < 50 ? 'Fetching channels…' : 'Indexing…', pct }));
          if (pct >= 100) { clearInterval(timer); resolve({ ok: true, data: stats() }); }
        }, 150);
      }),
      stats: () => ok(stats()),
      categories: (kind) => ok(categories[kind] || []),
      channels: (opts = {}) => {
        const all = filterChannels(opts);
        const { limit = 100, offset = 0 } = opts;
        return ok({ rows: all.slice(offset, offset + limit), total: all.length });
      },
      channelIds: (opts = {}) => ok(filterChannels(opts).map((c) => c.id)),
      titles: (kind, { category, search, sort = 'added', limit = 60, offset = 0 } = {}) => {
        let list = kind === 'movie' ? movies : series;
        if (category) list = list.filter((t) => t.cat === String(category));
        if (search) list = list.filter((t) => t.name.toLowerCase().includes(String(search).toLowerCase()));
        list = sortTitles(list, sort, kind === 'movie' ? 'added' : 'modified');
        return ok({ rows: list.slice(offset, offset + limit), total: list.length });
      },
      byIds: (kind, ids) => {
        const source = kind === 'live' ? channels.map(decorate) : kind === 'movie' ? movies : series;
        const index = new Map(source.map((r) => [String(r.id), r]));
        return ok((ids || []).map((id) => index.get(String(id))).filter(Boolean));
      },
      one: (kind, id) => {
        const source = kind === 'live' ? channels.map(decorate) : kind === 'movie' ? movies : series;
        return ok(source.find((r) => String(r.id) === String(id)) || null);
      },
      search: (term, limit = 60) => {
        const needle = String(term || '').toLowerCase();
        const match = (r) => r.name.toLowerCase().includes(needle);
        return ok({
          live: channels.map(decorate).filter((c) => !c.hidden && match(c)).slice(0, limit),
          movie: movies.filter(match).slice(0, limit),
          series: series.filter(match).slice(0, limit)
        });
      },
      archiveChannels: (limit = 500) => ok(channels.map(decorate).filter((c) => c.archive).slice(0, limit)),
      onProgress: (fn) => { syncListeners.add(fn); return () => syncListeners.delete(fn); }
    },

    channels: {
      setHidden: (ids, h) => {
        (ids || []).forEach((id) => (h ? hidden.add(String(id)) : hidden.delete(String(id))));
        return ok(hidden.size);
      },
      setOrder: () => ok(true),
      rename: (id, name) => { customNames.set(String(id), name); return ok(true); },
      setNumber: () => ok(true),
      resetPrefs: () => { hidden.clear(); customNames.clear(); return ok(true); }
    },

    groups: {
      list: () => ok(groups),
      create: (name) => { const id = groups.length + 1; groups.push({ id, name, count: 0 }); return ok(id); },
      rename: (id, name) => { const g = groups.find((x) => x.id === id); if (g) g.name = name; return ok(true); },
      remove: (id) => { groups = groups.filter((g) => g.id !== id); return ok(true); },
      setChannels: () => ok(true),
      add: (id, ids) => { const g = groups.find((x) => x.id === id); if (g) g.count += (ids || []).length; return ok(true); },
      removeChannels: () => ok(true)
    },

    xtream: {
      seriesInfo: (seriesId) => ok(mockSeriesInfo(seriesId)),
      vodInfo: (vodId) => ok(mockVodInfo(vodId)),
      shortEpg: () => ok({ epg_listings: [] }),
      streamUrl: (type, id, ext) => ok(`http://mock.provider.tv:8080/${type}/demo_user/secret/${id}.${ext || 'ts'}`),
      catchupUrl: () => ok('http://mock.provider.tv:8080/streaming/timeshift.php?mock=1'),
      accountInfo: () => ok(accountPayload('http://mock.provider.tv:8080', 'demo_user'))
    },

    tmdb: {
      status: () => ok({ enabled: false, language: 'en-GB', enriched: 0, notFound: 0 }),
      setKey: (key) => ok({ enabled: Boolean(key) }),
      enrich: () => ok(null),
      clear: () => ok({ enriched: 0, notFound: 0 })
    },

    epg: {
      status: () => ok({ loading: false, ready: epgReady, error: null, stats: epgStats() }),
      refresh: () => new Promise((resolve) => {
        let pct = 0;
        const timer = setInterval(() => {
          pct += 12;
          epgListeners.forEach((fn) =>
            fn({ phase: pct < 60 ? 'download' : 'parse', text: pct < 60 ? `Downloading guide — ${pct} MB` : 'Parsing programmes…', pct })
          );
          if (pct >= 100) {
            clearInterval(timer);
            epgReady = true;
            epgListeners.forEach((fn) => fn({ phase: 'done', text: 'Guide ready', pct: 100 }));
            resolve({ ok: true, data: { ok: true, stats: epgStats() } });
          }
        }, 200);
      }),
      cancel: () => ok(true),
      clear: () => { epgReady = false; return ok(true); },
      mapChannels: () => ok({ matched: epgReady ? channels.length : 0, total: channels.length, ready: epgReady }),
      query: (streamIds, from, to) => {
        const out = {};
        for (const id of streamIds || []) {
          out[id] = epgReady ? programmesFor(id).filter((p) => p.e > from && p.s < to) : [];
        }
        return ok(out);
      },
      nowNext: (streamIds) => {
        const out = {};
        for (const id of streamIds || []) out[id] = epgReady ? nowNextFor(id) : { now: null, next: null };
        return ok(out);
      },
      search: (term) => {
        if (!epgReady) return ok([]);
        const needle = String(term).toLowerCase();
        const results = [];
        for (const channel of channels.slice(0, 12)) {
          for (const p of programmesFor(channel.id)) {
            if (p.e > Date.now() && p.t.toLowerCase().includes(needle)) {
              results.push({ streamId: channel.id, channel: channel.name, ...p });
            }
          }
        }
        return ok(results.slice(0, 40));
      },
      onProgress: (fn) => { epgListeners.add(fn); return () => epgListeners.delete(fn); }
    },

    store: {
      getState: () => ok({
        settings, favorites, continueWatching,
        recentChannels: ['1003', '1014', '1025'],
        epg: { loading: false, ready: epgReady, error: null, stats: epgStats() },
        cache: { files: 6, size: 1248000 },
        catalogue: stats(),
        appVersion: '1.1.0-mock'
      }),
      setSettings: (patch) => { Object.assign(settings, patch); return ok(settings); },
      toggleFavorite: (kind, id) => {
        const list = favorites[kind];
        const key = String(id);
        const i = list.indexOf(key);
        if (i >= 0) list.splice(i, 1); else list.unshift(key);
        return ok({ added: i < 0, favorites });
      },
      saveProgress: (entry) => { continueWatching[entry.key] = { ...entry, updatedAt: Date.now() }; return ok(true); },
      removeProgress: (key) => { delete continueWatching[key]; return ok(true); },
      pushRecentChannel: (id) => ok([String(id), '1003', '1014']),
      clearCache: () => ok(true)
    }
  };

  function epgStats() {
    return epgReady
      ? { channels: 400, channelsWithData: 400, programmes: 24000, from: Date.now() - 6 * 3.6e6, to: Date.now() + 72 * 3.6e6, builtAt: Date.now() }
      : null;
  }

  function accountPayload(server, username) {
    return {
      userInfo: {
        username: username || 'demo_user',
        status: 'Active',
        exp_date: String(Math.floor(Date.now() / 1000) + 62 * 86400),
        is_trial: '0',
        active_cons: '1',
        max_connections: '3',
        auth: 1
      },
      serverInfo: { url: 'mock.provider.tv', port: '8080', timezone: 'Europe/London' },
      credentials: { host: server || 'http://mock.provider.tv:8080', username: username || 'demo_user' }
    };
  }

  function mockVodInfo(vodId) {
    const movie = movies.find((m) => String(m.id) === String(vodId)) || movies[0];
    return {
      info: {
        movie_image: '', name: movie.name, plot: movie.plot,
        cast: 'A. Player, B. Performer, C. Thespian, D. Understudy',
        director: 'E. Auteur', genre: movie.genre,
        releasedate: `${movie.year}-06-01`, rating: movie.rating,
        duration: '1:52:00', duration_secs: 6720, backdrop_path: [], youtube_trailer: ''
      },
      movie_data: { stream_id: movie.id, name: movie.name, container_extension: 'mp4' }
    };
  }

  function mockSeriesInfo(seriesId) {
    const s = series.find((x) => String(x.id) === String(seriesId)) || series[0];
    const episodes = {};
    const seasonCount = 2 + (Number(seriesId) % 2);
    for (let season = 1; season <= seasonCount; season += 1) {
      episodes[String(season)] = Array.from({ length: 6 }, (_, i) => ({
        id: String(Number(seriesId) * 10 + season * 100 + i),
        episode_num: i + 1,
        title: ['The Arrival', 'The Second Door', 'Low Water', 'Ash Wednesday', 'The Reckoning', 'Homecoming'][i],
        container_extension: 'mp4',
        season,
        info: {
          movie_image: '', plot: 'Something happens, then something else happens, and by the end of it nobody is quite the same.',
          duration_secs: 2700, duration: '00:45:00', rating: '7.8', releasedate: `2021-04-0${i + 1}`
        }
      }));
    }
    return {
      info: {
        name: s.name, cover: '', plot: s.plot, cast: 'A. Player, B. Performer',
        director: 'D. Filmmaker', genre: s.genre, releaseDate: `${s.year}-03-14`,
        rating: s.rating, backdrop_path: []
      },
      episodes
    };
  }

  console.log('[mock] window.aurum installed —', channels.length, 'channels,', movies.length, 'films,', series.length, 'series');
})();
