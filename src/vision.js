// On-device object detection for the camera watch: Google MediaPipe's ObjectDetector with EfficientDet-Lite0 (COCO
// labels), loaded from vendor/mediapipe/ (fetched by `npm run vision`). Frames never leave this computer and are
// never stored. Shared by the offscreen watcher (src/camera.js) and the camera test in Settings.

export const PHONE = 'cell phone';
export const PERSON = 'person';
// how sure the detector must be. A lower phone bar caught more real phones but also hands, mice and dark rectangles,
// so it stays at 0.45, a zoomed look needs 0.55, and the smoother wants 3 of 4 frames.
const MIN_SCORE = { [PHONE]: 0.45, [PERSON]: 0.45 };
const ZOOM_PHONE_SCORE = 0.55;

const MISSING = 'The vision files are missing: run `npm run vision` in the extension folder, then reload the extension.';
let tasks = null; // {vision module, fileset}, loaded once per page

async function loadTasks() {
  if (!tasks) {
    tasks = (async () => {
      const base = chrome.runtime.getURL('vendor/mediapipe/');
      const ok = await fetch(`${base}efficientdet_lite0.tflite`, { method: 'HEAD' }).then((r) => r.ok, () => false);
      if (!ok) throw new Error(MISSING);
      const mod = await import(chrome.runtime.getURL('vendor/mediapipe/vision_bundle.mjs'));
      return { mod, base, fileset: await mod.FilesetResolver.forVisionTasks(`${base}wasm`) };
    })();
    tasks.catch(() => { tasks = null; });
  }
  return tasks;
}

/** Loads the object detector (phone, person). Rejects with a readable message when the vision files are missing. */
export async function createDetector() {
  const { mod: { ObjectDetector }, base, fileset } = await loadTasks();
  // the sharper Lite2 when it was fetched (npm run vision), else Lite0
  const lite2 = await fetch(`${base}efficientdet_lite2.tflite`, { method: 'HEAD' }).then((r) => r.ok, () => false);
  return ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${base}${lite2 ? 'efficientdet_lite2' : 'efficientdet_lite0'}.tflite`, delegate: 'CPU' },
    runningMode: 'IMAGE',
    scoreThreshold: 0.3,
    maxResults: 6,
    categoryAllowlist: [PHONE, PERSON],
  });
}

/** What one frame shows: {phone, person, boxes: [{label, score, x, y, w, h}]}. `at` shifts and scales a crop's boxes. */
export function judgeFrame(result, at = null) {
  const boxes = [];
  for (const d of result?.detections || []) {
    const c = d.categories?.[0];
    if (!c || !(c.score >= (MIN_SCORE[c.categoryName] ?? 1))) continue;
    const b = d.boundingBox || {};
    const k = at?.scale || 1;
    boxes.push({ label: c.categoryName, score: c.score, x: (at?.x || 0) + b.originX / k, y: (at?.y || 0) + b.originY / k, w: b.width / k, h: b.height / k });
  }
  return { phone: boxes.some((b) => b.label === PHONE), person: boxes.some((b) => b.label === PERSON), boxes };
}

// the part of the picture where a phone in your hands is: the middle, from chin height down
const ZOOM = Object.freeze({ x: 0.12, y: 0.3, w: 0.76, h: 0.7 });
let zoomCanvas = null;
let zoomLeft = 0; // frames left of the every-frame zoom after a hit
let frames = 0;
const ZOOM_BURST = 10;

/**
 * Looks at one video frame: the whole picture, and when that shows no phone, a second, closer look at the area in
 * front of you (scaled up, so a small or half-hidden phone gets more pixels). Returns judgeFrame()'s shape.
 * To save work the close look happens only when the whole frame has a person, and when nothing was seen lately
 * only on every 2nd frame; after a close-look hit it runs on every frame for 10 frames (the smoother needs 3 of 4).
 */
export function lookAt(detector, video) {
  const whole = judgeFrame(detector.detect(video));
  frames += 1;
  if (whole.phone || !video.videoWidth || !whole.person) return whole;
  if (zoomLeft <= 0 && frames % 2) return whole;
  zoomLeft = Math.max(0, zoomLeft - 1);
  const W = video.videoWidth, H = video.videoHeight;
  const sx = Math.round(W * ZOOM.x), sy = Math.round(H * ZOOM.y), sw = Math.round(W * ZOOM.w), sh = Math.round(H * ZOOM.h);
  const scale = Math.min(2, 640 / sw);
  const cw = Math.round(sw * scale), ch = Math.round(sh * scale);
  zoomCanvas = zoomCanvas || video.ownerDocument.createElement('canvas');
  if (zoomCanvas.width !== cw) zoomCanvas.width = cw; // setting the size clears and reallocates the canvas
  if (zoomCanvas.height !== ch) zoomCanvas.height = ch;
  zoomCanvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
  const near = judgeFrame(detector.detect(zoomCanvas), { x: sx, y: sy, scale });
  const phones = near.boxes.filter((b) => b.label === PHONE && b.score >= ZOOM_PHONE_SCORE);
  if (phones.length) zoomLeft = ZOOM_BURST;
  return { phone: phones.length > 0, person: whole.person || near.person, boxes: [...whole.boxes, ...phones] };
}

/**
 * Smooths single frames into a steady reading: a phone counts when seen in 3 of the last 4 frames, a person is gone
 * only after 5 frames in a row without one (people turn away, lean back, the light changes), and the look is the most
 * common of the last 4 frames (a glance aside is not "away").
 */
export function smoother() {
  const phones = [];
  const looks = [];
  let missed = 0;
  return (frame) => {
    phones.push(frame.phone);
    if (phones.length > 4) phones.shift();
    missed = frame.person ? 0 : missed + 1;
    looks.push(frame.look || 'none');
    if (looks.length > 4) looks.shift();
    const count = {};
    for (const l of looks) count[l] = (count[l] || 0) + 1;
    const look = Object.keys(count).sort((a, b) => count[b] - count[a] || (a === 'screen' ? -1 : b === 'screen' ? 1 : 0))[0];
    return { phone: phones.filter(Boolean).length >= 3, person: missed < 5, look };
  };
}

// ------------------------------------------------------------------ which way you are looking

/** Loads the face landmarker (head and eye direction), or null when its model file is not there (older fetch). */
export async function createFace() {
  const { mod: { FaceLandmarker }, base, fileset } = await loadTasks();
  const ok = await fetch(`${base}face_landmarker.task`, { method: 'HEAD' }).then((r) => r.ok, () => false);
  if (!ok) return null;
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${base}face_landmarker.task`, delegate: 'CPU' },
    runningMode: 'IMAGE',
    numFaces: 1,
    outputFaceBlendshapes: true,
  });
}

