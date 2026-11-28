'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeDocument } = require('./fakeDom');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function surface(modules, ids) {
  const document = makeDocument();
  document.querySelector = s => document.body.querySelector(s);
  document.querySelectorAll = s => document.body.querySelectorAll(s);
  const nodes = {};
  for (const id of ids.split(' ')) {
    const el = nodes[id] = document.createElement('div');
    el.id = id;
    el.isConnected = true;
    document.body.appendChild(el);
  }
  const timers = new Map();
  const schedule = (fn, ms) => { timers.set(fn, ms); return fn; };
  const requests = [];
  const context = vm.createContext({
    document, t: k => k, console, Event, URL, CSS: { escape: s => s },
    setTimeout: schedule, clearTimeout: fn => timers.delete(fn),
    AbortSignal: { timeout(ms) {
      const ctl = new AbortController();
      schedule(() => ctl.abort(), ms);
      return ctl.signal;
    } },
    fetch(url, { signal }) {
      requests.push(url);
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    },
  });
  vm.runInContext(read('public/js/surface-state.js'), context);
  const app = { currentChannel: 'room', channels: [], socket: { connected: true, emit: (...args) => requests.push(args) } };
  for (const name of modules.split(' ')) {
    const source = read('public/js/modules/app-' + name + '.js').replace(/^import .*;$/mg, '');
    Object.assign(app, vm.runInContext('(() => {\n' + source.replace('export default', 'return') + '\n})()', context));
  }
  function expire(deadline = 10000) {
    assert.ok(timers.size);
    for (const [fn, ms] of [...timers]) {
      assert.equal(ms, deadline);
      timers.delete(fn);
      fn();
    }
  }
  return { app, nodes, document, requests, context, expire };
}

function expectFailure(host, key) {
  const line = host.querySelector('[role="alert"]');
  assert.ok(line);
  assert.match(line.textContent, new RegExp(key));
  assert.equal(line.querySelector('button').textContent, 'history.retry');
  return line.querySelector('button');
}

for (const [name, module, ids, open, key, event] of [
  ['docked and floating pins', 'message-tools', 'pinned-list pins-pip-list', app => app._requestPins(), 'pins_failed', 'get-pinned-messages'],
  ['files and media', 'media-gallery', 'media-gallery-body', app => app._requestChannelList('get-channel-media'), 'media_failed', 'get-channel-media'],
  ['thread list', 'media-gallery', 'threads-list-body', app => app._requestChannelList('get-channel-threads'), 'threads_failed', 'get-channel-threads'],
  ['member list', 'users', 'online-users', app => app._waitForRoster(false, 'room'), 'members_failed', 'enter-channel'],
  ['voice roster', 'users', 'voice-users', app => app._waitForRoster(true, 'room'), 'voice_failed', 'request-voice-users'],
  ['DM list', 'channels', 'dm-list', app => app._dmSnapshotState(), 'dm_failed', 'get-channels'],
  ['invite list', 'admin-controls', 'invite-codes-list', app => app._requestInviteCodes(), 'invites_failed', 'get-invite-codes'],
]) {
  test(name + ' ends a silent read and retries from the status line', () => {
    const { app, nodes, expire, requests } = surface(module, ids);
    open(app);
    for (const host of Object.values(nodes)) assert.equal(host.firstChild.getAttribute('role'), 'status');
    expire();
    const buttons = Object.values(nodes).map(host => expectFailure(host, key));
    buttons.at(-1).dispatch('click');
    assert.equal(requests.at(-1)[0], event);
    for (const host of Object.values(nodes)) host.textContent = 'fresh rows';
    expire();
    for (const host of Object.values(nodes)) assert.equal(host.textContent, 'fresh rows');
  });
}

for (const query of ['some words', 'mentions:me']) {
  test('search ' + query + ' ends a silent page and retries the same query', () => {
    const { app, nodes, requests, expire } = surface('search', 'search-panel search-panel-list search-panel-count search-panel-loading');
    app._searchState = {};
    app._searchRun(query, 3);
    assert.equal(nodes['search-panel-list'].getAttribute('aria-busy'), 'true');
    expire();
    assert.equal(nodes['search-panel-list'].getAttribute('aria-busy'), 'false');
    assert.equal(nodes['search-panel-loading'].style.display, 'none');
    expectFailure(nodes['search-panel-list'], 'search_failed').dispatch('click');
    assert.equal(requests.at(-1)[1].query, query);
    assert.equal(requests.at(-1)[1].page, 3);
    assert.ok(requests.at(-1)[1].token > requests[0][1].token);
  });
}

test('audit pagination keeps previous rows when the acknowledgement expires', () => {
  const { app, nodes, document } = surface('moderation',
    'audit-log-modal audit-log-list audit-log-filter-action audit-log-filter-actor audit-log-load-more open-audit-log-btn');
  let ack;
  app.socket.timeout = ms => {
    assert.equal(ms, 10000);
    return { emit(event, opts, cb) { assert.equal(event, 'get-audit-log'); ack = cb; } };
  };
  app._setupAuditLog();
  nodes['open-audit-log-btn'].dispatch('click');
  const list = nodes['audit-log-list'];
  assert.equal(list.firstChild.getAttribute('role'), 'status');
  ack(new Error('timeout'));
  expectFailure(list, 'load_failed').dispatch('click');
  const row = document.createElement('div');
  row.className = 'audit-log-row';
  list.replaceChildren(row);
  nodes['audit-log-load-more'].dispatch('click');
  ack(new Error('timeout'));
  assert.equal(list.firstChild, row);
  expectFailure(list, 'load_failed');
});

