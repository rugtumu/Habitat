'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createHarness } = require('./socketServerHarness');

const h = createHarness(3468, 'voice-move');
test.before(() => h.start());
test.after(() => h.stop());

test('delegated voice moves respect membership, capacity, rank and revocation', async t => {
  const owner = await h.register('admin');
  const moderator = await h.register('moderator');
  const member = await h.register('member');
  const admin = await h.connect(owner.token);
  const mod = await h.connect(moderator.token);
  const target = await h.connect(member.token);
  const db = new Database(path.join(h.dataDir, 'haven.db'));
  t.after(() => db.close());

  async function create(name) {
    const list = h.next(admin, 'channels-list', rooms => rooms.some(room => room.name === name));
    admin.emit('create-channel', { name });
    return (await list).find(room => room.name === name);
  }
  const from = await create('source'), to = await create('destination');
  const enroll = db.prepare('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)');
  for (const room of [from, to]) enroll.run(room.id, moderator.id);
  enroll.run(from.id, member.id);
  const joined = h.next(target, 'voice-existing-users', data => data.channelCode === from.code);
  target.emit('voice-join', { code: from.code });
  assert.ok(await joined);

  const move = () => mod.emit('voice-move-member', { from: from.code, to: to.code, userId: member.id });
  async function refused(pattern) {
    const error = h.next(mod, 'error-msg', message => pattern.test(message));
    move();
    assert.ok(await error);
  }
  const role = await h.ask(admin, 'create-role', {
    name: 'Voice moderator', level: 30, color: '#aabbcc', permissions: ['move_voice_members']
  });
  const assignment = { userId: moderator.id, roleId: role.roleId };
  assert.ok((await h.ask(admin, 'assign-role', assignment)).success);
  await refused(/not available/);
  enroll.run(to.id, member.id);

  db.prepare('UPDATE channels SET voice_user_limit = 1 WHERE id = ?').run(to.id);
  const occupied = h.next(admin, 'voice-existing-users', data => data.channelCode === to.code);
  admin.emit('voice-join', { code: to.code });
  assert.ok(await occupied);
  await refused(/full/);
  db.prepare('UPDATE channels SET voice_user_limit = 0 WHERE id = ?').run(to.id);

  const peerRole = { userId: member.id, roleId: role.roleId };
  assert.ok((await h.ask(admin, 'assign-role', peerRole)).success);
  await refused(/not available/);
  assert.ok((await h.ask(admin, 'revoke-role', peerRole)).success);
  const received = h.next(target, 'voice-move-requested');
  move();
  assert.deepEqual(await received, { from: from.code, to: to.code });
  assert.ok((await h.ask(admin, 'revoke-role', assignment)).success);
  await refused(/not available/);
});