// how far from YOUR usual direction counts (the camera may sit to one side or above the screen, so "straight at the
// camera" is not "at the screen"): the nose position across the face, and down it, relative to your own baseline
export const LOOK = Object.freeze({ side: 0.12, down: 0.08, up: 0.09, eyesSide: 0.45, eyesDown: 0.55 });
const DEFAULT_BASE = Object.freeze({ yaw: 0.5, pitch: 0.55 });

/** The raw numbers for one face: {yaw, pitch, eyesSide, eyesDown}, or null when no face was found. */
export function faceNumbers(result) {
  const lm = result?.faceLandmarks?.[0];
  if (!lm || lm.length < 455) return null;
  const nose = lm[1], top = lm[10], chin = lm[152], left = lm[234], right = lm[454];
  const bs = Object.fromEntries((result.faceBlendshapes?.[0]?.categories || []).map((c) => [c.categoryName, c.score]));
  return {
    yaw: (nose.x - left.x) / ((right.x - left.x) || 1e-6),
    pitch: (nose.y - top.y) / ((chin.y - top.y) || 1e-6),
    eyesSide: Math.max(((bs.eyeLookOutLeft || 0) + (bs.eyeLookInRight || 0)) / 2, ((bs.eyeLookInLeft || 0) + (bs.eyeLookOutRight || 0)) / 2),
    eyesDown: ((bs.eyeLookDownLeft || 0) + (bs.eyeLookDownRight || 0)) / 2,
  };
}

/**
 * Where one face is looking, against your baseline `base` ({yaw, pitch}: where your face usually points):
 * {look: 'screen' | 'down' | 'downRight' | 'away' | 'none', turn, tilt} with turn and tilt the distance from the baseline.
 */
export function judgeFace(result, base = DEFAULT_BASE) {
  const n = faceNumbers(result);
  if (!n) return { look: 'none', turn: 0, tilt: 0 };
  const turn = n.yaw - base.yaw;
  const tilt = n.pitch - base.pitch;
  let look = 'screen';
  // head (or eyes) down and turned to your right (the nose moves to the left of the raw camera frame): a copybook
  // beside the keyboard. Its own look so the copybook setting can pass it; without that setting it counts as 'down'.
  const down = tilt > LOOK.down || n.eyesDown > LOOK.eyesDown;
  if (down && turn < 0 && turn >= -LOOK.side * 3 && tilt >= -LOOK.up) look = 'downRight';
  else if (Math.abs(turn) > LOOK.side || tilt < -LOOK.up || n.eyesSide > LOOK.eyesSide) look = 'away';
  else if (tilt > LOOK.down || n.eyesDown > LOOK.eyesDown) look = 'down';
  return { look, turn: Math.round(turn * 100) / 100, tilt: Math.round(tilt * 100) / 100 };
}

/**
 * Learns where your face usually points (the median of the last ~90 looks near it, about a minute and a half) and
 * judges each look against it. Until 15 looks are in, the straight-on default is used (the first 15 s). Returns (result) => judgeFace(...).
 */
export function gazeTracker() {
  const yaws = [];
  const pitches = [];
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  return (result) => {
    const base = yaws.length >= 15 ? { yaw: median(yaws), pitch: median(pitches) } : DEFAULT_BASE;
    const judged = judgeFace(result, base);
    const n = faceNumbers(result);
    // learn only from looks close to the usual direction once it is known: looking away for a minute must not
    // become the new "usual" (it would then pass, and looking back would read as away)
    const near = n && (yaws.length < 15 || (Math.abs(n.yaw - base.yaw) <= LOOK.side * 1.5 && Math.abs(n.pitch - base.pitch) <= LOOK.down * 1.5));
    if (near) {
      yaws.push(n.yaw); pitches.push(n.pitch);
      if (yaws.length > 90) { yaws.shift(); pitches.shift(); }
    }
    return { ...judged, learned: yaws.length >= 15 };
  };
}
