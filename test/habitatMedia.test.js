/**
 * Habitat's limits on what a call uploads. A call is a mesh: a shared screen
 * and a camera are sent once to every other person in it.
 *
 *   node --test test/habitatMedia.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const VOICE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public/js/voice.js'), 'utf8');

function loadVoiceManager(storage = {}) {
  const context = vm.createContext({
    module: { exports: {} },
    navigator: { userAgent: '', platform: '', maxTouchPoints: 0 },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
      setItem(k, v) { storage[k] = String(v); },
      removeItem(k) { delete storage[k]; }
    },
    console: { log() {}, warn() {}, error() {} },
    RTCSessionDescription: function RTCSessionDescription(d) { return d; },
    setTimeout,
    clearTimeout,
    Date
  });
  vm.runInContext(`${VOICE_SOURCE}\nmodule.exports = VoiceManager;`, context, { filename: 'voice.js' });
  return context.module.exports;
}

function fakeSender(track) {
  return {
    track,
    applied: null,
    keyframes: 0,
    generateKeyFrame() { this.keyframes++; return Promise.resolve(); },
    getParameters() { return structuredClone(this.applied || { encodings: [{ active: true }] }); },
    setParameters(p) { this.applied = p; return Promise.resolve(); }
  };
}

// Someone sharing a screen with `viewers` other people in the call.
function makeSharer(VoiceManager, { viewers = 1, bitrate, resolution = 1080 } = {}) {
  const voice = Object.create(VoiceManager.prototype);
  const track = { kind: 'video', readyState: 'live' };
  voice.peers = new Map();
  voice.currentChannel = '11111111';
  voice.localUserId = 1;
  voice.screenStream = { id: 'capture', getVideoTracks: () => [track], getTracks: () => [track] };
  voice.isScreenSharing = true;
  voice.screenResolution = resolution;
  voice.screenFrameRate = 30;
  if (bitrate !== undefined) voice.screenBitrate = bitrate;
  const senders = [];
  for (let id = 2; id < 2 + viewers; id++) {
    const sender = fakeSender(track);
    senders.push(sender);
    voice.peers.set(id, { connection: { getSenders: () => [sender] }, username: `viewer ${id}` });
  }
  const sent = () => senders.map(sender => sender.applied?.encodings[0].maxBitrate);
  return { voice, senders, sent };
}

test('one viewer gets the whole cap, as before', () => {
  const { voice, sent } = makeSharer(loadVoiceManager(), { viewers: 1 });
  voice.reapplyScreenBitrate();
  assert.deepEqual(sent(), [8_000_000]);
});

test('the cap is the budget of the whole share, split between the people watching', () => {
  const { voice, sent } = makeSharer(loadVoiceManager(), { viewers: 4 });
  voice.reapplyScreenBitrate();
  assert.deepEqual(sent(), [2_000_000, 2_000_000, 2_000_000, 2_000_000]);
  assert.equal(sent().reduce((sum, value) => sum + value, 0), 8_000_000, 'four viewers no longer cost four caps');
});

test('a crowded room never drops a viewer below a readable picture', () => {
  const { voice, sent } = makeSharer(loadVoiceManager(), { viewers: 12 });
  voice.reapplyScreenBitrate();
  assert.ok(sent().every(value => value === 1_000_000));
});

test('a cap already under the floor is left as the sharer set it', () => {
  const { voice, sent } = makeSharer(loadVoiceManager(), { viewers: 3, bitrate: 600 });
  voice.reapplyScreenBitrate();
  assert.deepEqual(sent(), [600_000, 600_000, 600_000]);
});

test('unlimited stays unlimited', () => {
  const { voice, senders } = makeSharer(loadVoiceManager(), { viewers: 3, bitrate: 0 });
  voice.reapplyScreenBitrate();
  for (const sender of senders) assert.ok(!('maxBitrate' in sender.applied.encodings[0]));
});

test('a viewer reached through the relay gets the smaller of its profile and its share', () => {
  const { voice, sent } = makeSharer(loadVoiceManager(), { viewers: 4 });
  voice._relayPeers = new Set([2]);
  voice.reapplyScreenBitrate();
  assert.deepEqual(sent(), [2_000_000, 2_000_000, 2_000_000, 2_000_000], 'the 3 Mbps relay profile is above a quarter of the cap');
  const alone = makeSharer(loadVoiceManager(), { viewers: 1 });
  alone.voice._relayPeers = new Set([2]);
  alone.voice.reapplyScreenBitrate();
  assert.deepEqual(alone.sent(), [3_000_000], 'and below the whole of it');
});

test('the split is worked out again when someone leaves', async () => {
  const { voice, sent } = makeSharer(loadVoiceManager(), { viewers: 4 });
  voice.reapplyScreenBitrate();
  voice.peers.delete(5);
  voice._rebalanceScreenShare();
  await new Promise(setImmediate);
  assert.deepEqual(sent().slice(0, 3), [2_666_667, 2_666_667, 2_666_667]);
  voice.isScreenSharing = false;
  voice.peers.delete(4);
  voice._rebalanceScreenShare();
  assert.deepEqual(sent().slice(0, 2), [2_666_667, 2_666_667], 'nothing is touched when no screen is shared');
});

test('a camera carries a ceiling for the quality picked', () => {
  for (const [pick, cap] of [[undefined, 600_000], ['720', 1_200_000], ['1080p60', 3_500_000], ['nonsense', 600_000]]) {
    const VoiceManager = loadVoiceManager(pick === undefined ? {} : { haven_cam_quality: pick });
    const voice = Object.create(VoiceManager.prototype);
    const track = { kind: 'video' };
    const camera = fakeSender(track);
    const microphone = fakeSender({ kind: 'audio' });
    voice.webcamStream = { getVideoTracks: () => [track] };
    voice._applyWebcamBitrate({ getSenders: () => [microphone, camera] });
    assert.equal(camera.applied.encodings[0].maxBitrate, cap, `quality ${pick}`);
    assert.equal(microphone.applied, null, 'the voice is left alone');
  }
});

function snapshot(ids, streamId = 'capture') {
  return [{ sharerId: 1, streamId, viewers: ids.map(id => ({ id })) }];
}

test('only the three watchers share the cap among nine peers and a bitrate change keeps six paused', async () => {
  const { voice, senders } = makeSharer(loadVoiceManager(), { viewers: 9, bitrate: 9000 });
  voice.updateScreenViewers(voice.currentChannel, snapshot([2, 5, 9]));
  for (const [i, sender] of senders.entries()) {
    assert.equal(sender.applied.encodings[0].active, [2, 5, 9].includes(i + 2));
    assert.equal(sender.applied.encodings[0].maxBitrate, 3_000_000);
  }
  voice.setScreenBitrate(0);
  await new Promise(setImmediate);
  assert.equal(senders[1].applied.encodings[0].active, false);
  assert.ok(senders.every(s => !('maxBitrate' in s.applied.encodings[0])));
});

test('a rapid unwatch and watch resumes after the pending pause, then asks for a keyframe', async () => {
  const { voice, senders: [sender] } = makeSharer(loadVoiceManager());
  let finishPause;
  const apply = sender.setParameters.bind(sender);
  sender.setParameters = params => {
    if (params.encodings[0].active) return apply(params);
    return new Promise(resolve => { finishPause = () => resolve(apply(params)); });
  };
  voice.updateScreenViewers(voice.currentChannel, snapshot([]));
  voice.updateScreenViewers(voice.currentChannel, snapshot([2]));
  assert.equal(sender.keyframes, 0);
  finishPause();
  await new Promise(setImmediate);
  assert.equal(sender.applied.encodings[0].active, true);
  assert.equal(sender.keyframes, 1);
});

test('a missing, malformed or stale viewer list resumes the current share', async () => {
  for (const list of [undefined, [], [{ sharerId: 3, viewers: [] }], [{ sharerId: 1, viewers: [] }],
    [{ sharerId: 1, streamId: 'capture', viewers: [null] }], snapshot([], 'previous capture')]) {
    const { voice, senders: [sender] } = makeSharer(loadVoiceManager());
    voice.updateScreenViewers(voice.currentChannel, snapshot([]));
    voice.updateScreenViewers('22222222', snapshot([2]));
    assert.equal(sender.applied.encodings[0].active, false, 'a text channel cannot control the voice share');
    voice.updateScreenViewers(voice.currentChannel, list);
    await new Promise(setImmediate);
    assert.equal(sender.applied.encodings[0].active, true);
    assert.equal(sender.keyframes, 1);
  }
});

test('a new peer starts active until a snapshot arrives after it joined', async () => {
  const { voice, senders: [first] } = makeSharer(loadVoiceManager());
  voice.updateScreenViewers(voice.currentChannel, snapshot([]));
  const late = fakeSender(first.track);
  voice.peers.set(3, { connection: { getSenders: () => [late] } });
  voice._rebalanceScreenShare();
  assert.equal(late.applied.encodings[0].active, true);
  assert.equal(late.applied.encodings[0].maxBitrate, 8_000_000);
  voice.updateScreenViewers(voice.currentChannel, snapshot([]));
  await new Promise(setImmediate);
  assert.equal(late.applied.encodings[0].active, false);
});

test('losing the signalling socket releases paused mesh senders', async () => {
  const { voice, senders: [sender] } = makeSharer(loadVoiceManager());
  const handlers = new Map();
  voice.socket = { on: (event, fn) => handlers.set(event, fn) };
  voice._setupSocketListeners();
  voice.updateScreenViewers(voice.currentChannel, snapshot([]));
  handlers.get('disconnect')();
  await new Promise(setImmediate);
  assert.equal(sender.applied.encodings[0].active, true);
});

test('mesh viewer updates leave a voice relay session alone', () => {
  const { voice, senders: [sender] } = makeSharer(loadVoiceManager());
  voice._relay = {};
  voice.updateScreenViewers(voice.currentChannel, snapshot([]));
  assert.equal(sender.applied, null);
});

test('the viewer-list socket handler pauses the sharer and only asks for shares the viewer wants', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public/js/modules/app-socket-events.js'), 'utf8');
  let auto = 'false';
  let tile = null;
  const context = vm.createContext({
    module: { exports: {} },
    document: { getElementById: () => tile },
    localStorage: { getItem: () => auto },
  });
  vm.runInContext(source.replace(/^export default/m, 'module.exports ='), context);
  const { voice, senders: [sender] } = makeSharer(loadVoiceManager());
  voice.inVoice = true;
  const listeners = new Map();
  const watched = [];
  const app = {
    ...context.module.exports, voice, user: { id: 1 }, _updateStreamViewerBadges() {},
    socket: {
      on: (event, fn) => listeners.set(event, fn),
      emit(event, { code, sharerId }) {
        assert.equal(event, 'stream-watch');
        assert.equal(code, voice.currentChannel);
        watched.push(sharerId);
      },
    },
  };
  app._listenFeatureEvents();
  const otherShare = { sharerId: 2, streamId: 'other-capture', viewers: [] };
  const broadcast = () => listeners.get('stream-viewers-update')({
    channelCode: voice.currentChannel, streams: [...snapshot([]), otherShare],
  });
  broadcast();
  assert.equal(sender.applied.encodings[0].active, false);
  assert.deepEqual(watched, [], 'the Join prompt has not been accepted');
  auto = 'true';
  broadcast();
  assert.deepEqual(watched, [2], 'auto-accept can start a reused receiver before its first frame');
  tile = { dataset: { hidden: 'true' } };
  broadcast();
  assert.deepEqual(watched, [2], 'a hidden tile stays unwatched');
  auto = 'false';
  tile = { dataset: {} };
  broadcast();
  assert.deepEqual(watched, [2, 2], 'a visible accepted tile can recover a lost watch');
  otherShare.viewers = [{ id: 1 }];
  broadcast();
  assert.deepEqual(watched, [2, 2], 'an acknowledged watch yields no further requests');
});
