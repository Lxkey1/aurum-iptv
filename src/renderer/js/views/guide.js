/**
 * TV Guide — a scrollable timeline grid.
 *
 * Channels are virtualised vertically (only the visible lanes are in the DOM)
 * so a 20,000-channel playlist stays smooth. Programme blocks are absolutely
 * positioned against a pixels-per-minute scale.
 */

import { h, icon, clear } from '../util/dom.js';
import { timeHM, relativeDay, debounce, tidyChannelName, plainText } from '../util/format.js';
import { logoNode } from '../ui/cards.js';
import { emptyState, toast, toastErr, openModal, closeModal } from '../ui/feedback.js';
import { playChannel } from '../playback.js';
import * as store from '../state.js';

const LANE_H = 62;
const ZOOMS = [1.6, 2.6, 4, 6]; // pixels per minute
const OVERSCAN = 6;

let zoomIndex = 1;
let scrollTopMemo = 0;
let categoryMemo = '__all__';

export async function renderGuide(host) {
  clear(host);
  const page = h('div.page.page--flush');
  host.appendChild(page);

  try {
    await store.ensureLive();
  } catch (err) {
    page.appendChild(emptyState('alert', 'Could not load channels', err.message));
    return;
  }

  if (!store.state.epg.ready) {
    page.appendChild(buildLoadPrompt(host));
    return;
  }

  buildGrid(page, host);
}

// ------------------------------------------------------------ load prompt

function buildLoadPrompt(host) {
  const progressBar = h('i', { style: { width: '0%' } });
  const progressWrap = h('div.epg-progress.hidden', progressBar);
  const statusText = h('p.dim', { style: { fontSize: '12.5px', marginTop: '10px' } }, '');

  const button = h(
    'button.btn.btn--primary.btn--lg',
    {
      onclick: async () => {
        button.disabled = true;
        progressWrap.classList.remove('hidden');
        const unsub = window.aurum.epg.onProgress((p) => {
          progressBar.style.width = `${p.pct || 0}%`;
          statusText.textContent = p.text || '';
        });
        try {
          const result = await store.refreshEpg(true);
          if (result && result.ok) {
            toast('Guide ready', `${result.stats.programmes.toLocaleString()} programmes across ${result.stats.channelsWithData.toLocaleString()} channels.`);
            renderGuide(host);
          } else {
            toastErr('Guide download failed', (result && result.error) || 'Unknown error');
            button.disabled = false;
            statusText.textContent = (result && result.error) || '';
          }
        } catch (err) {
          toastErr('Guide download failed', err.message);
          button.disabled = false;
        } finally {
          unsub();
        }
      }
    },
    icon('download', 16),
    'Download TV guide'
  );

  return h(
    'div.page',
    h(
      'div.empty',
      { style: { paddingTop: '110px' } },
      h('div.empty__icon', icon('guide')),
      h('h3', 'The TV guide is not loaded yet'),
      h('p',
        'Aurum downloads the full XMLTV guide from your provider and indexes it locally. It is usually 20–150 MB and takes under a minute; after that it is cached and instant.'),
      button,
      progressWrap,
      statusText
    )
  );
}

// -------------------------------------------------------------- guide grid

