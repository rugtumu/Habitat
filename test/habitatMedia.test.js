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
    getParameters() { return { encodings: [{}] }; },
    setParameters(p) { this.applied = p; return Promise.resolve(); }
  };
}

// Someone sharing a screen with `viewers` other people in the call.
function makeSharer(VoiceManager, { viewers = 1, bitrate, resolution = 1080 } = {}) {
  const voice = Object.create(VoiceManager.prototype);
  const track = { kind: 'video', readyState: 'live' };
  voice.peers = new Map();
  voice.screenStream = { getVideoTracks: () => [track], getTracks: () => [track] };
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

test('the split is worked out again when someone leaves', () => {
  const { voice, sent } = makeSharer(loadVoiceManager(), { viewers: 4 });
  voice.reapplyScreenBitrate();
  voice.peers.delete(5);
  voice._rebalanceScreenShare();
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
