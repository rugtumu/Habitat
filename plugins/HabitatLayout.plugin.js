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
// the same elements in the server, account and rail menus.
//
// It has two shapes. 'desktop' (901px and wider) is the whole arrangement.
// In compact the Members panel is a drawer. Navigation and the server rail
// stay on screen on tablets. At phone width navigation becomes a drawer too.
function plainEscape(event) {
  return event.key === 'Escape' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}

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
      this._buildMenu(header, actions);
      this._buildAccountMenu(account);
      this._buildRailMenu(mode);
      this._dockAccount(account, footer, mode === 'desktop');
      this._buildAddPanel(channels);
      this._buildNavigation(mode);
      this._buildVoiceRooms();
      this._buildChannelTools();
      this._buildMemberPreview();
      this._buildConversationIntro();
      if (mode === 'compact') this._watchToastClearance();
      this._buildCallStage(mode);
      this._buildVoicePeople();
      this._buildConnectionInfo();
      this._watchVoice();
      this._setAttr(header, 'data-habitat-header', '');
      this._mode = mode;
      document.documentElement.setAttribute('data-habitat-layout', mode);
      if (mode === 'desktop') document.documentElement.setAttribute('data-habitat-layout-desktop', '1');
      document.documentElement.removeAttribute('data-habitat-boot');
    } catch (error) {
      this._restoreDesktop();
      throw error;
    }
  }

  _watchToastClearance() {
    const toast = document.getElementById('toast-container');
    if (!toast || typeof ResizeObserver !== 'function') return;
    const composer = this._region('composer');
    const controls = this._region('voice-controls');
    const workspace = this._region('workspace');
    if (!workspace) return;
    const property = '--hb-toast-clearance';
    this._inlineRestores.push([toast, property, toast.style.getPropertyValue(property), toast.style.getPropertyPriority(property)]);
    const sync = () => {
      const input = composer?.getBoundingClientRect();
      const bar = controls?.hasAttribute('data-habitat-call-bar') && controls.getBoundingClientRect();
      // The workspace ends above the status bar and shrinks with the PWA keyboard.
      const edge = input?.height ? input.top : workspace.getBoundingClientRect().bottom;
      const clearance = window.innerHeight - edge + (bar?.height || 0);
      toast.style.setProperty(property, Math.max(0, clearance) + 'px');
    };
    this._toastSize = new ResizeObserver(sync);
    for (const box of [workspace, composer, controls]) {
      if (box) this._toastSize.observe(box, { box: 'border-box' });
    }
    this._syncToastClearance = sync;
    this._on(window, 'resize', sync);
  }

  // Switch the list without switching conversations or marking anything read.
  _buildNavigation(mode) {
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
    const rail = this._region('server-rail');
    const home = document.getElementById('home-server');
    const label = dms.querySelector('.section-label-text')?.textContent || this._text('messages');
    const inbox = this._make('button', {
      type: 'button', class: 'server-icon', 'data-habitat-inbox': '', 'aria-controls': dms.id,
      'aria-label': label, title: label
    });
    inbox.appendChild(this._icon('M4 4h16v12H9l-5 4zM8 8h8M8 12h5'));
    // Haven hides the vertical rail when the phone drawer opens.
    if (mode === 'desktop' && rail && home?.parentNode === rail) rail.insertBefore(inbox, home);
    else nav.insertBefore(inbox, jump);
    const select = name => {
      this._list = document.body.classList.contains('is-guest') ? 'channels' : name;
      inbox.setAttribute('aria-pressed', String(this._list === 'messages'));
      split.setAttribute('data-habitat-list', this._list);
    };
    this._on(inbox, 'click', () => select(this._list === 'messages' ? 'channels' : 'messages'));
    if (home) {
      this._on(home, 'click', () => select('channels'));
      this._setAttr(home, 'role', 'button');
      this._setAttr(home, 'tabindex', '0');
      this._on(home, 'keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          home.click();
        }
      });
    }
    this._selectList = select;
    const badge = document.getElementById('dm-unread-badge');
    if (badge) {
      const count = this._make('span', { 'data-habitat-count': '' }, inbox);
      const sync = () => {
        count.textContent = badge.style.display === 'none' ? '' : badge.textContent;
        inbox.setAttribute('aria-label', count.textContent ? label + ' · ' + count.textContent : label);
      };
      this._badgeObserver = new MutationObserver(sync);
      this._badgeObserver.observe(badge, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
      sync();
    }
    const empty = this._make('p', { 'data-habitat-dm-empty': '' });
    empty.textContent = this._text('noDM');
    split.appendChild(empty);
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
        const member = window.app._memberById?.(partner.id);
        const face = this._memberFace({ ...member, ...partner }, name);
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
      image.draggable = false;
      face.appendChild(image);
    }
    if (person.border?.startsWith('/uploads/')) {
      const frame = document.createElement('span');
      frame.className = 'pfp-border';
      frame.dataset.border = person.border;
      frame.dataset.bt = JSON.stringify(person.borderTransform || []);
      frame.dataset.animate = person.animateProfile === 'disabled' ? 'disabled' : 'trigger';
      face.appendChild(frame);
    }
    return face;
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

  _wireVoiceMoves(rooms) {
    let drag = null;
    let highlight = null;
    const mark = row => {
      if (row === highlight) return;
      highlight?.removeAttribute('data-habitat-drop');
      highlight = row;
      row?.setAttribute('data-habitat-drop', '');
    };
    const destination = event => {
      const row = event.target.closest('.channel-item[data-code]') ||
        event.target.closest('.channel-voice-users')?.previousElementSibling;
      return drag && row && row.dataset.code !== drag.from &&
        window.app.channels.some(ch => ch.code === row.dataset.code && ch.canMoveVoiceMembers) ? row : null;
    };
    this._on(rooms, 'dragstart', event => {
      const row = event.target.closest('.channel-voice-user[draggable="true"]');
      if (!row) return;
      event.stopPropagation();
      drag = { from: row.parentElement.previousElementSibling.dataset.code, userId: Number(row.dataset.userId) };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', row.dataset.username);
    });
    this._on(rooms, 'dragover', event => {
      if (!drag) return;
      event.stopPropagation();
      const target = destination(event);
      mark(target);
      if (target) event.preventDefault();
    });
    this._on(rooms, 'dragleave', event => { if (!rooms.contains(event.relatedTarget)) mark(null); });
    this._on(rooms, 'drop', event => {
      if (!drag) return;
      event.preventDefault();
      event.stopPropagation();
      const target = destination(event);
      if (target) window.app.socket.emit('voice-move-member', { ...drag, to: target.dataset.code });
      mark(null);
      drag = null;
    });
    this._on(document, 'dragend', () => { mark(null); drag = null; });
    this._on(document, 'dragstart', () => {
      mark(null);
      drag = null;
    }, true);
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
        this._toggleDialog(true, add, 'b:voice_room');
      });
    }
    // The renderer keeps the original room buttons, moderation actions and live user rows.
    list.appendChild(section);
    this._voiceDirectory = section;
    this._wireVoiceMoves(rooms);
    window.app._renderChannels();
    // Someone joining a room settles into the list, and someone leaving
    // lingers a moment as they fade. Haven redraws a room's whole list
    // whenever anyone in it changes state, so only a person who is new to
    // the room, or gone from it, counts.
    let known = null;  // room and person -> their row and its list, at the last painting
    const paint = () => {
      const now = new Map();
      for (const row of list.querySelectorAll('.channel-voice-user')) {
        if (row.hasAttribute('data-habitat-leave')) continue;
        const home = row.parentElement;
        const key = `${home.previousElementSibling?.getAttribute('data-code')}:${row.getAttribute('data-user-id')}`;
        if (known && !known.has(key) && !row.querySelector('[data-habitat-face]')) row.setAttribute('data-habitat-enter', '');
        now.set(key, { row, home });
      }
      for (const [key, was] of known || []) {
        // The old row is the one Haven just threw away; it goes back in for
        // as long as the fade takes. A room that emptied has no list left.
        if (now.has(key) || was.row.isConnected || !was.home.isConnected) continue;
        const ghost = was.row;
        ghost.removeAttribute('data-habitat-enter');
        ghost.setAttribute('data-habitat-leave', '');
        ghost.setAttribute('aria-hidden', 'true');
        was.home.appendChild(ghost);
        const gone = () => ghost.remove();
        ghost.addEventListener('animationend', gone, { once: true });
        setTimeout(gone, 400)?.unref?.();
      }
      known = now;
      for (const row of list.querySelectorAll('.channel-voice-user:not(:has([data-habitat-face]))')) {
        const id = row.dataset.userId;
        const code = row.parentElement.previousElementSibling?.dataset.code;
        const member = window.app._onlineByChannel?.get(code)?.find(user => String(user.id) === id)
          || window.app._memberById?.(id) || { id };
        const app = window.app;
        // Rows are only moved from the voice directory, where the drop targets are.
        if (Number(id) !== app.user?.id && row.dataset.isBot !== 'true' && row.closest('[data-habitat-rooms]') &&
            app.channels?.some(ch => ch.code === code && ch.canMoveVoiceMembers)) row.draggable = true;
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
    const move = (id, parent) => {
      const item = document.getElementById(id);
      if (item && box.contains(item)) this._move(item, parent);
    };
    for (const id of ['pinned-toggle-btn', 'gallery-toggle-btn', 'threads-toggle-btn']) move(id, panel);
    const join = document.getElementById('voice-join-mobile');
    if (join) this._move(join, panel);
    const channelSelected = () => {
      const channel = window.app?.channels?.find(ch => ch.code === window.app.currentChannel);
      return channel && !channel.is_dm;
    };
    const canEdit = () => channelSelected() && (window.app.user?.isAdmin || window.app._hasPerm?.('set_channel_topic'));
    const topic = this._menuAction(panel, 'topic', '✎', () => {
      if (canEdit()) window.app._editTopic();
    });
    const group = this._make('div', { 'data-habitat-channel-management': '' }, panel);
    move('channel-code-display', group);
    move('copy-code-btn', group);
    const canRotate = () => channelSelected() && window.app.user?.isAdmin;
    const rotate = this._menuAction(group, 'rotate', '↻', () => {
      if (canRotate()) document.getElementById('code-rotate-now-btn')?.click();
    });
    move('channel-code-settings-btn', group);
    move('move-select-btn', group);
    const sync = () => {
      topic.hidden = !canEdit();
      rotate.hidden = !canRotate();
    };
    this._on(details, 'toggle', sync);
    sync();
    this._on(document, 'pointerdown', event => {
      if (details.open && !details.contains(event.target)) details.open = false;
    }, true);
    this._on(document, 'keydown', event => {
      if (details.open && plainEscape(event)) {
        details.open = false;
        trigger.focus();
        event.stopImmediatePropagation();
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
    // Who is already in the room, so joining is not a step into the dark.
    const people = this._make('p', { 'data-habitat-room-people': '' }, intro);
    const join = this._make('button', { type: 'button', class: 'btn-sm btn-accent', 'data-habitat-join-room': '' }, intro);
    join.textContent = this._text('joinRoom');
    this._on(join, 'click', () => window.app?._joinVoice());
    // A generated heading scrolls with the first page without becoming a
    // message. Haven relies on its real first child to paginate and trim.
    const historyTitle = 'data-habitat-history-title';
    this._setAttr(messages, historyTitle, '');
    const syncHistory = () => {
      const history = messages.getAttribute('data-history');
      const atStart = (history === 'start' || history === 'empty') && window.app?._noMoreHistory;
      const name = atStart ? header.textContent.trim() : '';
      if (messages.getAttribute(historyTitle) !== name) messages.setAttribute(historyTitle, name);
    };
    const syncJoin = () => {
      const app = window.app;
      const channel = HavenApi.currentChannel;
      const connected = app?.voice?.inVoice && app.voice.currentChannel === channel;
      const voiceRoom = header.hasAttribute('data-habitat-voice-title');
      intro.hidden = voiceRoom && !!connected;
      join.hidden = !voiceRoom || !app?._canUseVoice?.() || intro.hidden;
      people.hidden = !voiceRoom || intro.hidden;
      if (people.hidden) return;
      // Haven lists a room's people in the row after it; count what it drew.
      const row = [...document.querySelectorAll('.channel-item')].find(item => item.dataset?.code === channel);
      const list = row?.nextElementSibling;
      const count = String(list?.className || '').includes('channel-voice-users')
        ? list.querySelectorAll('.channel-voice-user').length : 0;
      const text = count ? this._text(count === 1 ? 'roomOne' : 'roomMany').replace('{n}', count) : this._text('roomEmpty');
      if (people.textContent !== text) people.textContent = text;
    };
    this._syncJoin = syncJoin;
    const sync = () => {
      const name = header.textContent.trim();
      const dm = document.body.classList.contains('viewing-dm');
      const channel = HavenApi.currentChannel;
      if (channel !== this._lastConversation) {
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
      hint.hidden = voiceRoom;
      syncJoin();
      hint.textContent = this._text(dm ? 'dmStart' : 'channelStart');
      syncHistory();
    };
    this._historyObserver = new MutationObserver(syncHistory);
    this._historyObserver.observe(messages, { childList: true, attributes: true, attributeFilter: ['data-history'] });
    this._on(messages, 'scrollend', syncHistory);
    const indicator = document.getElementById('voice-active-indicator');
    if (indicator) {
      this._joinObserver = new MutationObserver(syncJoin);
      this._joinObserver.observe(indicator, { attributes: true, attributeFilter: ['style'] });
    }
    // Haven redraws the channel list when someone joins or leaves a room.
    const channels = document.getElementById('channel-list');
    if (channels) {
      this._peopleObserver = new MutationObserver(syncJoin);
      this._peopleObserver.observe(channels, { childList: true, subtree: true });
    }
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

  _placeCallPopup(panel, button) {
    const anchor = button.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const gap = rem / 2;
    const clamp = (value, max) => Math.max(gap, Math.min(value, max - gap));
    const above = anchor.top - box.height - gap;
    panel.style.left = clamp(anchor.right - box.width, window.innerWidth - box.width) / rem + 'rem';
    panel.style.top = clamp(above >= gap ? above : anchor.bottom + gap, window.innerHeight - box.height) / rem + 'rem';
  }

  _buildStageMenu(button, stage, spread, showGrid) {
    const menu = this._newMenu(document.body, 'call');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', this._text('callActions'));
    const actions = new WeakMap();
    this._on(menu, 'click', event => {
      const row = event.target.closest?.('button');
      if (row && !row.disabled && !menu.hidden) actions.get(row)?.();
    });
    const add = (name, icon, action, disabled = false) => {
      const row = this._make('button', {
        type: 'button', role: 'menuitem', tabindex: '-1', 'aria-label': name, 'data-habitat-label': name
      }, menu);
      row.textContent = icon;
      row.disabled = disabled;
      actions.set(row, action);
    };
    this._bindMenu(button, menu, () => {
      menu.replaceChildren();
      const forward = (id, key, icon, afterClick) => {
        const source = document.getElementById(id);
        if (source) add(this._text(key), icon, () => {
          source.click();
          afterClick?.();
        }, source.disabled || source.getAttribute('aria-disabled') === 'true');
      };
      forward('voice-settings-toggle', 'voiceSettings', '⚙', () => {
        const panel = this._region('voice-settings');
        if (panel && panel.style.display !== 'none') panel.querySelector('[data-habitat-close-settings]')?.focus();
      });
      if (this._openConnection) add(this._text('connection'), 'ⓘ', () => this._openConnection(button));
      forward('voice-soundboard-btn', 'soundboard', '♫');
      forward('voice-listen-together-btn', 'listenTogether', '♪');
      if (stage.hasAttribute('data-habitat-focus')) add(this._text('showGrid'), '⊞', showGrid);
      if (!spread.hidden && spread.getAttribute('aria-pressed') !== 'true') add(this._text('sideBySide'), '◫', () => spread.click());
      const cameras = stage.querySelectorAll('.webcam-tile');
      const shares = [...stage.querySelectorAll('.screen-share-tile')].filter(tile => tile.getAttribute('data-hidden') !== 'true');
      for (const tile of [...cameras, ...shares]) {
        const popped = tile.matches('.stream-popped-out, .webcam-popped-out');
        const camera = tile.matches('.webcam-tile');
        let popout = tile.querySelector('.stream-popout-btn');
        if (popped && document.pictureInPictureElement !== tile.querySelector('video')) {
          const overlay = tile.id.replace(camera ? 'webcam-tile-' : 'screen-tile-', camera ? 'webcam-pip-' : 'stream-pip-');
          popout = document.getElementById(overlay)?.querySelector('.stream-pip-popin');
        }
        const name = tile.querySelector('.webcam-tile-label, .screen-share-tile-label')?.textContent;
        const key = popped ? (camera ? 'returnCamera' : 'returnScreen') : (camera ? 'popCamera' : 'popScreen');
        if (popout) add(this._text(key).replace('{name}', () => name || this._text('participant')), '⧉', () => popout.click(), popout.disabled);
      }
      if (cameras.length) forward('webcam-close-btn', 'closeCameras', '×');
      if (shares.length) {
        const voice = window.app?.voice;
        // Only the mesh minimise handler hides the tiles themselves. On the relay it hides the dissolved panel.
        if (voice?.inVoice && !voice._relay && voice._callTransport !== 'relay') forward('screen-share-minimize', 'minimizeStreams', '−');
        forward('screen-share-close', 'closeStreams', '×');
      }
      this._placeCallPopup(menu, button);
    });
    return menu;
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
    // The members drawer on a phone is closed with a button that lives in the
    // voice roster's header. The roster itself is not shown in the drawer in
    // this layout (the people in a call are under the room and on the stage),
    // so the button moves to the placeholder for as long as the layout is on.
    const close = mode === 'compact' ? document.getElementById('mobile-right-close') : null;
    if (close) this._move(close, anchor, null);
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
    let cast = null;       // what was on the stage at the last arrangement: tile -> its row and where it sat
    let lastSize = '';     // the stage's own size then, to tell a regrouping from a window being resized
    const glides = new WeakMap();
    let keyboardRow = null;
    this._on(document, 'focusin', event => {
      keyboardRow = stage.contains(event.target) && event.target.matches('.voice-user-item[tabindex="0"]') ? event.target : null;
    });
    // Alone in a room, the stage says so and offers the way to bring people in.
    const alone = this._make('div', { 'data-habitat-alone': '', hidden: '' }, stage);
    this._make('strong', {}, alone).textContent = this._text('aloneTitle');
    this._make('span', {}, alone).textContent = this._text('aloneHint');
    const invite = this._make('button', { type: 'button' }, alone);
    invite.textContent = this._text('invite');
    this._on(invite, 'click', () => document.getElementById('right-btn-invite-popout')?.click());
    const spreadLabel = this._text('sideBySide');
    const spreadButton = this._make('button', {
      type: 'button', 'data-habitat-stage-spread': '', 'aria-pressed': 'false',
      'aria-label': spreadLabel, title: spreadLabel, hidden: ''
    }, stage);
    spreadButton.appendChild(this._icon('M3 5h8v14H3zM13 5h8v14h-8z'));
    // On a desktop the call buttons live in the sidebar footer. A call also
    // wants them where the eyes are, so the stage carries stand-ins that
    // appear when the pointer is over it. Each presses the real button and
    // copies its icon, name and state: nothing is moved, and there is still
    // one place that decides. A phone has the real row under the stage.
    const proxies = [];
    const controls = mode === 'desktop'
      ? this._make('div', { 'data-habitat-stage-controls': '', role: 'group' }, stage) : this._region('voice-controls');
    if (mode === 'desktop') {
      for (const id of ['voice-mute-btn', 'voice-deafen-btn', 'voice-cam-btn', 'screen-share-btn', 'voice-bar-leave-btn']) {
        const proxy = this._make('button', { type: 'button', 'data-habitat-for': id }, controls);
        this._on(proxy, 'click', () => { if (!proxy.disabled && !proxy.hidden) document.getElementById(id)?.click(); });
        proxies.push(proxy);
      }
      proxies[4].appendChild(this._icon('M3.5 14.5c5-4.5 12-4.5 17 0l-1.8 2.6-3.7-1.4v-2.2c-2-.6-4-.6-6 0v2.2l-3.7 1.4z'));
    }
    const more = this._make('button', {
      type: 'button', class: 'voice-panel-btn', 'data-habitat-call-more': '', 'aria-haspopup': 'menu',
      'aria-label': this._text('callActions'), title: this._text('callActions')
    });
    more.appendChild(this._icon('M6 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM18 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z'));
    const showGrid = () => {
      focusKey = null;
      autoFocus = false;
      spread = false;
      arrange();
    };
    const menu = this._buildStageMenu(more, stage, spreadButton, showGrid);
    const mirror = () => {
      for (const proxy of proxies) {
        const real = document.getElementById(proxy.getAttribute('data-habitat-for'));
        proxy.hidden = !real || real.hidden || real.getAttribute('aria-hidden') === 'true'
          || !real.getClientRects().length || getComputedStyle(real).visibility === 'hidden';
        if (!real) continue;
        const ariaDisabled = real.getAttribute('aria-disabled');
        proxy.disabled = real.disabled || ariaDisabled === 'true';
        if (ariaDisabled === null) proxy.removeAttribute('aria-disabled');
        else proxy.setAttribute('aria-disabled', ariaDisabled);
        const name = real.getAttribute('title') || real.getAttribute('aria-label') || real.textContent.trim();
        if (proxy.getAttribute('aria-label') !== name) {
          proxy.setAttribute('aria-label', name);
          proxy.setAttribute('title', name);
        }
        const on = String(/(^|\s)(muted|deafened|sharing|active)(\s|$)/.test(real.getAttribute('class') || ''));
        if (proxy !== proxies[4] && proxy.getAttribute('aria-pressed') !== on) proxy.setAttribute('aria-pressed', on);
        const glyph = proxy === proxies[4] ? null : real.querySelector('.haven-glyph, svg');
        const drawn = glyph ? glyph.getAttribute('class') || 'svg' : '';
        if (glyph && proxy.getAttribute('data-habitat-drawn') !== drawn && typeof proxy.replaceChildren === 'function') {
          proxy.setAttribute('data-habitat-drawn', drawn);
          proxy.replaceChildren(glyph.cloneNode(true));
        }
      }
    };

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
        const drawn = JSON.stringify([photo?.src, frame?.dataset.border, frame?.dataset.bt, frame?.dataset.animate, photo?.dataset.animate]);
        const old = row.querySelector('[data-habitat-call-avatar]');
        if (old?.getAttribute('data-habitat-call-avatar') === drawn) continue;
        old?.remove();
        const face = this._make('span', { 'data-habitat-call-avatar': drawn, 'aria-hidden': 'true' }, row);
        if (photo) this._make('img', { src: photo.src, alt: '', 'data-habitat-call-photo': '', 'data-animate': photo.dataset.animate || 'trigger' }, face);
        else face.textContent = Array.from(row.querySelector('.user-item-name')?.textContent || '?')[0];
        // The member's own picture frame comes along, as drawn in the member list.
        if (frame) {
          const marker = frame.cloneNode(false);
          delete marker.dataset.pfpDone;
          face.appendChild(marker);
        }
        row.insertBefore(face, row.firstChild);
      }
    };
    const flag = (part, name, on) => {
      if (on) part.setAttribute(name, ''); else part.removeAttribute(name);
    };
    const tileStyles = new WeakMap();
    const tileAttrs = new WeakMap();
    const rowTitles = new WeakMap();
    const restoreTile = part => {
      for (const [name, value] of tileAttrs.get(part) || []) {
        if (value === null) part.removeAttribute(name); else part.setAttribute(name, value);
      }
      tileAttrs.delete(part);
    };
    const unmark = (part) => {
      for (const [name, value, priority] of tileStyles.get(part) || []) {
        if (value) part.style.setProperty(name, value, priority); else part.style.removeProperty(name);
      }
      tileStyles.delete(part);
      for (const name of marks) part.removeAttribute(name);
      part.removeAttribute('data-habitat-enter');
      glides.get(part)?.cancel();
      restoreTile(part);
      if (rowTitles.has(part)) {
        const title = rowTitles.get(part);
        if (title === null) part.removeAttribute('title'); else part.setAttribute('title', title);
        rowTitles.delete(part);
      }
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
      alone.hidden = all.length !== 1 || !stage.hasAttribute('data-habitat-voice-room');
      invite.hidden = document.getElementById('sidebar-invite-panel')?.style.display === 'none'
        || !document.getElementById('right-btn-invite-popout');
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
          if (!tileStyles.has(part)) tileStyles.set(part, ['grid-area', 'left', 'top', 'width', 'height']
            .map(name => [name, part.style.getPropertyValue(name), part.style.getPropertyPriority(name)]));
          // The camera and its name plate form one tile. Only its picture takes a tab stop.
          if (part === slot.parts[0]) {
            if (!tileAttrs.has(part)) tileAttrs.set(part, ['tabindex', 'role', 'aria-label', 'aria-pressed']
              .map(name => [name, part.getAttribute(name)]));
            const name = slot.row?.querySelector('.user-item-name')?.textContent
              || part.querySelector('.webcam-tile-label, .screen-share-tile-label')?.textContent || this._text('participant');
            const key = slot.share ? 'enlargeScreen' : part === slot.row ? 'enlargePerson' : 'enlargeCamera';
            const canEnlarge = !slot.away && all.length > 1;
            part.setAttribute('role', canEnlarge ? 'button' : 'group');
            part.setAttribute('tabindex', '0');
            if (canEnlarge) part.setAttribute('aria-pressed', String(!cell)); else part.removeAttribute('aria-pressed');
            part.setAttribute('aria-label', canEnlarge ? this._text(key).replace('{name}', () => name) : name);
          } else restoreTile(part);
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
        if (!rowTitles.has(slot.row)) rowTitles.set(slot.row, slot.row.getAttribute('title'));
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
      if (keyboardRow && !now.has(keyboardRow) && document.activeElement === document.body) {
        const replacement = all.find(slot => slot.row?.dataset.userId === keyboardRow.dataset.userId)?.parts[0];
        keyboardRow = null;
        if (replacement?.getAttribute('tabindex') === '0') replacement.focus({ preventScroll: true });
      }
      // A newcomer's tile settles in, and the tile of someone who left stays
      // where it was for the length of a fade. Haven redraws every row when
      // anyone's state changes, so only a person new to the call, or gone
      // from it, counts; the row it threw away is the one that fades.
      const present = new Map();
      // Where each tile sits is read from the layout itself (offset*), which
      // a running animation does not disturb, so a second arrangement in the
      // same breath leaves a glide alone.
      const size = `${stage.clientWidth}x${stage.clientHeight}`;
      const settled = size === lastSize && !document.documentElement.classList?.contains('reduce-motion');
      lastSize = size;
      for (const slot of all) {
        const lead = slot.parts[0];
        if (slot.row && cast && !cast.has(slot.key)) for (const part of slot.parts) part.setAttribute('data-habitat-enter', '');
        const box = typeof lead.offsetWidth === 'number' && lead.offsetWidth > 0
          ? { left: lead.offsetLeft, top: lead.offsetTop, width: lead.offsetWidth, height: lead.offsetHeight } : null;
        const was = cast?.get(slot.key)?.box;
        // When the grid changes because someone came, left or took the large
        // spot, the others glide to their new place instead of jumping. A
        // window being resized is not that: it would glide on every pixel.
        if (settled && box && was) {
          const dx = was.left + was.width / 2 - box.left - box.width / 2;
          const dy = was.top + was.height / 2 - box.top - box.height / 2;
          // A tile whose shape changes a lot would squash the face in it on
          // the way; it grows evenly instead and lets the edges catch up.
          let sx = was.width / box.width;
          let sy = was.height / box.height;
          if (Math.abs(sx - sy) > .1) sx = sy = (sx + sy) / 2;
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(sx - 1) > .02 || Math.abs(sy - 1) > .02) {
            for (const part of slot.parts) {
              if (typeof part.animate !== 'function') continue;
              glides.get(part)?.cancel();
              glides.set(part, part.animate(
                [{ translate: `${dx}px ${dy}px`, scale: `${sx} ${sy}` }, { translate: '0 0', scale: '1 1' }],
                { duration: 180, easing: 'cubic-bezier(.2, .8, .2, 1)' }
              ));
            }
          }
        }
        present.set(slot.key, { row: slot.row, plain: !!slot.row && !slot.camera, box });
      }
      for (const [key, was] of cast || []) {
        if (present.has(key) || !was.box || !was.plain || was.row.isConnected) continue;
        const ghost = was.row;
        for (const name of [...marks, 'data-habitat-enter', 'title']) ghost.removeAttribute(name);
        ghost.setAttribute('data-habitat-leave', '');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.removeProperty('grid-area');
        for (const side of ['left', 'top', 'width', 'height']) ghost.style.setProperty(side, `${(was.box[side] / rem).toFixed(3)}rem`);
        stage.appendChild(ghost);
        const gone = () => ghost.remove();
        ghost.addEventListener('animationend', gone, { once: true });
        setTimeout(gone, 400)?.unref?.();
      }
      cast = present;
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
    const settingsHeader = this._make('header', { 'data-habitat-call-settings-heading': '' });
    this._make('h3', {}, settingsHeader).textContent = this._text('voiceSettings');
    const closeSettings = this._make('button', { type: 'button', class: 'icon-btn', 'data-habitat-close-settings': '', 'aria-label': this._text('close') }, settingsHeader);
    closeSettings.textContent = '×';
    this._on(closeSettings, 'click', () => {
      document.getElementById('voice-settings-toggle')?.click();
      more.focus();
    });
    let docked = [];
    let settingsWereHidden = false;
    const dockBar = (on) => {
      if (on) {
        const leave = mode === 'desktop' ? proxies[4] : controls?.querySelector('#voice-leave-sidebar-btn');
        controls?.insertBefore(more, leave || null);
        const settings = this._region('voice-settings');
        settings?.insertBefore(settingsHeader, settings.firstChild);
        settingsWereHidden = settings?.style.display === 'none';
        const row = mode === 'compact' ? controls : null;
        const inline = row ? Object.keys(barStyle).map(name =>
          [name, row.style.getPropertyValue(name), row.style.getPropertyPriority(name)]) : [];
        for (const piece of [row, settings]) {
          if (!piece) continue;
          docked.push([piece, piece.parentNode, piece.nextSibling, piece === row ? inline : []]);
          area.insertBefore(piece, stage.nextSibling);
        }
        if (row) {
          for (const [name, value] of Object.entries(barStyle)) row.style.setProperty(name, value, 'important');
          row.setAttribute('data-habitat-call-bar', '');
        }
      } else {
        menu.hidden = true;
        more.setAttribute('aria-expanded', 'false');
        this._closeCallConnection?.();
        more.remove();
        settingsHeader.remove();
        const settings = this._region('voice-settings');
        if (settingsWereHidden && settings && settings.style.display !== 'none') document.getElementById('voice-settings-toggle')?.click();
        for (const [piece, parent, next, inline] of docked.reverse()) {
          for (const [name, value, priority] of inline) {
            if (value) piece.style.setProperty(name, value, priority); else piece.style.removeProperty(name);
          }
          piece.removeAttribute('data-habitat-call-bar');
          parent.insertBefore(piece, next?.parentNode === parent ? next : null);
        }
        docked = [];
      }
      this._syncToastClearance?.();
    };
    const setOpen = (open) => {
      if (open === roster.hasAttribute('data-habitat-stage')) return;
      if (open) {
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
        focusKey = null; autoFocus = true; shareCount = 0; spread = false; cast = null; lastSize = '';
        if (proxies.length) {
          this._controlsObserver = new MutationObserver(mirror);
          this._controlsObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-habitat-layout', 'data-habitat-in-voice'] });
          for (const home of [document.querySelector('[data-habitat-tools]'), this._region('voice-controls'), document.getElementById('voice-bar')]) {
            if (home) this._controlsObserver.observe(home, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'title', 'aria-label', 'disabled', 'aria-disabled', 'hidden', 'aria-hidden'] });
          }
          mirror();
        }
        dockBar(true);
        arrange();
      } else {
        keyboardRow = null;
        this._stageObserver?.disconnect();
        this._stageSize?.disconnect();
        this._controlsObserver?.disconnect();
        dockBar(false);
        for (const ghost of stage.querySelectorAll('[data-habitat-leave]')) ghost.remove();
        cast = null;
        for (const part of placed) unmark(part);
        placed = new Set();
        for (const face of roster.querySelectorAll('[data-habitat-call-avatar]')) face.remove();
        for (const box of [...media].reverse()) {
          const next = homes.get(box);
          carry(box, area, next?.parentNode === area ? next : null);
        }
        homes.clear();
        carry(roster, anchor.parentNode, anchor.nextSibling);
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
    const toggleTile = tile => {
      const slot = slots().find(item => item.parts.includes(tile));
      if (!slot || slot.away) return;
      const focused = tile.hasAttribute('data-habitat-focused');
      // From side by side, a click keeps the one that was clicked.
      focusKey = focused && !spread ? null : slot.key;
      if (focused && !spread) autoFocus = false;
      spread = false;
      arrange();
    };
    this._on(stage, 'click', event => {
      const tile = event.target.closest?.('.screen-share-tile, .webcam-tile, .voice-user-item');
      if (!tile || document.fullscreenElement) return;
      if (event.target.closest('button, input, a, label, .user-item-name, .voice-stream-badge, .stream-audio-controls, .fullscreen-call-toolbar')) return;
      toggleTile(tile);
    });
    this._on(stage, 'keydown', event => {
      if (document.fullscreenElement || event.defaultPrevented) return;
      if (plainEscape(event) && stage.hasAttribute('data-habitat-focus')
          && event.target.closest?.('.screen-share-tile, .webcam-tile, .voice-user-item')) {
        showGrid();
      } else if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[tabindex="0"][aria-pressed]')
          && event.target.matches('.screen-share-tile, .webcam-tile, .voice-user-item')) {
        if (!event.repeat) toggleTile(event.target);
      } else return;
      event.preventDefault();
      event.stopPropagation();
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
    let stageRoom = null;
    const sync = () => {
      const app = window.app;
      const voice = app?.voice;
      button.hidden = voice ? !(voice.inVoice && voice.currentChannel === app.currentChannel) : indicator.style.display === 'none';
      if (button.hidden) closedByHand = false;
      const room = !button.hidden && app?._isVoiceOnlyChannel?.(app.currentChannel) ? app.currentChannel : null;
      flag(stage, 'data-habitat-voice-room', !!room);
      if (room && room !== stageRoom) setOpen(true);
      else if (button.hidden || (!room && stageRoom)) setOpen(false);
      if (room !== stageRoom) arrange();
      stageRoom = room;
      followMedia();
    };
    this._syncStage = sync;
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
      const source = app.channels?.find(ch => ch.canMoveVoiceMembers &&
        app.voiceChannelUsers[ch.code]?.some(person => person.id === userId));
      const destinations = source && app.channels.filter(ch => ch.canMoveVoiceMembers && ch.code !== source.code);
      if (destinations?.length) {
        const label = this._text('moveMember');
        const picker = this._make('select', { 'aria-label': label, 'data-habitat-move-member': '' }, tools);
        this._make('option', { value: '' }, picker).textContent = label;
        for (const room of destinations) this._make('option', { value: room.code }, picker).textContent = room.name;
        picker.addEventListener('change', () => {
          if (picker.value) app.socket.emit('voice-move-member', { from: source.code, to: picker.value, userId });
          picker.value = '';
          app._closeProfilePopup();
        });
      }
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
              out.video = {
                height: report.frameHeight, fps: report.framesPerSecond, limit: report.qualityLimitationReason,
                // Which codec, and whether the graphics hardware is doing the
                // work: a software encoder per viewer is what makes a whole
                // machine stutter during a share.
                codec: String(byId.get(report.codecId)?.mimeType || '').replace(/^video\//i, ''),
                hardware: report.powerEfficientEncoder
              };
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
        call.video.codec,
        call.video.hardware === true ? this._text('hardware') : call.video.hardware === false ? this._text('software') : '',
        held ? this._text(call.video.limit === 'cpu' ? 'limitCpu' : 'limitBandwidth') : ''
      ].filter(Boolean).join(' · ');
      cells.route.textContent = call.sfu ? this._text('sfu')
        : !call.relayed && !call.direct ? '–'
          : this._text(call.relayed && call.direct ? 'mixed' : call.relayed ? 'relay' : 'direct');
      cells.server.textContent = window.location?.host || '–';
    };
    const place = () => {
      panel.style.top = '';
      const box = bar.getBoundingClientRect();
      panel.style.setProperty('left', `${box.left + 8}px`);
      panel.style.setProperty('bottom', `${window.innerHeight - box.top + 8}px`);
      panel.style.setProperty('width', `${Math.max(box.width - 16, 200)}px`);
    };
    let stageAnchor = null;
    const setOpen = (open, anchor = null) => {
      stageAnchor = open ? anchor : null;
      panel.hidden = !open;
      bar.querySelector('.voice-bar-status')?.setAttribute('aria-expanded', String(open));
      if (stageAnchor) {
        panel.style.bottom = 'auto';
        panel.style.width = 'min(20rem, 95vw)';
        this._placeCallPopup(panel, stageAnchor);
        draw();
      } else if (open) { place(); draw(); }
    };
    this._openConnection = anchor => setOpen(true, anchor);
    this._closeCallConnection = () => { if (stageAnchor) setOpen(false); };
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
      if (plainEscape(event) && !panel.hidden) {
        event.stopImmediatePropagation();
        setOpen(false);
      }
    }, true);
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
      // Haven redraws the bar after voice.join resolves, on moves and on leave.
      this._syncJoin?.();
      this._syncStage?.();
      this._signalSync?.(inCall);
    };
    this._voiceObserver = new MutationObserver(sync);
    this._voiceObserver.observe(bar, { attributes: true, attributeFilter: ['style'], childList: true });
    sync();
  }

  // ── Server name menu ───────────────────────────────────────
  _buildMenu(header, actions) {
    const button = this._make('button', {
      type: 'button', 'data-habitat-menu-button': '', 'aria-label': this._text('menu')
    });
    button.appendChild(this._icon('M6 9.5l6 6 6-6'));
    header.appendChild(button);
    const menu = this._newMenu(header, 'server');
    this._move(actions, menu);
    const invitePanel = document.getElementById('sidebar-invite-panel');
    const invite = invitePanel?.querySelector('#right-btn-invite-popout');
    if (invite) {
      this._move(invite, menu);
      this._setAttr(invitePanel, 'data-habitat-emptied', '');
    }
    const admin = this._menuAction(menu, 'serverSettings', '⚙', () => {
      if (!window.app?._hasAnyAdminSettingsAccess?.()) return;
      document.getElementById('open-settings-btn')?.click();
      document.querySelector('.settings-tab-admin')?.click();
    });
    const permissions = this._menuAction(menu, 'permissions', '🛡', () => {
      if (window.app?._hasPerm?.('manage_roles')) window.app._openPermMatrix();
    });
    const create = this._menuAction(menu, 'createChannel', '+', () => {
      this._toggleDialog(true, button);
    });
    this._menuAction(menu, 'notifications', '🔔', () => {
      document.getElementById('open-settings-btn')?.click();
      document.querySelector('.settings-nav-item[data-target="section-sounds"]')?.click();
      document.getElementById('notif-server-mute-mode')?.focus();
    });
    this._bindMenu(button, menu, () => {
      admin.hidden = !window.app?._hasAnyAdminSettingsAccess?.();
      permissions.hidden = !window.app?._hasPerm?.('manage_roles');
      const region = this._region('create-channel');
      create.hidden = !region || region.style.display === 'none';
    });
  }

  _newMenu(parent, name) {
    const menu = this._make('div', { id: 'habitat-menu-' + name, 'data-habitat-menu': name, hidden: '' });
    parent.appendChild(menu);
    return menu;
  }

  _menuAction(menu, key, icon, action) {
    const button = this._make('button', { type: 'button', 'aria-label': this._text(key) }, menu);
    button.setAttribute('class', 'icon-btn small');
    button.textContent = icon;
    this._on(button, 'click', action);
    return button;
  }

  _bindMenu(button, menu, prepare, alternate) {
    this._setAttr(button, 'aria-controls', menu.id);
    this._setAttr(button, 'aria-expanded', 'false');
    const labelled = new WeakSet();
    const close = () => {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };
    const toggle = () => {
      if (!menu.hidden) { close(); return; }
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      prepare?.();
      // Haven's tooltip borrows title on hover. Copy the current name before
      // focus moves, including a translation applied since the last opening.
      for (const row of menu.querySelectorAll('button')) {
        if (row.getAttribute('role') === 'menuitem') continue;
        const name = row.getAttribute('aria-label') || row.title;
        if (labelled.has(row)) row.setAttribute('data-habitat-label', name || '');
        else {
          this._setAttr(row, 'data-habitat-label', name || '');
          labelled.add(row);
        }
      }
      const first = [...menu.querySelectorAll('button')].find(row => !row.disabled && !row.hidden && row.getClientRects().length);
      first?.focus();
    };
    this._on(button, 'click', event => {
      // The native avatar opens Edit Profile directly outside this layout.
      if (button.id === 'user-bar-avatar') event.stopImmediatePropagation();
      toggle();
    }, true);
    this._on(document, 'focusin', event => {
      if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) close();
    });
    this._on(menu, 'keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const rows = [...menu.querySelectorAll('button')].filter(row => !row.disabled && !row.hidden && row.getClientRects().length);
      if (!rows.length) return;
      event.preventDefault();
      const index = rows.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1);
      rows[(next + rows.length) % rows.length].focus();
    });
    this._on(menu, 'click', event => {
      if (!event.target.closest('button')) return;
      // A dialog opened by the row may already own focus.
      if (menu.contains(document.activeElement)) button.focus();
      close();
    });
    this._on(document, 'keydown', event => {
      if (!menu.hidden && plainEscape(event)) {
        event.stopImmediatePropagation();
        close();
        button.focus();
      }
    }, true);
    this._on(document, 'pointerdown', event => {
      if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target) && !alternate?.contains(event.target)) {
        close();
        button.focus();
      }
    }, true);
  }

  _buildAccountMenu(account) {
    const avatar = document.getElementById('user-bar-avatar');
    if (!avatar) return;
    const menu = this._newMenu(account, 'account');
    // applyDOM may run again while the layout owns the avatar.
    for (const attr of ['data-i18n-title', 'data-i18n-aria-label']) {
      this._setAttr(avatar, attr, null);
    }
    this._setAttr(avatar, 'title', this._text('accountMenu'));
    this._setAttr(avatar, 'aria-label', this._text('accountMenu'));
    for (const id of ['rename-btn', 'logout-btn']) {
      const item = document.getElementById(id);
      if (item && account.contains(item)) this._move(item, menu);
    }
    const rename = document.getElementById('rename-btn');
    if (rename) {
      this._setAttr(rename, 'title', this._text('editProfile'));
      this._setAttr(rename, 'aria-label', this._text('editProfile'));
      this._setAttr(rename, 'data-i18n-title', 'users.edit_profile');
    }
    const names = account.querySelector('.user-names');
    this._bindMenu(avatar, menu, null, names);
    if (names) this._on(names, 'click', event => {
      if (!event.target.closest('button')) avatar.click();
    });
  }

  _buildRailMenu(mode) {
    const rail = this._region('server-rail');
    if (!rail) return;
    const menu = this._newMenu(document.body, 'rail');
    for (const id of ['add-server-btn', 'manage-servers-btn', 'sync-servers-btn']) {
      const row = document.getElementById(id);
      if (row && rail.contains(row)) this._move(row, menu);
    }
    const button = this._make('button', {
      type: 'button', 'data-habitat-servers-button': '', 'aria-label': this._text('serverActions')
    });
    const mark = this._make('span', { class: 'server-icon-text', 'aria-hidden': 'true' }, button);
    const place = () => {
      // Tablet widths still use the vertical rail. Phones have server bubbles
      // in the navigation drawer and the exact same three actions follow them.
      const bubbles = mode === 'compact' && this._phone.matches && document.getElementById('mobile-servers-row');
      button.setAttribute('class', bubbles ? 'mobile-srv-add-btn' : 'server-icon add-server');
      mark.textContent = bubbles ? '⋯' : '+';
      (bubbles || rail).appendChild(button);
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };
    place();
    this._on(this._phone, 'change', place);
    this._bindMenu(button, menu, () => {
      // The rail and the bubbles both clip overflow. Anchor the menu outside
      // them and keep its last item on screen when the server list is long.
      const anchor = button.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      menu.style.left = Math.max(0, Math.min(anchor.right, window.innerWidth - bounds.width)) + 'px';
      menu.style.top = Math.max(0, Math.min(anchor.top, window.innerHeight - bounds.height)) + 'px';
    });
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
    const tabs = this._make('div', { role: 'tablist', 'aria-label': this._text('add') }, panel);
    const body = this._make('div', { 'data-habitat-dialog-body': '' }, panel);
    document.body.appendChild(dialog);
    this._dialog = dialog;
    this._addButton = button;
    if (join) this._move(join, body);
    if (create) this._move(create, body);
    this._addForms = {};
    for (const [kind, region] of [['create', create], ['join', join]]) {
      if (!region) continue;
      this._addForms[kind] = this._buildChannelForm(kind, region, tabs);
    }
    this._bindAddChoices(tabs, 'tab');
    const syncPermission = () => {
      if (!create) return;
      const item = this._addForms.create;
      item.tab.hidden = create.style.display === 'none' || create.hidden;
      if (item.tab.hidden && this._activeAddForm === item && !dialog.hidden) {
        this._selectAddTab(this._addForms.join);
        (this._addRequest ? close : this._addForms.join?.field)?.focus();
      }
    };
    if (create) {
      this._addPermissionObserver = new MutationObserver(syncPermission);
      this._addPermissionObserver.observe(create, { attributes: true, attributeFilter: ['style', 'hidden'] });
    }
    this._openAdd = (opener, template) => {
      syncPermission();
      const { create, join } = this._addForms;
      const first = create && !create.tab.hidden ? create : join;
      if (!first) return;
      this._addOpener = opener;
      this._restoreAddDraft = this._saveAddDraft();
      for (const item of Object.values(this._addForms)) {
        item.form.reset();
        this._showAddError(item, '');
      }
      if (create) {
        create.choose(template);
        create.expand(false);
      }
      dialog.hidden = false;
      this._selectAddTab(first);
      first.field.focus();
    };
    this._on(button, 'click', event => {
      event.stopPropagation();
      this._toggleDialog(true, button);
    });
    this._on(channels, 'click', event => {
      if (!event.target.closest('.temp-channel-create-btn') || !create || create.hidden || create.style.display === 'none') return;
      event.stopPropagation();
      this._toggleDialog(true);
      const temp = document.getElementById('new-channel-temporary');
      temp.checked = true;
      temp.dispatchEvent(new Event('change'));
      this._addForms.create.expand(true);
    }, true);
    this._on(close, 'click', () => this._toggleDialog(false));
    this._on(dialog, 'pointerdown', event => {
      if (event.target === dialog) this._toggleDialog(false);
    });
    this._on(document, 'keydown', event => {
      if (dialog.hidden) return;
      const confirm = document.getElementById('confirm-modal-ok')?.closest('.modal-overlay');
      if (plainEscape(event) && !confirm) {
        event.stopImmediatePropagation();
        this._toggleDialog(false);
      }
      if (event.key !== 'Tab') return;
      const stops = [...(confirm || panel).querySelectorAll('button, input, select, [tabindex]')].filter(el =>
        !el.disabled && el.tabIndex !== -1 && !el.closest('[hidden], [disabled]') && el.getClientRects().length);
      const first = stops[0], last = stops.at(-1);
      const active = document.activeElement;
      if (!stops.includes(active) || active === (event.shiftKey ? first : last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }, true);
  }

  _buildChannelForm(kind, region, tabs) {
    const create = kind === 'create';
    const tabId = 'habitat-tab-' + kind;
    const panelId = 'habitat-panel-' + kind;
    const tab = this._make('button', {
      type: 'button', role: 'tab', id: tabId, 'aria-controls': panelId
    }, tabs);
    tab.textContent = this._text(create ? 'create' : 'joinCode');
    // Keep the sidebar headers and their collapsed state intact for Mod Mode.
    const sidebar = this._make('div', { hidden: '' });
    for (const child of [...region.children]) this._move(child, sidebar);
    region.appendChild(sidebar);
    const form = this._make('form', { id: panelId, role: 'tabpanel', 'data-habitat-channel-form': '', 'aria-labelledby': tabId, novalidate: '' });
    region.appendChild(form);
    const fields = this._make('fieldset', {}, form);
    const field = region.querySelector(create ? '#new-channel-name' : '#channel-code-input');
    const nativeButton = region.querySelector(create ? '#create-channel-btn' : '#join-channel-btn');
    const item = { kind, tab, form, fields, field, nativeButton };

    if (create) this._buildChannelKinds(item);
    this._make('label', { for: field.id }, fields).textContent = this._text(create ? 'channelName' : 'channelCode');
    const entry = this._make('div', { 'data-habitat-entry': '' }, fields);
    if (create) {
      item.icon = this._make('span', { 'aria-hidden': 'true' }, entry);
    }
    this._move(field, entry);
    const hintId = 'habitat-join-hint';
    if (!create) this._make('small', { id: hintId }, fields).textContent = this._text('joinHint');
    item.error = this._make('small', { id: panelId + '-error', role: 'alert', hidden: '' }, fields);
    this._setAttr(field, 'aria-describedby', (create ? '' : hintId + ' ') + item.error.id);
    this._setAttr(field, 'aria-invalid', null);
    if (create) this._buildChannelOptions(item, sidebar);

    const footer = this._make('footer', {}, form);
    const cancel = this._make('button', { type: 'button' }, footer);
    cancel.textContent = this._text('cancel');
    this._on(cancel, 'click', () => this._toggleDialog(false));
    item.submit = this._make('button', { type: 'submit', class: 'btn-accent' }, footer);
    this._on(tab, 'click', () => this._selectAddTab(item));
    this._on(form, 'submit', event => {
      event.preventDefault();
      if (this._activeAddForm === item && !this._dialog.hidden && !tab.hidden) this._submitAdd(item);
    });
    return item;
  }

  _buildChannelKinds(item) {
    const select = document.getElementById('new-channel-template');
    const group = this._make('div', { role: 'radiogroup', 'aria-label': this._text('channelKind') }, item.fields);
    const hash = 'M10 3 6 21M18 3l-4 18M4 9h17M3 15h17';
    const speaker = 'M4 9h4l5-4v14l-5-4H4zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14';
    const cards = [];
    for (const [value, title, hint, path] of [
      ['b:chat', 'textChannel', 'textHint', hash], ['b:voice_room', 'voiceRoom', 'voiceHint', speaker]
    ]) {
      const card = this._make('button', { type: 'button', role: 'radio', value }, group);
      card.appendChild(this._icon(path));
      this._make('strong', {}, card).textContent = this._text(title);
      this._make('small', {}, card).textContent = this._text(hint);
      this._on(card, 'click', () => item.choose(value));
      cards.push(card);
    }
    item.choose = value => {
      if (!select.options.length) window.app?._renderChannelTemplates?.();
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const sync = () => {
      for (const card of cards) {
        const checked = card.value === select.value;
        card.setAttribute('aria-checked', String(checked));
        card.tabIndex = checked || (card === cards[0] && select.value !== 'b:voice_room') ? 0 : -1;
      }
      const voice = select.value === 'b:voice_room';
      item.icon.replaceChildren(this._icon(voice ? speaker : hash));
      item.submitKey = voice ? 'createRoom' : 'createChannel';
      this._paintAddSubmit(item);
    };
    this._bindAddChoices(group, 'radio');
    this._on(select, 'change', sync);
    // Deleting a saved template rebuilds the options without firing change.
    this._addTemplateObserver = new MutationObserver(sync);
    this._addTemplateObserver.observe(select, { childList: true });
  }

  _bindAddChoices(group, role) {
    this._on(group, 'keydown', event => {
      const options = [...group.querySelectorAll('[role="' + role + '"]')].filter(el => !el.hidden && !el.disabled);
      const i = options.indexOf(event.target);
      if (i === -1) return;
      const keys = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: options.length - 1 };
      if (role === 'radio') Object.assign(keys, { ArrowUp: i - 1, ArrowDown: i + 1 });
      if (!(event.key in keys)) return;
      event.preventDefault();
      const next = options[(keys[event.key] + options.length) % options.length];
      next.click();
      next.focus();
    });
  }

  _buildChannelOptions(item, sidebar) {
    const original = sidebar.querySelector('#create-section-body');
    const privateRow = original.querySelector('#new-channel-private').parentElement;
    this._move(privateRow, item.fields);
    const toggle = this._make('button', {
      type: 'button', 'data-habitat-advanced': '', 'aria-controls': 'habitat-channel-options'
    }, item.fields);
    this._make('span', {}, toggle).textContent = this._text('advanced');
    toggle.appendChild(this._icon('m6 9 6 6 6-6'));
    const options = this._make('div', { id: 'habitat-channel-options' }, item.fields);
    item.expand = open => {
      options.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    };
    this._on(toggle, 'click', () => item.expand(options.hidden));

    const more = original.querySelector('#new-channel-more');
    const template = original.querySelector('#new-channel-template-row');
    this._make('label', { for: 'new-channel-template' }, options).textContent = this._text('template');
    this._move(template, options);
    const duration = original.querySelector('#temp-channel-duration-row');
    this._setAttr(duration.querySelector('input'), 'aria-label', this._text('expiryHours'));
    for (const row of [...original.children]) {
      if (row === more || row === duration || row.contains(item.nativeButton)) continue;
      this._move(row, options);
      if (row.querySelector('#new-channel-temporary')) this._move(duration, options);
    }
    for (const row of [...more.children]) {
      if (row.matches('summary')) continue;
      if (row.id === 'new-channel-topic') {
        this._make('label', { for: row.id }, options).textContent = this._text('channelTopic');
      }
      this._move(row, options);
    }
    const hints = {
      'new-channel-private': 'privateHint', 'new-channel-temporary': 'temporaryHint',
      'new-channel-text': 'messagesHint', 'new-channel-media': 'uploadsHint', 'new-channel-voice': 'callsHint',
      'new-channel-slowmode': 'slowHint'
    };
    for (const label of item.fields.querySelectorAll('.checkbox-row')) {
      const caption = label.querySelector('span');
      const control = label.querySelector('input, select');
      if (!control || !caption) continue;
      if (control.matches('input[type="checkbox"]')) this._setAttr(control, 'role', 'switch');
      const copy = this._make('span', { 'data-habitat-switch-copy': '' });
      label.appendChild(copy);
      this._move(caption, copy);
      const hint = hints[control.id] ? this._text(hints[control.id]) : label.title;
      if (hint) this._make('small', {}, copy).textContent = hint;
    }
  }

  // A dialog starts fresh even if someone had a draft in Haven's sidebar.
  // Keep that draft, including the template-only announcement flag, for their return.
  _saveAddDraft() {
    const inputs = [...this._dialog.querySelectorAll('input, select')].map(el => [el, el.value, el.checked]);
    const template = window.app?._pendingChannelTemplate;
    const attrs = [];
    for (const [id, attr] of [['new-channel-more', 'open'], ['new-channel-template-del', 'style'],
      ['temp-channel-duration-row', 'style']]) {
      const el = document.getElementById(id);
      if (el) attrs.push([el, attr, el.getAttribute(attr)]);
    }
    return () => {
      for (const [el, value, checked] of inputs) {
        if (el.matches('input[type="checkbox"]')) el.checked = checked;
        else el.value = value;
      }
      for (const [el, attr, value] of attrs) {
        if (value === null) el.removeAttribute(attr);
        else el.setAttribute(attr, value);
      }
      if (window.app) window.app._pendingChannelTemplate = template;
      const picker = document.getElementById('new-channel-template');
      if (picker?.options.length && !picker.value) this._addForms.create.choose('b:chat');
    };
  }

  _selectAddTab(item) {
    if (!item) return;
    this._activeAddForm = item;
    for (const other of Object.values(this._addForms)) {
      const active = other === item;
      other.tab.setAttribute('aria-selected', String(active));
      other.tab.tabIndex = active ? 0 : -1;
      other.form.hidden = !active;
      this._paintAddSubmit(other);
    }
  }

  _paintAddSubmit(item) {
    const waiting = !!this._addRequest;
    item.tab.disabled = waiting && item !== this._activeAddForm && !this._addRequest.dismissed;
    item.form.setAttribute('aria-busy', String(waiting));
    item.submit.disabled = waiting;
    item.fields.disabled = waiting && !this._addRequest.dismissed;
    let key = item.submitKey || 'join';
    if (waiting) key = this._addRequest.dismissed ? 'waiting' : (this._addRequest.kind === 'join' ? 'joining' : 'creating');
    item.submit.textContent = this._text(key);
  }

  _showAddError(item, message) {
    item.error.textContent = message;
    item.error.hidden = !message;
    if (message) {
      item.field.setAttribute('aria-invalid', 'true');
      item.field.focus();
    } else item.field.removeAttribute('aria-invalid');
  }

  _submitAdd(item) {
    if (this._addRequest) return;
    const value = item.field.value.trim();
    if (!value) return this._showAddError(item, this._text(item.kind === 'join' ? 'needCode' : 'needName'));
    const socket = window.app?.socket;
    if (!socket?.connected) return this._showAddError(item, this._text('connectionLost'));
    this._showAddError(item, '');
    const create = item.kind === 'create';
    const request = { kind: item.kind };
    const app = window.app;
    const done = message => {
      request.cleanup();
      this._addRequest = null;
      for (const other of Object.values(this._addForms)) this._paintAddSubmit(other);
      if (request.dismissed || this._dialog.hidden || item !== this._activeAddForm) return false;
      if (message) this._showAddError(item, message);
      else this._toggleDialog(false);
      return true;
    };
    // channel-created also goes to members added by someone else. A join may
    // rotate its own code, and server-wide invites only send a textual receipt.
    app._habitatAddError = msg => {
      if (!create && /^Server code accepted: joined \d+ channels?$/.test(msg)) return done();
      const refused = create
        ? /^(Channel name |Failed to create channel|You don't have permission to create channels)/
        : /^(Invalid channel code|This invite link |Guests cannot join channels by code)/;
      if (refused.test(msg) || msg === 'Slow down: too many requests') return done(msg);
      return false;
    };
    const listeners = { disconnect: () => done(this._text('connectionLost')) };
    if (create) {
      listeners['channel-created'] = ch => {
        if (ch.name === value && ch.created_by === app.user.id) done();
      };
    } else {
      // Only the requesting socket gets this receipt, including when a role gate hides the room broadcast.
      listeners['channel-joined'] = () => done();
      listeners.toast = data => {
        if (data?.type === 'success' && /^Invite accepted: joined \d+ channels?$/.test(data.message)) done();
      };
    }
    // The rate limiter can silently drop a repeated request. Keep the draft
    // available and let the member check the channel list before trying again.
    const timer = setTimeout(() => done(this._text('noReply')), 30000);
    request.cleanup = () => {
      clearTimeout(timer);
      delete app._habitatAddError;
      for (const [event, handler] of Object.entries(listeners)) socket.off(event, handler);
    };
    this._addRequest = request;
    for (const [event, handler] of Object.entries(listeners)) socket.on(event, handler);
    for (const other of Object.values(this._addForms)) this._paintAddSubmit(other);
    item.nativeButton.click();
  }

  _toggleDialog(open, opener = this._addButton, template = 'b:chat') {
    if (!this._dialog) return;
    if (open && this._dialog.hidden) return this._openAdd(opener, template);
    if (open) return;
    this._dialog.hidden = true;
    this._restoreAddDraft?.();
    this._restoreAddDraft = null;
    if (this._addRequest) this._addRequest.dismissed = true;
    this._addOpener?.focus();
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
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }

  _restoreDesktop() {
    this._restoreAddDraft?.();
    this._restoreAddDraft = null;
    this._addRequest?.cleanup();
    this._addRequest = null;
    this._addPermissionObserver?.disconnect();
    this._addTemplateObserver?.disconnect();
    this._addTemplateObserver = this._addPermissionObserver = null;
    this._mode = null;
    this._indicatorObserver?.disconnect();
    this._mediaObserver?.disconnect();
    this._toastSize?.disconnect();
    this._toastSize = this._syncToastClearance = null;
    this._closeStage?.();
    this._closeStage = null;
    this._openConnection = this._closeCallConnection = null;
    this._selectList = null;
    this._badgeObserver?.disconnect();
    this._dmAvatarObserver?.disconnect();
    this._syncJoin = null;
    this._syncStage = null;
    this._voiceFaces?.disconnect();
    this._voiceCreateObserver?.disconnect();
    this._memberObserver?.disconnect();
    this._drawerObserver?.disconnect();
    for (const face of document.querySelectorAll('[data-habitat-dm-avatar]')) face.remove();
    this._historyObserver?.disconnect();
    this._nameObserver?.disconnect();
    this._joinObserver?.disconnect();
    this._peopleObserver?.disconnect();
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
    this._addForms = this._activeAddForm = this._openAdd = this._addOpener = null;
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
    create: 'Create', joinCode: 'Join with a code', join: 'Join', cancel: 'Cancel', advanced: 'Advanced',
    textChannel: 'Text channel', voiceRoom: 'Voice room', textHint: 'Messages, files and threads',
    voiceHint: 'Talk, camera and screen share', channelKind: 'Channel kind', channelName: 'Channel name',
    channelCode: 'Channel code', joinHint: 'Ask a member for the code of the channel you want to join.',
    messagesHint: 'Allow members to send messages.', uploadsHint: 'Allow files and images.',
    callsHint: 'Allow members to join a call.', slowHint: 'Minimum time between messages.',
    expiryHours: 'Expiry in hours', temporaryHint: 'Expires after the time you choose.', waiting: 'Waiting for the server…',
    privateHint: 'Only invited members can join.', template: 'Template', channelTopic: 'Topic',
    createRoom: 'Create room', joining: 'Joining…', creating: 'Creating…',
    noReply: 'No reply yet. Check the channel list before trying again.',
    needCode: 'Enter a channel code.', needName: 'Enter a channel name.',
    connectionLost: 'Connection lost. Reconnect to check the channel and try again.',
    menu: 'Server menu', add: 'Add a channel', close: 'Close', accountMenu: 'Account menu', editProfile: 'Edit profile',
    serverActions: 'Server list actions', serverSettings: 'Server settings', createChannel: 'Create channel',
    notifications: 'Server notifications', topic: 'Set or edit topic', rotate: 'Rotate channel code',
    joinRoom: 'Join voice', moveMember: 'Move to voice channel…', permissions: 'Roles & permissions', speaking: 'Speaking', voiceRooms: 'Voice channels', emptyVoice: 'No voice channels yet.', addVoice: 'Create a voice channel',
    callActions: 'More call actions', voiceSettings: 'Voice settings', soundboard: 'Soundboard', listenTogether: 'Listen together',
    participant: 'Participant', enlargePerson: 'Enlarge tile for {name}', enlargeCamera: 'Enlarge camera for {name}',
    enlargeScreen: 'Enlarge screen for {name}', popCamera: 'Pop out camera for {name}', popScreen: 'Pop out screen for {name}',
    returnCamera: 'Return camera for {name}', returnScreen: 'Return screen for {name}', minimizeStreams: 'Minimize streams',
    showGrid: 'Return to grid', closeCameras: 'Close cameras', closeStreams: 'Close streams',
    callView: 'Call view', find: 'Find a conversation', messages: 'Messages',
    tools: 'Channel actions', noDM: 'No conversations yet. Open a member’s profile to send a message.',
    roomEmpty: 'No one is here yet. Be the first in.', roomOne: '1 person is here', roomMany: '{n} people are here',
    channelStart: 'This is the beginning of this channel.', dmStart: 'This is the beginning of your conversation.',
    volume: 'User volume', mute: 'Mute', unmute: 'Unmute', connection: 'Connection details',
    good: 'Connection is good', fair: 'Connection is unsteady', poor: 'Connection is poor',
    people: 'Connected to', alone: 'No one else here yet', serverPing: 'Server ping', voicePing: 'Voice delay',
    loss: 'Packet loss', jitter: 'Jitter', route: 'Route', server: 'Server',
    direct: 'Direct', relay: 'Relay (TURN)', mixed: 'Direct and relay',
    sideBySide: 'Show every shared screen together',
    aloneTitle: 'You are the first one here', aloneHint: 'People appear here as they join.', invite: 'Invite people',
    upload: 'Upload', download: 'Download', video: 'Picture you send',
    limitBandwidth: 'held back by the connection', limitCpu: 'held back by this computer',
    sfu: 'Through the server (voice relay)', hardware: 'hardware', software: 'software'
  }),
  tr: Object.freeze({
    create: 'Oluştur', joinCode: 'Kodla katıl', join: 'Katıl', cancel: 'İptal', advanced: 'Gelişmiş',
    textChannel: 'Metin kanalı', voiceRoom: 'Ses odası', textHint: 'Mesajlar, dosyalar ve konu dizileri',
    voiceHint: 'Sesli sohbet, kamera ve ekran paylaşımı', channelKind: 'Kanal türü', channelName: 'Kanal adı',
    channelCode: 'Kanal kodu', joinHint: 'Katılmak istediğin kanalın kodunu bir üyeden iste.',
    messagesHint: 'Üyeler mesaj gönderebilir.', uploadsHint: 'Dosya ve resim paylaşılabilir.',
    callsHint: 'Üyeler sesli sohbete katılabilir.', slowHint: 'İki mesaj arasındaki en kısa süre.',
    expiryHours: 'Sona erme süresi (saat)', temporaryHint: 'Seçtiğin süre dolunca silinir.', waiting: 'Sunucudan yanıt bekleniyor…',
    privateHint: 'Yalnızca davet edilen üyeler katılabilir.', template: 'Şablon', channelTopic: 'Konu',
    createRoom: 'Oda oluştur', joining: 'Katılınıyor…', creating: 'Oluşturuluyor…',
    noReply: 'Henüz yanıt gelmedi. Tekrar denemeden önce kanal listesine bak.',
    needCode: 'Bir kanal kodu gir.', needName: 'Bir kanal adı gir.',
    connectionLost: 'Bağlantı kesildi. Yeniden bağlanıp kanalı kontrol ettikten sonra tekrar dene.',
    menu: 'Sunucu menüsü', add: 'Kanal ekle', close: 'Kapat', accountMenu: 'Hesap menüsü', editProfile: 'Profili düzenle',
    serverActions: 'Sunucu listesi işlemleri', serverSettings: 'Sunucu ayarları', createChannel: 'Kanal oluştur',
    notifications: 'Sunucu bildirimleri', topic: 'Kanal konusunu düzenle', rotate: 'Kanal kodunu yenile',
    joinRoom: 'Ses odasına katıl', moveMember: 'Ses odasına taşı…', permissions: 'Roller ve yetkiler', speaking: 'Konuşuyor', voiceRooms: 'Sesli odalar', emptyVoice: 'Henüz sesli oda yok.', addVoice: 'Sesli oda oluştur',
    callActions: 'Diğer arama işlemleri', voiceSettings: 'Ses ayarları', soundboard: 'Ses panosu', listenTogether: 'Birlikte dinle',
    participant: 'Katılımcı', enlargePerson: '{name} için kutucuğu büyüt', enlargeCamera: '{name} için kamerayı büyüt',
    enlargeScreen: '{name} için ekranı büyüt', popCamera: '{name} için kamerayı ayrı pencerede aç', popScreen: '{name} için ekranı ayrı pencerede aç',
    returnCamera: '{name} için kamerayı geri getir', returnScreen: '{name} için ekranı geri getir', minimizeStreams: 'Yayınları küçült',
    showGrid: 'Izgaraya dön', closeCameras: 'Kameraları kapat', closeStreams: 'Yayınları kapat',
    callView: 'Arama görünümü', find: 'Sohbet bul', messages: 'Mesajlar',
    tools: 'Kanal işlemleri', noDM: 'Henüz sohbet yok. Mesaj göndermek için bir üyenin profilini aç.',
    roomEmpty: 'Henüz kimse yok. İlk sen katıl.', roomOne: '1 kişi burada', roomMany: '{n} kişi burada',
    channelStart: 'Bu kanalın başlangıcındasın.', dmStart: 'Bu sohbetin başlangıcındasın.',
    volume: 'Ses düzeyi', mute: 'Sustur', unmute: 'Sesini aç', connection: 'Bağlantı ayrıntıları',
    good: 'Bağlantı iyi', fair: 'Bağlantı dalgalı', poor: 'Bağlantı zayıf',
    people: 'Bağlı kişiler', alone: 'Henüz başka kimse yok', serverPing: 'Sunucu gecikmesi', voicePing: 'Ses gecikmesi',
    loss: 'Paket kaybı', jitter: 'Seğirme', route: 'Yol', server: 'Sunucu',
    direct: 'Doğrudan', relay: 'Aktarıcı (TURN)', mixed: 'Doğrudan ve aktarıcı',
    sideBySide: 'Paylaşılan ekranları birlikte göster',
    aloneTitle: 'Buraya ilk gelen sensin', aloneHint: 'Katılanlar burada görünür.', invite: 'Davet et',
    upload: 'Yükleme', download: 'İndirme', video: 'Gönderdiğin görüntü',
    limitBandwidth: 'bağlantı sınırlıyor', limitCpu: 'bilgisayar sınırlıyor',
    sfu: 'Sunucu üzerinden (ses aktarıcısı)', hardware: 'donanım', software: 'yazılım'
  })
});

