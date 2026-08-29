/** Settings: account, playback, guide and maintenance. */

import { h, icon, clear } from '../util/dom.js';
import { expiryText, bytes } from '../util/format.js';
import { toast, toastOk, toastErr, confirmDialog } from '../ui/feedback.js';
import * as store from '../state.js';

const ACCENTS = [
  { id: 'gold', label: 'Champagne', swatch: '#E3C77E' },
  { id: 'platinum', label: 'Platinum', swatch: '#D8DEE9' },
  { id: 'rose', label: 'Rose', swatch: '#E8A0A8' },
  { id: 'emerald', label: 'Emerald', swatch: '#7FD3A8' },
  { id: 'sapphire', label: 'Sapphire', swatch: '#8FB6F0' }
];

const USER_AGENTS = [
  'VLC/3.0.20 LibVLC/3.0.20',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Lavf/60.16.100',
  'IPTVSmarters/1.0',
  'TiviMate/4.7.0 (Android)'
];

export async function renderSettings(host, { navigate, onLogout }) {
  clear(host);
  const page = h('div.page');
  host.appendChild(page);

  page.appendChild(
    h('div.page__head', h('div.page__title', h('h1', 'Settings'), h('p', `Aurum IPTV ${store.state.appVersion}`)))
  );

  const grid = h('div.settings-grid');
  page.appendChild(grid);

  grid.append(
    accountCard(onLogout),
    playbackCard(),
    guideCard(),
    appearanceCard(),
    maintenanceCard(host, navigate),
    aboutCard()
  );
}

// ---------------------------------------------------------------- account

function accountCard(onLogout) {
  const account = store.state.account || {};
  const info = account.userInfo || {};
  const server = account.serverInfo || {};
  const creds = account.credentials || {};

  const exp = expiryText(info.exp_date);
  const active = String(info.status || '').toLowerCase();

  const card = h(
    'div.card',
    h('div.card__title', icon('user'), 'Account'),
    h(
      'div.stat-grid',
      stat('Username', info.username || creds.username || '—'),
      stat('Status', info.status || '—', active === 'active' ? 'ok' : 'warn'),
      stat('Expires', exp.text, exp.tone),
      stat('Connections', `${info.active_cons ?? '0'} of ${info.max_connections ?? '—'}`,
        Number(info.active_cons) >= Number(info.max_connections) ? 'warn' : ''),
      stat('Server', creds.host ? String(creds.host).replace(/^https?:\/\//, '') : '—'),
      stat('Timezone', server.timezone || '—')
    ),
    h(
      'div.row.gap-3',
      { style: { marginTop: '20px' } },
      h(
        'button.btn.btn--sm',
        {
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              const fresh = await window.aurum.xtream.accountInfo();
              if (fresh.ok) {
                store.state.account = { ...store.state.account, ...fresh.data };
                toastOk('Account refreshed');
                const parent = card.parentElement;
                const replacement = accountCard(onLogout);
                parent.replaceChild(replacement, card);
              } else {
                toastErr('Could not refresh', fresh.error);
              }
            } finally {
              btn.disabled = false;
            }
          }
        },
        icon('refresh', 14),
        'Refresh'
      ),
      h(
        'button.btn.btn--sm.btn--danger',
        {
          onclick: async () => {
            const yes = await confirmDialog({
              title: 'Sign out?',
              message: 'Your saved credentials, cached catalogue and downloaded TV guide will be removed from this PC.',
              confirmText: 'Sign out',
              danger: true
            });
            if (yes) onLogout();
          }
        },
        icon('logout', 14),
        'Sign out'
      )
    )
  );
  return card;
}

// ---------------------------------------------------------------- playback

function playbackCard() {
  const s = store.state.settings;

  const formatSelect = h(
    'select.select',
    {
      onchange: async (e) => {
        await store.updateSettings({ liveFormat: e.target.value });
        toast('Live format changed', 'This applies the next time you open a channel.');
      }
    },
    h('option', { value: 'ts', selected: s.liveFormat === 'ts' }, 'MPEG-TS (.ts) — most compatible'),
    h('option', { value: 'm3u8', selected: s.liveFormat === 'm3u8' }, 'HLS (.m3u8) — allows quality switching')
  );

  const uaSelect = h(
    'select.select',
    {
      style: { maxWidth: '260px' },
      onchange: async (e) => {
        await store.updateSettings({ userAgent: e.target.value });
        toast('User agent changed', 'Some providers only serve specific players.');
      }
    },
    USER_AGENTS.map((ua) =>
      h('option', { value: ua, selected: ua === s.userAgent }, ua.length > 42 ? `${ua.slice(0, 42)}…` : ua)
    )
  );

  return h(
    'div.card',
    h('div.card__title', icon('play'), 'Playback'),
    setting(
      'Live stream format',
      'MPEG-TS works on nearly every line. HLS is worth trying if a channel stalls, and is the only format that exposes multiple quality levels.',
      formatSelect
    ),
    setting(
      'Player identity',
      'The User-Agent Aurum sends when fetching streams. Some providers block anything that does not look like a known IPTV player.',
      uaSelect
    ),
    setting(
      'Hardware acceleration',
      'Uses your GPU to decode video. Turn this off only if you see green artefacts or crashes — it needs a restart.',
      toggle(s.hwAccel, async (value) => {
        await store.updateSettings({ hwAccel: value });
        toast('Restart required', 'Close and reopen Aurum for this to take effect.');
      })
    ),
    setting(
      'Reduce motion',
      'Disables transitions and the home-screen carousel animation.',
      toggle(s.reduceMotion, (value) => store.updateSettings({ reduceMotion: value }))
    )
  );
}

