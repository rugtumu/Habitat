'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const VOICE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public/js/voice.js'), 'utf8');

class FakeMediaStream {
  constructor(tracks = []) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
}

function loadVoiceManager(setTimeout = () => 1) {
  let connection;
  class FakeRTCPeerConnection {
    constructor() {
      connection = this;
      this.signalingState = 'stable';
    }
    addEventListener() {}
    getSenders() { return []; }
    getReceivers() { return []; }
  }
  const context = vm.createContext({
    module: { exports: {} },
    navigator: { userAgent: '', platform: '', maxTouchPoints: 0 },
    document: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console: { log() {}, warn() {}, error() {} },
    MediaStream: FakeMediaStream,
    RTCPeerConnection: FakeRTCPeerConnection,
    setTimeout,
    clearTimeout() {},
  });
  vm.runInContext(`${VOICE_SOURCE}\nmodule.exports = VoiceManager;`, context, { filename: 'voice.js' });
  return { VoiceManager: context.module.exports, getConnection: () => connection };
}

async function createViewer(setTimeout) {
  const { VoiceManager, getConnection } = loadVoiceManager(setTimeout);
  const voice = Object.create(VoiceManager.prototype);
  voice.peers = new Map();
  voice.rtcConfig = {};
  voice.localStream = null;
  voice.audioBitrate = 0;
  voice.screenStream = null;
  voice.isScreenSharing = false;
  voice.webcamStream = null;
  voice.isWebcamActive = false;
  voice.screenSharers = new Set();
  voice.webcamUsers = new Set();
  voice.screenStreamIds = new Map();
  voice.webcamStreamIds = new Map();
  voice._screenDelivered = new Set();
  const socketHandlers = new Map();
  voice.socket = { on: (event, handler) => socketHandlers.set(event, handler), emit() {} };
  voice.currentChannel = '11111111';
  voice._cancelScreenWatchdog = () => {};
  voice._watchForScreenStream = () => {};
  voice._cleanupScreenPlayback = () => {};
  voice.onWebcamStatusChange = () => {};
  voice.onScreenShareStarted = () => {};
  voice.onScreenNoAudio = () => {};
  voice.onScreenShareRestart = () => {};
  voice.onScreenStream = (userId, stream) => voice.screenResults.push({ userId, stream });
  voice.onWebcamStream = (userId, stream) => voice.webcamResults.push({ userId, stream });
  voice.screenResults = [];
  voice.webcamResults = [];
  voice._setupSocketListeners();
  await voice._createPeer(7, 'Peer', false);
  return { voice, connection: getConnection(), socketHandlers };
}

function remoteVideoTrack(id) {
  return {
    id,
    kind: 'video',
    readyState: 'live',
    getSettings: () => ({}),
  };
}

test('unclaimed share audio keeps a live microphone playing after the timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { voice, connection } = await createViewer(setTimeout);
  const micRoutes = [];
  const screenRoutes = [];
  voice._playAudio = (_, stream) => micRoutes.push(stream);
  voice._playScreenAudio = (_, stream) => screenRoutes.push(stream);
  const deliverAudio = (id) => {
    const track = { kind: 'audio', readyState: 'live', id };
    const stream = new FakeMediaStream([track]);
    stream.id = id;
    connection.ontrack({ track, streams: [stream] });
    return stream;
  };

  const mic = deliverAudio('microphone');
  voice.screenSharers.add(7);
  const share = deliverAudio('screen');
  t.mock.timers.tick(1500);
  assert.equal(micRoutes.length, 1, 'the microphone route was left alone');
  assert.equal(voice.peers.get(7).stream.getAudioTracks()[0], mic.getAudioTracks()[0]);
  assert.deepEqual(screenRoutes, [share]);

  mic.getAudioTracks()[0].readyState = 'ended';
  const replacement = deliverAudio('replacement');
  t.mock.timers.tick(1500);
  assert.equal(micRoutes.at(-1).getAudioTracks()[0], replacement.getAudioTracks()[0]);
});

test('camera stays in the webcam section while its peer is also screen-sharing', async () => {
  const { voice, connection } = await createViewer();
  voice.webcamUsers.add(7);
  voice.screenSharers.add(7);
  const camera = remoteVideoTrack('camera-track');
  const cameraStream = new FakeMediaStream([camera]);
  cameraStream.id = 'camera-stream';
  voice.webcamStreamIds.set(7, cameraStream.id);

  connection.ontrack({ track: camera, streams: [cameraStream] });

  assert.equal(voice.webcamResults.length, 1);
  assert.equal(voice.webcamResults[0].stream, cameraStream);
  assert.equal(voice.screenResults.length, 0);
});

test('a screen track arriving before its share announcement waits instead of becoming a webcam', async () => {
  const { voice, connection, socketHandlers } = await createViewer();
  voice.webcamUsers.add(7);
  voice.webcamStreamIds.set(7, 'camera-stream');
  const screen = remoteVideoTrack('screen-track');
  const screenStream = new FakeMediaStream([screen]);
  screenStream.id = 'screen-stream';

  connection.ontrack({ track: screen, streams: [screenStream] });

  assert.equal(voice.webcamResults.length, 0);
  assert.equal(voice.screenResults.length, 0);

  socketHandlers.get('screen-share-started')({
    userId: 7,
    channelCode: voice.currentChannel,
    streamId: screenStream.id,
  });

  assert.equal(voice.webcamResults.length, 0);
  assert.equal(voice.screenResults.length, 1);
  assert.equal(voice.screenResults[0].stream.id, 'screen-stream');
  assert.equal(voice._screenDelivered.has(7), true);
});

test('webcam-started claims only the matching early camera track', async () => {
  const { voice, connection, socketHandlers } = await createViewer();
  const camera = remoteVideoTrack('camera-track');
  const cameraStream = new FakeMediaStream([camera]);
  cameraStream.id = 'camera-stream';

  connection.ontrack({ track: camera, streams: [cameraStream] });
  assert.equal(voice.webcamResults.length, 0);

  socketHandlers.get('webcam-started')({
    userId: 7,
    channelCode: voice.currentChannel,
    streamId: cameraStream.id,
  });

  assert.equal(voice.webcamResults.length, 1);
  assert.equal(voice.webcamResults[0].stream, cameraStream);
  assert.equal(voice.screenResults.length, 0);
});

test('an app that sends no stream IDs still gets its camera and screen shown', async () => {
  const { voice, connection, socketHandlers } = await createViewer();
  socketHandlers.get('webcam-started')({ userId: 7, channelCode: voice.currentChannel });
  const camera = remoteVideoTrack('camera-track');
  const cameraStream = new FakeMediaStream([camera]);
  cameraStream.id = 'camera-stream';

  connection.ontrack({ track: camera, streams: [cameraStream] });
  assert.equal(voice.webcamResults.length, 1, 'the camera shows on the old flags');
  assert.equal(voice.webcamResults[0].stream, cameraStream);

  const other = await createViewer();
  other.socketHandlers.get('screen-share-started')({ userId: 7, channelCode: other.voice.currentChannel });
  const screen = remoteVideoTrack('screen-track');
  const screenStream = new FakeMediaStream([screen]);
  screenStream.id = 'screen-stream';
  other.connection.ontrack({ track: screen, streams: [screenStream] });
  assert.equal(other.voice.screenResults.length, 1, 'the screen share shows on the old flags');
  assert.equal(other.voice.webcamResults.length, 0);
});