for (const [method, key] of [['Filter', 'mtf'], ['Manage', 'mtm']]) {
  test('gallery tag ' + method + ' replaces a timed out list and ignores old queries', () => {
    const { app, nodes } = surface('media-gallery', key + '-input ' + key + '-list');
    const acks = [];
    app.socket.timeout = ms => {
      assert.equal(ms, 10000);
      return { emit(event, opts, cb) { assert.equal(event, 'search-upload-tags'); acks.push(cb); } };
    };
    app._mediaTagManage = {};
    for (const q of ['a','b']) {
      nodes[key + '-input'].value = q;
      app['_mediaTag' + method + 'Search'](q);
    }
    const list = nodes[key + '-list'];
    acks[0](new Error('stale'));
    assert.equal(list.firstChild.getAttribute('role'), 'status');
    acks[1](new Error('timeout'));
    expectFailure(list, 'tags_failed');
  });
}

for (const query of ['', 'kittens']) {
  test('GIF ' + (query || 'trending') + ' turns a stalled fetch into an inline retry', async () => {
    const { app, nodes, expire, requests } = surface('gif-picker', 'gif-grid');
    const run = query ? app._searchGifs(query) : app._loadTrendingGifs();
    assert.ok(requests[0].includes(query ? '/search?' : '/trending?'));
    expire();
    await run;
    expectFailure(nodes['gif-grid'], query ? 'search_failed' : 'load_failed').dispatch('click');
    assert.equal(requests[1], requests[0]);
  });
}

for (const catalog of ['StandardEmojis', 'CustomEmojis', 'Stickers']) {
  test(catalog + ' clears the picker loading state after a stalled fetch', async () => {
    const { app, nodes, expire } = surface('emoji-stickers', 'emoji-picker');
    const changes = [];
    nodes['emoji-picker']._catalogRefresh = () => changes.push(app._pickerCatalogs[catalog]);
    const run = app['_load' + catalog]();
    expire();
    await run;
    assert.deepEqual(changes, ['loading', 'failed']);
  });
}

test('link preview deadline frees the fetch slot and makes the card retryable', async () => {
  const { app, document, context, expire, requests } = surface('link-previews', 'messages');
  document.body.className = 'embed-size-medium';
  context.window = { location: { origin: 'https://example.test' } };
  app._embedFolded = () => false;
  const host = document.createElement('div');
  const link = { href: 'https://other.test/news', dataset: {}, closest: () => host };
  const container = { querySelectorAll: () => [link] };
  app._fetchLinkPreviews(container);
  assert.equal(host.firstChild.getAttribute('role'), 'status');
  expire();
  await tick();
  expectFailure(host, 'preview_failed').dispatch('click');
  assert.equal(requests.length, 2);
  expire();
  await tick();
  assert.equal(app._lpActive, 0);
  assert.equal(app._linkPreviewInflight.size, 0);
});

test('empty states use the shared muted type and spacing in both palettes', () => {
  const css = read('themes/habitat-grafit.theme.css');
  const body = css.match(/\n\[data-haven-page="app"\] \.surface-state\.surface-state \{([^}]+)\}/)[1];
  for (const declaration of ['color: var(--text-muted)', 'font-size: var(--hb-text-sm)', 'padding: 1.5rem 1rem', 'text-align: center']) {
    assert.ok(body.includes(declaration));
  }
  assert.match(read('public/css/style.css'), /\.surface-state \{[^}]*text-align: center/);
  assert.match(read('themes/habitat-grafit-light.theme.css'), /@import.*habitat-grafit.theme.css/);
});

