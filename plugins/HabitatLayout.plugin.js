/**
 * @name Habitat Layout
 * @description The layout people already know from other chat apps: your account, mute, deafen and settings sit bottom-left with the call controls above them, joining and creating a channel open from a + button instead of filling the sidebar, and the rest of the sidebar tools fold into the server name menu. On a phone the message box tools fold into one + button. Reversible, picked in Settings, Layout.
 * @author Habitat
 * @version 1.0.0
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
    if (fold === this._folded) return;
    this._folded = fold;
    const root = document.documentElement;
    if (fold) {
      root.setAttribute('data-compact-composer', '');
    } else {
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
    this._voiceObserver?.disconnect();
    this._voiceObserver = null;
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
  en: Object.freeze({ menu: 'Server menu', add: 'Add a channel', close: 'Close', supporters: 'Supporters' }),
  tr: Object.freeze({ menu: 'Sunucu menüsü', add: 'Kanal ekle', close: 'Kapat', supporters: 'Destekçiler' })
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
`;

if (typeof module !== 'undefined') module.exports = HabitatLayout;
if (typeof _win !== 'undefined') _win.HabitatLayout = HabitatLayout;
