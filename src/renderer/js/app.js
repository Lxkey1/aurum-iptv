/** Boot, routing, login and the app shell wiring. */

import { $, h, icon, clear } from './util/dom.js';
import { debounce, expiryText } from './util/format.js';
import { toast, toastOk, toastErr, setStatus, closeModal, isModalOpen } from './ui/feedback.js';
import { initials } from './ui/cards.js';
import { player } from './player/player.js';
import * as store from './state.js';

import { renderHome } from './views/home.js';
import { renderLive } from './views/live.js';
import { renderMovies, renderSeries } from './views/catalogue.js';
import { renderGuide } from './views/guide.js';
import { renderSearch } from './views/search.js';
import { renderFavourites } from './views/favourites.js';
import { renderSettings } from './views/settings.js';

const ROUTES = [
  { id: 'home', label: 'Home', icon: 'home', section: 'Browse', render: renderHome },
  { id: 'live', label: 'Live TV', icon: 'tv', section: 'Browse', render: renderLive },
  { id: 'guide', label: 'TV Guide', icon: 'guide', section: 'Browse', render: renderGuide },
  { id: 'movies', label: 'Films', icon: 'film', section: 'Library', render: renderMovies },
  { id: 'series', label: 'Box sets', icon: 'series', section: 'Library', render: renderSeries },
  { id: 'favourites', label: 'My collection', icon: 'heart', section: 'Library', render: renderFavourites },
  { id: 'search', label: 'Search', icon: 'search', section: null, hidden: true, render: renderSearch },
  { id: 'settings', label: 'Settings', icon: 'settings', section: 'System', render: renderSettings }
];

let currentRoute = '';
let searchQuery = '';

// ---------------------------------------------------------------- routing

async function navigate(routeId, params = {}) {
  const route = ROUTES.find((r) => r.id === routeId);
  if (!route) return;

  currentRoute = routeId;
  paintNav();

  const content = $('#content');
  content.scrollTop = 0;

  try {
    await route.render(content, { navigate, query: params.query ?? searchQuery, onLogout: doLogout });
  } catch (err) {
    console.error(`[route:${routeId}]`, err);
    clear(content).appendChild(
      h(
        'div.page',
        h(
          'div.empty',
          h('div.empty__icon', icon('alert')),
          h('h3', 'This page could not be loaded'),
          h('p', err.message || String(err)),
          h('button.btn.btn--primary', { onclick: () => navigate(routeId, params) }, 'Try again')
        )
      )
    );
  }
}

function paintNav() {
  const nav = $('#nav');
  clear(nav);

  let lastSection = null;
  for (const route of ROUTES) {
    if (route.hidden) continue;
    if (route.section && route.section !== lastSection) {
      nav.appendChild(h('div.nav__section', route.section));
      lastSection = route.section;
    }

    let badge = null;
    if (route.id === 'live' && store.state.liveChannels.length) {
      badge = h('span.nav__badge', formatCount(store.state.liveChannels.length));
    } else if (route.id === 'movies' && store.state.movies.length) {
      badge = h('span.nav__badge', formatCount(store.state.movies.length));
    } else if (route.id === 'series' && store.state.series.length) {
      badge = h('span.nav__badge', formatCount(store.state.series.length));
    } else if (route.id === 'favourites') {
      const total =
        store.state.favorites.live.length + store.state.favorites.movie.length + store.state.favorites.series.length;
      if (total) badge = h('span.nav__badge', String(total));
    }

    nav.appendChild(
      h(
        'button.nav__item',
        {
          class: currentRoute === route.id ? 'active' : '',
          onclick: () => navigate(route.id)
        },
        icon(route.icon),
        h('span.nav__label', route.label),
        badge
      )
    );
  }
}

const formatCount = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

// ------------------------------------------------------------------ login

