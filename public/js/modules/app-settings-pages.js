// Habitat fork: five member pages and four admin pages keep related settings together.
// The map orders jump links. The sections themselves follow their order in app.html.
// Account comes last so opening Settings does not fetch sessions, two-factor state and recovery codes.
const SETTINGS_PAGES = {
  user: [
    // The two desktop sections are hidden in a browser and simply do not show.
    ['look', '🎨', 'settings.pages.interface', 'Interface & accessibility', ['section-layout', 'section-toolbar-icons', 'section-banner-display', 'section-role-display', 'section-zoom', 'section-toggle-style', 'section-language', 'section-plugins', 'section-desktop-shortcuts', 'section-desktop-app', 'section-debug']],
    ['chat', '💬', 'settings.pages.chat', 'Chat & media', ['section-chat-behavior', 'section-image-display', 'section-embed-size', 'section-reaction-size', 'section-content-privacy', 'section-score-badges']],
    ['voice', '🎧', 'settings.pages.voice', 'Voice & video', ['section-call-settings']],
    ['alerts', '🔔', 'settings.pages.alerts', 'Notifications', ['section-sounds', 'section-push', 'section-whats-new']],
    ['profile', '👤', 'settings.pages.account', 'Profile & account', ['section-activity', 'section-password', 'section-2fa', 'section-recovery', 'section-sessions', 'section-e2e-passphrase', 'section-delete-account']]
  ],
  admin: [
    ['server', '🏠', 'settings.pages.server_channels', 'Server & channels', ['section-branding', 'section-channel-types', 'section-presence', 'section-custom-tos', 'section-modmode']],
    ['people', '👥', 'settings.pages.people_safety', 'People & safety', ['section-members', 'section-roles', 'section-badges', 'section-moderation', 'section-security', 'section-automod', 'section-whitelist', 'section-invite', 'section-guests', 'section-audit-log']],
    ['content', '😎', 'settings.pages.content_integrations', 'Content & integrations', ['section-emojis', 'section-stickers', 'section-gifs', 'section-sounds-admin', 'section-uploads', 'section-tags-admin', 'section-bots', 'section-ferry', 'section-import']],
    // Habitat fork: release preferences stay on Operations for delegated managers.
    ['network', '🛠️', 'settings.pages.operations', 'Operations', ['section-update', 'section-update-preferences', 'section-extension-updates', 'section-connectivity', 'section-privacy', 'section-large-server', 'section-tunnel', 'section-backup', 'section-template', 'section-cleanup']]
  ]
};
export default {
_setupSettingsPages() {
  const nav = document.getElementById('settings-nav'), modal = document.getElementById('settings-modal');
  if (!nav || !modal || this._spReady) return;
  this._spReady = true;
  this._spPage = { user: 'look', admin: 'server' };
  const tr = (k, f) => { const s = typeof t === 'function' ? t(k) : ''; return s && s !== k ? s : f; };
  const sides = { user: { nav: nav.querySelector('.settings-nav-user'), body: document.getElementById('settings-body-user'), sel: '.settings-section' }, admin: { nav: nav.querySelector('.settings-nav-admin-group'), body: document.getElementById('settings-body-admin'), sel: '#admin-mod-panel > .admin-settings[id]' } };
  this._spSides = sides;
  Object.entries(sides).forEach(([side, s]) => {
    if (!s.nav || !s.body) return;
    const known = new Set(SETTINGS_PAGES[side].flatMap(p => p[4])), extra = [...s.body.querySelectorAll(s.sel)].map(x => x.id).filter(id => id && id !== 'admin-mod-panel' && !known.has(id));
    s.pages = [...SETTINGS_PAGES[side], ...(extra.length ? [['more', '➕', 'settings.pages.more', 'More', extra]] : [])];
    const list = document.createElement('div');
    list.className = 'sp-list';
    // Habitat fork: use the same available categories in the sidebar and phone picker.
    s.picker = document.createElement('select');
    s.picker.className = 'sp-page-picker';
    s.picker.setAttribute('aria-label', tr('settings.title', 'Settings'));
    s.picker.setAttribute('aria-controls', s.body.id);
    const choose = id => {
      const search = document.getElementById('settings-search');
      if (search?.value) {
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
      this._showSettingsPage(side, id);
    };
    s.picker.addEventListener('change', () => choose(s.picker.value));
    s.nav.prepend(s.picker);
    s.intro = document.createElement('header');
    s.intro.className = 'sp-page-intro';
    s.body.prepend(s.intro);
    const empty = document.createElement('p');
    empty.className = 'sp-empty';
    empty.setAttribute('role', 'status');
    empty.textContent = tr('header.search_no_results', 'No results found');
    s.body.prepend(empty);
    s.pages.forEach(([id, icon, key, label]) => {
      const item = Object.assign(document.createElement('div'), { className: 'sp-cat', tabIndex: 0 });
      item.dataset.sp = id;
      item.setAttribute('role', 'button');
      item.append(Object.assign(document.createElement('span'), { className: 'sp-icon', textContent: icon }), Object.assign(document.createElement('span'), { textContent: tr(key, label) }));
      item.firstElementChild.setAttribute('aria-hidden', 'true');
      item.addEventListener('click', () => choose(id));
      item.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), choose(id)));
      list.append(item);
    });
    s.nav.prepend(list);
    s.list = list;
    s.body.classList.add('sp-body');
    this._spTips(s.body, tr);
  });
  nav.classList.add('sp-nav');
  document.addEventListener('click', (e) => {
    const item = !this._spBusy && e.target.closest?.('#settings-nav .settings-nav-item[data-target]');
    if (!item) return;
    const side = item.closest('.settings-nav-admin-group') ? 'admin' : 'user', page = sides[side].pages?.find(p => p[4].includes(item.dataset.target));
    page && page[0] !== this._spPage[side] && this._showSettingsPage(side, page[0], item.dataset.target);
  }, true);
  modal.addEventListener('input', e => {
    if (e.target.id !== 'settings-search') return;
    const query = e.target.value.trim().toLowerCase();
    modal.classList.toggle('sp-search', !!query);
    for (const details of modal.querySelectorAll('details.toolbar-order-wrap')) {
      if (query && !details.hasAttribute('data-before-search')) details.dataset.beforeSearch = String(details.open);
      if (details.hasAttribute('data-before-search')) {
        details.open = details.dataset.beforeSearch === 'true' || (!!query && details.textContent.toLowerCase().includes(query));
        if (!query) delete details.dataset.beforeSearch;
      }
    }
  });
  document.querySelectorAll('#settings-tab-bar .settings-tab').forEach(tab => tab.addEventListener('click', () => setTimeout(() => this._showSettingsPage(tab.dataset.tab === 'admin' ? 'admin' : 'user'), 0)));
  document.getElementById('open-settings-btn')?.addEventListener('click', () => setTimeout(() => { this._showSettingsPage('user'); this._showSettingsPage('admin'); }, 0));
  this._showSettingsPage('user');
},
_spTips(root, tr) {
  const rows = '.toggle-row, .select-row, .checkbox-row, .volume-row', heads = 'h5, h6, .settings-group-label, .settings-section-title, .settings-section-subtitle';
  const mk = () => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'sp-tip-btn', textContent: 'ⓘ' });
    b._tips = [];
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-label', tr('settings.pages.more_info', 'More info'));
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const on = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(on)); b._tips.forEach(t => t.classList.toggle('sp-tip-open', on)); });
    b.addEventListener('pointerenter', () => { b.title = b._tips.map(t => t.textContent.trim()).join('\n\n'); });
    return b;
  };
  root.querySelectorAll('.settings-hint, .settings-desc, p.muted-text').forEach(h => {
    if (h.dataset.spTip || h.id || h.matches('.error, .success, .env-setting-hint') || /color/.test(h.getAttribute('style') || '') || h.querySelector('strong, b, button, input, select, textarea, label, [id]') || h.textContent.trim().length < 30) return;
    let p = h.previousElementSibling, btn = null;
    for (let i = 0; p && i < 4 && !btn; i++, p = p.previousElementSibling) {
      const span = p.matches(rows) && p.querySelector(':scope > span');
      btn = p._spBtn || (span ? span.after(mk()) || span.nextElementSibling : p.matches(heads) && !p.hasAttribute('data-i18n') ? p.appendChild(mk()) : null);
      if (p.matches(rows) || p.matches(heads)) break;
    }
    if (!btn) return;
    h.dataset.spTip = '1';
    h._spBtn = btn;
    h.classList.add('sp-tip');
    btn._tips.push(h);
  });
},
_spAvailable(side, id) {
  const s = this._spSides[side], navItem = s.nav.querySelector(`.settings-nav-item[data-target="${id}"]`), sec = document.getElementById(id);
  return !!sec && (!navItem || navItem.style.display !== 'none');
},
_showSettingsPage(side, id, skip) {
  const s = this._spSides?.[side];
  if (!s?.pages) return;
  const usable = s.pages.filter(p => p[4].some(sid => this._spAvailable(side, sid)));
  const page = usable.find(p => p[0] === (id || this._spPage[side])) || usable[0];
  if (!page) return;
  this._spPage[side] = page[0];
  s.picker.replaceChildren(...usable.map(([id]) => {
    const label = s.list.querySelector(`[data-sp="${id}"]`).lastElementChild.textContent;
    return new Option(label, id);
  }));
  s.picker.value = page[0];
  const sections = page[4].filter(sid => this._spAvailable(side, sid));
  s.intro.replaceChildren();
  s.intro.hidden = sections.length < 2;
  s.body.classList.toggle('sp-single', s.intro.hidden);
  if (!s.intro.hidden) {
    const title = document.createElement('h4');
    title.textContent = s.picker.selectedOptions[0].textContent;
    const links = document.createElement('div');
    links.className = 'sp-section-links';
    for (const sid of sections) {
      const anchor = s.nav.querySelector(`.settings-nav-item[data-target="${sid}"]`);
      if (!anchor) continue;
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.setAttribute('aria-controls', sid);
      jump.textContent = (anchor.querySelector('[data-i18n]') || anchor).textContent.trim();
      jump.addEventListener('click', () => {
        anchor.click();
        const target = document.getElementById(sid);
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      });
      links.append(jump);
    }
    s.intro.append(title, links);
  }
  s.list.querySelectorAll('.sp-cat').forEach(c => { const on = c.dataset.sp === page[0]; c.classList.toggle('active', on); c.setAttribute('aria-current', on ? 'page' : 'false'); c.style.display = usable.some(p => p[0] === c.dataset.sp) ? '' : 'none'; on && s.list.scrollWidth > s.list.clientWidth && c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
  s.body.querySelectorAll(s.sel).forEach(sec => sec.id !== 'admin-mod-panel' && sec.classList.toggle('sp-off', !page[4].includes(sec.id)));
  this._spBusy = true;
  page[4].filter(sid => sid !== skip && this._spAvailable(side, sid)).forEach(sid => {
    const sec = document.getElementById(sid), navItem = s.nav.querySelector(`.settings-nav-item[data-target="${sid}"]`);
    if (!navItem) return;
    sec.scrollIntoView = () => {};
    try { navItem.click(); } finally { delete sec.scrollIntoView; }
  });
  this._spBusy = false;
  skip || (s.body.scrollTop = 0);
},
};
