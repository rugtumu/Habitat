// Habitat fork: row elements are disposable. Only the list and the identity of its current row survive a redraw.
(() => {
  const controls = 'button, a[href], input, select, textarea, summary, [tabindex], [contenteditable="true"]';
  let reverseTab = false;
  // A click on a row's text gives focus to the list, the nearest thing that
  // can take it. That is not someone entering the list by keyboard: treating
  // it as one moved focus to another row, jumped history to the newest
  // message and sent the next letters to that message instead of the composer.
  let pointer = false;
  document.addEventListener('keydown', event => { pointer = false; reverseTab = event.key === 'Tab' && event.shiftKey; }, true);
  document.addEventListener('pointerdown', () => { pointer = true; reverseTab = false; }, true);

  function bind(list) {
    const messages = list.id === 'messages';
    const selector = messages ? 'li[data-msg-id]' : '[role="listitem"]';
    let current, identity;
    const visible = row => row && !row.hidden && row.style.display !== 'none' && !row.closest('[hidden]');
    // The filtered tree makes rows in the category grid and voice directory siblings in visual order.
    const walker = messages ? null : document.createTreeWalker(list, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.hidden || node.style.display === 'none') return NodeFilter.FILTER_REJECT;
        return node.matches(selector) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    function sidebarStep(from, direction) {
      walker.currentNode = from;
      return walker[direction]();
    }
    function key(row) {
      const d = row.dataset;
      if (d.code) return ['data-code', d.code];
      if (d.msgId) return ['data-msg-id', d.msgId];
      if (d.userId) return ['data-user-id', d.userId];
      if (d.category) return ['data-category', d.category];
      if (d.tagName) return ['data-tag-name', d.tagName, d.parentCode];
      return ['dm-category', row.querySelector('.dm-category-name')?.textContent];
    }
    function remembered() {
      if (!identity) return;
      const [attr, value, parent] = identity;
      if (attr === 'dm-category') return Array.from(list.querySelectorAll('.dm-category-header'))
        .find(row => visible(row) && key(row)[1] === value);
      const owner = parent ? '[data-parent-code="' + CSS.escape(parent) + '"]' : '';
      const row = list.querySelector(selector + '[' + attr + '="' + CSS.escape(value) + '"]' + owner);
      if (visible(row)) return row;
    }
    function messageAt(start, forward) {
      for (let row = start; row; row = forward ? row.nextElementSibling : row.previousElementSibling) {
        if (row.matches(selector) && visible(row)) return row;
      }
    }
    function first() {
      return messages ? messageAt(list.lastElementChild, false) : sidebarStep(list, 'firstChild');
    }
    function release() {
      observer.disconnect();
      if (walker) walker.currentNode = list;
      if (current) {
        current.tabIndex = -1;
        if (!messages) current.querySelectorAll('button').forEach(button => { button.tabIndex = -1; });
      }
      current = null;
      list.tabIndex = 0;
    }
    function select(row, focus = true, preventScroll = false) {
      if (!row) return;
      if (current !== row) {
        release();
        current = row;
        identity = key(row);
        list.tabIndex = -1;
        row.tabIndex = 0;
        if (!messages) row.querySelectorAll('button').forEach(button => { button.tabIndex = 0; });
      }
      if (focus) row.focus({ preventScroll });
      observer.observe(list, { childList: true, subtree: !messages });
    }
    const observer = new MutationObserver(() => {
      // Appending history or refreshing a badge costs a connectivity check. Look up a key only on replacement.
      if (current?.isConnected) return;
      if (document.activeElement !== document.body && document.activeElement !== list) return release();
      const next = remembered() || first();
      if (next) select(next, true, true);
      else { release(); list.focus({ preventScroll: true }); }
    });
    list.addEventListener('focusin', event => {
      if (pointer && event.target === list) return;
      const row = event.target.closest(selector);
      if (event.target === list || (messages && row && reverseTab && !list.contains(event.relatedTarget))) {
        select(remembered() || first());
        if (!current) observer.observe(list, { childList: true });
      } else if (row && list.contains(row)) select(row, false);
    });
    list.addEventListener('focusout', event => {
      if (event.relatedTarget && !list.contains(event.relatedTarget)) release();
      else if (!event.relatedTarget) queueMicrotask(() => {
        if (current?.isConnected && !list.contains(document.activeElement)) release();
      });
    });

    // There can be links, polls and custom toolbars in history. Only inspect the current row on Tab.
    function tabMessage(event) {
      const items = [current, ...Array.from(current.querySelectorAll(controls)).filter(el =>
        !el.disabled && el.tabIndex >= 0 && el.getClientRects().length && getComputedStyle(el).visibility === 'visible')];
      const index = items.indexOf(event.target);
      if (index < 0) return;
      const next = items[index + (event.shiftKey ? -1 : 1)];
      if (next) { event.preventDefault(); next.focus(); return; }
      // Start the browser's native Tab outside history, including when the next stop is browser chrome.
      const edge = document.createElement('span');
      edge.tabIndex = -1;
      if (event.shiftKey) list.before(edge); else list.after(edge);
      edge.focus({ preventScroll: true });
      setTimeout(() => edge.remove(), 0);
    }
    function expand(row, open) {
      const people = row.nextElementSibling;
      if (row.hasAttribute('data-habitat-voice-room') && people?.classList.contains('channel-voice-users')) {
        const collapsed = window.app._collapsedVoicePeople ||= new Set();
        if (open) collapsed.delete(row.dataset.code); else collapsed.add(row.dataset.code);
        people.hidden = !open;
        row.setAttribute('aria-expanded', String(open));
        return;
      }
      const arrow = row.querySelector('.channel-collapse-arrow, .cat-collapse-arrow, .dm-category-arrow');
      if (arrow) {
        if (arrow.classList.contains('collapsed') === open) (arrow.classList.contains('channel-collapse-arrow') ? arrow : row).click();
        return;
      }
      if (open) return;
      const category = row.dataset.catGroup || row.dataset.catSubGroup;
      let header = category && list.querySelector('[data-category="' + CSS.escape(category) + '"]');
      if (list.id === 'dm-list' && !row.classList.contains('dm-pinned')) {
        header = row.previousElementSibling;
        while (header && !header.classList.contains('dm-category-header')) header = header.previousElementSibling;
      }
      if (header) { select(header); expand(header, false); }
    }
    list.addEventListener('keydown', event => {
      if (!current || event.defaultPrevented || event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return;
      if (messages && event.key === 'Tab') return tabMessage(event);
      if (event.target !== current) {
        // Space activates a focused action button before document-wide type-to-focus sees it.
        if (event.key === ' ' && event.target.closest('button')) event.stopPropagation();
        return;
      }
      const menu = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
      // Shift is left to the browser and to Haven: in particular Shift+Delete
      // does not delete here. From the keyboard a deletion always asks first.
      if (event.shiftKey && !menu) return;
      if (messages && window.getSelection()?.isCollapsed === false) return;
      const row = current;
      const k = event.key;
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k)) {
        const forward = k === 'ArrowDown' || k === 'Home';
        if (messages) {
          const start = k === 'Home' ? list.firstElementChild : k === 'End' ? list.lastElementChild
            : forward ? row.nextElementSibling : row.previousElementSibling;
          select(messageAt(start, forward));
        } else {
          if (k === 'Home') select(sidebarStep(list, 'firstChild'));
          else if (k === 'End') select(sidebarStep(list, 'lastChild'));
          else select(sidebarStep(row, forward ? 'nextSibling' : 'previousSibling'));
        }
      } else if (menu || (messages && k === 'Enter')) {
        if (event.repeat) { event.preventDefault(); return; }
        const bounds = row.getBoundingClientRect();
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: bounds.left, clientY: bounds.bottom }));
      } else if (!messages && (k === 'Enter' || k === ' ')) {
        if (!event.repeat) row.click();
      } else if (list.id !== 'online-users' && !messages && (k === 'ArrowLeft' || k === 'ArrowRight')) {
        expand(row, k === 'ArrowRight');
      } else if (messages && ['e', 'r', 'Delete'].includes(k)) {
        const action = { e: 'edit', r: 'reply', Delete: 'delete' }[k];
        const button = row.querySelector('.msg-toolbar button[data-action="' + action + '"]:not([hidden])');
        if (!button || button.disabled) return;
        if (!event.repeat) {
          button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
      } else return;
      event.preventDefault();
      event.stopPropagation();
    });
  }
  for (const id of ['channel-list', 'dm-list', 'online-users', 'messages']) bind(document.getElementById(id));
})();
