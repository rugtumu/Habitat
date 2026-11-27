/**
 * @name Habitat Layout
 * @description The layout people already know from other chat apps: your account, mute, deafen and settings sit bottom-left with the call controls above them, joining and creating a channel open from a + button instead of filling the sidebar, and the rest of the sidebar tools fold into the server name menu. On a phone the message box tools fold into one + button. Reversible, picked in Settings, Layout.
 * @author Habitat
 * @version 1.3.0
 */

// Habitat fork: this layout only moves complete public regions and a few
// named buttons, records where each one came from, and puts everything back
// while Mod Mode edits the layout and when it is switched off. Nothing is
// hidden without staying reachable: the buttons that leave the sidebar are
// the same elements, in the server name menu.
//
// It has two shapes. 'desktop' (901px and wider) is the whole arrangement.
// 'compact' (tablet and phone) is the same sidebar inside Haven's own
// drawer, which is where the join and create forms hurt most: on a phone
// they left room for one channel. The call controls stay in the members
// drawer there, where the phone layout expects them.
class HabitatLayout {
  start() {
    if (this._started) return;
    this._started = true;
    this._engaged = false;
    this._blocked = false;
    this._suspended = document.documentElement.hasAttribute('data-haven-layout-editing');
    this._listeners = [];
    this._applied = [];
    this._placements = [];
    this._inlineRestores = [];
    this._attrRestores = [];
    this._built = [];
    this._mode = null;
    this._folded = false;
    this._composerActive = false;
    this._media = window.matchMedia('(min-width: 901px)');
    this._phone = window.matchMedia('(max-width: 768px)');

    try {
      HavenApi.DOM.addStyle('HabitatLayout', HabitatLayout.CSS);
      this._listen(document, 'haven:layout-editing', (event) => {
        this._suspended = event.detail?.active === true;
        if (!this._suspended && event.detail?.owner && event.detail.owner !== 'HabitatLayout') {
          this._restoreDesktop();
          this._syncComposer();
          return;
        }
        this._syncDesktop();
      });
      this._listen(document, 'haven:layout-owner-change', (event) => {
        if (event.detail?.owner !== 'HabitatLayout') this._syncDesktop();
      });
      this._listen(this._media, 'change', () => this._syncDesktop());
      this._listen(this._phone, 'change', () => this._syncComposer());

      if (HavenApi.Data.load('HabitatLayout', 'layoutOn', '1') !== '0') this._engage(false);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    if (!this._started) return;
    this._disengage(false);
    for (const [target, type, listener, options] of this._listeners) {
      target.removeEventListener(type, listener, options);
    }
    this._listeners = [];
    this._media = null;
    this._phone = null;
    HavenApi.DOM.removeStyle('HabitatLayout');
    this._started = false;
  }

  _listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this._listeners.push([target, type, listener, options]);
  }

  // Listeners that only live while the layout is applied.
  _on(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this._applied.push([target, type, listener, options]);
  }

  _region(name) {
    return HavenApi.DOM.query(`[data-haven-region="${name}"]`);
  }

  _text(key) {
    const lang = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
    return (HabitatLayout.TEXT[lang] || HabitatLayout.TEXT.en)[key];
  }

  _engage(persist = true) {
    if (this._engaged) return;
    this._engaged = true;
    try {
      this._syncDesktop();
      if (persist) HavenApi.Data.save('HabitatLayout', 'layoutOn', '1');
    } catch (error) {
      this._engaged = false;
      this._restoreDesktop();
      throw error;
    }
  }

  _disengage(persist = true) {
    if (!this._engaged) return;
    this._engaged = false;
    this._restoreDesktop();
    this._syncComposer();
    if (persist) HavenApi.Data.save('HabitatLayout', 'layoutOn', '0');
  }

  _syncDesktop() {
    const editing = document.documentElement.hasAttribute('data-haven-layout-editing');
    const want = this._engaged && !this._suspended && !editing && this._media
      ? (this._media.matches ? 'desktop' : 'compact')
      : null;
    if (want !== this._mode) {
      this._restoreDesktop();
      if (want) this._applyDesktop(want);
    }
    this._syncComposer();
  }

  // On a phone the eight message box tools leave about 22px for the text.
  // Haven already has a folded mode for this (Settings, Layout: one + button);
  // the layout switches it on at phone width and hands it back afterwards.
  _syncComposer() {
    const fold = this._mode === 'compact' && this._phone?.matches === true;
    const active = Boolean(this._mode);
    if (fold === this._folded && active === this._composerActive) return;
    this._composerActive = active;
    const wasFolded = this._folded;
    this._folded = fold;
    const root = document.documentElement;
    if (fold) {
      root.setAttribute('data-compact-composer', '');
    } else if (wasFolded) {
      const setting = document.getElementById('compact-composer');
      if (setting?.checked) root.setAttribute('data-compact-composer', '');
      else root.removeAttribute('data-compact-composer');
    }
    // Buttons a member folded away by hand sit in another menu; let the app
    // put each one where the current mode looks for it.
    window.app?._applyComposerButtons?.();
  }

  _applyDesktop(mode = 'desktop') {
    if (this._placements.length || this._built.length) return;
    const navigation = this._region('navigation-sidebar');
    const account = this._region('account');
    const footer = this._region('sidebar-footer');
    const actions = this._region('sidebar-actions');
    const channels = this._region('channels');
    const header = account?.parentElement;
    if (!navigation || !account || !footer || !actions || !channels || !header || header === footer) {
      console.warn('[HabitatLayout] Required public layout regions are unavailable');
      return;
    }
    if (HavenApi.Layout && !HavenApi.Layout.acquire('HabitatLayout')) {
      this._blocked = true;
      return;
    }
    this._blocked = false;

    try {
      this._buildAccountTools(account, actions);
      this._buildMenu(header, account, actions);
      this._dockAccount(account, footer, mode === 'desktop');
      this._buildAddPanel(channels);
      this._buildNavigation();
      this._buildVoiceRooms();
      this._buildChannelTools();
      this._buildMemberPreview();
      this._buildConversationIntro();
      this._buildCallStage(mode);
      this._buildVoicePeople();
      this._buildConnectionInfo();
      this._watchVoice();
      this._setAttr(header, 'data-habitat-header', '');
      this._mode = mode;
      document.documentElement.setAttribute('data-habitat-layout', mode);
      if (mode === 'desktop') document.documentElement.setAttribute('data-habitat-layout-desktop', '1');
    } catch (error) {
      this._restoreDesktop();
      throw error;
    }
  }

