import test from 'node:test';
import assert from 'node:assert/strict';
import { nextDelay } from '../src/camera.js';
import { lookAt } from '../src/vision.js';

test('nextDelay: calm is slow, anything else is fast for 10 looks', () => {
  const calm = { look: 'screen', phone: false, raw: [] };
  assert.equal(nextDelay({ ...calm, alertLeft: 0 }).delay, 2000);
  assert.equal(nextDelay({ ...calm, alertLeft: 0, raw: [{ label: 'person', score: 0.9 }] }).delay, 2000);
  for (const odd of [{ look: 'away' }, { look: 'down' }, { look: 'none' }, { phone: true }, { raw: [{ label: 'cell phone', score: 0.3 }] }]) {
    const r = nextDelay({ ...calm, ...odd, alertLeft: 0 });
    assert.equal(r.delay, 1000);
    assert.equal(r.alertLeft, 10);
  }
  let state = { alertLeft: 10 };
  let fast = 0;
  while (nextDelay({ ...calm, ...state }).delay === 1000) { state = nextDelay({ ...calm, ...state }); fast += 1; }
  assert.equal(fast, 10);
});

const fakeVideo = () => {
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
  return { videoWidth: 640, videoHeight: 480, ownerDocument: { createElement: () => canvas } };
};
const det = (log, whole, near) => ({
  detect: (src) => { log.push(src.getContext ? 'zoom' : 'whole'); return src.getContext ? near : whole; },
});
const person = { detections: [{ categories: [{ categoryName: 'person', score: 0.9 }], boundingBox: { originX: 0, originY: 0, width: 10, height: 10 } }] };
const phone = { detections: [{ categories: [{ categoryName: 'cell phone', score: 0.9 }], boundingBox: { originX: 0, originY: 0, width: 10, height: 10 } }] };

test('lookAt: no zoom without a person; calm zooms every 2nd frame; a hit zooms 10 frames in a row', () => {
  const v = fakeVideo();
  let log = [];
  for (let i = 0; i < 4; i += 1) lookAt(det(log, { detections: [] }, { detections: [] }), v);
  assert.equal(log.filter((x) => x === 'zoom').length, 0);
  log = [];
  for (let i = 0; i < 4; i += 1) lookAt(det(log, person, { detections: [] }), v);
  assert.equal(log.filter((x) => x === 'zoom').length, 2);
  // a hit (on a zooming frame), then every frame
  let hit = null;
  for (let i = 0; i < 2 && !hit?.phone; i += 1) hit = lookAt(det([], person, phone), v);
  assert.equal(hit.phone, true);
  log = [];
  for (let i = 0; i < 10; i += 1) lookAt(det(log, person, { detections: [] }), v);
  assert.equal(log.filter((x) => x === 'zoom').length, 10);
});