// ------------------------------------------------------------------- guide

function guideCard() {
  const s = store.state.settings;
  const stats = store.state.epg.stats;

  const progressBar = h('i', { style: { width: '0%' } });
  const progressWrap = h('div.epg-progress.hidden', progressBar);
  const statusLine = h('p.dim', { style: { fontSize: '12px', marginTop: '8px' } },
    stats
      ? `${stats.programmes.toLocaleString()} programmes · ${stats.channelsWithData.toLocaleString()} channels with data · ${store.state.epg.matched.toLocaleString()} matched to your line`
      : 'The guide has not been downloaded yet.');

  const downloadBtn = h(
    'button.btn.btn--sm.btn--primary',
    {
      onclick: async () => {
        downloadBtn.disabled = true;
        progressWrap.classList.remove('hidden');
        const unsub = window.aurum.epg.onProgress((p) => {
          progressBar.style.width = `${p.pct || 0}%`;
          statusLine.textContent = p.text || '';
        });
        try {
          const result = await store.refreshEpg(true);
          if (result && result.ok) {
            toastOk('Guide updated', `${result.stats.programmes.toLocaleString()} programmes indexed.`);
            statusLine.textContent = `${result.stats.programmes.toLocaleString()} programmes · ${result.stats.channelsWithData.toLocaleString()} channels with data`;
          } else {
            toastErr('Guide download failed', (result && result.error) || 'Unknown error');
            statusLine.textContent = (result && result.error) || '';
          }
        } catch (err) {
          toastErr('Guide download failed', err.message);
        } finally {
          unsub();
          downloadBtn.disabled = false;
          progressBar.style.width = '0%';
          progressWrap.classList.add('hidden');
        }
      }
    },
    icon('download', 14),
    stats ? 'Update now' : 'Download guide'
  );

  const forwardSelect = h(
    'select.select',
    { onchange: (e) => store.updateSettings({ epgWindowHoursForward: Number(e.target.value) }) },
    [24, 48, 72, 120, 168].map((hours) =>
      h('option', { value: hours, selected: Number(s.epgWindowHoursForward) === hours },
        hours >= 24 ? `${hours / 24} days` : `${hours} hours`)
    )
  );

  return h(
    'div.card',
    h('div.card__title', icon('guide'), 'TV guide'),
    setting(
      'Guide data',
      'Aurum downloads your provider’s XMLTV file and indexes it on a background thread. Refresh it once a day or so.',
      downloadBtn
    ),
    progressWrap,
    statusLine,
    setting(
      'How far ahead to keep',
      'A longer window uses more memory and takes longer to index. Three days suits most people.',
      forwardSelect
    ),
    setting(
      'Load automatically at sign-in',
      'Downloads the guide in the background when Aurum starts.',
      toggle(s.epgAutoLoad, (value) => store.updateSettings({ epgAutoLoad: value }))
    ),
    setting(
      'Delete guide data',
      'Frees the cached index. You can download it again at any time.',
      h(
        'button.btn.btn--sm.btn--danger',
        {
          onclick: async () => {
            await store.clearEpg();
            store.state.epg = { ready: false, loading: false, stats: null, matched: 0 };
            toast('Guide data deleted');
            statusLine.textContent = 'The guide has not been downloaded yet.';
          }
        },
        icon('trash', 14),
        'Delete'
      )
    )
  );
}

// -------------------------------------------------------------- appearance

function appearanceCard() {
  const s = store.state.settings;

  const swatches = h(
    'div.row.gap-2',
    ACCENTS.map((accent) =>
      h('button', {
        title: accent.label,
        style: {
          width: '30px',
          height: '30px',
          borderRadius: '50%',
          background: accent.swatch,
          border: s.accent === accent.id ? '2px solid var(--text)' : '2px solid transparent',
          boxShadow: s.accent === accent.id ? '0 0 0 2px var(--bg-base), 0 0 14px rgba(0,0,0,.5)' : 'none',
          cursor: 'pointer'
        },
        onclick: async (e) => {
          await store.updateSettings({ accent: accent.id });
          Array.from(e.currentTarget.parentElement.children).forEach((el) => {
            el.style.border = '2px solid transparent';
            el.style.boxShadow = 'none';
          });
          e.currentTarget.style.border = '2px solid var(--text)';
          e.currentTarget.style.boxShadow = '0 0 0 2px var(--bg-base), 0 0 14px rgba(0,0,0,.5)';
        }
      })
    )
  );

  const startSelect = h(
    'select.select',
    { onchange: (e) => store.updateSettings({ startPage: e.target.value }) },
    [
      ['home', 'Home'],
      ['live', 'Live TV'],
      ['guide', 'TV Guide'],
      ['movies', 'Films'],
      ['series', 'Box sets'],
      ['favourites', 'My collection']
    ].map(([id, label]) => h('option', { value: id, selected: s.startPage === id }, label))
  );

  return h(
    'div.card',
    h('div.card__title', icon('sliders'), 'Appearance'),
    setting('Accent colour', 'Sets the highlight colour used throughout the app.', swatches),
    setting('Open on', 'Which page Aurum shows when it starts.', startSelect)
  );
}

