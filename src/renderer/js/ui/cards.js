/** Poster cards, channel rows and horizontal rails, shared across views. */

import { h, icon, poster, clear } from '../util/dom.js';
import { tidyChannelName, timeHM, runtime } from '../util/format.js';
import * as store from '../state.js';

/**
 * @param {object} opts
 *   { id, kind:'movie'|'series', title, sub, cover, rating, progress, onOpen, onPlay }
 */
export function posterCard(opts) {
  const fav = store.isFavorite(opts.kind, opts.id);

  const favBtn = h(
    'button.poster__fav',
    {
      class: fav ? 'on' : '',
      title: fav ? 'Remove from favourites' : 'Add to favourites',
      onclick: async (e) => {
        e.stopPropagation();
        const added = await store.toggleFavorite(opts.kind, opts.id);
        favBtn.classList.toggle('on', added);
      }
    },
    icon('heart', 14)
  );

  const art = poster(opts.cover, opts.title, opts.title);

  if (opts.rating) {
    art.appendChild(h('span.poster__rating', icon('star', 11), String(opts.rating)));
  }
  art.appendChild(favBtn);
  art.appendChild(
    h(
      'div.poster__overlay',
      h(
        'span.poster__play',
        {
          onclick: (e) => {
            if (!opts.onPlay) return;
            e.stopPropagation();
            opts.onPlay();
          }
        },
        icon('play', 18)
      )
    )
  );

  if (opts.progress > 0 && opts.progress < 1) {
    art.appendChild(h('div.poster__progress', h('i', { style: { width: `${opts.progress * 100}%` } })));
  }

  return h(
    'button.poster',
    { onclick: opts.onOpen, title: opts.title },
    art,
    h(
      'div.poster__meta',
      h('div.poster__name.clamp-2', opts.title),
      opts.sub ? h('div.poster__sub.truncate', opts.sub) : null
    )
  );
}

/** A live channel row with now/next info. */
export function channelRow(channel, { epg, playing, onPlay, index } = {}) {
  const fav = store.isFavorite('live', channel.stream_id);

  const favBtn = h(
    'button.iconbtn',
    {
      class: fav ? 'on' : '',
      title: fav ? 'Remove from favourites' : 'Add to favourites',
      onclick: async (e) => {
        e.stopPropagation();
        const added = await store.toggleFavorite('live', channel.stream_id);
        favBtn.classList.toggle('on', added);
      }
    },
    icon('heart', 15)
  );

  const now = epg && epg.now;
  const next = epg && epg.next;

  let progressBar = null;
  let nowLine = null;

  if (now) {
    const pct = Math.min(1, Math.max(0, (Date.now() - now.s) / Math.max(1, now.e - now.s)));
    progressBar = h('span.chan__bar', h('i', { style: { width: `${pct * 100}%` } }));
    nowLine = h(
      'span.chan__now',
      progressBar,
      h('b.truncate', now.t),
      h('span', `· until ${timeHM(now.e)}`)
    );
  } else if (next) {
    nowLine = h('span.chan__now', h('span', `Next: ${next.t} at ${timeHM(next.s)}`));
  }

  return h(
    'button.chan',
    { class: playing ? 'playing' : '', onclick: onPlay, title: channel.name },
    h('span.chan__num', String(channel.num || index + 1 || '')),
    h('span.chan__logo', logoNode(channel)),
    h(
      'span.chan__body',
      h(
        'span.chan__name.truncate',
        tidyChannelName(channel.name),
        /\b(4K|UHD)\b/i.test(channel.name) ? h('span.badge.badge--gold', '4K') : null,
        /\b(FHD|HD)\b/i.test(channel.name) && !/\b(4K|UHD)\b/i.test(channel.name)
          ? h('span.badge.badge--hd', 'HD')
          : null
      ),
      nowLine
    ),
    h('span.chan__actions', favBtn)
  );
}

export function logoNode(channel) {
  const src = channel.stream_icon || channel.cover;
  if (src) {
    const img = h('img', { src, alt: '', referrerPolicy: 'no-referrer', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(h('span', initials(channel.name))));
    return img;
  }
  return h('span', initials(channel.name));
}

export function initials(name) {
  const clean = String(name || '?').replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

/** A horizontally scrolling row with hover arrows. */
export function rail(title, cards, { action } = {}) {
  if (!cards.length) return null;

  const track = h('div.rail', cards);
  const prev = h(
    'button.rail-nav',
    { dataset: { dir: 'prev' }, onclick: () => track.scrollBy({ left: -track.clientWidth * 0.8, behavior: 'smooth' }) },
    icon('chevronLeft')
  );
  const next = h(
    'button.rail-nav',
    { dataset: { dir: 'next' }, onclick: () => track.scrollBy({ left: track.clientWidth * 0.8, behavior: 'smooth' }) },
    icon('chevronRight')
  );

  const updateArrows = () => {
    const max = track.scrollWidth - track.clientWidth - 4;
    prev.classList.toggle('hidden', track.scrollLeft <= 4);
    next.classList.toggle('hidden', track.scrollLeft >= max);
  };
  track.addEventListener('scroll', updateArrows);
  setTimeout(updateArrows, 60);

  return h(
    'section.row-block',
    h(
      'div.row-block__head',
      h('h2', h('span.accent-bar'), title),
      action || null
    ),
    h('div.rail-wrap', prev, track, next)
  );
}

export function sectionHead(title, action) {
  return h('div.row-block__head', h('h2', h('span.accent-bar'), title), action || null);
}

/** Chip strip for category filtering. */
export function chipBar(items, activeId, onPick) {
  const bar = h('div.chips');
  for (const item of items) {
    bar.appendChild(
      h(
        'button.chip',
        {
          class: String(item.id) === String(activeId) ? 'active' : '',
          onclick: () => onPick(item.id)
        },
        item.label,
        item.count !== undefined ? h('span.chip__count', String(item.count)) : null
      )
    );
  }
  return bar;
}

/**
 * Renders a large list in chunks as the user scrolls, so 20k-channel
 * playlists do not lock up the renderer.
 */
export function lazyList(container, items, renderItem, { chunk = 60, scrollHost } = {}) {
  clear(container);
  let rendered = 0;

  const sentinel = h('div', { style: { height: '1px' } });

  const renderMore = () => {
    const slice = items.slice(rendered, rendered + chunk);
    if (!slice.length) return;
    const frag = document.createDocumentFragment();
    slice.forEach((item, i) => {
      const node = renderItem(item, rendered + i);
      if (node) frag.appendChild(node);
    });
    container.insertBefore(frag, sentinel);
    rendered += slice.length;
    if (rendered >= items.length) observer.disconnect();
  };

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) renderMore();
    },
    { root: scrollHost || container.closest('.content') || null, rootMargin: '600px' }
  );

  container.appendChild(sentinel);
  renderMore();
  observer.observe(sentinel);

  return { destroy: () => observer.disconnect() };
}
