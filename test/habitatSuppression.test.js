'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scripts = path.join(__dirname, '../public/js');
function worklet() {
  let Processor;
  vm.runInNewContext(fs.readFileSync(path.join(scripts, 'rnnoise-processor.js'), 'utf8'), {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
    registerProcessor: (_, type) => { Processor = type; },
    WebAssembly, ArrayBuffer, Float32Array, Uint8Array, sampleRate: 48000,
  });
  return new Processor();
}

test('the shipped model attenuates steady noise at 48 kHz', async () => {
  const processor = worklet();
  const bytes = fs.readFileSync(path.join(scripts, 'rnnoise.wasm'));
  await processor._initWasm(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(processor._ready, true);
  let seed = 1234, rawEnergy = 0, filteredEnergy = 0;
  const input = new Float32Array(128), output = new Float32Array(128);
  for (let block = 0; block < 1000; block++) {
    for (let i = 0; i < input.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      input[i] = 0.06 * (seed / 2147483648 - 1);
    }
    processor.process([[input]], [[output]]);
    if (block < 375) continue; // allow a second for the model to settle
    for (let i = 0; i < input.length; i++) {
      rawEnergy += input[i] ** 2;
      filteredEnergy += output[i] ** 2;
    }
  }
  assert.ok(filteredEnergy > 0 && filteredEnergy < rawEnergy / 10);
  processor._cleanup();
});

test('residual suppression opens within one frame and holds through gaps in speech', () => {
  const processor = worklet();
  const heap = new Float32Array(960);
  processor._HEAPF32 = heap;
  processor._wasmMemory = { buffer: heap.buffer };
  processor._wasmInputPtr = 0;
  processor._wasmOutputPtr = 480 * 4;
  heap.fill(32768, 480);
  let probability = 0;
  processor._rnnoise_process_frame = () => probability;
  function frame() {
    processor._fifoCount = 0;
    const start = processor._fifoWrite;
    processor._processFrame();
    return [processor._fifo[start], processor._fifo[(start + 479) % processor._FIFO_CAP]];
  }
  for (let i = 0; i < 80; i++) frame();
  assert.ok(frame()[1] < 0.26);
  probability = 0.8;
  const onset = frame();
  assert.ok(onset[0] < 0.27);
  assert.equal(onset[1], 1);
  probability = 0;
  for (let i = 0; i < 15; i++) assert.deepEqual(frame(), [1, 1]);
  assert.ok(frame()[1] < 1);
});
