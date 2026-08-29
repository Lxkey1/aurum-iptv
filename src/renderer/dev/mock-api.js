/**
 * DEV ONLY — a fake `window.aurum` so the whole UI can be exercised in a plain
 * browser without a real Xtream line. Loaded by dev-preview.html; never shipped
 * (see the "files" globs in package.json).
 */
(function mockAurum() {
  const ok = (data) => Promise.resolve({ ok: true, data });
  const fail = (error) => Promise.resolve({ ok: false, error, code: 'MOCK' });

  const rand = (seed) => {
    let x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };

  const GENRES = ['Drama', 'Action', 'Comedy', 'Documentary', 'Thriller', 'Sci-Fi', 'Sport'];
  const COUNTRIES = ['UK', 'US', 'IE', 'CA', 'AU'];

  // ---------------------------------------------------------- fake catalogue

  const liveCategories = [
    { category_id: '1', category_name: 'UK | Entertainment' },
    { category_id: '2', category_name: 'UK | Sports' },
    { category_id: '3', category_name: 'UK | Movies' },
    { category_id: '4', category_name: 'US | News' },
    { category_id: '5', category_name: 'Documentary' },
    { category_id: '6', category_name: 'Kids' }
  ];

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

  const liveStreams = CHANNEL_NAMES.map((name, i) => ({
    num: i + 1,
    name,
    stream_type: 'live',
    stream_id: 1000 + i,
    stream_icon: '',
    epg_channel_id: `mock.${i}`,
    added: String(Math.floor(Date.now() / 1000) - i * 8000),
    category_id: String(Math.min(6, Math.floor(i / 7) + 1)),
    tv_archive: i % 3 === 0 ? 1 : 0,
    direct_source: ''
  }));

  const MOVIE_TITLES = [
    'The Midnight Archive', 'Northern Lights', 'Cold Harbour', 'The Glass Quarter', 'Salt & Iron',
    'A Quiet Signal', 'The Long Descent', 'Paper Cities', 'Whitecap', 'The Gilded Room',
    'Static Bloom', 'Hollow Point', 'The Cartographer', 'Nine Lives of Winter', 'Redwood Falls',
    'The Amber Line', 'Dust and Ashes', 'Blue Hour', 'The Last Ferry', 'Ironwood',
    'Ember Court', 'The Silent Orchard', 'Nightjar', 'Copper Sky', 'The Third Bell',
    'Featherstone', 'Low Tide', 'The Errand', 'Marble Heart', 'Vanishing Point'
  ];

  const vodCategories = [
    { category_id: '10', category_name: 'New Releases' },
    { category_id: '11', category_name: 'Action & Adventure' },
    { category_id: '12', category_name: 'Drama' },
    { category_id: '13', category_name: '4K UHD' }
  ];

  const vodStreams = MOVIE_TITLES.map((name, i) => ({
    num: i + 1,
    name,
    stream_type: 'movie',
    stream_id: 5000 + i,
    stream_icon: '',
    rating: (5 + rand(i) * 5).toFixed(1),
    rating_5based: 4,
    added: String(Math.floor(Date.now() / 1000) - i * 40000),
    category_id: String(10 + (i % 4)),
    container_extension: 'mp4',
    year: String(2015 + (i % 10)),
    genre: GENRES[i % GENRES.length],
    plot: 'A slow-burning story about people at the edge of something they cannot name, told across one long winter.'
  }));

  const SERIES_TITLES = [
    'The Fold', 'Harrowgate', 'Signal Hill', 'The Pale Coast', 'Eastwater',
    'Chapter and Verse', 'The Understudy', 'Marram', 'Deep Field', 'The Quiet Part',
    'Ravensbourne', 'Sixth Sunday'
  ];

  const seriesCategories = [
    { category_id: '20', category_name: 'Box Sets' },
    { category_id: '21', category_name: 'Crime & Mystery' },
    { category_id: '22', category_name: 'Comedy' }
  ];

  const seriesList = SERIES_TITLES.map((name, i) => ({
    num: i + 1,
    name,
    series_id: 9000 + i,
    cover: '',
    plot: 'Six episodes of very good television about a town that keeps its secrets badly.',
    cast: 'A. Player, B. Performer, C. Thespian',
    director: 'D. Filmmaker',
    genre: GENRES[i % GENRES.length],
    releaseDate: `${2018 + (i % 7)}-03-14`,
    last_modified: String(Math.floor(Date.now() / 1000) - i * 90000),
    rating: (6 + rand(i + 99) * 4).toFixed(1),
    category_id: String(20 + (i % 3))
  }));

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
    const base = new Date().setMinutes(0, 0, 0) - 4 * 3600 * 1000;
    let cursor = base;
    for (let i = 0; i < 60; i += 1) {
      const mins = [30, 45, 60, 90, 120][Math.floor(rand(idx * 100 + i) * 5)];
      const start = cursor;
      const end = cursor + mins * 60000;
      out.push({
        s: start,
        e: end,
        t: PROGRAMME_TITLES[(idx + i) % PROGRAMME_TITLES.length],
        d: 'A programme description supplied by the mock guide, long enough to show how the detail sheet wraps a couple of lines of copy.',
        c: GENRES[(idx + i) % GENRES.length]
      });
      cursor = end;
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
    catchupEnabled: true
  };

  const favorites = { live: ['1000', '1012'], movie: ['5003'], series: ['9001'] };
  const continueWatching = {
    'movie:5001': {
      key: 'movie:5001', type: 'movie', id: 5001, name: MOVIE_TITLES[1],
      cover: '', position: 1840, duration: 6900, updatedAt: Date.now() - 3600000, ext: 'mp4'
    },
    'episode:70011': {
      key: 'episode:70011', type: 'episode', id: 70011, seriesId: 9000,
      name: SERIES_TITLES[0], subtitle: 'S01E02 · The Second Door',
      cover: '', position: 900, duration: 2700, updatedAt: Date.now() - 7200000,
      ext: 'mp4', meta: { season: '1', episode: 2 }
    }
  };

  const epgProgressListeners = new Set();

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
      login: ({ server, username, password }) => {
        if (!password || password === 'wrong') return fail('Incorrect username or password.');
        return ok(accountPayload(server, username));
      },
      restore: () => ok(accountPayload('http://mock.provider.tv:8080', 'demo_user')),
      hasProfile: () => ok(window.__MOCK_SIGNED_IN__ !== false),
      logout: () => { window.__MOCK_SIGNED_IN__ = false; return ok(true); }
    },
    xtream: {
      liveCategories: () => ok(liveCategories),
      vodCategories: () => ok(vodCategories),
      seriesCategories: () => ok(seriesCategories),
      liveStreams: () => ok(liveStreams),
      vodStreams: () => ok(vodStreams),
      series: () => ok(seriesList),
      seriesInfo: (seriesId) => ok(mockSeriesInfo(seriesId)),
      vodInfo: (vodId) => ok(mockVodInfo(vodId)),
      shortEpg: () => ok({ epg_listings: [] }),
      streamUrl: (type, id, ext) => ok(`http://mock.provider.tv:8080/${type}/demo_user/secret/${id}.${ext || 'ts'}`),
      catchupUrl: () => ok('http://mock.provider.tv:8080/streaming/timeshift.php'),
      accountInfo: () => ok(accountPayload('http://mock.provider.tv:8080', 'demo_user'))
    },
    epg: {
      status: () => ok({ loading: false, ready: epgReady, error: null, stats: epgStats() }),
      refresh: () => new Promise((resolve) => {
        let pct = 0;
        const timer = setInterval(() => {
          pct += 12;
          epgProgressListeners.forEach((fn) =>
            fn({ phase: pct < 60 ? 'download' : 'parse', text: pct < 60 ? `Downloading guide — ${pct} MB` : 'Parsing programmes…', pct })
          );
          if (pct >= 100) {
            clearInterval(timer);
            epgReady = true;
            epgProgressListeners.forEach((fn) => fn({ phase: 'done', text: 'Guide ready', pct: 100 }));
            resolve({ ok: true, data: { ok: true, stats: epgStats() } });
          }
        }, 220);
      }),
      cancel: () => ok(true),
      clear: () => { epgReady = false; return ok(true); },
      mapChannels: (channels) => ok({ matched: epgReady ? (channels || []).length : 0, total: (channels || []).length, ready: epgReady }),
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
        for (const channel of liveStreams.slice(0, 12)) {
          for (const p of programmesFor(channel.stream_id)) {
            if (p.e > Date.now() && p.t.toLowerCase().includes(needle)) {
              results.push({ streamId: String(channel.stream_id), channel: channel.name, ...p });
            }
          }
        }
        return ok(results.slice(0, 40));
      },
      onProgress: (fn) => {
        epgProgressListeners.add(fn);
        return () => epgProgressListeners.delete(fn);
      }
    },
    store: {
      getState: () => ok({
        settings, favorites, continueWatching,
        recentChannels: ['1003', '1014', '1025'],
        epg: { loading: false, ready: epgReady, error: null, stats: epgStats() },
        cache: { files: 6, size: 1248000 },
        appVersion: '1.0.0-mock'
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
      ? { channels: 40, channelsWithData: 40, programmes: 2400, from: Date.now() - 6 * 3.6e6, to: Date.now() + 72 * 3.6e6, builtAt: Date.now() }
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
        created_at: String(Math.floor(Date.now() / 1000) - 300 * 86400),
        auth: 1
      },
      serverInfo: { url: 'mock.provider.tv', port: '8080', timezone: 'Europe/London', server_protocol: 'http' },
      credentials: { host: server || 'http://mock.provider.tv:8080', username: username || 'demo_user' }
    };
  }

  function mockVodInfo(vodId) {
    const movie = vodStreams.find((m) => String(m.stream_id) === String(vodId)) || vodStreams[0];
    return {
      info: {
        movie_image: '', name: movie.name, plot: movie.plot,
        cast: 'A. Player, B. Performer, C. Thespian, D. Understudy',
        director: 'E. Auteur', genre: movie.genre,
        releasedate: `${movie.year}-06-01`, rating: movie.rating,
        duration: '1:52:00', duration_secs: 6720, country: 'United Kingdom',
        backdrop_path: [], youtube_trailer: ''
      },
      movie_data: {
        stream_id: movie.stream_id, name: movie.name,
        container_extension: 'mp4', category_id: movie.category_id
      }
    };
  }

  function mockSeriesInfo(seriesId) {
    const series = seriesList.find((s) => String(s.series_id) === String(seriesId)) || seriesList[0];
    const episodes = {};
    const seasonCount = 2 + (Number(seriesId) % 2);
    for (let season = 1; season <= seasonCount; season += 1) {
      episodes[String(season)] = Array.from({ length: 6 }, (_, i) => ({
        id: String(Number(seriesId) * 10 + season * 100 + i),
        episode_num: i + 1,
        title: `Episode ${i + 1}: ${['The Arrival', 'The Second Door', 'Low Water', 'Ash Wednesday', 'The Reckoning', 'Homecoming'][i]}`,
        container_extension: 'mp4',
        season,
        info: {
          movie_image: '', plot: 'Something happens, then something else happens, and by the end of it nobody is quite the same.',
          duration_secs: 2700, duration: '00:45:00', rating: '7.8', releasedate: '2021-04-0' + (i + 1)
        }
      }));
    }
    return {
      info: {
        name: series.name, cover: '', plot: series.plot, cast: series.cast,
        director: series.director, genre: series.genre, releaseDate: series.releaseDate,
        rating: series.rating, backdrop_path: []
      },
      episodes
    };
  }

  console.log('[mock] window.aurum installed —', liveStreams.length, 'channels,', vodStreams.length, 'films,', seriesList.length, 'series');
})();