function showLogin(prefill) {
  $('#login').style.display = 'flex';
  $('#app').classList.add('hidden');
  $('#boot').classList.add('hidden');

  if (prefill) {
    $('#loginServer').value = prefill.host || '';
    $('#loginUser').value = prefill.username || '';
  }
  setTimeout(() => $('#loginServer').focus(), 120);
}

function hideLogin() {
  $('#login').style.display = 'none';
  $('#app').classList.remove('hidden');
}

function bindLogin() {
  const form = $('#loginForm');
  const serverInput = $('#loginServer');
  const userInput = $('#loginUser');
  const passInput = $('#loginPass');
  const errorBox = $('#loginError');
  const errorText = $('#loginErrorText');
  const submit = $('#loginSubmit');
  const submitText = $('#loginSubmitText');
  const rememberBox = $('#rememberBox');

  $('#rememberWrap').addEventListener('click', (e) => {
    e.preventDefault();
    rememberBox.classList.toggle('on');
  });

  $('#togglePass').addEventListener('click', () => {
    passInput.type = passInput.type === 'password' ? 'text' : 'password';
  });

  // Pasting a full get.php / m3u_plus link fills everything in.
  serverInput.addEventListener('input', () => {
    const value = serverInput.value;
    if (!/[?&]username=/i.test(value)) return;
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
      const u = url.searchParams.get('username');
      const p = url.searchParams.get('password');
      if (u) userInput.value = u;
      if (p) passInput.value = p;
      serverInput.value = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
      toast('Link recognised', 'Username and password were filled in from the URL.');
    } catch {
      /* not a URL yet */
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.add('hidden');

    const server = serverInput.value.trim();
    const username = userInput.value.trim();
    const password = passInput.value;

    if (!server) return fail('Enter your provider’s server address.');
    if (!username || !password) return fail('Enter both your username and password.');

    submit.disabled = true;
    submitText.textContent = 'Connecting…';

    try {
      const account = await store.login({ server, username, password, remember: rememberBox.classList.contains('on') });
      await afterLogin(account);
    } catch (err) {
      fail(err.message || 'Could not sign in.');
    } finally {
      submit.disabled = false;
      submitText.textContent = 'Connect';
    }
  });

  function fail(message) {
    errorText.textContent = message;
    errorBox.classList.remove('hidden');
  }
}

async function afterLogin(account) {
  hideLogin();
  paintAccount(account);

  const start = store.state.settings.startPage || 'home';
  await navigate(start);

  // Warm the catalogue so nav badges and search are ready.
  setStatus('Loading catalogue…', 'busy');
  Promise.allSettled([store.ensureLive(), store.ensureMovies(), store.ensureSeries()]).then(() => {
    paintNav();
    setStatus(
      `${store.state.liveChannels.length.toLocaleString()} channels · ${store.state.movies.length.toLocaleString()} films · ${store.state.series.length.toLocaleString()} box sets`,
      'ok',
      6000
    );
    maybeAutoLoadEpg();
  });
}

function maybeAutoLoadEpg() {
  if (!store.state.settings.epgAutoLoad) return;
  if (store.state.epg.ready || store.state.epg.loading) return;

  setStatus('Downloading TV guide…', 'busy');
  const unsub = window.aurum.epg.onProgress((p) => {
    setStatus(p.text || 'Downloading TV guide…', p.phase === 'error' ? 'err' : 'busy');
  });

  store
    .refreshEpg(false)
    .then((result) => {
      if (result && result.ok) {
        setStatus(`Guide ready · ${result.stats.programmes.toLocaleString()} programmes`, 'ok', 8000);
        if (currentRoute === 'guide') navigate('guide');
      } else {
        setStatus('Guide unavailable', 'err', 8000);
      }
    })
    .catch(() => setStatus('Guide unavailable', 'err', 8000))
    .finally(() => unsub());
}

