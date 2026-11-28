// ── Mentions and replies (the @ button in the account bar) ──────────────────
// Clicking @ opens the search panel on "mentions:me": every message in a
// channel you can open that @mentions you or replies to you, newest first,
// each one a click away (src/mentionFilter.js does the matching). The button
// also counts mentions and replies you have not seen yet. Seeing them means
// opening the list, opening that channel, or reading it on another device.
// DMs are left out: they are end-to-end encrypted and notify on their own.

const UNSEEN_KEY = 'haven_unseen_mentions';
const UNSEEN_CAP = 99;
const SEEN_UPTO_KEY = 'haven_mentions_seen_upto';

export default {

_mentionsInit() {
  try { this._unseenMentions = JSON.parse(localStorage.getItem(UNSEEN_KEY) || '[]'); }
  catch { this._unseenMentions = []; } // private mode or a damaged value: start from none
  if (!Array.isArray(this._unseenMentions)) this._unseenMentions = [];
  document.getElementById('mentions-btn')?.addEventListener('click', () => this._mentionsOpen());
  this._mentionsRenderBadge();
},

_mentionsPersist() {
  try { localStorage.setItem(UNSEEN_KEY, JSON.stringify(this._unseenMentions)); }
  catch { /* private mode: the count still works until the page closes */ }
  this._mentionsRenderBadge();
},

_mentionsRenderBadge() {
  const badge = document.getElementById('mentions-btn-count');
  if (!badge) return;
  const n = (this._unseenMentions || []).length;
  badge.textContent = n >= UNSEEN_CAP ? `${UNSEEN_CAP}+` : String(n);
  badge.style.display = n ? '' : 'none';
  document.getElementById('mentions-btn')?.classList.toggle('mentions-btn-unseen', n > 0);
},
_mentionsSeenUpTo(next) {
  try {
    if (next !== undefined) localStorage.setItem(SEEN_UPTO_KEY, String(next));
    return Number(localStorage.getItem(SEEN_UPTO_KEY)) || 0;
  } catch { return next || 0; } // private mode: storage is unavailable, count from what this page saw
},
// Habitat fork: opening the @ list acknowledges the account badge. Channel badges last until read.
// The server counts personal mentions and replies. @everyone, @here and role mentions stay plain unread.
_channelMentionSet(code) {
  this._channelMentionIds ||= Object.create(null);
  return this._channelMentionIds[code] ||= new Set();
},
_mentionCountFor(code) {
  const ids = this._channelMentionIds?.[code];
  if (!ids?.size) return 0;
  const ch = this.channels?.find(c => c.code === code);
  return ch && !ch.is_dm && (this.unreadCounts?.[code] ?? ch.unreadCount) > 0 ? ids.size : 0;
},
_setMentionBadge(badge, code) {
  const count = this._mentionCountFor(code);
  if (count) badge.dataset.mentions = count >= UNSEEN_CAP ? '99+' : String(count);
  else delete badge.dataset.mentions;
},
_mentionsMerge(channels) {
  const upTo = this._mentionsSeenUpTo();
  const list = this._unseenMentions || (this._unseenMentions = []);
  const viewing = document.visibilityState === 'visible' ? this.currentChannel : null;
  for (const ch of channels || []) {
    if (ch.is_dm || (this.unreadCounts?.[ch.code] ?? ch.unreadCount) === 0) {
      delete this._channelMentionIds?.[ch.code];
    } else if (Array.isArray(ch.unreadMentionIds) && ch.unreadMentionIds.length) {
      const ids = this._channelMentionSet(ch.code);
      for (const id of ch.unreadMentionIds) ids.add(id);
    }
  }
  const fresh = (channels || []).filter(ch => !ch.is_dm && ch.code !== viewing && Array.isArray(ch.unreadMentionIds))
    .flatMap(ch => ch.unreadMentionIds.filter(id => id > upTo && !list.some(m => m.id === id)).map(id => ({ c: ch.code, id })));
  if (!fresh.length) return;
  list.push(...fresh);
  list.sort((a, b) => a.id - b.id);
  if (list.length > UNSEEN_CAP) list.splice(0, list.length - UNSEEN_CAP);
  this._mentionsPersist();
},

// Same test the list uses: @yourname as a whole word, or a reply to you.
_mentionsIsForMe(message) {
  if (!message || !this.user) return false;
  if (message.replyContext && message.replyContext.user_id === this.user.id) return true;
  const me = (this.user.username || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !!me && new RegExp(`(?<![\\w@])@${me}(?!\\w)`, 'i').test(message.content || '');
},

// Called for a new message from someone else that you are not looking at.
_mentionsCount(message, channelCode) {
  const ch = (this.channels || []).find(c => c.code === channelCode);
  if (!ch || ch.is_dm || !this._mentionsIsForMe(message)) return;
  // Habitat fork: update the row even if the account badge already knows this ID.
  this._channelMentionSet(channelCode).add(message.id);
  this._updateBadge(channelCode);
  const list = this._unseenMentions || (this._unseenMentions = []);
  if (list.some(m => m.id === message.id)) return;
  list.push({ c: channelCode, id: message.id });
  if (list.length > UNSEEN_CAP) list.splice(0, list.length - UNSEEN_CAP);
  this._mentionsPersist();
},

// Opening a channel, or reading it elsewhere, counts its mentions as seen.
_mentionsSeenInChannel(channelCode, upToId) {
  const ch = (this.channels || []).find(c => c.code === channelCode);
  if (ch && !ch.is_dm) this._mentionsHome = channelCode;
  const list = this._unseenMentions || [];
  // Habitat fork: another device can read only part of the channel while the @ list is empty.
  const ids = this._channelMentionIds?.[channelCode];
  if (ids) {
    for (const id of ids) if (!upToId || id <= upToId) ids.delete(id);
    if (!ids.size) delete this._channelMentionIds[channelCode];
    this._updateBadge(channelCode);
  }
  const kept = list.filter(m => m.c !== channelCode || (upToId && m.id > upToId));
  if (kept.length === list.length) return;
  this._unseenMentions = kept;
  this._mentionsPersist();
},

// Habitat fork: bulk read advances the same account watermark as opening the @ list.
_acknowledgeMentions() {
  this._mentionsSeenUpTo(Math.max(this._mentionsSeenUpTo(), ...(this.channels || []).map(c => Number(c.latestMessageId) || 0), ...(this._unseenMentions || []).map(m => m.id)));
  this._unseenMentions = [];
  this._mentionsPersist();
},

async _mentionsOpen() {
  this._acknowledgeMentions();
  // The list lives in the server-wide search panel, which DMs do not use, so
  // from a DM step back into the last server channel first.
  const here = (this.channels || []).find(c => c.code === this.currentChannel);
  if (!here || here.is_dm) {
    const home = (this.channels || []).find(c => c.code === this._mentionsHome && !c.is_dm)
      || (this.channels || []).find(c => !c.is_dm);
    if (!home) return;
    await this.switchChannel(home.code);
  }
  const token = 'mentions:me';
  const sc = document.getElementById('search-container');
  if (sc) sc.style.display = 'flex';
  const input = document.getElementById('search-input');
  if (input) input.value = token;
  this._searchRun(token);
  this._sfpSync?.();
},

};