  // Switch the list without switching conversations or marking anything read.
  _buildNavigation() {
    const split = document.getElementById('sidebar-split');
    const channels = this._region('channels');
    const dms = this._region('direct-messages');
    if (!split || !channels || !dms) return;

    const nav = this._make('div', { 'data-habitat-nav': '' });
    split.parentNode.insertBefore(nav, split);
    const jump = this._make('button', { type: 'button', 'data-habitat-jump': '' }, nav);
    jump.appendChild(this._icon('M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'));
    this._make('span', {}, jump).textContent = this._text('find');
    this._on(jump, 'click', () => window.app?._openQuickSwitcher?.());
    const choices = this._make('div', { 'data-habitat-lists': '' }, nav);
    const rail = this._region('server-rail');
    const home = document.getElementById('home-server');
    let inbox;
    if (home && rail?.contains(home)) {
      const label = dms.querySelector('.section-label-text')?.textContent || this._text('messages');
      inbox = this._make('button', { type: 'button', class: 'server-icon', 'data-habitat-inbox': '', 'aria-label': label, title: label });
      inbox.appendChild(this._icon('M4 4h16v12H9l-5 4zM8 8h8M8 12h5'));
      rail.insertBefore(inbox, home);
    }
    const openInbox = this._buildInbox(dms);
    const buttons = {};
    const select = (name) => {
      inbox?.setAttribute('aria-pressed', String(name === 'messages'));
      this._list = name;
      split.setAttribute('data-habitat-list', name);
      for (const [key, button] of Object.entries(buttons)) {
        button.setAttribute('aria-pressed', String(name === key));
      }
    };
    for (const [key, region] of [['channels', channels], ['messages', dms]]) {
      const button = this._make('button', { type: 'button', 'aria-controls': region.id }, choices);
      button.textContent = region.querySelector('.section-label-text')?.textContent || this._text(key);
      buttons[key] = button;
      this._on(button, 'click', () => {
        select(key);
        if (key === 'messages') openInbox();
      });
    }
    if (inbox) {
      this._on(inbox, 'click', () => { select('messages'); openInbox(); });
      this._on(home, 'click', () => select('channels'));
    }
    this._selectList = select;
    const badge = document.getElementById('dm-unread-badge');
    if (badge) {
      const count = this._make('span', { 'data-habitat-count': '' }, buttons.messages);
      const sync = () => { count.textContent = badge.style.display === 'none' ? '' : badge.textContent; };
      this._badgeObserver = new MutationObserver(sync);
      this._badgeObserver.observe(badge, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
      sync();
    }
    this._make('p', { 'data-habitat-dm-empty': '' }, split).textContent = this._text('noDM');
    this._watchDmAvatars();
    this._setAttr(split, 'data-habitat-list', '');
    select(this._list || (document.body.classList.contains('viewing-dm') ? 'messages' : 'channels'));
  }

  _watchDmAvatars() {
    const list = document.getElementById('dm-list');
    if (!list) return;
    const paint = () => {
      const partners = new Map((window.app?.channels || [])
        .filter(channel => channel.is_dm && !channel.is_group && channel.dm_target)
        .map(channel => [channel.code, channel.dm_target]));
      for (const row of list.querySelectorAll('.dm-item')) {
        const partner = partners.get(row.dataset.code);
        if (!partner || row.querySelector('[data-habitat-dm-avatar]')) continue;
        const name = row.querySelector('.channel-name')?.textContent.trim() || partner.username;
        // A newly opened DM can arrive with only the partner's ID and name.
        const member = partner.avatar === undefined
          ? window.app._memberById?.(partner.id) : null;
        const face = this._memberFace(member || partner, name);
        face.setAttribute('data-habitat-dm-avatar', '');
        row.prepend(face);
      }
    };
    // Haven replaces the list's children when a name, pin or tag changes.
    this._dmAvatarObserver = new MutationObserver(paint);
    this._dmAvatarObserver.observe(list, { childList: true });
    paint();
  }

  _memberFace(person, name) {
    const face = document.createElement('span');
    face.setAttribute('data-habitat-face', '');
    face.setAttribute('data-habitat-avatar-id', person.id);
    face.setAttribute('aria-hidden', 'true');
    if (['rounded', 'squircle', 'hex', 'diamond', 'square'].includes(person.avatarShape)) {
      face.classList.add('avatar-' + person.avatarShape);
    }
    face.textContent = Array.from(name || '?')[0].toLocaleUpperCase();
    face.style.setProperty('--habitat-avatar-color', window.app._getUserColor(person.username || name || ''));
    if (person.avatar?.startsWith('/uploads/')) {
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.dataset.animate = person.animateProfile === 'disabled' ? 'disabled' : 'trigger';
      image.addEventListener('error', () => image.remove(), { once: true });
      image.src = person.avatar;
      face.appendChild(image);
    }
    return face;
  }

  // Read the existing sidebar order, names and unread badges. Browsing the
  // inbox never enters a conversation until the reader picks a recipient.
  _buildInbox(dms) {
    const dialog = this._make('dialog', { 'data-habitat-inbox-page': '', 'aria-labelledby': 'habitat-inbox-title' });
    document.body.appendChild(dialog);
    const top = this._make('header', {}, dialog);
    const title = this._make('h2', { id: 'habitat-inbox-title' }, top);
    const close = this._make('button', { type: 'button', 'aria-label': this._text('close') }, top);
    close.appendChild(this._icon('M6 6l12 12M18 6 6 18'));
    const input = this._make('input', { type: 'search', 'aria-label': this._text('find'), placeholder: this._text('find') }, dialog);
    const results = this._make('div', { 'data-habitat-conversations': '' }, dialog);
    const empty = this._make('p', {}, dialog);
    const render = () => {
      if (!dialog.open) return;
      const term = input.value.trim().toLocaleLowerCase();
      const activeCode = document.activeElement?.dataset.habitatDmCode;
      const rows = document.createDocumentFragment();
      for (const native of dms.querySelectorAll('.dm-item')) {
        const name = native.querySelector('.channel-name')?.textContent || '';
        if (!name.toLocaleLowerCase().includes(term)) continue;
        const row = this._make('button', { type: 'button', 'data-habitat-dm-code': native.dataset.code }, rows);
        const face = native.querySelector('[data-habitat-dm-avatar], .channel-hash');
        if (face) row.appendChild(face.cloneNode(true));
        this._make('span', {}, row).textContent = name;
        const badge = native.querySelector('.channel-badge');
        if (badge) row.appendChild(badge.cloneNode(true));
      }
      empty.hidden = Boolean(rows.childElementCount);
      empty.textContent = term ? window.t('header.search_no_results') : this._text('noDM');
      results.replaceChildren(rows);
      if (activeCode) (results.querySelector(`[data-habitat-dm-code="${CSS.escape(activeCode)}"]`) || input).focus();
    };
    this._inboxObserver = new MutationObserver(render);
    this._inboxObserver.observe(dms, { childList: true, subtree: true, characterData: true });
    this._on(input, 'input', render);
    this._on(close, 'click', () => dialog.close());
    this._on(results, 'click', event => {
      const code = event.target.closest('button')?.dataset.habitatDmCode;
      if (!window.app?.channels.some(ch => ch.is_dm && ch.code === code)) return;
      dialog.close();
      window.app._closeDMPiP?.();
      window.app.switchChannel(code);
      window.app._closeMobilePanels?.();
    });
    return () => {
      if (window.app?.user?.isGuest) return;
      title.textContent = dms.querySelector('.section-label-text')?.textContent || this._text('messages');
      input.value = '';
      dialog.showModal();
      render();
      input.focus();
    };
  }

  _buildMemberPreview() {
    const mobile = document.getElementById('mobile-users-btn');
    const toggle = document.getElementById('sidebar-toggle-btn');
    const roster = document.getElementById('online-users');
    const name = document.getElementById('channel-header-name');
    if (!mobile || !toggle || !roster || !name) return;
    const button = this._make('button', { type: 'button', 'data-habitat-room-members': '', 'aria-controls': 'right-sidebar' });
    mobile.before(button);
    const faces = this._make('span', { 'data-habitat-stack': '', 'aria-hidden': 'true' }, button);
    const count = this._make('span', {}, button);
    const sync = () => {
      const app = window.app;
      const people = app?._onlineByChannel?.get(app.currentChannel) || [];
      button.hidden = !people.length || document.body.classList.contains('viewing-dm');
      if (button.hidden) return;
      const first = people.filter(person => person.online !== false).slice(0, 3);
      faces.replaceChildren(...(first.length ? first : people.slice(0, 3)).map(person => this._memberFace(person, person.username)));
      count.textContent = String(people.length);
      const label = window.t('settings.nav.members') + ' · ' + people.length;
      button.title = label;
      button.setAttribute('aria-label', label);
    };
    const sidebar = document.getElementById('right-sidebar');
    const body = document.getElementById('app-body');
    const syncExpanded = () => button.setAttribute('aria-expanded', String(this._media.matches
      ? !sidebar.classList.contains('collapsed')
      : body.classList.contains('mobile-right-open')));
    if (sidebar && body) {
      this._drawerObserver = new MutationObserver(syncExpanded);
      this._drawerObserver.observe(this._media.matches ? sidebar : body, { attributes: true, attributeFilter: ['class'] });
      syncExpanded();
    }
    this._memberObserver = new MutationObserver(sync);
    this._memberObserver.observe(roster, { childList: true });
    this._memberObserver.observe(name, { childList: true, characterData: true, subtree: true });
    this._on(button, 'click', () => (this._media.matches ? toggle : mobile).click());
    sync();
  }

  _buildVoiceRooms() {
    const list = document.getElementById('channel-list');
    const create = this._region('create-channel');
    if (!list || !window.app?._renderChannels) return;
    const section = this._make('section', { 'data-habitat-voice-section': '', 'aria-label': this._text('voiceRooms') });
    const header = this._make('div', { 'data-habitat-room-heading': '' }, section);
    const toggle = this._make('button', { type: 'button', 'aria-expanded': 'true', 'aria-controls': 'habitat-voice-rooms' }, header);
    toggle.appendChild(this._icon('m6 9 6 6 6-6'));
    this._make('span', {}, toggle).textContent = this._text('voiceRooms');
    const rooms = this._make('div', { id: 'habitat-voice-rooms', 'data-habitat-rooms': '' }, section);
    this._make('p', { 'data-habitat-no-rooms': '' }, section).textContent = this._text('emptyVoice');
    this._on(toggle, 'click', () => {
      rooms.hidden = !rooms.hidden;
      toggle.setAttribute('aria-expanded', String(!rooms.hidden));
    });
    if (create) {
      const add = this._make('button', { type: 'button', 'aria-label': this._text('addVoice'), title: this._text('addVoice') }, header);
      add.appendChild(this._icon('M12 5v14M5 12h14'));
      const syncCreate = () => { add.hidden = create.style.display === 'none'; };
      this._voiceCreateObserver = new MutationObserver(syncCreate);
      this._voiceCreateObserver.observe(create, { attributes: true, attributeFilter: ['style'] });
      syncCreate();
      this._on(add, 'click', () => {
        this._toggleDialog(true);
        const form = document.getElementById('create-section-body');
        if (form?.style.display === 'none') document.getElementById('create-section-toggle')?.click();
        const picker = document.getElementById('new-channel-template');
        if (picker) {
          picker.value = 'b:voice_room';
          picker.dispatchEvent(new Event('change'));
        }
        document.getElementById('new-channel-name')?.focus();
      });
    }
    // The renderer keeps the original room buttons, moderation actions and live user rows.
    list.appendChild(section);
    this._voiceDirectory = section;
    window.app._renderChannels();
    const paint = () => {
      for (const row of list.querySelectorAll('.channel-voice-user:not(:has([data-habitat-face]))')) {
        const id = row.dataset.userId;
        const code = row.parentElement.previousElementSibling?.dataset.code;
        const member = window.app._onlineByChannel?.get(code)?.find(user => String(user.id) === id)
          || window.app._memberById?.(id) || { id };
        row.prepend(this._memberFace(member, row.dataset.username));
        this._make('span', { 'data-habitat-speaking': '' }, row).textContent = this._text('speaking');
      }
    };
    this._voiceFaces = new MutationObserver(paint);
    this._voiceFaces.observe(list, { childList: true, subtree: true });
    paint();
  }

  // The original buttons keep their handlers and permission-dependent visibility.
  _buildChannelTools() {
    const box = document.getElementById('header-actions-box');
    if (!box) return;
    const details = this._make('details', { 'data-habitat-channel-tools': '' });
    box.appendChild(details);
    const label = this._text('tools');
    const trigger = this._make('summary', { 'aria-label': label, title: label }, details);
    trigger.appendChild(this._icon('M4 12h2m5 0h2m5 0h2'));
    const panel = this._make('div', { 'data-habitat-channel-menu': '' }, details);
    for (const id of ['channel-code-display', 'copy-code-btn', 'channel-code-settings-btn', 'pinned-toggle-btn', 'gallery-toggle-btn', 'threads-toggle-btn', 'move-select-btn']) {
      const item = document.getElementById(id);
      if (item && box.contains(item)) this._move(item, panel, null);
    }
    this._on(document, 'pointerdown', event => {
      if (details.open && !details.contains(event.target)) details.open = false;
    }, true);
    this._on(details, 'keydown', event => {
      if (event.key === 'Escape') {
        details.open = false;
        trigger.focus();
        event.stopPropagation();
      }
    }, true);
    this._on(panel, 'click', event => {
      if (event.target.closest('button')) details.open = false;
    });
  }

  _buildConversationIntro() {
    const messages = this._region('message-list');
    const header = document.getElementById('channel-header-name');
    if (!messages || !header) return;
    const intro = this._make('div', { 'data-habitat-intro': '' });
    messages.parentNode.insertBefore(intro, messages.nextSibling);
    const mark = this._make('span', { 'aria-hidden': 'true' }, intro);
    const title = this._make('h2', {}, intro);
    const hint = this._make('p', {}, intro);
    // A generated heading scrolls with the first page without becoming a
    // message. Haven relies on its real first child to paginate and trim.
    const historyTitle = 'data-habitat-history-title';
    this._setAttr(messages, historyTitle, '');
    const syncHistory = () => {
      const name = window.app?._noMoreHistory ? header.textContent.trim() : '';
      if (messages.getAttribute(historyTitle) !== name) messages.setAttribute(historyTitle, name);
    };
    const sync = () => {
      const name = header.textContent.trim();
      const dm = document.body.classList.contains('viewing-dm');
      const channel = HavenApi.currentChannel;
      if (channel && channel !== this._lastConversation) {
        this._lastConversation = channel;
        this._selectList?.(dm ? 'messages' : 'channels');
      }
      // A voice room is not a text channel: its title carries a speaker, not a hash.
      const voiceRoom = !dm && !!window.app?._isVoiceOnlyChannel?.(channel);
      if (voiceRoom) header.setAttribute('data-habitat-voice-title', name.replace(/^#\s*/, ''));
      else header.removeAttribute('data-habitat-voice-title');
      mark.textContent = dm ? '@' : voiceRoom ? '' : '#';
      intro.setAttribute('data-habitat-intro', voiceRoom ? 'voice' : '');
      title.textContent = voiceRoom ? name.replace(/^#\s*/, '') : name;
      hint.textContent = this._text(dm ? 'dmStart' : 'channelStart');
      syncHistory();
    };
    this._historyObserver = new MutationObserver(syncHistory);
    this._historyObserver.observe(messages, { childList: true });
    this._on(messages, 'scrollend', syncHistory);
    this._nameObserver = new MutationObserver(sync);
    this._nameObserver.observe(header, { childList: true, characterData: true, subtree: true });
    sync();
  }

  // The largest tile that lets `count` tiles share a box. A tile stays
  // between 4:3 and 16:9, so one person on a wide screen is not stretched
  // and nine people on a phone still fit without scrolling.
  static stageGrid(count, width, height, gap, rows = 0) {
    let best = { cols: 1, rows: Math.max(1, count), width: 0, height: 0 };
    for (let cols = 1; cols <= Math.max(1, count); cols++) {
      const lines = rows || Math.ceil(count / cols);
      if (rows && cols * rows < count) continue;
      let w = (width - gap * (cols - 1)) / cols;
      let h = (height - gap * (lines - 1)) / lines;
      if (w <= 0 || h <= 0) continue;
      if (w / h > 16 / 9) w = h * 16 / 9;
      else if (w / h < 4 / 3) h = w * 3 / 4;
      if (w > best.width) best = { cols, rows: lines, width: w, height: h };
    }
    return best;
  }

  // One grid holds everyone in the call. Haven keeps people, cameras and
  // screen shares in three separate boxes that stack and scroll; here the
  // boxes dissolve and every tile is given a cell, so a camera fills its
  // owner's tile and a screen share takes the large spot with the rest in a
  // row beneath. Haven's own tiles are placed, never rebuilt: their buttons,
  // menus and handlers keep working. The roster's placeholder also keeps the
  // drawer close button in reach on a phone.
  _buildCallStage(mode) {
    const indicator = document.getElementById('voice-active-indicator');
    const area = this._region('message-area');
    const roster = this._region('voice-roster');
    if (!area || !indicator || !roster) return;
    const anchor = this._make('div', { 'data-habitat-roster-home': '' });
    roster.parentNode.insertBefore(anchor, roster);
    const label = this._text('callView');
    const button = this._make('button', {
      type: 'button', 'data-habitat-call-view': '', 'aria-pressed': 'false',
      'aria-controls': roster.id, 'aria-label': label, title: label
    });
    indicator.parentNode.insertBefore(button, indicator);
    button.appendChild(this._icon('M3 4h8v7H3zM14 4h7v7h-7zM3 14h8v6H3zM14 14h7v6h-7z'));
    const close = document.getElementById('mobile-right-close');
    const closeParent = close?.parentNode;
    const closeNext = close?.nextSibling;
    const users = document.getElementById('voice-users');
    const stage = this._make('div', { 'data-habitat-call-stage': '' });
    const media = [this._region('webcams'), this._region('screen-shares')].filter(box => box?.parentNode === area);
    const homes = new Map();
    const marks = ['data-habitat-focused', 'data-habitat-on-camera', 'data-habitat-paired'];
    let placed = new Set();
    let focusKey = null;   // the tile the member chose to enlarge
    let autoFocus = true;  // a new screen share takes the large spot until the member puts it back
    let shareCount = 0;
    let spread = false;    // every shared screen in the large spot at once, when the member asks for it
    const spreadLabel = this._text('sideBySide');
    const spreadButton = this._make('button', {
      type: 'button', 'data-habitat-stage-spread': '', 'aria-pressed': 'false',
      'aria-label': spreadLabel, title: spreadLabel, hidden: ''
    }, stage);
    spreadButton.appendChild(this._icon('M3 5h8v14H3zM13 5h8v14h-8z'));

    const drawAvatars = () => {
      if (!users) return;
      const members = new Map();
      for (const member of document.querySelectorAll('#online-users .user-item[data-user-id]')) {
        members.set(member.dataset.userId, member);
      }
      for (const row of users.querySelectorAll('.voice-user-item')) {
        const member = members.get(row.dataset.userId);
        const photo = member?.querySelector('img.user-item-avatar');
        const frame = member?.querySelector('.pfp-border');
        // The member list can arrive after the call does: a face drawn without
        // the picture or frame it now has is drawn again.
        const drawn = `${photo?.src || ''}|${frame?.getAttribute('data-border') || ''}`;
        const old = row.querySelector('[data-habitat-call-avatar]');
        if (old?.getAttribute('data-habitat-call-avatar') === drawn) continue;
        old?.remove();
        const face = this._make('span', { 'data-habitat-call-avatar': drawn, 'aria-hidden': 'true' }, row);
        if (photo) this._make('img', { src: photo.src, alt: '', 'data-habitat-call-photo': '' }, face);
        else face.textContent = Array.from(row.querySelector('.user-item-name')?.textContent || '?')[0];
        // The member's own picture frame comes along, as drawn in the member list.
        if (frame) face.appendChild(frame.cloneNode(true));
        row.insertBefore(face, row.firstChild);
      }
    };
    const flag = (part, name, on) => {
      if (on) part.setAttribute(name, ''); else part.removeAttribute(name);
    };
    const unmark = (part) => {
      for (const name of ['grid-area', 'left', 'top', 'width', 'height']) part.style.removeProperty(name);
      for (const name of marks) part.removeAttribute(name);
      if (part.matches('.voice-user-item')) part.removeAttribute('title');
      if (part.getAttribute('style') === '') part.removeAttribute('style');
    };
    // Shares first, then each person with their camera, then a camera whose
    // owner the roster has not listed yet.
    const slots = () => {
      const list = [];
      // A picture popped out into its own window leaves a short placeholder
      // behind: it keeps a place in the row, never the large spot.
      const away = tile => tile.matches('.stream-popped-out, .webcam-popped-out');
      for (const tile of stage.querySelectorAll('.screen-share-tile')) {
        if (tile.getAttribute('data-hidden') !== 'true') list.push({ key: tile.id, share: true, away: away(tile), parts: [tile] });
      }
      const paired = new Set();
      for (const row of users ? users.querySelectorAll('.voice-user-item') : []) {
        const id = row.getAttribute('data-user-id');
        const camera = [...stage.querySelectorAll('.webcam-tile')].find(tile => tile.id === `webcam-tile-${id}` && !away(tile));
        if (camera) paired.add(camera);
        list.push({ key: `person-${id}`, row, camera, parts: camera ? [camera, row] : [row] });
      }
      for (const tile of stage.querySelectorAll('.webcam-tile')) {
        if (!paired.has(tile)) list.push({ key: tile.id, away: away(tile), parts: [tile] });
      }
      return list;
    };
    const arrange = () => {
      if (stage.parentNode !== area) return;
      drawAvatars();
      const all = slots();
      const shares = all.filter(slot => slot.share);
      if (shares.length > shareCount) autoFocus = true;
      shareCount = shares.length;
      // One screen is large by default. A second one waits in the row with
      // the people until the member picks it, or asks for both side by side.
      const screens = shares.filter(slot => !slot.away);
      if (screens.length < 2) spread = false;
      spreadButton.hidden = screens.length < 2;
      spreadButton.setAttribute('aria-pressed', String(spread));
      let focus = all.find(slot => slot.key === focusKey && !slot.away) || null;
      if (!focus) focusKey = null;
      if (!focus && autoFocus) focus = screens[0] || null;
      let large = spread ? screens : focus ? [focus] : [];
      // Alone, there is nothing to enlarge, and a click made then must not
      // send that tile to the large spot when the next person arrives.
      if (all.length < 2) { large = []; focusKey = null; }
      const rest = all.filter(slot => !large.includes(slot));
      const look = getComputedStyle(stage);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const gap = parseFloat(look.columnGap) || 0;
      const width = stage.clientWidth - (parseFloat(look.paddingLeft) || 0) - (parseFloat(look.paddingRight) || 0);
      const height = stage.clientHeight - (parseFloat(look.paddingTop) || 0) - (parseFloat(look.paddingBottom) || 0);
      const strip = Math.max(4.5 * rem, Math.min(8.5 * rem, height * 0.2));
      const grid = large.length
        ? HabitatLayout.stageGrid(rest.length, width, strip, gap, 1)
        : HabitatLayout.stageGrid(rest.length, width, height, gap);
      stage.style.setProperty('--hb-stage-cols', String(grid.cols * 2));
      stage.style.setProperty('--hb-tile-w', `${(grid.width / rem).toFixed(3)}rem`);
      stage.style.setProperty('--hb-tile-h', `${(grid.height / rem).toFixed(3)}rem`);
      flag(stage, 'data-habitat-focus', large.length > 0);
      // Too small for a name under the face: the face alone, the name on hover.
      const dense = grid.height < 5 * rem;
      flag(stage, 'data-habitat-dense', dense);
      const now = new Set();
      const put = (slot, cell, box = {}) => {
        for (const part of slot.parts) {
          now.add(part);
          if (cell) part.style.setProperty('grid-area', cell); else part.style.removeProperty('grid-area');
          for (const side of ['left', 'top', 'width', 'height']) {
            if (side in box) part.style.setProperty(side, `${(box[side] / rem).toFixed(3)}rem`);
            else part.style.removeProperty(side);
          }
          flag(part, 'data-habitat-focused', !cell);
          flag(part, 'data-habitat-on-camera', part === slot.row && !!slot.camera);
          flag(part, 'data-habitat-paired', part === slot.camera);
        }
        if (!slot.row) return;
        const name = dense && cell ? slot.row.querySelector('.user-item-name')?.textContent.trim() : '';
        if (name) slot.row.setAttribute('title', name); else slot.row.removeAttribute('title');
      };
      rest.forEach((slot, index) => {
        const line = Math.floor(index / grid.cols);
        const inLine = Math.min(grid.cols, rest.length - line * grid.cols);
        // A short last row is centred: every tile spans two half-width columns.
        const start = (index % grid.cols) * 2 + 1 + (grid.cols - inLine);
        put(slot, `${line + 1} / ${start} / span 1 / span 2`);
      });
      // The large spot is everything above the row, shared out between the
      // tiles in it. A screen is shown whole inside its share, never cropped.
      const room = height - (rest.length ? grid.height + gap : 0);
      const fit = HabitatLayout.stageGrid(large.length, width, room, gap);
      const cellWidth = (width - gap * (fit.cols - 1)) / fit.cols;
      const cellHeight = (room - gap * (fit.rows - 1)) / fit.rows;
      large.forEach((slot, index) => put(slot, null, {
        left: (parseFloat(look.paddingLeft) || 0) + (index % fit.cols) * (cellWidth + gap),
        top: (parseFloat(look.paddingTop) || 0) + Math.floor(index / fit.cols) * (cellHeight + gap),
        width: cellWidth, height: cellHeight
      }));
      for (const part of placed) if (!now.has(part)) unmark(part);
      placed = now;
    };
    // Moving a playing video the plain way pauses it in some browsers.
    const carry = (node, parent, before) => {
      if (typeof parent.moveBefore === 'function' && node.isConnected && parent.isConnected) {
        try { parent.moveBefore(node, before); return; } catch { /* not movable in place: the plain move below works everywhere */ }
      }
      parent.insertBefore(node, before);
    };
    const resume = () => {
      for (const box of media) {
        for (const video of box.querySelectorAll('video')) {
          if (video.srcObject && video.paused) video.play?.().catch(() => { /* the next click starts it, as in Haven */ });
        }
      }
    };
    // On a phone or tablet Haven keeps the camera, share and leave buttons in
    // the members drawer. While the stage is open they sit under it instead,
    // with their settings panel, so none of them is a drawer away.
    const barStyle = {
      position: 'static', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto',
      width: 'auto', 'max-width': 'none', transform: 'none', 'z-index': 'auto', resize: 'none'
    };
    let docked = [];
    const dockBar = (on) => {
      const controls = this._region('voice-controls');
      if (on && mode === 'compact' && controls && controls.parentNode !== area) {
        const settings = this._region('voice-settings');
        const inline = Object.keys(barStyle).map(name =>
          [name, controls.style.getPropertyValue(name), controls.style.getPropertyPriority(name)]);
        for (const piece of [settings, controls]) {
          if (!piece) continue;
          docked.push([piece, piece.parentNode, piece.nextSibling, piece === controls ? inline : []]);
          area.insertBefore(piece, stage.nextSibling);
        }
        if (settings) area.insertBefore(settings, controls);
        for (const [name, value] of Object.entries(barStyle)) controls.style.setProperty(name, value, 'important');
        controls.setAttribute('data-habitat-call-bar', '');
      } else if (!on) {
        for (const [piece, parent, next, inline] of docked.reverse()) {
          for (const [name, value, priority] of inline) {
            if (value) piece.style.setProperty(name, value, priority); else piece.style.removeProperty(name);
          }
          piece.removeAttribute('data-habitat-call-bar');
          parent.insertBefore(piece, next?.parentNode === parent ? next : null);
        }
        docked = [];
      }
    };
    const setOpen = (open) => {
      if (open === roster.hasAttribute('data-habitat-stage')) return;
      if (open) {
        if (close) anchor.appendChild(close);
        area.insertBefore(stage, area.firstChild);
        carry(roster, stage, null);
        roster.setAttribute('data-habitat-stage', '');
        // Haven's own enlarge and minimise states belong to its panels; left on,
        // they hide every tile but one inside the stage.
        window.app?._exitStreamFocus?.();
        for (const box of media) {
          for (const tile of box.querySelectorAll('.webcam-focused')) window.app?._toggleWebcamFocus?.(tile);
          for (const tile of box.querySelectorAll('.webcam-minimized')) tile.querySelector('.stream-minimize-btn')?.click();
          homes.set(box, box.nextSibling);
          carry(box, stage, null);
        }
        // Tiles coming and going, and a picture Haven hides or pops out into
        // its own window (a class on the tile), change who gets which cell.
        // The roster's own class changes, one per spoken word, do not.
        this._stageObserver = new MutationObserver((records) => {
          const relevant = !records?.length || records.some(record => record.type === 'childList'
            || record.target?.matches?.('.webcam-tile, .screen-share-tile'));
          if (relevant) arrange();
        });
        this._stageObserver.observe(stage, {
          childList: true, subtree: true, attributes: true, attributeFilter: ['data-hidden', 'class']
        });
        if (typeof ResizeObserver === 'function') {
          this._stageSize = new ResizeObserver(arrange);
          this._stageSize.observe(stage);
        }
        focusKey = null; autoFocus = true; shareCount = 0; spread = false;
        dockBar(true);
        arrange();
      } else {
        this._stageObserver?.disconnect();
        this._stageSize?.disconnect();
        dockBar(false);
        for (const part of placed) unmark(part);
        placed = new Set();
        for (const face of roster.querySelectorAll('[data-habitat-call-avatar]')) face.remove();
        for (const box of [...media].reverse()) {
          const next = homes.get(box);
          carry(box, area, next?.parentNode === area ? next : null);
        }
        homes.clear();
        carry(roster, anchor.parentNode, anchor.nextSibling);
        if (closeParent) closeParent.insertBefore(close, closeNext?.parentNode === closeParent ? closeNext : null);
        roster.removeAttribute('data-habitat-stage');
        stage.remove();
        stage.removeAttribute('data-habitat-focus');
        stage.removeAttribute('data-habitat-dense');
        stage.removeAttribute('style');
      }
      resume();
      button.setAttribute('aria-pressed', String(open));
    };
    // A click on a tile enlarges it; a click on the large tile puts it back.
    // Controls inside a tile, and a tile shown fullscreen, keep their own clicks.
    this._on(stage, 'click', (event) => {
      const tile = event.target.closest?.('.screen-share-tile, .webcam-tile, .voice-user-item');
      if (!tile || document.fullscreenElement) return;
      if (event.target.closest('button, input, a, label, .user-item-name, .voice-stream-badge, .stream-audio-controls, .fullscreen-call-toolbar')) return;
      const slot = slots().find(item => item.parts.includes(tile));
      if (!slot) return;
      const focused = tile.hasAttribute('data-habitat-focused');
      // From side by side, a click keeps the one that was clicked.
      focusKey = focused && !spread ? null : slot.key;
      if (focused && !spread) autoFocus = false;
      spread = false;
      arrange();
    });
    this._on(spreadButton, 'click', () => {
      spread = !spread;
      if (spread) focusKey = null;
      arrange();
    });
    // Haven's double-click enlarges a tile inside its own panel, which the
    // stage has dissolved; the single click above does that job here.
    this._on(stage, 'dblclick', (event) => {
      if (event.target.closest?.('.screen-share-tile, .webcam-tile') && !document.fullscreenElement) event.stopPropagation();
    }, true);
    // A camera or a shared screen opens the stage by itself, so Haven's two
    // stacked panels are never the first thing a call shows. Closing the stage
    // by hand is respected until the call ends.
    let closedByHand = false;
    const followMedia = () => {
      if (button.hidden || closedByHand || roster.hasAttribute('data-habitat-stage')) return;
      if (media.some(box => box.querySelector('.webcam-tile, .screen-share-tile'))) setOpen(true);
    };
    if (media.length) {
      this._mediaObserver = new MutationObserver(followMedia);
      for (const box of media) this._mediaObserver.observe(box, { childList: true, subtree: true });
    }
    // Haven shows the indicator only on the channel the call is in, so the
    // button, and with it the stage, never outlives a move to another channel.
    let stageRoom = null;
    const sync = () => {
      button.hidden = indicator.style.display === 'none';
      if (button.hidden) closedByHand = false;
      const app = window.app;
      const connectedHere = !button.hidden && app?.voice?.inVoice && app.voice.currentChannel === app.currentChannel;
      const room = connectedHere && app._isVoiceOnlyChannel?.(app.currentChannel) ? app.currentChannel : null;
      if (room && room !== stageRoom) setOpen(true);
      else if (button.hidden || (!room && stageRoom)) setOpen(false);
      flag(stage, 'data-habitat-voice-room', !!room);
      stageRoom = room;
      followMedia();
      arrange();
    };
    this._closeStage = () => { setOpen(false); stage.removeAttribute('data-habitat-voice-room'); };
    this._on(button, 'click', () => {
      closedByHand = roster.hasAttribute('data-habitat-stage');
      setOpen(!closedByHand);
    });
    this._indicatorObserver = new MutationObserver(sync);
    this._indicatorObserver.observe(indicator, { attributes: true, attributeFilter: ['style'] });
    const title = document.getElementById('channel-header-name');
    if (title) this._indicatorObserver.observe(title, { childList: true, characterData: true, subtree: true });
    sync();
  }

  // ── Bottom-left: account, mute, deafen, settings ──────────
  _buildAccountTools(account, actions) {
    const tools = this._make('div', { 'data-habitat-tools': '' });
    account.appendChild(tools);
    for (const id of ['voice-mute-btn', 'voice-deafen-btn']) {
      const button = document.getElementById(id);
      if (button && actions.contains(button)) this._move(button, tools, null);
    }
    const settings = document.getElementById('open-settings-btn');
    const context = this._region('context-sidebar');
    if (settings && context?.contains(settings)) {
      this._setAttr(settings.parentElement, 'data-habitat-emptied', '');
      this._move(settings, tools, null);
    }
  }

  _dockAccount(account, footer, withCallControls) {
    this._move(account, footer, null);
    if (!withCallControls) return;
    const voiceSettings = this._region('voice-settings');
    const voiceControls = this._region('voice-controls');
    if (voiceSettings) this._move(voiceSettings, footer, account);
    if (voiceControls) {
      this._move(voiceControls, footer, account);
      this._dockVoiceControls(voiceControls);
    }
  }

  // The call bar floats over the right sidebar natively, positioned inline.
  // Docked in the footer it has to sit in the flow instead.
  _dockVoiceControls(element) {
    const overrides = {
      position: 'static', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto',
      width: 'auto', 'max-width': 'none', transform: 'none', 'z-index': 'auto',
      border: '0', 'border-radius': '0', 'box-shadow': 'none', resize: 'none'
    };
    for (const [property, value] of Object.entries(overrides)) {
      this._inlineRestores.push([
        element, property,
        element.style.getPropertyValue(property),
        element.style.getPropertyPriority(property)
      ]);
      element.style.setProperty(property, value, 'important');
    }
  }

  // ── People in a voice room ─────────────────────────────────
  // Haven gives the names under a voice room a right-click menu and nothing
  // else. A click now opens the person's profile card, and the card of anyone
  // who is in a voice room carries their volume and a mute switch, so the
  // same controls are one tap away on a phone, where there is no right click.
  _buildVoicePeople() {
    const list = document.getElementById('channel-list');
    if (list) {
      this._on(list, 'click', (event) => {
        const row = event.target.closest?.('.channel-voice-user');
        const app = window.app;
        if (!row || event.target.closest('button') || !app?.socket) return;
        const userId = parseInt(row.getAttribute('data-user-id'), 10);
        if (Number.isNaN(userId) || row.getAttribute('data-is-bot') === 'true') return;
        event.stopPropagation();
        // A hover preview leaves these set, and the card that follows a click
        // would be thrown away as a preview nobody is hovering any more.
        app._isHoverPopup = false;
        app._hoverTarget = null;
        app._profilePopupAnchor = row;
        app.socket.emit('get-user-profile', { userId });
      });
    }
    if (typeof MutationObserver !== 'function') return;
    const dress = () => {
      const card = document.getElementById('profile-popup');
      const app = window.app;
      if (!card || !app || card.querySelector('[data-habitat-voice-tools]')) return;
      const userId = parseInt(card.getAttribute('data-habitat-avatar-id'), 10);
      const inVoice = Object.values(app.voiceChannelUsers || {})
        .some(room => Array.isArray(room) && room.some(person => person.id === userId));
      const body = card.querySelector('.profile-popup-body');
      if (!body || Number.isNaN(userId) || userId === app.user?.id || !inVoice) return;
      const tools = this._make('div', { 'data-habitat-voice-tools': '' }, body);
      const label = this._make('label', {}, tools);
      this._make('span', {}, label).textContent = this._text('volume');
      const slider = this._make('input', { type: 'range', min: '0', max: '200', step: '5' }, label);
      const readout = this._make('output', {}, label);
      const mute = this._make('button', { type: 'button' }, tools);
      const show = (value) => {
        readout.textContent = `${value}%`;
        mute.textContent = this._text(value === 0 ? 'unmute' : 'mute');
        mute.setAttribute('aria-pressed', String(value === 0));
      };
      // The same two calls Haven's own voice menu makes: remember, then apply.
      const apply = (value) => {
        app._setVoiceVolume?.(userId, value);
        app.voice?.setVolume?.(userId, value / 100);
        show(value);
      };
      const saved = Number(app._getVoiceVolume?.(userId) ?? 100);
      slider.value = String(saved);
      show(saved);
      slider.addEventListener('input', () => apply(parseInt(slider.value, 10) || 0));
      mute.addEventListener('click', () => {
        const next = (parseInt(slider.value, 10) || 0) === 0 ? 100 : 0;
        slider.value = String(next);
        apply(next);
      });
      body.insertBefore(tools, body.querySelector('.profile-popup-actions'));
      // The card was placed before it grew.
      app._positionProfilePopup?.(card);
    };
    this._cardObserver = new MutationObserver(dress);
    this._cardObserver.observe(document.body, { childList: true });
  }

  // ── The signal mark: how the call is doing ─────────────────
  // Haven's voice bar says "connected" and nothing more. The mark beside it
  // now takes the colour of the connection, and a click on it lists what that
  // is made of: the round trip to the server, the delay, loss and jitter of
  // the voice itself, and whether it travels directly or through the relay.
  _buildConnectionInfo() {
    const bar = document.getElementById('voice-bar');
    if (!bar) return;
    const panel = this._make('div', { 'data-habitat-connection': '', role: 'status', hidden: '' });
    document.body.appendChild(panel);
    const head = this._make('strong', {}, panel);
    const table = this._make('dl', {}, panel);
    const cells = {};
    for (const key of ['people', 'serverPing', 'voicePing', 'loss', 'jitter', 'upload', 'download', 'video', 'route', 'server']) {
      this._make('dt', {}, table).textContent = this._text(key);
      cells[key] = this._make('dd', {}, table);
    }
    let before = new Map();  // per person: packets lost and received at the last reading
    let traffic = null;      // bytes sent and received, and when, at the last reading
    const read = async () => {
      const out = {
        peers: 0, live: 0, rtt: null, loss: null, jitter: null, relayed: 0, direct: 0, up: null, down: null, video: null,
        sfu: false, sfuLive: false, others: 0
      };
      let sentBytes = 0; let gotBytes = 0;
      const voice = window.app?.voice;
      // A call is either a mesh, one connection per person, or goes through
      // Haven's voice relay: two connections to the server, one each way.
      const links = [];
      if (voice?.peers && typeof voice.peers.forEach === 'function') {
        for (const [id, peer] of voice.peers) links.push({ id, link: peer?.connection, person: true });
      }
      const relay = voice?._relay;
      if (relay && !relay.closed) {
        out.sfu = true;
        links.push({ id: 'relay-out', link: relay.sendTransport }, { id: 'relay-in', link: relay.recvTransport });
        const heard = new Set();
        relay.consumers?.forEach?.(entry => heard.add(entry.userId));
        out.others = heard.size;
      }
      const trips = []; const shakes = []; let lost = 0; let got = 0;
      const seen = new Map();
      for (const { id, link, person } of links) {
        if (!link || typeof link.getStats !== 'function') continue;
        if (person) {
          out.peers++;
          if (link.connectionState === 'connected') out.live++;
        } else if (link.connectionState === 'connected') out.sfuLive = true;
        let stats;
        try { stats = await link.getStats(); } catch { continue; }
        const byId = new Map();
        stats.forEach(report => byId.set(report.id, report));
        let pair = null; let peerLost = 0; let peerGot = 0;
        stats.forEach((report) => {
          if (report.type === 'transport' && report.selectedCandidatePairId) pair = byId.get(report.selectedCandidatePairId) || pair;
          // What this member sends and receives, voice and pictures together,
          // and the largest picture going out: its size, its frame rate and
          // what, if anything, the browser says is holding it back.
          if (report.type === 'inbound-rtp') gotBytes += report.bytesReceived || 0;
          if (report.type === 'outbound-rtp') {
            sentBytes += report.bytesSent || 0;
            if (report.kind === 'video' && report.frameHeight && (!out.video || report.frameHeight > out.video.height)) {
              out.video = { height: report.frameHeight, fps: report.framesPerSecond, limit: report.qualityLimitationReason };
            }
          }
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            peerLost += report.packetsLost || 0;
            peerGot += report.packetsReceived || 0;
            if (typeof report.jitter === 'number') shakes.push(report.jitter * 1000);
          }
        });
        if (!pair) stats.forEach((report) => {
          if (!pair && report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) pair = report;
        });
        if (pair) {
          if (typeof pair.currentRoundTripTime === 'number') trips.push(pair.currentRoundTripTime * 1000);
          const ends = [byId.get(pair.localCandidateId), byId.get(pair.remoteCandidateId)];
          if (ends.some(end => end?.candidateType === 'relay')) out.relayed++; else out.direct++;
        }
        // Loss since the last reading, not since the call began: an old drop
        // should not colour the mark for the rest of the evening.
        const was = before.get(id) || { lost: 0, got: 0 };
        seen.set(id, { lost: peerLost, got: peerGot });
        lost += Math.max(0, peerLost - was.lost);
        got += Math.max(0, peerGot - was.got);
      }
      before = seen;
      const now = Date.now();
      if (traffic && now > traffic.at) {
        const seconds = (now - traffic.at) / 1000;
        out.up = Math.max(0, sentBytes - traffic.sent) * 8 / seconds;
        out.down = Math.max(0, gotBytes - traffic.got) * 8 / seconds;
      }
      traffic = { sent: sentBytes, got: gotBytes, at: now };
      const mean = list => list.reduce((sum, value) => sum + value, 0) / list.length;
      if (trips.length) out.rtt = mean(trips);
      if (shakes.length) out.jitter = mean(shakes);
      if (lost + got > 0) out.loss = lost / (lost + got) * 100;
      return out;
    };
    const ms = value => (value === null || !Number.isFinite(value) ? '–' : `${Math.round(value)} ms`);
    const rate = value => (value === null || !Number.isFinite(value) ? '–'
      : value >= 1e6 ? `${(value / 1e6).toFixed(1)} Mbps` : `${Math.round(value / 1000)} kbps`);
    let drawing = false;
    const draw = async () => {
      const app = window.app;
      if (!app?.voice?.inVoice || drawing) return;
      drawing = true;
      let call;
      try { call = await read(); } finally { drawing = false; }
      if (!timer) return;  // the call ended, or the layout left, while the reading was out
      const ping = parseInt(document.getElementById('status-ping')?.textContent, 10);
      const worst = Math.max(Number.isFinite(ping) ? ping : 0, call.rtt || 0);
      const loss = call.loss || 0;
      const held = call.video?.limit === 'bandwidth' || call.video?.limit === 'cpu';
      const down = (call.peers && !call.live && !call.sfuLive) || (call.sfu && !call.sfuLive && !call.live);
      const grade = down || worst > 300 || loss > 8 ? 'poor'
        : worst > 120 || loss > 3 || held ? 'fair' : 'good';
      if (bar.getAttribute('data-habitat-signal') !== grade) bar.setAttribute('data-habitat-signal', grade);
      if (panel.hidden) return;
      panel.setAttribute('data-habitat-connection', grade);
      head.textContent = this._text(grade);
      cells.people.textContent = call.peers ? `${call.live} / ${call.peers}`
        : call.others ? String(call.others) : this._text('alone');
      cells.serverPing.textContent = ms(Number.isFinite(ping) ? ping : null);
      cells.voicePing.textContent = ms(call.rtt);
      cells.loss.textContent = call.loss === null ? '–' : `${call.loss.toFixed(1)}%`;
      cells.jitter.textContent = ms(call.jitter);
      cells.upload.textContent = rate(call.up);
      cells.download.textContent = rate(call.down);
      cells.video.textContent = !call.video ? '–' : [
        `${call.video.height}p`,
        Number.isFinite(call.video.fps) ? `${Math.round(call.video.fps)} fps` : '',
        held ? this._text(call.video.limit === 'cpu' ? 'limitCpu' : 'limitBandwidth') : ''
      ].filter(Boolean).join(' · ');
      cells.route.textContent = call.sfu ? this._text('sfu')
        : !call.relayed && !call.direct ? '–'
          : this._text(call.relayed && call.direct ? 'mixed' : call.relayed ? 'relay' : 'direct');
      cells.server.textContent = window.location?.host || '–';
    };
    const place = () => {
      const box = bar.getBoundingClientRect();
      panel.style.setProperty('left', `${box.left + 8}px`);
      panel.style.setProperty('bottom', `${window.innerHeight - box.top + 8}px`);
      panel.style.setProperty('width', `${Math.max(box.width - 16, 200)}px`);
    };
    const setOpen = (open) => {
      panel.hidden = !open;
      bar.querySelector('.voice-bar-status')?.setAttribute('aria-expanded', String(open));
      if (open) { place(); draw(); }
    };
    this._on(bar, 'click', (event) => {
      if (event.target.closest?.('.voice-bar-status')) setOpen(panel.hidden);
    });
    this._on(bar, 'keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.closest?.('.voice-bar-status')) {
        event.preventDefault?.();
        setOpen(panel.hidden);
      }
    });
    this._on(document, 'pointerdown', (event) => {
      if (!panel.hidden && !panel.contains(event.target) && !event.target.closest?.('.voice-bar-status')) setOpen(false);
    }, true);
    this._on(document, 'keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) setOpen(false);
    });
    let timer = null;
    // Called by the voice watcher each time Haven redraws the bar.
    this._signalSync = (inCall) => {
      if (inCall) {
        const status = bar.querySelector('.voice-bar-status');
        if (status && !status.hasAttribute('role')) {
          for (const [name, value] of [['role', 'button'], ['tabindex', '0'], ['title', this._text('connection')],
            ['aria-expanded', String(!panel.hidden)]]) status.setAttribute(name, value);
        }
        // Haven writes "# name" for every channel; a voice room has no hash.
        const name = bar.querySelector('.voice-bar-channel');
        const app = window.app;
        if (name && app?._isVoiceOnlyChannel?.(app.voice?.currentChannel)) {
          name.setAttribute('data-habitat-voice-title', name.textContent.trim().replace(/^#\s*/, ''));
        }
        if (timer) return;
        timer = setInterval(draw, 4000);
        timer.unref?.();
        draw();
      } else {
        if (timer) clearInterval(timer);
        timer = null;
        before = new Map();
        traffic = null;
        bar.removeAttribute('data-habitat-signal');
        const status = bar.querySelector('.voice-bar-status');
        for (const name of ['role', 'tabindex', 'title', 'aria-expanded']) status?.removeAttribute(name);
        bar.querySelector('.voice-bar-channel')?.removeAttribute('data-habitat-voice-title');
        panel.hidden = true;
      }
    };
  }

  // ── In a call: mute and deafen beside the account ─────────
  // Haven draws these two in the sidebar only for a member who opted in to
  // sidebar voice controls; for everyone else they sit in the members panel
  // header. In this layout the account bar is where people look for them,
  // so they show there whenever a call is on. The voice bar is Haven's own
  // sign of that: it is only drawn during a call.
  _watchVoice() {
    const bar = document.getElementById('voice-bar');
    if (!bar || typeof MutationObserver !== 'function') return;
    const sync = () => {
      const inCall = bar.style.display !== 'none' && bar.children.length > 0;
      if (inCall) document.documentElement.setAttribute('data-habitat-in-voice', '');
      else document.documentElement.removeAttribute('data-habitat-in-voice');
      this._signalSync?.(inCall);
    };
    this._voiceObserver = new MutationObserver(sync);
    this._voiceObserver.observe(bar, { attributes: true, attributeFilter: ['style'], childList: true });
    sync();
  }

  // ── Server name menu ───────────────────────────────────────
  _buildMenu(header, account, actions) {
    const button = this._make('button', {
      type: 'button',
      'data-habitat-menu-button': '',
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      'aria-label': this._text('menu'),
      title: this._text('menu')
    });
    button.appendChild(this._icon('M6 9.5l6 6 6-6'));
    const menu = this._make('div', { 'data-habitat-menu': '', hidden: '' });
    header.appendChild(button);
    header.appendChild(menu);

    this._move(actions, menu, null);
    // The floating debug tab otherwise covers Send on narrow screens.
    const statusTab = document.getElementById('status-bar-toggle');
    if (statusTab) this._move(statusTab, menu, null);
    for (const id of ['rename-btn', 'logout-btn']) {
      const item = document.getElementById(id);
      if (item && account.contains(item)) this._move(item, menu, null);
    }
    // A row is labelled by its button's name, so one without a name gets one.
    const donors = document.getElementById('donors-btn');
    if (donors && menu.contains(donors) && !donors.title && !donors.getAttribute('aria-label')) {
      this._setAttr(donors, 'aria-label', this._text('supporters'));
    }

    this._menu = menu;
    this._menuButton = button;
    this._on(button, 'click', () => this._toggleMenu());
    // The row has done its job once clicked; let its own handler run first.
    this._on(menu, 'click', (event) => {
      if (event.target.closest('button')) setTimeout(() => this._toggleMenu(false), 0);
    });
    this._on(document, 'pointerdown', (event) => {
      if (this._menu?.hidden) return;
      if (!this._menu.contains(event.target) && !this._menuButton.contains(event.target)) this._toggleMenu(false);
    }, true);
  }

  _toggleMenu(open = this._menu?.hidden) {
    if (!this._menu) return;
    if (open) this._labelMenu();
    this._menu.hidden = !open;
    this._menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // A row shows its button's name next to the icon. The name is copied when
  // the menu opens rather than read live from title: the tooltip code takes
  // title off a button while the pointer is over it, and a language change
  // rewrites it.
  _labelMenu() {
    for (const button of this._menu.querySelectorAll('button')) {
      const name = button.getAttribute('title') || button.getAttribute('aria-label');
      if (name) button.setAttribute('data-habitat-label', name);
    }
  }

  // ── Join or create a channel: a + button and a dialog ─────
  _buildAddPanel(channels) {
    const join = this._region('join-channel');
    const create = this._region('create-channel');
    if (!join && !create) return;

    const button = this._make('button', {
      type: 'button',
      'data-habitat-add-button': '',
      'aria-haspopup': 'dialog',
      'aria-label': this._text('add'),
      title: this._text('add')
    });
    button.appendChild(this._icon('M12 5v14M5 12h14'));
    const heading = channels.querySelector(':scope > h5, :scope > [role="heading"]');
    if (heading) heading.appendChild(button);
    else channels.prepend(button);

    const dialog = this._make('div', { 'data-habitat-dialog': '', hidden: '' });
    const panel = this._make('div', {
      'data-habitat-dialog-panel': '',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': this._text('add'),
      tabindex: '-1'
    }, dialog);
    const top = this._make('div', { 'data-habitat-dialog-top': '' }, panel);
    const title = this._make('h2', {}, top);
    title.textContent = this._text('add');
    const close = this._make('button', {
      type: 'button',
      'data-habitat-dialog-close': '',
      'aria-label': this._text('close'),
      title: this._text('close')
    }, top);
    close.appendChild(this._icon('M6 6l12 12M18 6 6 18'));
    const body = this._make('div', { 'data-habitat-dialog-body': '' }, panel);
    document.body.appendChild(dialog);

    if (join) this._move(join, body, null);
    if (create) this._move(create, body, null);

    this._dialog = dialog;
    this._addButton = button;
    this._on(button, 'click', (event) => {
      // The heading it sits in collapses the channel list on click.
      event.stopPropagation();
      this._toggleDialog(true);
    });
    this._on(close, 'click', () => this._toggleDialog(false));
    this._on(dialog, 'pointerdown', (event) => {
      if (event.target === dialog) this._toggleDialog(false);
    });
    this._on(document, 'keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (this._dialog && !this._dialog.hidden) { event.stopPropagation(); this._toggleDialog(false); }
      else if (this._menu && !this._menu.hidden) this._toggleMenu(false);
    }, true);
    // Joining or creating closes the dialog, but only when there was
    // something to submit: an empty field keeps it open for the error.
    // Both listen in the capture phase, because the app's own handler on the
    // button empties the field before the event would bubble up to here.
    this._on(body, 'click', (event) => {
      const submit = event.target.closest('#join-channel-btn, #create-channel-btn');
      if (!submit) return;
      const field = submit.parentElement?.querySelector('input[type="text"]');
      if (field && field.value.trim()) setTimeout(() => this._toggleDialog(false), 0);
    }, true);
    this._on(body, 'keydown', (event) => {
      if (event.key !== 'Enter' || !event.target.matches?.('input[type="text"]')) return;
      if (event.target.value.trim()) setTimeout(() => this._toggleDialog(false), 0);
    }, true);
  }

  _toggleDialog(open) {
    if (!this._dialog) return;
    this._dialog.hidden = !open;
    if (open) {
      const field = this._dialog.querySelector('input[type="text"]');
      (field || this._dialog.querySelector('[data-habitat-dialog-panel]')).focus();
    } else {
      this._addButton?.focus();
    }
  }

  // ── Bookkeeping ────────────────────────────────────────────
  _make(tag, attributes = {}, parent = null) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    if (parent) parent.appendChild(element);
    // Only top-level pieces are tracked: removing one takes its children.
    else this._built.push(element);
    return element;
  }

  _icon(d) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('data-habitat-icon', '');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  _move(element, parent, before) {
    this._placements.push([element, element.parentNode, element.nextSibling]);
    parent.insertBefore(element, before || null);
  }

  _setAttr(element, name, value) {
    if (!element) return;
    this._attrRestores.push([element, name, element.getAttribute(name)]);
    element.setAttribute(name, value);
  }

  _restoreDesktop() {
    this._mode = null;
    this._indicatorObserver?.disconnect();
    this._mediaObserver?.disconnect();
    this._closeStage?.();
    this._closeStage = null;
    this._selectList = null;
    this._badgeObserver?.disconnect();
    this._dmAvatarObserver?.disconnect();
    this._inboxObserver?.disconnect();
    this._voiceFaces?.disconnect();
    this._voiceCreateObserver?.disconnect();
    this._memberObserver?.disconnect();
    this._drawerObserver?.disconnect();
    for (const face of document.querySelectorAll('[data-habitat-dm-avatar]')) face.remove();
    this._historyObserver?.disconnect();
    this._nameObserver?.disconnect();
    document.getElementById('channel-header-name')?.removeAttribute('data-habitat-voice-title');
    this._voiceObserver?.disconnect();
    this._voiceObserver = null;
    this._cardObserver?.disconnect();
    this._signalSync?.(false);
    this._signalSync = null;
    document.getElementById('profile-popup')?.querySelector('[data-habitat-voice-tools]')?.remove();
    document.documentElement.removeAttribute('data-habitat-in-voice');
    document.documentElement.removeAttribute('data-habitat-layout');
    document.documentElement.removeAttribute('data-habitat-layout-desktop');
    for (const [target, type, listener, options] of this._applied) {
      target.removeEventListener(type, listener, options);
    }
    this._applied = [];
    for (let index = this._inlineRestores.length - 1; index >= 0; index--) {
      const [element, property, value, priority] = this._inlineRestores[index];
      if (value) element.style.setProperty(property, value, priority);
      else element.style.removeProperty(property);
    }
    this._inlineRestores = [];
    for (let index = this._attrRestores.length - 1; index >= 0; index--) {
      const [element, name, value] = this._attrRestores[index];
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
    this._attrRestores = [];
    for (let index = this._placements.length - 1; index >= 0; index--) {
      const [element, parent, next] = this._placements[index];
      if (parent) parent.insertBefore(element, next?.parentNode === parent ? next : null);
    }
    this._placements = [];
    for (const element of this._built) element.remove();
    this._built = [];
    if (this._voiceDirectory) {
      this._voiceDirectory = null;
      window.app?._renderChannels?.();
    }
    for (const labelled of document.querySelectorAll('[data-habitat-label]')) {
      labelled.removeAttribute('data-habitat-label');
    }
    this._menu = null;
    this._menuButton = null;
    this._dialog = null;
    this._addButton = null;
    HavenApi.Layout?.release('HabitatLayout');
    this._blocked = Boolean(
      this._engaged && HavenApi.Layout?.owner && HavenApi.Layout.owner !== 'HabitatLayout'
    );
  }
}

HabitatLayout.TEXT = Object.freeze({
  en: Object.freeze({
    menu: 'Server menu', add: 'Add a channel', close: 'Close', supporters: 'Supporters',
    speaking: 'Speaking', voiceRooms: 'Voice channels', emptyVoice: 'No voice channels yet.', addVoice: 'Create a voice channel',
    callView: 'Call view', find: 'Find a conversation', channels: 'Channels', messages: 'Messages',
    tools: 'Channel actions', noDM: 'No conversations yet. Open a member’s profile to send a message.',
    channelStart: 'This is the beginning of this channel.', dmStart: 'This is the beginning of your conversation.',
    volume: 'User volume', mute: 'Mute', unmute: 'Unmute', connection: 'Connection details',
    good: 'Connection is good', fair: 'Connection is unsteady', poor: 'Connection is poor',
    people: 'Connected to', alone: 'No one else here yet', serverPing: 'Server ping', voicePing: 'Voice delay',
    loss: 'Packet loss', jitter: 'Jitter', route: 'Route', server: 'Server',
    direct: 'Direct', relay: 'Relay (TURN)', mixed: 'Direct and relay',
    sideBySide: 'Show every shared screen together',
    upload: 'Upload', download: 'Download', video: 'Picture you send',
    limitBandwidth: 'held back by the connection', limitCpu: 'held back by this computer',
    sfu: 'Through the server (voice relay)'
  }),
  tr: Object.freeze({
    menu: 'Sunucu menüsü', add: 'Kanal ekle', close: 'Kapat', supporters: 'Destekçiler',
    speaking: 'Konuşuyor', voiceRooms: 'Sesli odalar', emptyVoice: 'Henüz sesli oda yok.', addVoice: 'Sesli oda oluştur',
    callView: 'Arama görünümü', find: 'Sohbet bul', channels: 'Kanallar', messages: 'Mesajlar',
    tools: 'Kanal işlemleri', noDM: 'Henüz sohbet yok. Mesaj göndermek için bir üyenin profilini aç.',
    channelStart: 'Bu kanalın başlangıcındasın.', dmStart: 'Bu sohbetin başlangıcındasın.',
    volume: 'Ses düzeyi', mute: 'Sustur', unmute: 'Sesini aç', connection: 'Bağlantı ayrıntıları',
    good: 'Bağlantı iyi', fair: 'Bağlantı dalgalı', poor: 'Bağlantı zayıf',
    people: 'Bağlı kişiler', alone: 'Henüz başka kimse yok', serverPing: 'Sunucu gecikmesi', voicePing: 'Ses gecikmesi',
    loss: 'Paket kaybı', jitter: 'Seğirme', route: 'Yol', server: 'Sunucu',
    direct: 'Doğrudan', relay: 'Aktarıcı (TURN)', mixed: 'Doğrudan ve aktarıcı',
    sideBySide: 'Paylaşılan ekranları birlikte göster',
    upload: 'Yükleme', download: 'İndirme', video: 'Gönderdiğin görüntü',
    limitBandwidth: 'bağlantı sınırlıyor', limitCpu: 'bilgisayar sınırlıyor',
    sfu: 'Sunucu üzerinden (ses aktarıcısı)'
  })
});

// Cosmetic rules sit in :where() so any theme can restyle them; rules the
// layout needs in order to work at all keep their weight.
HabitatLayout.CSS = `
html[data-habitat-layout] [data-habitat-icon] {
  width: 1.25rem;
  height: 1.25rem;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ── Motion ──
   Opacity and the translate and scale properties only. Haven's reduce-motion
   switch takes these to zero along with everything else. */
@keyframes habitat-layout-fade {
  from { opacity: 0; }
}
@keyframes habitat-layout-drop {
  from { opacity: 0; translate: 0 -0.25rem; }
}
@keyframes habitat-layout-pop {
  from { opacity: 0; translate: 0 0.5rem; scale: 0.98; }
}
html[data-habitat-layout] [data-habitat-menu]:not([hidden]) {
  animation: habitat-layout-drop 0.14s ease-out;
}
html[data-habitat-layout] [data-habitat-menu-button] > [data-habitat-icon] {
  transition: rotate 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
}
html[data-habitat-layout] [data-habitat-menu-button][aria-expanded="true"] > [data-habitat-icon] {
  rotate: 180deg;
}
html[data-habitat-layout] :where([data-habitat-menu] button, [data-habitat-tools] > button,
  [data-habitat-menu-button], [data-habitat-add-button], [data-habitat-dialog-close]) {
  transition: background-color 0.12s ease, color 0.12s ease;
}
html[data-habitat-layout] :is([data-habitat-menu-button], [data-habitat-add-button],
  [data-habitat-dialog-close], [data-habitat-tools] > button):active {
  scale: 0.94;
}
[data-habitat-dialog]:not([hidden]) {
  animation: habitat-layout-fade 0.16s ease-out;
}
[data-habitat-dialog]:not([hidden]) > [data-habitat-dialog-panel] {
  animation: habitat-layout-pop 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* ── Server rail ── */
html[data-habitat-layout-desktop="1"] :where([data-haven-region="server-rail"]) {
  width: 4.5rem;
  min-width: 4.5rem;
  padding: 0.75rem 0;
  gap: 0.5rem;
}
html[data-habitat-layout-desktop="1"] :where([data-haven-region="server-rail"] .server-icon) {
  width: 3rem;
  height: 3rem;
}

/* ── Server name header and its menu ── */
html[data-habitat-layout] [data-habitat-header] {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  box-sizing: border-box;
  height: 3.25rem;
  min-height: 3.25rem;
  padding: 0 0.5rem 0 1rem;
  border-bottom: 1px solid var(--border);
  overflow: visible;
}
html[data-habitat-layout] [data-habitat-header] > :where(.brand) {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}
html[data-habitat-layout] :where([data-habitat-header] .brand-text) {
  font-family: var(--font-heading);
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-transform: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
html[data-habitat-layout] :where([data-habitat-menu-button]),
html[data-habitat-layout] :where([data-habitat-add-button]),
html[data-habitat-layout] :where([data-habitat-dialog-close]) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
html[data-habitat-layout] :where([data-habitat-menu-button], [data-habitat-add-button], [data-habitat-dialog-close]):hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
html[data-habitat-layout] :where([data-habitat-add-button]) {
  width: 1.5rem;
  height: 1.5rem;
}
html[data-habitat-layout] :where([data-habitat-add-button]) [data-habitat-icon] {
  width: 1rem;
  height: 1rem;
}
/* On a phone Haven's own close button sits in the header's top right corner. */
@media (max-width: 768px) {
  html[data-habitat-layout] [data-habitat-menu-button] {
    margin-right: 2.75rem;
  }
}
html[data-habitat-layout] [data-habitat-menu] {
  position: absolute;
  z-index: 60;
  top: calc(100% + 0.25rem);
  left: 0.5rem;
  right: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.375rem;
  border: 1px solid var(--border-light);
  border-radius: 0.625rem;
  background: var(--bg-card);
  box-shadow: 0 0.75rem 2rem rgba(0, 0, 0, 0.45);
}
html[data-habitat-layout] [data-habitat-menu][hidden] {
  display: none;
}
html[data-habitat-layout] [data-habitat-menu] [data-haven-region="sidebar-actions"] {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0;
  border: 0;
  background: transparent;
}
html[data-habitat-layout] [data-habitat-menu] [data-haven-region="sidebar-actions"] > span {
  display: none;
}
html[data-habitat-layout] [data-habitat-menu] button {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.625rem;
  width: 100%;
  height: 2.25rem;
  min-height: 2.25rem;
  margin: 0;
  padding: 0 0.625rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font: 500 0.875rem var(--font-main);
  text-align: left;
  cursor: pointer;
}
html[data-habitat-layout] [data-habitat-menu] button::after {
  content: attr(data-habitat-label);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
html[data-habitat-layout] [data-habitat-menu] .status-bar-toggle-tab {
  position: static; opacity: 1;
}
html[data-habitat-layout]:not([data-hide-statusbar]) [data-habitat-menu] .status-bar-toggle-tab { display: none; }
html[data-habitat-layout] [data-habitat-menu] button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
html[data-habitat-layout] [data-habitat-menu] #logout-btn {
  color: var(--danger);
}

/* ── Channel list ── */
html[data-habitat-layout] :where([data-haven-region="sidebar-content"] .sidebar-section) {
  border-bottom: 0;
}
html[data-habitat-layout] :where([data-haven-region="channels"], [data-haven-region="direct-messages"]) {
  padding-inline: 0.5rem;
}
html[data-habitat-layout] :where([data-haven-region="channels"], [data-haven-region="direct-messages"]) > :where(h5) {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 1.75rem;
  padding-inline: 0.25rem;
}
html[data-habitat-layout] :where([data-haven-region="channels"] .channel-item, [data-haven-region="direct-messages"] .channel-item) {
  min-height: 2.125rem;
  height: auto;
  margin: 0.0625rem 0;
  padding: 0.25rem 0.5rem;
  font-size: 0.9375rem;
}

/* ── Bottom-left account bar ── */
html[data-habitat-layout] [data-haven-region="sidebar-footer"] {
  display: flex;
  flex-direction: column;
}
html[data-habitat-layout] [data-haven-region="sidebar-footer"] > [data-haven-region="account"] {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  box-sizing: border-box;
  min-height: 3.5rem;
  margin: 0;
  padding: 0.5rem;
  border-radius: 0;
}
/* The bar's 0.25rem gap is sized for its row of small buttons. A profile
   border is drawn up to a quarter larger than the avatar it frames, so with
   one on, that gap was used up and the picture touched the name. */
html[data-habitat-layout] [data-haven-region="sidebar-footer"] > [data-haven-region="account"] > #user-bar-avatar {
  margin-inline-end: 0.5rem;
}
html[data-habitat-layout] [data-habitat-tools] {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  margin-left: auto;
}
html[data-habitat-layout] [data-habitat-tools] > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  min-width: 2rem;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 1rem;
  cursor: pointer;
}
html[data-habitat-layout] [data-habitat-tools] > button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
html[data-habitat-layout] [data-habitat-tools] > button > span:not(.haven-glyph) {
  display: none;
}
html[data-habitat-layout] [data-habitat-emptied] {
  display: none;
}

/* ── In a call ── */
/* Haven hides these two with an inline style unless a member opted in to
   sidebar voice controls, so this one rule has to outrank an inline style. */
html[data-habitat-layout][data-habitat-in-voice] [data-habitat-tools] > :is(#voice-mute-btn, #voice-deafen-btn) {
  display: inline-flex !important;
}
html[data-habitat-layout] [data-habitat-tools] > button.muted {
  position: relative;
  background: transparent;
  color: var(--danger);
}
/* On a desktop the same two buttons in the members panel header would now be a
   second copy. On a phone they stay: that drawer is where the call controls are. */
html[data-habitat-layout-desktop="1"][data-habitat-in-voice] [data-haven-region="voice-roster"] .voice-header-actions {
  display: none;
}
html[data-habitat-layout-desktop="1"] :where([data-haven-region="sidebar-footer"] > [data-haven-region="voice-controls"]) {
  justify-content: flex-start;
  padding: 0.375rem 0.5rem;
  border-top: 1px solid var(--border);
  overflow-x: auto;
}
html[data-habitat-layout-desktop="1"] :where([data-haven-region="sidebar-footer"] > [data-haven-region="voice-settings"]) {
  max-height: 45vh;
  overflow-y: auto;
}

/* ── Add a channel dialog ── */
/* Above Haven's phone drawers: the navigation drawer the + button lives in is
   a fixed overlay at 100000, and the dialog has to open over it. */
[data-habitat-dialog] {
  position: fixed;
  inset: 0;
  z-index: 100020;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.6);
}
[data-habitat-dialog][hidden] {
  display: none;
}
[data-habitat-dialog-panel] {
  box-sizing: border-box;
  width: min(30rem, 100%);
  max-height: calc(100vh - 4rem);
  overflow-y: auto;
  padding: 1.25rem 1.5rem 1.5rem;
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, 0.55);
}
[data-habitat-dialog-panel]:focus {
  outline: none;
}
[data-habitat-dialog-top] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
[data-habitat-dialog-top] > h2 {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 1.375rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
[data-habitat-dialog-body] > :where([data-haven-region]) {
  padding: 0.75rem 0;
  border: 0;
}
[data-habitat-dialog-body] > :where([data-haven-region]) + :where([data-haven-region]) {
  border-top: 1px solid var(--border);
}
[data-habitat-roster-home]:empty, [data-habitat-call-view][hidden] { display: none; }
[data-habitat-call-view] {
  display: grid; place-items: center; width: 2.25rem; height: 2.25rem; flex: none;
  border: 0; border-radius: var(--radius-sm); color: var(--text-secondary); background: transparent; cursor: pointer;
}
[data-habitat-call-view][aria-pressed="true"] { background: var(--bg-active); color: var(--accent); }
[data-habitat-roster-home]:not(:empty) { position: relative; min-height: 2.5rem; }
[data-habitat-roster-home]:not(:empty) #mobile-right-close { margin-inline-start: auto; }
[data-habitat-call-stage] {
  --hb-stage-gap: .5rem; --hb-stage-pad: .75rem; --hb-stage-top: var(--hb-stage-pad);
  position: relative; flex: none; height: clamp(11rem, 42dvh, 30rem); min-height: 0; overflow: hidden;
  display: grid; gap: var(--hb-stage-gap); place-content: center;
  grid-template-columns: repeat(var(--hb-stage-cols, 2), calc((var(--hb-tile-w, 16rem) - var(--hb-stage-gap)) / 2));
  grid-auto-rows: var(--hb-tile-h, 9rem);
  padding: var(--hb-stage-top) var(--hb-stage-pad) var(--hb-stage-pad);
  background: var(--bg-tertiary); border-bottom: 1px solid var(--border);
}
/* A phone shows its own mute and deafen buttons in the roster header; they
   get a row of their own so they never sit on someone's picture. */
html:not([data-habitat-layout-desktop="1"]) [data-habitat-call-stage]:has(.voice-header-actions > :not([style*="none"])) { --hb-stage-top: 2.75rem; }
[data-habitat-call-stage][data-habitat-focus] { height: clamp(14rem, 60dvh, 44rem); align-content: end; }
[data-habitat-call-bar] {
  flex: none; justify-content: center; gap: .5rem; overflow-x: auto;
  padding: .5rem .75rem calc(.5rem + env(safe-area-inset-bottom, 0px));
  border: 0; border-top: 1px solid var(--border); border-radius: 0; box-shadow: none; background: var(--bg-tertiary);
}
[data-habitat-call-stage] :is(.panel, #voice-users, #webcam-grid, #screen-share-grid) { display: contents; }
[data-habitat-call-stage] > :is([data-habitat-stage], #webcam-container, #screen-share-container) { display: contents !important; }
[data-habitat-call-stage] :is(.webcam-popped-out, .stream-popped-out) { height: auto !important; }
[data-habitat-call-stage] :is(.webcam-header, .screen-share-header, .panel-title, .webcam-tile .stream-minimize-btn) { display: none; }
[data-habitat-call-stage] .voice-panel-header { position: absolute; inset: .375rem var(--hb-stage-pad) auto auto; z-index: 3; margin: 0; padding: 0; }
[data-habitat-call-stage] #voice-users > :not(.voice-user-item) { grid-column: 1 / -1; margin: 0; text-align: center; }
[data-habitat-call-stage] :is(.voice-user-item, .webcam-tile, .screen-share-tile) {
  position: relative; box-sizing: border-box; width: auto; height: auto; min-width: 0; min-height: 0; margin: 0;
  overflow: hidden; border-radius: .75rem; cursor: pointer;
}
[data-habitat-call-stage] :is(.webcam-tile, .screen-share-tile) { max-width: none !important; background: #0b0c0f; box-shadow: none; }
[data-habitat-call-stage] :is(.webcam-tile, .screen-share-tile) > video {
  width: 100%; height: 100%; max-height: none !important; object-fit: cover;
}
[data-habitat-call-stage] .screen-share-tile > video { object-fit: contain; }
[data-habitat-call-stage] [data-habitat-focused] { position: absolute; z-index: 1; }
[data-habitat-stage-spread] {
  position: absolute; inset: calc(var(--hb-stage-top) + .5rem) auto auto 50%; z-index: 3; translate: -50%;
  display: grid; place-items: center; width: 2.25rem; height: 2.25rem; padding: 0;
  border: 0; border-radius: .5rem; color: #fff; background: rgba(8, 9, 12, .68); cursor: pointer;
}
[data-habitat-stage-spread][hidden] { display: none; }
[data-habitat-stage-spread][aria-pressed="true"] { color: var(--accent-text); background: var(--accent); }
[data-habitat-call-stage] .voice-user-item {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .375rem;
  padding: .75rem; background: var(--bg-active);
}
[data-habitat-call-stage] .voice-user-item.talking { outline: 2px solid var(--success); outline-offset: -2px; }
[data-habitat-call-stage] .voice-status-icons { margin: 0; }
[data-habitat-call-stage] .voice-user-item .user-dot { position: absolute; inset: .625rem auto auto .625rem; }
/* On camera the person's row becomes a see-through layer over their picture:
   the name, mute state and menu stay the real ones, the picture stays clickable. */
[data-habitat-call-stage] .voice-user-item[data-habitat-on-camera] {
  z-index: 2; flex-direction: row; align-items: flex-end; justify-content: flex-start;
  padding: .5rem; background: transparent; pointer-events: none;
}
[data-habitat-call-stage] [data-habitat-on-camera] > * { pointer-events: auto; }
[data-habitat-call-stage][data-habitat-dense] :is(.voice-user-item, .webcam-tile, .screen-share-tile):not([data-habitat-focused])
  :is(.user-item-name, .webcam-tile-label, .screen-share-tile-label, .voice-user-menu-btn, .voice-stream-badge.watching) { display: none; }
[data-habitat-call-stage][data-habitat-dense] .voice-user-item:not([data-habitat-focused]) { padding: .25rem; }
[data-habitat-call-stage] [data-habitat-on-camera] :is([data-habitat-call-avatar], .user-dot, .voice-stream-badge.webcam),
[data-habitat-call-stage] .webcam-tile[data-habitat-paired] > .webcam-tile-label { display: none; }
[data-habitat-connection] {
  position: fixed; z-index: 100010; box-sizing: border-box; padding: .75rem .875rem;
  border: 1px solid var(--border-light); border-radius: .75rem;
  color: var(--text-primary); background: var(--bg-card); box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, .5); font-size: .8125rem;
}
[data-habitat-connection][hidden] { display: none; }
[data-habitat-connection] > strong { display: flex; align-items: center; gap: .5rem; margin-bottom: .5rem; font-size: .875rem; }
[data-habitat-connection] > strong::before { content: ''; width: .5rem; height: .5rem; flex: none; border-radius: 50%; background: var(--success); }
[data-habitat-connection="fair"] > strong::before { background: var(--warning); }
[data-habitat-connection="poor"] > strong::before { background: var(--danger); }
[data-habitat-connection] dl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .25rem .75rem; margin: 0; }
[data-habitat-connection] dt { color: var(--text-secondary); }
[data-habitat-connection] dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; text-align: end; }
html[data-habitat-layout] .voice-bar-status[role="button"] { cursor: pointer; }
html[data-habitat-layout] #channel-list .channel-voice-user { cursor: pointer; }
[data-habitat-voice-tools] {
  display: grid; gap: .5rem; margin-block: .75rem; padding-block: .75rem; border-block: 1px solid var(--border);
}
[data-habitat-voice-tools] label {
  display: grid; grid-template-columns: auto minmax(0, 1fr) 3rem; align-items: center; gap: .625rem;
  color: var(--text-secondary); font-size: .8125rem;
}
[data-habitat-voice-tools] input { width: 100%; min-width: 0; margin: 0; accent-color: var(--accent); }
[data-habitat-voice-tools] output { color: var(--text-primary); font-variant-numeric: tabular-nums; text-align: end; }
[data-habitat-voice-tools] button {
  min-height: 2.25rem; border: 1px solid var(--border-light); border-radius: var(--radius-sm);
  color: var(--text-primary); background: var(--bg-input); font: inherit; font-weight: 600; cursor: pointer;
}
[data-habitat-voice-tools] button[aria-pressed="true"] { border-color: transparent; color: var(--danger-text); background: var(--danger); }
[data-habitat-call-avatar] {
  display: grid; place-items: center; width: 3rem; height: 3rem; border-radius: 50%;
  position: relative; color: var(--accent-text); background: var(--accent); font: 700 1.25rem/1 var(--font-main);
}
[data-habitat-rooms]:not(:empty) + [data-habitat-no-rooms],
[data-habitat-rooms][hidden] + [data-habitat-no-rooms],
[data-habitat-speaking] { display: none; }
.channel-voice-user.talking [data-habitat-speaking] {
  display: inline; position: absolute; width: .0625rem; height: .0625rem; overflow: hidden; clip-path: inset(50%);
}
[data-habitat-call-avatar] > [data-habitat-call-photo] { width: 100%; height: 100%; border-radius: inherit; object-fit: cover; }
[data-habitat-call-stage] .user-item-name { flex: none; max-width: 100%; font-weight: 650; }
body.is-guest [data-habitat-inbox], body.is-guest [data-habitat-lists] [aria-controls="dm-pane"] { display: none; }
[data-habitat-inbox] { margin-block-end: .375rem; }
[data-habitat-inbox][aria-pressed="true"] {
  background: var(--accent); color: var(--accent-text); border-radius: 1rem;
}
[data-habitat-nav] {
  display: grid;
  gap: .625rem;
  padding: .75rem;
  flex: none;
}
[data-habitat-nav] button, [data-habitat-channel-tools] summary {
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}
[data-habitat-jump] {
  display: flex;
  align-items: center;
  gap: .625rem;
  width: 100%;
  min-height: 2.25rem;
  padding: .375rem .625rem;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: var(--bg-tertiary);
  text-align: start;
}
[data-habitat-inbox-page] {
  box-sizing: border-box; width: min(36rem, 94vw); max-height: 86dvh;
  margin: auto; padding: 1.5rem; border: .0625rem solid var(--border-light);
  border-radius: 1rem; background: var(--bg-secondary); color: var(--text-primary);
}
[data-habitat-inbox-page][open] { display: flex; flex-direction: column; gap: 1rem; }
[data-habitat-inbox-page]::backdrop { background: color-mix(in srgb, var(--bg-tertiary) 80%, transparent); }
[data-habitat-inbox-page] header { display: flex; align-items: center; justify-content: space-between; }
[data-habitat-inbox-page] h2 { margin: 0; font: 750 1.65rem/1.2 var(--font-heading); }
[data-habitat-inbox-page] header button, [data-habitat-room-members] {
  display: inline-flex; align-items: center; justify-content: center; gap: .375rem;
  border: 0; padding: .375rem; border-radius: .5rem; color: var(--text-secondary); background: var(--bg-hover);
}
[data-habitat-inbox-page] input {
  width: 100%; min-height: 2.5rem; border: .0625rem solid var(--border-light);
  border-radius: .5rem; background: var(--bg-input); color: var(--text-primary); padding-inline: .75rem; font: inherit;
}
[data-habitat-conversations] { overflow-y: auto; min-height: 0; }
[data-habitat-conversations] button {
  display: flex; align-items: center; gap: .75rem; width: 100%; min-height: 3rem;
  padding: .5rem; border: 0; border-radius: .5rem; background: transparent; color: var(--text-primary); font: 600 1rem var(--font-main); text-align: start;
}
[data-habitat-conversations] button:hover, [data-habitat-conversations] button:focus-visible { background: var(--bg-active); }
[data-habitat-conversations] button > span:nth-child(2) { min-width: 0; overflow-wrap: anywhere; }
[data-habitat-conversations] .channel-badge { margin-inline-start: auto; }
[data-habitat-room-members] { flex: none; font: 650 .875rem/1 var(--font-main); cursor: pointer; }
[data-habitat-room-members][hidden] { display: none; }
/* Haven forces its mobile button visible even when the roster already has a trigger. */
[data-habitat-room-members]:not([hidden]) + #mobile-users-btn { display: none !important; }
[data-habitat-stack] { display: inline-flex; padding-inline-start: .25rem; }
[data-habitat-stack] [data-habitat-face] { width: 1.5rem; height: 1.5rem; margin-inline-start: -.25rem; box-shadow: 0 0 0 .125rem var(--bg-hover); }
@media (max-width: 480px) {
  [data-habitat-stack] [data-habitat-face]:not(:first-child) { display: none; }
  [data-habitat-inbox-page] { width: 100%; height: 100dvh; max-width: 100%; max-height: 100dvh; border-radius: 0; padding: 1rem; }
}
[data-habitat-lists] { display: flex; gap: .25rem; }
[data-habitat-face] {
  position: relative; display: inline-grid; place-items: center; flex: none;
  width: 1.875rem; height: 1.875rem; overflow: hidden; border-radius: 50%;
  background: color-mix(in srgb, var(--habitat-avatar-color) 45%, var(--bg-tertiary));
  color: var(--text-primary); font: 700 .9375rem/1 var(--font-main);
}
[data-habitat-face] img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.dm-item > [data-habitat-dm-avatar] + .channel-hash { display: none; }
[data-habitat-lists] button {
  flex: 1; min-width: 0; min-height: 2.125rem;
  padding: .25rem; border: 0; border-radius: var(--radius-sm);
  background: transparent; font-size: .875rem; font-weight: 600;
}
[data-habitat-lists] button[aria-pressed="true"], [data-habitat-lists] button:hover {
  background: var(--bg-active); color: var(--text-primary);
}
[data-habitat-count]:not(:empty) {
  margin-inline-start: .25rem; border-radius: 1rem;
  padding: .0625rem .3125rem; background: var(--danger); color: var(--danger-text);
}
#sidebar-split[data-habitat-list="channels"] > [data-haven-region="direct-messages"],
#sidebar-split[data-habitat-list="messages"] > [data-haven-region="channels"],
[data-habitat-list] > .sidebar-split-handle,
[data-habitat-dm-empty] { display: none; }
[data-habitat-list="messages"]:has(> #dm-pane[style*="display: none"]) > [data-habitat-dm-empty] {
  display: block; margin: .5rem 1rem; color: var(--text-secondary); line-height: 1.5;
}
[data-habitat-channel-tools] { position: relative; flex: none; }
[data-habitat-channel-tools] summary {
  display: grid; place-items: center; list-style: none; width: 2rem; height: 2rem;
  border-radius: var(--radius-sm);
}
[data-habitat-channel-tools] summary::-webkit-details-marker { display: none; }
[data-habitat-channel-tools][open] summary, [data-habitat-channel-tools] summary:hover {
  color: var(--text-primary); background: var(--bg-active);
}
[data-habitat-channel-menu] {
  position: absolute; z-index: 60; inset-block-start: calc(100% + .375rem); inset-inline-end: 0;
  display: grid; min-width: min(14rem, 82vw); padding: .375rem;
  background: var(--bg-card); border: 1px solid var(--border-light); border-radius: var(--radius);
  box-shadow: 0 .5rem 1.5rem #0005;
}
[data-habitat-channel-menu] > button.icon-btn {
  justify-content: start; align-items: center; gap: .625rem; padding: .5rem .625rem;
  width: 100%; height: auto; min-height: 2.25rem; opacity: 1; text-align: start;
}
[data-habitat-channel-menu] > button::after { content: attr(aria-label); font: 500 .875rem/1.25 var(--font-main); }
[data-habitat-channel-menu] .channel-code-tag:not(:empty) { margin: .25rem .5rem; width: fit-content; }
[data-habitat-channel-menu] .channel-code-tag:empty, html[data-habitat-layout] .header-actions-divider { display: none; }
html[data-habitat-layout] .channel-header:has(details[open]) { z-index: 65; overflow: visible; }
[data-habitat-intro] { display: none; }
[data-haven-region="message-list"]:not(:has(> :not(#msg-more-btn))) + [data-habitat-intro] {
  display: block; flex: none; padding: 1rem 1.5rem; color: var(--text-primary);
}
[data-habitat-intro] > span {
  display: grid; place-items: center; width: 3.25rem; height: 3.25rem;
  background: var(--bg-active); border-radius: 50%; font: 600 1.875rem/1 var(--font-main);
}
[data-habitat-intro] h2 { margin: .75rem 0 .25rem; overflow-wrap: anywhere; font: 750 1.625rem/1.15 var(--font-heading); }
[data-habitat-intro] p { margin: 0; color: var(--text-secondary); }
@media (min-width: 901px) {
  html[data-habitat-layout-desktop]:has(#voice-join-btn[style*="inline-flex"]) #voice-join-mobile { display: none; }
  html[data-habitat-layout-desktop]:has(#voice-join-btn[style*="inline-flex"]) #right-sidebar-voice:has(#voice-users > .muted-text:only-child) { display: none; }
}
/* A voice room has nothing to search, and on a phone its name needs the
   room, so the search button is only brought back for text channels. */
@media (max-width: 768px) {
  html[data-habitat-layout] #header-actions-box[style*="display: flex"] { display: flex !important; padding: 0; gap: 0; }
  html[data-habitat-layout]:not(:has(#channel-header-name[data-habitat-voice-title])) #header-actions-box #search-toggle-btn,
  html[data-habitat-layout] [data-habitat-channel-menu] #pinned-toggle-btn,
  html[data-habitat-layout] [data-habitat-channel-menu] #copy-code-btn[style*="inline-flex"] { display: inline-flex !important; }
  [data-habitat-channel-tools] summary, html[data-habitat-layout] #search-toggle-btn {
    width: 2.5rem; min-height: 2.5rem; justify-content: center; align-items: center;
  }
  [data-habitat-channel-menu] { max-height: 65dvh; overflow: auto; }
}
`;

if (typeof module !== 'undefined') module.exports = HabitatLayout;
if (typeof _win !== 'undefined') _win.HabitatLayout = HabitatLayout;