function buildGrid(page, host) {
  const channels = store.state.liveChannels;

  // Window: from the top of the current hour, forward 48 hours.
  const now = Date.now();
  const startMs = new Date(now).setMinutes(0, 0, 0) - 2 * 3600 * 1000;
  const endMs = startMs + 50 * 3600 * 1000;
  const totalMinutes = (endMs - startMs) / 60000;

  let pxPerMin = ZOOMS[zoomIndex];
  let canvasWidth = totalMinutes * pxPerMin;

  // ----------------------------------------------------------- category
  const counts = new Map();
  for (const c of channels) counts.set(c._cat, (counts.get(c._cat) || 0) + 1);

  const categorySelect = h(
    'select.select',
    { style: { maxWidth: '240px' } },
    h('option', { value: '__all__' }, `All channels (${channels.length})`),
    h('option', { value: '__fav__' }, `Favourites (${store.state.favorites.live.length})`),
    store.state.liveCategories
      .filter((c) => (counts.get(String(c.category_id)) || 0) > 0)
      .map((c) =>
        h('option', { value: String(c.category_id) }, `${c.category_name} (${counts.get(String(c.category_id))})`)
      )
  );
  categorySelect.value = categoryMemo;

  const searchInput = h('input', { type: 'text', placeholder: 'Find a channel…', spellcheck: false });

  const dayLabel = h('span.badge.badge--gold', relativeDay(now));
  const matchLabel = h(
    'span.dim',
    { style: { fontSize: '12px' } },
    `${store.state.epg.matched.toLocaleString()} of ${channels.length.toLocaleString()} channels matched`
  );

  const zoomOut = h('button.iconbtn', { title: 'Zoom out' }, h('span', { style: { fontSize: '16px', fontWeight: '600' } }, '−'));
  const zoomIn = h('button.iconbtn', { title: 'Zoom in' }, h('span', { style: { fontSize: '16px', fontWeight: '600' } }, '+'));

  const nowBtn = h('button.btn.btn--sm', icon('clock', 14), 'Now');
  const refreshBtn = h('button.btn.btn--sm.btn--ghost', icon('refresh', 14), 'Refresh guide');

  // ------------------------------------------------------------- structure
  const chanScroll = h('div.guide__chans-scroll');
  const chanCanvas = h('div', { style: { position: 'relative' } });
  chanScroll.appendChild(chanCanvas);

  const ruler = h('div.guide__ruler');
  const rulerWrap = h('div.guide__ruler-wrap', ruler);

  const canvas = h('div.guide__canvas');
  const nowLine = h('div.guide__nowline');
  canvas.appendChild(nowLine);

  const scroll = h('div.guide__scroll', canvas);

  const guide = h(
    'div.guide',
    h(
      'div.guide__bar',
      dayLabel,
      categorySelect,
      h('div.live-cats__search', { style: { width: '210px' } }, icon('search', 14), searchInput),
      h('div.grow'),
      matchLabel,
      zoomOut,
      zoomIn,
      nowBtn,
      refreshBtn
    ),
    h(
      'div.guide__body',
      h('div.guide__chans', h('div.guide__chans-head', 'Channel'), chanScroll),
      h('div.guide__time', rulerWrap, scroll)
    )
  );

  clear(page).appendChild(guide);

  // ---------------------------------------------------------------- data
  let visible = [];
  let programmeCache = new Map(); // streamId -> programmes[]
  let renderedLanes = new Map(); // index -> {lane, chanRow}

  const applyFilter = () => {
    const cat = categorySelect.value;
    const needle = searchInput.value.trim().toLowerCase();
    let list = channels;

    if (cat === '__fav__') {
      const favs = new Set(store.state.favorites.live.map(String));
      list = list.filter((c) => favs.has(String(c.stream_id)));
    } else if (cat !== '__all__') {
      list = list.filter((c) => c._cat === cat);
    }
    if (needle) list = list.filter((c) => String(c.name).toLowerCase().includes(needle));

    visible = list;
    categoryMemo = cat;
    programmeCache = new Map();
    renderedLanes = new Map();
    layout();
    paintVisible(true);
  };

  const layout = () => {
    canvasWidth = totalMinutes * pxPerMin;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${visible.length * LANE_H}px`;
    chanCanvas.style.height = `${visible.length * LANE_H}px`;
    drawRuler();
    positionNowLine();
  };

  const drawRuler = () => {
    clear(ruler);
    ruler.style.width = `${canvasWidth}px`;
    const stepMinutes = pxPerMin >= 4 ? 15 : pxPerMin >= 2.6 ? 30 : 60;
    for (let m = 0; m <= totalMinutes; m += stepMinutes) {
      const ms = startMs + m * 60000;
      const d = new Date(ms);
      const isDayStart = d.getHours() === 0 && d.getMinutes() === 0;
      const label = isDayStart ? relativeDay(ms) : timeHM(ms);
      ruler.appendChild(
        h('div.guide__tick', {
          class: isDayStart ? 'day' : '',
          style: { left: `${m * pxPerMin}px` }
        }, label)
      );
    }
  };

  const positionNowLine = () => {
    const offset = ((Date.now() - startMs) / 60000) * pxPerMin;
    nowLine.style.left = `${offset}px`;
    nowLine.style.height = `${Math.max(visible.length * LANE_H, 100)}px`;
  };

  // ------------------------------------------------------------ virtualise
  const paintVisible = async (force = false) => {
    const top = scroll.scrollTop;
    const height = scroll.clientHeight || 600;
    const first = Math.max(0, Math.floor(top / LANE_H) - OVERSCAN);
    const last = Math.min(visible.length - 1, Math.ceil((top + height) / LANE_H) + OVERSCAN);

    // drop lanes that scrolled away
    for (const [index, nodes] of renderedLanes) {
      if (index < first || index > last) {
        nodes.lane.remove();
        nodes.chanRow.remove();
        renderedLanes.delete(index);
      }
    }

    const needed = [];
    for (let i = first; i <= last; i += 1) {
      if (!renderedLanes.has(i)) needed.push(i);
    }
    if (!needed.length && !force) return;

    // one IPC round trip for every channel that is about to appear
    const missing = needed
      .map((i) => visible[i])
      .filter(Boolean)
      .filter((c) => !programmeCache.has(String(c.stream_id)))
      .map((c) => String(c.stream_id));

    if (missing.length) {
      try {
        const data = await store.epgQuery(missing, startMs, endMs);
        for (const [id, list] of Object.entries(data)) programmeCache.set(id, list);
      } catch {
        for (const id of missing) programmeCache.set(id, []);
      }
    }

    for (const i of needed) {
      const channel = visible[i];
      if (!channel) continue;
      if (renderedLanes.has(i)) continue;

      const lane = h('div.guide__lane', { style: { top: `${i * LANE_H}px` } });
      const programmes = programmeCache.get(String(channel.stream_id)) || [];

      if (!programmes.length) {
        lane.appendChild(h('div.guide__empty-lane', 'No guide data for this channel'));
      } else {
        for (const p of programmes) {
          lane.appendChild(programmeBlock(p, channel, startMs, pxPerMin));
        }
      }

      const chanRow = h(
        'div.guide-chan',
        {
          style: { position: 'absolute', top: `${i * LANE_H}px`, left: '0', right: '0' },
          onclick: () => playChannel(channel, visible),
          title: channel.name
        },
        h('span.guide-chan__logo', logoNode(channel)),
        h(
          'span.guide-chan__text',
          h('span.guide-chan__name', tidyChannelName(channel.name)),
          h('span.guide-chan__num', String(channel.num || i + 1))
        )
      );

      canvas.appendChild(lane);
      chanCanvas.appendChild(chanRow);
      renderedLanes.set(i, { lane, chanRow });
    }
  };

  // --------------------------------------------------------------- events
  const onScroll = () => {
    chanScroll.scrollTop = scroll.scrollTop;
    rulerWrap.scrollLeft = scroll.scrollLeft;
    ruler.style.transform = `translateX(${-scroll.scrollLeft}px)`;
    scrollTopMemo = scroll.scrollTop;
    paintVisible();
  };
  scroll.addEventListener('scroll', onScroll, { passive: true });

  // Ctrl+wheel zooms the timeline.
  scroll.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const next = Math.min(ZOOMS.length - 1, Math.max(0, zoomIndex + (e.deltaY < 0 ? 1 : -1)));
      if (next === zoomIndex) return;
      setZoom(next);
    },
    { passive: false }
  );

  const setZoom = (next) => {
    const anchorRatio = scroll.scrollLeft / Math.max(1, canvasWidth);
    zoomIndex = next;
    pxPerMin = ZOOMS[zoomIndex];
    renderedLanes.forEach((nodes) => {
      nodes.lane.remove();
      nodes.chanRow.remove();
    });
    renderedLanes = new Map();
    layout();
    scroll.scrollLeft = anchorRatio * canvasWidth;
    paintVisible(true);
  };

  zoomIn.onclick = () => setZoom(Math.min(ZOOMS.length - 1, zoomIndex + 1));
  zoomOut.onclick = () => setZoom(Math.max(0, zoomIndex - 1));

  nowBtn.onclick = () => {
    const offset = ((Date.now() - startMs) / 60000) * pxPerMin;
    scroll.scrollTo({ left: Math.max(0, offset - 160), behavior: 'smooth' });
  };

  refreshBtn.onclick = async () => {
    refreshBtn.disabled = true;
    const unsub = window.aurum.epg.onProgress((p) => {
      refreshBtn.textContent = `${Math.round(p.pct || 0)}%`;
    });
    try {
      const result = await store.refreshEpg(true);
      if (result && result.ok) {
        toast('Guide refreshed', `${result.stats.programmes.toLocaleString()} programmes indexed.`);
        renderGuide(host);
      } else {
        toastErr('Refresh failed', (result && result.error) || 'Unknown error');
      }
    } finally {
      unsub();
      refreshBtn.disabled = false;
    }
  };

  categorySelect.onchange = applyFilter;
  searchInput.addEventListener('input', debounce(applyFilter, 220));

  // keep the now-line moving
  const ticker = setInterval(() => {
    if (!document.body.contains(guide)) {
      clearInterval(ticker);
      return;
    }
    positionNowLine();
  }, 30000);

  applyFilter();

  // restore position, then jump to "now" on first open
  requestAnimationFrame(() => {
    scroll.scrollTop = scrollTopMemo;
    const offset = ((Date.now() - startMs) / 60000) * pxPerMin;
    scroll.scrollLeft = Math.max(0, offset - 160);
    onScroll();
  });
}

function programmeBlock(p, channel, startMs, pxPerMin) {
  const left = ((p.s - startMs) / 60000) * pxPerMin;
  const width = ((p.e - p.s) / 60000) * pxPerMin;
  const now = Date.now();
  const isNow = p.s <= now && p.e > now;
  const isPast = p.e <= now;

  const block = h(
    'button.prog',
    {
      class: `${isNow ? 'on-now' : ''} ${isPast ? 'past' : ''}`.trim(),
      style: { left: `${left}px`, width: `${Math.max(width - 3, 26)}px` },
      title: `${p.t}\n${timeHM(p.s)} – ${timeHM(p.e)}`,
      onclick: () => openProgramme(p, channel)
    },
    h('span.prog__title', p.t),
    h('span.prog__time', `${timeHM(p.s)} – ${timeHM(p.e)}`)
  );

  if (isNow) {
    const pct = ((now - p.s) / (p.e - p.s)) * 100;
    block.appendChild(h('span.prog__fill', { style: { width: `${pct}%` } }));
  }
  return block;
}

function openProgramme(p, channel) {
  const now = Date.now();
  const live = p.s <= now && p.e > now;
  const mins = Math.round((p.e - p.s) / 60000);

  openModal(
    h(
      'div',
      { style: { padding: '30px 32px' } },
      h(
        'div.row.gap-3',
        { style: { marginBottom: '14px' } },
        live ? h('span.badge.badge--live', h('span.dot'), 'On now') : h('span.badge', relativeDay(p.s)),
        h('span.badge', `${mins} min`),
        p.c ? h('span.badge', p.c) : null
      ),
      h('h2', { style: { fontSize: '23px', marginBottom: '6px' } }, p.t),
      h('p.dim', { style: { fontSize: '13px', marginBottom: '18px' } },
        `${tidyChannelName(channel.name)}  ·  ${timeHM(p.s)} – ${timeHM(p.e)}`),
      p.d
        ? h('p.muted', { style: { fontSize: '13.5px', lineHeight: '1.65' } }, plainText(p.d))
        : h('p.dim', { style: { fontSize: '13px' } }, 'No description was supplied for this programme.'),
      h(
        'div.row.gap-3',
        { style: { marginTop: '26px' } },
        h(
          'button.btn.btn--primary',
          {
            onclick: () => {
              closeModal();
              playChannel(channel, store.state.liveChannels);
            }
          },
          icon('play', 16),
          live ? 'Watch now' : 'Go to channel'
        ),
        h('button.btn.btn--ghost', { onclick: closeModal }, 'Close')
      )
    ),
    { small: true }
  );
}
