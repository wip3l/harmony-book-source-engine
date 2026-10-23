// Exercise the production ImageKit adapter with row padding and explicit pixel values.
// Platform codec/NAPI execution is verified separately by the HarmonyOS build/device.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

let frames = 1, width = 3, height = 11, created = 0, released = 0;
let outputRows = [], packedFormat = '', failure = '';
const image = {
  PixelMapFormat: { RGBA_8888: 3 },
  createImageSource() {
    created++;
    return {
      async getImageInfo() { return { size: { width, height } }; },
      async getFrameCount() { return frames; },
      async createPixelMap() {
        created++;
        const stride = width * 4 + 4;
        const original = new Uint8Array(stride * height);
        for (let row = 0; row < height; row++) original.fill(row, row * stride, (row + 1) * stride);
        return {
          getBytesNumberPerRow: () => stride,
          async readPixelsToBuffer(buffer) { new Uint8Array(buffer).set(original); },
          async writeBufferToPixels(buffer) {
            if (failure === 'write') throw new Error('write failed');
            outputRows = Array.from({ length: height }, (_, row) => new Uint8Array(buffer)[row * stride]);
          },
          async release() { released++; }
        };
      },
      async release() { released++; }
    };
  },
  createImagePacker() {
    created++;
    return {
      async packToData(_, options) { packedFormat = options.format; return new Uint8Array([255,216,255,0]).buffer; },
      async release() { released++; }
    };
  }
};
const source = readFileSync(new URL('../sourceengine/src/main/ets/core/nativesource/NativeImageTransform.ts', import.meta.url), 'utf8');
const context = vm.createContext({ image, Uint8Array, ArrayBuffer, console });
vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), { mode: 'strip' }), context);
const transform = vm.runInContext('NativeImageTransform', context);
const bytes = new Uint8Array([255,216,255,1]);
const reorder = options => transform.reorderStrips(bytes, JSON.stringify(options));
await reorder({ count: 3 });
assert.deepEqual(outputRows, [6,7,8,9,10,3,4,5,0,1,2], 'remainder belongs to the final input strip');
assert.equal(packedFormat, 'image/png');
await reorder({ count: 3, remainder: 'first', order: [2,0,1], format: 'image/jpeg', quality: 90 });
assert.deepEqual(outputRows, [8,9,10,0,1,2,3,4,5,6,7], 'arbitrary strip permutations preserve every row');
assert.equal(packedFormat, 'image/jpeg');
height = 12;
await reorder({ count: 3 });
assert.deepEqual(outputRows, [8,9,10,11,4,5,6,7,0,1,2,3]);
const before = created;
assert.equal(await reorder({ count: 1 }), bytes);
assert.equal(created, before, 'identity does not decode/re-encode an image');
for (const options of [null, [], {}, {count:0}, {count:257}, {count:2.5}, {count:2,order:[0,0]},
  {count:2,order:[0]}, {count:2,order:[0,2]}, {count:2,remainder:'middle'}, {count:2,format:'svg'},
  {count:2,quality:101}, {count:2,quality:'95'}]) await assert.rejects(reorder(options), /reorderStrips/);
await assert.rejects(reorder({count:13}), /高度/);
frames = 2;
await assert.rejects(reorder({count:3}), /动图/);
frames = 1; width = 4096; height = 4096;
await assert.rejects(reorder({count:3}), /像素/);
width = 3; height = 11; failure = 'write';
await assert.rejects(reorder({count:3}), /write failed/);
assert.equal(created, released, 'codec resources are released on success and failure');
console.log('image-strip-check: remainder, permutations, row padding, identity, dimensions, animation, validation and cleanup passed');