// ------------------------------------------------------------ maintenance

function maintenanceCard(host, navigate) {
  return h(
    'div.card',
    h('div.card__title', icon('refresh'), 'Data & cache'),
    setting(
      'Refresh catalogue',
      'Clears the cached channel, film and series lists and pulls fresh copies from your provider.',
      h(
        'button.btn.btn--sm',
        {
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await store.clearCache();
              await Promise.allSettled([
                store.ensureLive(true),
                store.ensureMovies(true),
                store.ensureSeries(true)
              ]);
              toastOk('Catalogue refreshed',
                `${store.state.liveChannels.length.toLocaleString()} channels · ${store.state.movies.length.toLocaleString()} films · ${store.state.series.length.toLocaleString()} box sets`);
            } catch (err) {
              toastErr('Refresh failed', err.message);
            } finally {
              btn.disabled = false;
            }
          }
        },
        icon('refresh', 14),
        'Refresh'
      )
    ),
    setting(
      'Clear watch history',
      'Removes every “continue watching” entry. Favourites are kept.',
      h(
        'button.btn.btn--sm.btn--danger',
        {
          onclick: async () => {
            const yes = await confirmDialog({
              title: 'Clear watch history?',
              message: 'Every partly-watched film and episode will be forgotten.',
              confirmText: 'Clear',
              danger: true
            });
            if (!yes) return;
            for (const key of Object.keys(store.state.continueWatching)) await store.removeProgress(key);
            toast('Watch history cleared');
          }
        },
        icon('trash', 14),
        'Clear'
      )
    )
  );
}

function aboutCard() {
  return h(
    'div.card',
    h('div.card__title', icon('shield'), 'About & privacy'),
    h(
      'p.muted',
      { style: { fontSize: '13px', lineHeight: '1.7' } },
      'Aurum is a player only. It does not host, provide or resell any channels — everything you see comes from the Xtream Codes line you signed in with.'
    ),
    h(
      'p.dim',
      { style: { fontSize: '12.5px', lineHeight: '1.7', marginTop: '12px' } },
      'Your username and password are encrypted with Windows Data Protection and stored locally. Nothing is sent anywhere except your own provider.'
    ),
    h(
      'div.row.gap-3.wrap',
      { style: { marginTop: '16px' } },
      h('span.badge', 'Electron'),
      h('span.badge', 'hls.js'),
      h('span.badge', 'mpegts.js'),
      h('span.badge', `v${store.state.appVersion}`)
    ),
    h(
      'div',
      { style: { marginTop: '18px' } },
      h('div.card__title', { style: { marginBottom: '10px' } }, icon('zap'), 'Keyboard shortcuts'),
      shortcutList()
    )
  );
}

function shortcutList() {
  const rows = [
    ['Ctrl K', 'Focus search'],
    ['Ctrl B', 'Collapse sidebar'],
    ['Space / K', 'Play or pause'],
    ['← →', 'Skip 10 seconds (Shift for 60)'],
    ['↑ ↓', 'Volume'],
    ['Page Up / Down', 'Previous / next channel'],
    ['L', 'Channel list while playing'],
    ['I', 'Stream statistics'],
    ['F', 'Favourite the current item'],
    ['P', 'Picture in picture'],
    ['F11', 'Fullscreen'],
    ['Esc', 'Back / close']
  ];
  return h(
    'div.col.gap-2',
    rows.map(([key, label]) =>
      h(
        'div.row.gap-3',
        { style: { fontSize: '12.5px' } },
        h('span.kbd', { style: { minWidth: '92px', textAlign: 'center' } }, key),
        h('span.muted', label)
      )
    )
  );
}

// ---------------------------------------------------------------- helpers

function setting(label, desc, control) {
  return h(
    'div.setting',
    h('div.setting__text', h('div.setting__label', label), h('div.setting__desc', desc)),
    control
  );
}

function toggle(initial, onChange) {
  const el = h('button.switch', { class: initial ? 'on' : '' });
  el.onclick = () => {
    const next = !el.classList.contains('on');
    el.classList.toggle('on', next);
    onChange(next);
  };
  return el;
}

function stat(label, value, tone) {
  return h('div', h('div.stat__label', label), h(`div.stat__value${tone ? `.${tone}` : ''}`, String(value)));
}