function paintAccount(account) {
  const info = (account && account.userInfo) || {};
  const creds = (account && account.credentials) || {};
  const name = info.username || creds.username || 'Account';

  $('#accountAvatar').textContent = initials(name);
  $('#accountName').textContent = name;

  const exp = expiryText(info.exp_date);
  $('#accountMeta').textContent = exp.text;
  $('#accountMeta').style.color = exp.tone === 'bad' ? 'var(--bad)' : exp.tone === 'warn' ? 'var(--warn)' : '';
}

async function doLogout() {
  await store.logout();
  clear($('#content'));
  $('#searchInput').value = '';
  showLogin();
  toast('Signed out', 'Your credentials have been removed from this PC.');
}

// -------------------------------------------------------------- app chrome

function bindChrome() {
  // window controls
  document.querySelectorAll('.wincontrols button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.win;
      if (action === 'min') window.aurum.window.minimize();
      else if (action === 'max') window.aurum.window.maximize();
      else window.aurum.window.close();
    });
  });

  window.aurum.window.onState((state) => {
    const maxBtn = document.querySelector('[data-win="max"]');
    if (maxBtn) maxBtn.title = state.maximized ? 'Restore' : 'Maximise';
  });

  // sidebar
  $('#toggleSidebar').addEventListener('click', () => $('#sidebar').classList.toggle('collapsed'));
  $('#accountBtn').addEventListener('click', () => navigate('settings'));

  // search
  const searchInput = $('#searchInput');
  const searchClear = $('#searchClear');

  const runSearch = debounce((value) => {
    searchQuery = value;
    if (value.trim().length >= 2) navigate('search', { query: value });
    else if (currentRoute === 'search') navigate('home');
  }, 380);

  searchInput.addEventListener('input', () => {
    searchClear.classList.toggle('hidden', !searchInput.value);
    runSearch(searchInput.value);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      searchClear.classList.add('hidden');
      searchInput.blur();
      if (currentRoute === 'search') navigate('home');
    }
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.add('hidden');
    searchInput.focus();
    if (currentRoute === 'search') navigate('home');
  });

  // refresh
  $('#refreshBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    setStatus('Refreshing…', 'busy');
    try {
      await store.clearCache();
      await Promise.allSettled([store.ensureLive(true), store.ensureMovies(true), store.ensureSeries(true)]);
      paintNav();
      await navigate(currentRoute);
      setStatus('Catalogue refreshed', 'ok', 4000);
    } catch (err) {
      setStatus('Refresh failed', 'err', 5000);
      toastErr('Refresh failed', err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // modal
  $('#modalBackdrop').addEventListener('click', closeModal);
  $('#modalClose').addEventListener('click', closeModal);

  // global shortcuts
  document.addEventListener('keydown', (e) => {
    if (player.open) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#searchInput').focus();
      $('#searchInput').select();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      $('#sidebar').classList.toggle('collapsed');
      return;
    }
    if (e.key === 'Escape' && isModalOpen()) {
      e.preventDefault();
      closeModal();
    }
  });

  // keep favourites badges honest
  store.on('favorites', () => paintNav());
}

// ------------------------------------------------------------------- boot

async function boot() {
  const bootText = $('#bootText');

  try {
    await store.loadPersistedState();
  } catch (err) {
    console.error('[boot] could not read settings', err);
  }

  bindChrome();
  bindLogin();
  player.init();
  paintNav();

  let hasProfile = false;
  try {
    hasProfile = await store.hasSavedProfile();
  } catch {
    hasProfile = false;
  }

  if (!hasProfile) {
    $('#boot').classList.add('hidden');
    showLogin();
    return;
  }

  bootText.textContent = 'Signing in…';
  try {
    const account = await store.restoreSession();
    if (!account) throw new Error('No saved session');
    $('#boot').classList.add('hidden');
    hideLogin();
    await afterLogin(account);
  } catch (err) {
    $('#boot').classList.add('hidden');
    showLogin();
    const box = $('#loginError');
    $('#loginErrorText').textContent = `Your saved session could not be restored: ${err.message}`;
    box.classList.remove('hidden');
  }
}

document.addEventListener('DOMContentLoaded', boot);