// Cosmetic rules sit in :where() so any theme can restyle them; rules the
// layout needs in order to work at all keep their weight.
HabitatLayout.CSS = `
:where(:root) {
  --hb-text-xs: .75rem;
  --hb-text-sm: .875rem;
  --hb-text-md: 1rem;
  --hb-text-lg: 1.125rem;
  --hb-text-xl: 1.5rem;
  --hb-text-2xl: 2rem;
  --hb-text-display: clamp(1.625rem, 3vw, 2.25rem);
  --hb-stage-gap: .5rem;
  --hb-stage-pad: .75rem;
  --hb-stage-surface: var(--bg-tertiary);
  --radius: .5rem;
  --radius-sm: .375rem;
  --hb-ease: cubic-bezier(.2, .8, .2, 1);
  --hb-fast: .12s;
  --hb-base: .18s;
  --hb-radius-lg: .75rem;
  --hb-radius-xl: 1.25rem;
  --hb-radius-pill: 62.5rem;
  --hb-shadow-ink: rgba(0, 0, 0, .5);
  --hb-elev-popover: 0 .75rem 2rem var(--hb-shadow-ink);
  --hb-elev-dialog: 0 1.5rem 4rem var(--hb-shadow-ink);
  --hb-ring-hairline: inset 0 0 0 .0625rem color-mix(in srgb, var(--text-primary) 7%, transparent);
  --hb-ring-speaking: inset 0 0 0 .125rem var(--success), 0 0 0 .25rem color-mix(in srgb, var(--success) 25%, transparent);
  --hb-scrim: rgba(0, 0, 0, .6);
  --hb-media-surface: #0b0c0f;
  --hb-media-plate: rgba(8, 9, 12, .78);
  --hb-media-plate-hover: rgba(40, 44, 50, .92);
  --hb-on-media: #fff;
  --hb-on-media-fill: rgba(255, 255, 255, .12);
}

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
   Opacity, translate, scale and rotate only. Haven's reduce-motion
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
  animation: habitat-layout-drop var(--hb-fast) var(--hb-ease);
}
html[data-habitat-layout] [data-habitat-menu-button] > [data-habitat-icon] {
  transition: rotate var(--hb-base) var(--hb-ease);
}
html[data-habitat-layout] [data-habitat-menu-button][aria-expanded="true"] > [data-habitat-icon] {
  rotate: 180deg;
}
html[data-habitat-layout] :where([data-habitat-menu] button, [data-habitat-tools] > button,
  [data-habitat-menu-button], [data-habitat-add-button], [data-habitat-dialog-close]) {
  transition: scale var(--hb-fast) var(--hb-ease);
}
html[data-habitat-layout] :is([data-habitat-menu-button], [data-habitat-add-button],
  [data-habitat-dialog-close], [data-habitat-tools] > button):active {
  scale: 0.94;
}
[data-habitat-dialog]:not([hidden]) {
  animation: habitat-layout-fade var(--hb-base) var(--hb-ease);
}
[data-habitat-dialog]:not([hidden]) > [data-habitat-dialog-panel] {
  animation: habitat-layout-pop var(--hb-base) var(--hb-ease);
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
  padding-inline-end: 2rem;
}
html[data-habitat-layout] :where([data-habitat-header] .brand-text) {
  font-family: var(--font-heading);
  font-size: var(--hb-text-lg);
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
/* Stretch the native button's hit area across the brand. The drawer close
   button has its own higher stacking order. */
html[data-habitat-layout] [data-habitat-menu-button] {
  position: absolute; inset: 0; width: 100%; height: 100%; justify-content: end; padding-inline: .75rem;
  background: transparent;
}
/* On a phone Haven's own close button sits in the header's top right corner. */
@media (max-width: 768px) {
  html[data-habitat-layout] [data-habitat-header] > .brand { padding-inline-end: 4.75rem; }
  html[data-habitat-layout] [data-habitat-menu-button] {
    width: calc(100% - 2.75rem);
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
  padding: 0.25rem;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: var(--bg-card);
  box-shadow: var(--hb-elev-popover);
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
  gap: 0.75rem;
  width: 100%;
  height: 2.25rem;
  min-height: 2.25rem;
  margin: 0;
  padding: 0 0.75rem;
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
/* Haven still sets invite permission on the original panel. The button already has a text label. */
html[data-habitat-layout]:has(#sidebar-invite-panel[style*="none"]) [data-habitat-menu] > #right-btn-invite-popout,
[data-habitat-menu] > #right-btn-invite-popout::after { display: none; }
#sidebar-invite-panel[data-habitat-emptied] { padding: 0; border: 0; }
html[data-habitat-layout] :is([data-habitat-menu="rail"], [data-habitat-menu="call"]) {
  position: fixed; right: auto; width: min(14rem, 95vw); max-height: 90dvh; overflow: auto; z-index: 100001;
}
html[data-habitat-layout] [data-haven-region="account"] { position: relative; }
html[data-habitat-layout] [data-habitat-menu="account"] { top: auto; bottom: 100%; }
html[data-habitat-layout] :is(#mobile-srv-add-btn, #mobile-server-add-btn, #mobile-settings-btn),
html[data-habitat-layout] [data-habitat-menu] button[hidden] { display: none; }
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
  font-size: var(--hb-text-md);
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
  padding: 0.25rem 0.5rem;
  border-top: 1px solid var(--border);
  overflow-x: auto;
}
html[data-habitat-layout-desktop="1"] :where([data-haven-region="sidebar-footer"] > [data-haven-region="voice-settings"]) {
  max-height: 45vh;
  overflow-y: auto;
}

/* ── Add a channel dialog ── */
[data-habitat-dialog] {
  position: fixed;
  inset: 0;
  /* Between the navigation drawer and Haven's saved-template confirmation. */
  z-index: 100001;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: var(--hb-scrim);
}
[data-habitat-dialog][hidden], [data-habitat-dialog] [hidden] { display: none; }
[data-habitat-dialog-panel] {
  box-sizing: border-box;
  width: min(30rem, 100%);
  max-height: calc(100vh - 2rem);
  max-height: calc(100dvh - 2rem);
  overflow: auto;
  overscroll-behavior: contain;
  padding: 1.5rem;
  border: .0625rem solid var(--border);
  border-radius: var(--hb-radius-lg);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: .875rem;
  box-shadow: var(--hb-elev-dialog);
}
[data-habitat-dialog-top], [data-habitat-dialog] footer, [data-habitat-advanced] {
  display: flex; align-items: center; justify-content: space-between; gap: .5rem;
}
[data-habitat-dialog-top] > h2 {
  margin: 0; font: 600 1.5rem/1.25 var(--font-heading); letter-spacing: -.02em;
}
[data-habitat-dialog] [role="tablist"] {
  display: flex; gap: .25rem; padding: .25rem; margin: 1rem 0;
  border-radius: var(--radius); background: var(--bg-tertiary);
}
[data-habitat-dialog] :is([role="tab"], [role="radio"], [data-habitat-advanced], footer button) {
  font-family: inherit; font-size: .875rem; line-height: 1.4; cursor: pointer;
}
[data-habitat-dialog] [role="tab"] {
  flex: 1; padding: .5rem; border: 0; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-secondary);
}
[data-habitat-dialog] [role="tab"][aria-selected="true"] {
  background: var(--bg-card); color: var(--text-primary); font-weight: 600;
}
[data-habitat-dialog-body] > [data-haven-region] { margin: 0; padding: 0; border: 0; }
[data-habitat-dialog] fieldset {
  display: grid; gap: .5rem; min-width: 0; border: 0; padding: 0; margin: 0;
}
[data-habitat-dialog] [role="radiogroup"] {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; margin-bottom: .5rem;
}
[data-habitat-dialog] [role="radio"] {
  display: grid; align-content: start; justify-items: start; gap: .25rem;
  padding: .75rem; text-align: start; border: .0625rem solid var(--border);
  border-radius: var(--radius); background: var(--bg-secondary); color: var(--text-primary);
}
[data-habitat-dialog] [role="radio"] > svg { margin-bottom: .25rem; color: var(--text-secondary); }
[data-habitat-dialog] [role="radio"]:hover { border-color: var(--border-light); }
[data-habitat-dialog] [role="radio"][aria-checked="true"] {
  border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--bg-card));
}
[data-habitat-dialog] [role="radio"][aria-checked="true"] > svg { color: var(--accent); }
[data-habitat-dialog] small {
  font-size: .75rem; line-height: 1.4; color: var(--text-secondary);
}
[data-habitat-dialog] label[for] { font-weight: 600; }
[data-habitat-entry] { position: relative; }
[data-habitat-entry] > span {
  position: absolute; inset-inline-start: .75rem; inset-block: 0;
  display: grid; align-items: center; color: var(--text-muted); pointer-events: none;
}
[data-habitat-dialog] :is(input[type="text"], select, input[type="number"]) {
  min-width: 0; box-sizing: border-box; padding: .5rem .75rem;
  border: .0625rem solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-input); color: var(--text-primary); font: inherit;
}
[data-habitat-dialog] input[type="text"] { width: 100%; }
[data-habitat-entry] > span + input[type="text"] { padding-inline-start: 2.5rem; }
[data-habitat-dialog] input[aria-invalid="true"] { border-color: var(--danger); }
[data-habitat-dialog] [role="alert"] { color: var(--danger); }
[data-habitat-dialog] :is(button, input, select):focus-visible {
  outline: .125rem solid var(--accent); outline-offset: .125rem;
}
[data-habitat-dialog] .checkbox-row { min-height: 2.5rem; }
[data-habitat-switch-copy] { flex: 1; display: grid; gap: .125rem; }
[data-habitat-switch-copy] > span:has([data-i18n]) { font-size: 0; }
[data-habitat-switch-copy] .haven-glyph { display: none; }
[data-habitat-switch-copy] [data-i18n] { font-size: .875rem; color: var(--text-primary); }
[data-habitat-dialog] .checkbox-row > :is(input[role="switch"], select) {
  order: 1; margin-inline-start: auto; accent-color: var(--accent);
}
[data-habitat-advanced] {
  width: 100%; padding: .5rem 0; border: 0; border-top: .0625rem solid var(--border);
  background: transparent; color: var(--text-secondary); font-weight: 600;
}
[data-habitat-advanced] > svg { transition: rotate var(--hb-fast) var(--hb-ease); }
[data-habitat-advanced][aria-expanded="true"] > svg { rotate: 180deg; }
#habitat-channel-options:not([hidden]) { display: grid; gap: .5rem; }
#habitat-channel-options > label[for]:not(:first-child) { margin-top: .5rem; }
[data-habitat-dialog] footer {
  justify-content: flex-end; border-top: .0625rem solid var(--border);
  margin-top: .75rem; padding-top: 1rem;
}
[data-habitat-dialog] footer button {
  min-height: 2.5rem; padding: .5rem 1rem; border: 0; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-secondary);
}
[data-habitat-dialog] footer button:hover { background: var(--bg-hover); }
[data-habitat-dialog] footer button[type="submit"] {
  background: var(--accent); color: var(--accent-text); font-weight: 600;
}
[data-habitat-dialog] footer button[type="submit"]:hover { background: var(--accent-hover); }
[data-habitat-dialog] footer button:disabled { opacity: .65; cursor: wait; }
@media (max-width: 479px) {
  [data-habitat-dialog] { align-items: end; padding: .5rem; }
  [data-habitat-dialog-panel] { width: 100%; padding: 1rem; padding-bottom: max(1rem, env(safe-area-inset-bottom)); }
  [data-habitat-dialog] [role="radiogroup"] { grid-template-columns: 1fr; }
  [data-habitat-dialog] [role="radio"] {
    grid-template-columns: auto 1fr; align-items: center; column-gap: .75rem;
  }
  [data-habitat-dialog] [role="radio"] > svg { grid-row: span 2; margin: 0; }
}
html[data-habitat-layout] [data-haven-region="context-sidebar"] > [data-haven-region="voice-roster"],
[data-habitat-roster-home], [data-habitat-call-view][hidden] { display: none; }
[data-habitat-call-view] {
  display: grid; place-items: center; width: 2.25rem; height: 2.25rem; flex: none;
  border: 0; border-radius: var(--radius-sm); color: var(--text-secondary); background: transparent; cursor: pointer;
}
[data-habitat-call-view][aria-pressed="true"] { background: var(--bg-active); color: var(--accent); }
html[data-habitat-layout="compact"] [data-habitat-roster-home]:not(:empty) { display: block; position: relative; min-height: 2.5rem; }
[data-habitat-roster-home]:not(:empty) #mobile-right-close { margin-inline-start: auto; }
[data-habitat-call-stage] {
  --hb-stage-top: var(--hb-stage-pad);
  position: relative; flex: none; height: clamp(11rem, 42dvh, 30rem); min-height: 0; overflow: hidden;
  display: grid; gap: var(--hb-stage-gap); place-content: center;
  grid-template-columns: repeat(var(--hb-stage-cols, 2), calc((var(--hb-tile-w, 16rem) - var(--hb-stage-gap)) / 2));
  grid-auto-rows: var(--hb-tile-h, 9rem);
  padding: var(--hb-stage-top) var(--hb-stage-pad) var(--hb-stage-pad);
  background: var(--hb-stage-surface); border-bottom: 1px solid var(--border);
}
/* A phone shows its own mute and deafen buttons in the roster header; they
   get a row of their own so they never sit on someone's picture. */
html:not([data-habitat-layout-desktop="1"]) [data-habitat-call-stage]:has(.voice-header-actions > :not([style*="none"])) { --hb-stage-top: 2.75rem; }
[data-habitat-call-stage][data-habitat-focus] { height: clamp(14rem, 60dvh, 44rem); align-content: end; }
/* Closing the stage brings back any history from before the room became voice-only. */
[data-haven-region="message-area"] > [data-habitat-call-stage][data-habitat-voice-room] { flex: 1 1 auto; height: auto; }
[data-haven-region="message-area"]:has(> [data-habitat-call-stage][data-habitat-voice-room]) > [data-haven-region="message-list"] { display: none; }
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
  overflow: hidden; border-radius: var(--hb-radius-lg); cursor: pointer;
  box-shadow: var(--hb-ring-hairline); transition: none;
}
[data-habitat-call-stage] :is(.webcam-tile, .screen-share-tile) { max-width: none !important; background: var(--hb-media-surface); }
[data-habitat-call-stage] :is(.webcam-tile, .screen-share-tile) > video {
  width: 100%; height: 100%; max-height: none !important; object-fit: cover;
}
[data-habitat-call-stage] .screen-share-tile > video { object-fit: contain; }
[data-habitat-call-stage] :is(.voice-user-item, .webcam-tile, .screen-share-tile):focus-visible {
  outline: .125rem solid var(--accent); outline-offset: -.1875rem;
}
[data-habitat-call-stage] + [data-haven-region="voice-settings"] {
  max-height: 40dvh; overflow-y: auto; overscroll-behavior: contain;
}
[data-habitat-call-stage] [data-habitat-focused] { position: absolute; z-index: 1; }
[data-habitat-call-stage] > [data-habitat-leave] { position: absolute; z-index: 0; pointer-events: none; }
[data-habitat-alone] {
  position: absolute; inset: auto 1rem clamp(5.5rem, 20%, 12rem); z-index: 2; display: grid; justify-items: center; gap: .25rem;
  color: var(--text-secondary); font-size: .875rem; text-align: center; pointer-events: none;
}
[data-habitat-alone][hidden], [data-habitat-alone] > [hidden] { display: none; }
[data-habitat-alone] > strong { color: var(--text-primary); font-size: 1rem; }
[data-habitat-alone] > button {
  margin-top: .5rem; min-height: 2.25rem; padding: 0 1rem; border: 0; border-radius: var(--radius-sm);
  color: var(--accent-text); background: var(--accent); font: inherit; font-weight: 600; cursor: pointer; pointer-events: auto;
}
html[data-habitat-layout="compact"] [data-habitat-alone] { bottom: 1.25rem; }
[data-habitat-leave] { pointer-events: none; }
[data-habitat-stage-spread] {
  position: absolute; inset: calc(var(--hb-stage-top) + .5rem) auto auto 50%; z-index: 3; translate: -50%;
  display: grid; place-items: center; width: 2.25rem; height: 2.25rem; padding: 0;
  border: 0; border-radius: var(--radius); color: var(--hb-on-media); background: var(--hb-media-plate); cursor: pointer;
}
[data-habitat-stage-spread][hidden] { display: none; }
[data-habitat-stage-controls] {
  position: absolute; inset: auto auto 1rem 50%; z-index: 4; translate: -50%;
  display: flex; gap: .5rem; padding: .25rem; border-radius: var(--hb-radius-pill); background: var(--hb-media-plate);
  opacity: 0; pointer-events: none;
}
[data-habitat-call-stage][data-habitat-focus] > [data-habitat-stage-controls] {
  bottom: calc(var(--hb-stage-pad) + var(--hb-tile-h, 0rem) + var(--hb-stage-gap) + .75rem);
}
[data-habitat-stage-controls]:has(> [aria-expanded="true"]),
[data-habitat-call-stage]:is(:hover, :focus-within) > [data-habitat-stage-controls] { opacity: 1; pointer-events: auto; }
[data-habitat-stage-controls] > button {
  display: grid; place-items: center; width: 2.75rem; height: 2.75rem; padding: 0;
  border: 0; border-radius: 50%; color: var(--hb-on-media); background: var(--hb-on-media-fill); cursor: pointer;
}
html[data-habitat-layout] [data-habitat-menu="call"] button:disabled { opacity: .45; cursor: default; }
[data-habitat-stage-controls] > button:disabled { opacity: .45; cursor: default; scale: 1; }
[data-habitat-stage-controls] > button[hidden] { display: none; }
[data-habitat-stage-controls] > button[aria-pressed="true"] { color: var(--danger-text); background: var(--danger); }
[data-habitat-stage-controls] > :is([data-habitat-for="voice-cam-btn"], [data-habitat-for="screen-share-btn"])[aria-pressed="true"] {
  color: var(--accent-text); background: var(--accent);
}
[data-habitat-stage-controls] > [data-habitat-for="voice-bar-leave-btn"] { color: var(--danger-text); background: var(--danger); }
[data-habitat-stage-spread][aria-pressed="true"] { color: var(--accent-text); background: var(--accent); }
[data-habitat-call-stage] .voice-user-item {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .25rem;
  padding: .75rem; background: var(--bg-active);
}
[data-habitat-call-stage] .voice-user-item.talking { box-shadow: var(--hb-ring-speaking, inset 0 0 0 .125rem var(--success)); }
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
  position: fixed; z-index: 100010; box-sizing: border-box; padding: .75rem;
  border: 1px solid var(--border-light); border-radius: var(--hb-radius-lg);
  color: var(--text-primary); background: var(--bg-card); box-shadow: var(--hb-elev-popover); font-size: var(--hb-text-xs);
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
  display: grid; grid-template-columns: auto minmax(0, 1fr) 3rem; align-items: center; gap: .5rem;
  color: var(--text-secondary); font-size: var(--hb-text-sm);
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
/* The picture is pinned to the face rather than sized as a grid item: there a
   percentage height has nothing definite to measure against, and a photo that
   is not square kept its own shape and hung out of the circle as an oval. */
[data-habitat-call-avatar] > [data-habitat-call-photo] {
  position: absolute; inset: 0; width: 100%; height: 100%; border-radius: inherit; object-fit: cover;
}
[data-habitat-call-stage] .user-item-name { flex: none; max-width: 100%; font-weight: 600; }
body.is-guest [data-habitat-inbox] { display: none; }
[data-habitat-inbox] { color: var(--text-secondary); border: 0; }
[data-habitat-inbox] svg { width: 1.375rem; height: 1.375rem; }
[data-habitat-nav] > [data-habitat-inbox] { width: 2.75rem; height: 2.75rem; }
[data-habitat-nav]:has(> [data-habitat-inbox]) { display: flex; align-items: center; }
[data-haven-page="app"] [data-habitat-inbox][aria-pressed="true"] {
  background: var(--accent); color: var(--accent-text); border-radius: var(--hb-radius-lg);
}
[data-habitat-nav] {
  display: grid;
  gap: .5rem;
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
  gap: .5rem;
  width: 100%;
  min-height: 2.25rem;
  padding: .25rem .75rem;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: var(--bg-tertiary);
  text-align: start;
}
[data-habitat-room-members] {
  display: inline-flex; align-items: center; justify-content: center; gap: .25rem;
  border: 0; padding: .25rem; border-radius: var(--radius); color: var(--text-secondary); background: var(--bg-hover);
}
[data-habitat-room-members] { flex: none; font: 600 var(--hb-text-sm)/1 var(--font-main); cursor: pointer; }
[data-habitat-room-members][hidden] { display: none; }
/* Haven forces its mobile button visible even when the roster already has a trigger. */
[data-habitat-room-members]:not([hidden]) + #mobile-users-btn { display: none !important; }
[data-habitat-stack] { display: inline-flex; padding-inline-start: .25rem; }
[data-habitat-stack] [data-habitat-face] { width: 1.5rem; height: 1.5rem; margin-inline-start: -.25rem; box-shadow: 0 0 0 .125rem var(--bg-hover); }
@media (max-width: 480px) {
  [data-habitat-stack] [data-habitat-face]:not(:first-child) { display: none; }
}
[data-habitat-face] {
  position: relative; display: inline-grid; place-items: center; flex: none;
  width: 1.875rem; height: 1.875rem; overflow: hidden; border-radius: 50%;
  background: color-mix(in srgb, var(--habitat-avatar-color) 45%, var(--bg-tertiary));
  color: var(--text-primary); font: 700 .9375rem/1 var(--font-main);
}
[data-habitat-face]:has(> .pfp-border) { overflow: visible; }
[data-habitat-face] > img { border-radius: inherit; }
[data-habitat-move-member] { grid-column: 1 / -1; width: 100%; min-height: 2.5rem; }

[data-habitat-rooms] .channel-voice-user[draggable="true"] { cursor: grab; }
[data-habitat-rooms] .channel-item[data-habitat-drop] { outline: .125rem solid var(--accent); outline-offset: -.125rem; }
[data-habitat-face] > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.dm-item > [data-habitat-dm-avatar] + .channel-hash { display: none; }
[data-habitat-count]:not(:empty) {
  position: absolute; inset: auto 0 0 auto; border-radius: var(--hb-radius-pill); font-size: var(--hb-text-xs); line-height: 1;
  padding: .125rem .25rem; background: var(--danger); color: var(--danger-text);
}
/* A single pane uses the whole split, even when Haven saved a fractional flex for it. */
@media (min-height: 551px) {
  [data-channel-scroll="separate"] #sidebar-split[data-habitat-list] { display: grid; grid-template-rows: minmax(0, 1fr); }
}
#sidebar-split[data-habitat-list="channels"] > [data-haven-region="direct-messages"],
#sidebar-split[data-habitat-list="messages"] > [data-haven-region="channels"],
[data-habitat-list] > .sidebar-split-handle,
[data-habitat-dm-empty] { display: none; }
[data-habitat-list="messages"]:has(> #dm-pane[style*="display: none"]) > [data-habitat-dm-empty] {
  display: block; margin: .5rem 1rem; color: var(--text-secondary); line-height: 1.5;
}
/* Settings owns embed size and channel actions owns the empty topic editor. */
html[data-habitat-layout] #channel-topic-bar[data-empty-topic],
html[data-habitat-layout] .lp-header .lp-size { display: none; }
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
  display: grid; min-width: min(14rem, 82vw); padding: .25rem;
  background: var(--bg-card); border: 1px solid var(--border-light); border-radius: var(--radius);
  box-shadow: var(--hb-elev-popover);
}
[data-habitat-channel-menu] button.icon-btn {
  justify-content: start; align-items: center; gap: .75rem; padding: .5rem .75rem;
  width: 100%; height: auto; min-height: 2.25rem; opacity: 1; text-align: start;
}
[data-habitat-channel-menu] button::after { content: attr(aria-label); font: 500 .875rem/1.25 var(--font-main); }
/* Haven uses the pins button's trailing pseudo-element for its unread dot. */
[data-habitat-channel-menu] #pinned-toggle-btn.has-pins::before {
  content: attr(aria-label); order: 1; font: 500 .875rem/1.25 var(--font-main);
}
/* The way into the channel's call, moved here from the members drawer on a
   phone. It carries its own words, and the header's icon-only rule for voice
   buttons must not blank them. */
html[data-habitat-layout] [data-habitat-channel-menu] > #voice-join-mobile {
  justify-content: start; align-items: center; width: 100%; min-height: 2.25rem; margin: 0; padding: .5rem .75rem;
  border: 0; border-radius: var(--radius-sm); color: var(--accent); background: transparent; font: 600 .875rem/1.25 var(--font-main);
}
html[data-habitat-layout] [data-habitat-channel-menu] > #voice-join-mobile > span {
  display: inline-flex; align-items: center; gap: .75rem; font-size: inherit;
}
[data-habitat-channel-management] {
  display: grid; border-block-start: 1px solid var(--border); padding-block-start: .25rem; margin-block-start: .25rem;
}
[data-habitat-channel-management]:not(:has(button:not([hidden]):not([style*="none"]))),
[data-habitat-channel-management]:has(#copy-code-btn[style*="none"]) .channel-code-tag,
[data-habitat-channel-menu] button[hidden] { display: none; }
[data-habitat-channel-menu] .channel-code-tag:not(:empty) { margin: .25rem .5rem; width: fit-content; }
[data-habitat-channel-menu] .channel-code-tag:empty, html[data-habitat-layout] .header-actions-divider { display: none; }
html[data-habitat-layout] .channel-header:has(details[open]) { z-index: 65; overflow: visible; }
[data-habitat-intro] { display: none; }
[data-habitat-intro="voice"]:not([hidden]),
[data-haven-region="message-list"][data-history="empty"]:not(:has(> :not(#msg-more-btn))) + [data-habitat-intro]:not([hidden]) {
  display: block; flex: none; padding: 1rem 1.5rem; color: var(--text-primary);
}
[data-habitat-intro] > span {
  display: grid; place-items: center; width: 3.25rem; height: 3.25rem;
  background: var(--bg-active); border-radius: 50%; font: 600 1.875rem/1 var(--font-main);
}
[data-habitat-intro] h2 { margin: .75rem 0 .25rem; overflow-wrap: anywhere; font: 700 var(--hb-text-xl)/1.15 var(--font-heading); }
[data-habitat-join-room] { margin-block-start: .5rem; min-height: 2.5rem; }
[data-habitat-join-room][hidden] { display: none; }
[data-habitat-intro] p { margin: 0; color: var(--text-secondary); }
[data-habitat-room-people][hidden] { display: none; }
/* A voice room has no history to sit under, so its way in takes the middle
   of the room instead of a corner, and the empty list gives it the space.
   The id, the layout mark and the doubled attribute are there to outweigh
   the rule above, whose :not(#msg-more-btn) counts as an id. */
html[data-habitat-layout] #message-area > [data-habitat-intro="voice"][data-habitat-intro]:not([hidden]) {
  display: flex; flex: 1 1 auto; flex-direction: column; align-items: center; justify-content: center;
  min-height: 0; padding: 1.5rem; text-align: center;
}
[data-haven-region="message-list"]:has(+ [data-habitat-intro="voice"]:not([hidden])) { display: none; }
[data-habitat-intro="voice"] > span { width: 4.5rem; height: 4.5rem; }
[data-habitat-intro="voice"] h2 { margin: 1rem 0 .25rem; }
[data-habitat-intro="voice"] [data-habitat-join-room] { margin-block-start: 1rem; min-height: 2.75rem; padding-inline: 1.5rem; font-size: 1rem; }
/* The room's own button is the way in; the header's copy of it would be a
   second one a hand's width away. Haven sets its display inline, so it is
   taken out of the flow rather than hidden by display. */
html[data-habitat-layout] body:has([data-habitat-intro="voice"]:not([hidden]) > [data-habitat-join-room]:not([hidden])) .channel-header #voice-join-btn {
  position: absolute; visibility: hidden; pointer-events: none;
}
/* Let header popovers paint above the conversation even when details is closed. */
@media (max-width: 480px) {
  html[data-habitat-layout] .channel-header { overflow: visible; }
}
html[data-habitat-layout] .channel-header:has(#e2e-dropdown[style*="display: block"]) {
  overflow: visible; z-index: 65;
}
@media (min-width: 769px) {
  /* Above the phone breakpoint Haven supplies the join action in the header. */
  html[data-habitat-layout] #voice-join-mobile { display: none; }
}
@media (min-width: 769px) and (max-width: 900px) {
  html[data-habitat-layout="compact"] #mobile-right-close { display: flex; }
}
/* A voice room has nothing to search, and on a phone its name needs the
   room, so the search button is only brought back for text channels. */
@media (max-width: 768px) {
  /* Limit the banner band even when Branding sets its preferred height inline. */
  html[data-habitat-layout] .main.has-banner:not(.banner-mode-shaded):not(.banner-mode-minimal):not(.banner-mode-transparent) > #server-banner-display {
    max-height: 3.25rem;
  }
  html[data-habitat-layout="compact"] #mobile-server-dropdown { display: none; }
  html[data-habitat-layout] #header-actions-box[style*="display: flex"] { display: flex !important; padding: 0; gap: 0; }
  html[data-habitat-layout] .channel-header:not(:has(#channel-header-name[data-habitat-voice-title])) #header-actions-box #search-toggle-btn,
  html[data-habitat-layout] [data-habitat-channel-menu] #pinned-toggle-btn,
  html[data-habitat-layout] [data-habitat-channel-menu] #copy-code-btn[style*="inline-flex"] { display: inline-flex !important; }
  [data-habitat-channel-tools] summary, html[data-habitat-layout] #search-toggle-btn {
    width: 2.5rem; height: 2.5rem; justify-content: center; align-items: center;
  }
  [data-habitat-channel-menu] { max-height: 65dvh; overflow: auto; }
}
`;

if (typeof module !== 'undefined') module.exports = HabitatLayout;
if (typeof _win !== 'undefined') _win.HabitatLayout = HabitatLayout;