test('short camera tiles hide the overlapping menu and exclude the enlarged camera', () => {
  const plugin = read('plugins/HabitatLayout.plugin.js');
  assert.match(plugin, /flag\(stage, 'data-habitat-short-camera', grid.height < 7\.5 \* rem\)/);
  assert.match(plugin, /\[data-habitat-short-camera\] \[data-habitat-on-camera\]:not\(\[data-habitat-focused\]\) \.voice-user-menu-btn \{ display: none/);
  assert.match(plugin, /stage.removeAttribute\('data-habitat-short-camera'\)/);
});

test('the three review notices resolve through the English locale', () => {
  const en = JSON.parse(read('public/locales/en.json'));
  for (const [module, key] of [['people','profile_unconfirmed'], ['admin-controls','invite_unconfirmed'], ['socket-events','thread_discarded']]) {
    const source = read('public/js/modules/app-' + module + '.js');
    assert.ok(source.includes("t('surface." + key + "')"));
    assert.ok(en.surface[key].length > 20);
    assert.ok(!source.includes(en.surface[key]));
  }
});

test('a failed image keeps its filename and retry, and a later load restores the image', () => {
  const { app, document, context } = surface('message-content', 'messages');
  const host = document.body;
  const img = document.createElement('img');
  img.src = 'https://example.test/uploads/family%20photo.jpg';
  img.closest = () => null;
  img.after = el => host.appendChild(el);
  img.style.removeProperty = key => delete img.style[key];
  context.location = { href: img.src };
  context.t = (key, values) => values?.name || key;
  host.appendChild(img);
  app._showMediaFailure(img);
  assert.match(host.querySelector('[role="alert"]').textContent, /family photo.jpg/);
  host.querySelector('button').dispatch('click');
  img.dispatch('load');
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.equal(img.style.display, undefined);
});

test('a stalled encrypted image ends loading and retries its encrypted fetch', async () => {
  const { app, nodes, context, document, expire } = surface('platform message-content', 'messages');
  const root = nodes.messages;
  const img = document.createElement('img');
  img.classList.add('e2e-img-pending');
  img.dataset.e2eSrc = '/uploads/photo.jpg';
  img.closest = () => null;
  img.after = el => root.appendChild(el);
  root.appendChild(img);
  app._getE2EPartner = () => ({});
  context.location = { href: 'https://example.test' };
  app._decryptE2EImages(root);
  assert.ok(img.classList.contains('e2e-img-loading'));
  expire(120000);
  await tick();
  assert.ok(!img.classList.contains('e2e-img-loading'));
  expectFailure(root, 'file_failed').dispatch('click');
  assert.ok(img.classList.contains('e2e-img-loading'));
});

test('slash GIF search replaces loading with a retry on a failed fetch', async () => {
  const { app, context, nodes, document, expire } = surface('gif-picker', 'composer');
  nodes.composer.classList.add('message-input-area');
  document.body.insertBefore = el => document.body.appendChild(el);
  context.setTimeout = (fn, ms) => { if (ms !== 100) throw new Error('unexpected timer'); };
  app._showGifSlashResults('cat');
  expire();
  await tick();
  expectFailure(document.getElementById('gif-slash-picker'), 'search_failed');
});

test('a failed search tag lookup clears the pending filter', () => {
  const { app, nodes, context } = surface('search', 'sfp-list');
  context.setTimeout = fn => fn();
  app._sfpActive = 'tag';
  let ack;
  app.socket.timeout = ms => {
    assert.equal(ms, 10000);
    return { emit(event, opts, cb) { assert.equal(event, 'search-upload-tags'); ack = cb; } };
  };
  app._sfpRenderTagList('photo');
  ack(new Error('timeout'));
  expectFailure(nodes['sfp-list'], 'tags_failed');
});

test('audit export releases the button after its page times out', async () => {
  const { app, nodes } = surface('moderation',
    'audit-log-modal audit-log-list audit-log-filter-action audit-log-filter-actor audit-log-export-btn');
  app.socket.timeout = ms => {
    assert.equal(ms, 10000);
    return { async emitWithAck(event) { assert.equal(event, 'get-audit-log'); throw new Error('timeout'); } };
  };
  const notices = [];
  app._showToast = key => notices.push(key);
  app._setupAuditLog();
  const button = nodes['audit-log-export-btn'];
  button.dispatch('click');
  assert.equal(button.disabled, true);
  await tick();
  assert.equal(button.disabled, false);
  assert.deepEqual(notices, ['modals.audit_log.load_failed']);
});

test('a failed video with preload disabled can retry without pressing the hidden player', () => {
  const { app, context, document } = surface('message-content', 'messages');
  const box = document.createElement('div');
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = 'Team recording.mov';
  const video = document.createElement('video');
  video.tagName = 'VIDEO';
  video.preload = 'none';
  video.src = 'https://example.test/uploads/123.mov';
  video.closest = selector => selector === '.file-attachment' ? box : null;
  video.after = el => box.appendChild(el);
  video.style.removeProperty = key => delete video.style[key];
  let loads = 0;
  video.load = () => { loads++; };
  box.append(name, video);
  context.t = (key, values) => values?.name || key;
  app._showMediaFailure(video);
  const line = box.querySelector('[role="alert"]');
  assert.match(line.textContent, /Team recording.mov/);
  assert.equal(line.querySelector('a').href, video.src);
  line.querySelector('button').dispatch('click');
  assert.equal(loads, 1);
  assert.equal(video.preload, 'metadata');
  video.dispatch('loadedmetadata');
  assert.equal(box.querySelector('[role="alert"]'), null);
});

test('a failed public address lookup releases invite rendering with its local fallback', async () => {
  const { app, expire } = surface('utilities', 'invite-codes-list');
  const run = app._fetchShareOrigin();
  expire();
  assert.equal(await run, null);
});

test('optional emoji keywords fall back to bundled words after a stalled download', async () => {
  const { app, context, expire } = surface('emoji-search', 'emoji-picker');
  context.EMOJI_SLANG = { '👌': 'okay' };
  const run = app._loadEmojiKeywords();
  expire();
  await run;
  assert.equal(app.emojiKeywords['👌'], 'okay');
});
