/**
 * Background blur using MediaPipe selfie segmentation (runs fully in the browser).
 * The segmentation model and WASM are fetched on first use. The "background" mask value is
 * detected from the frame border, so it works whichever way the model encodes the mask.
 */
const MP_VERSION = '1.2.2';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
let segmenterPromise = null;

export const blurSupported = () => typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype && !!HTMLCanvasElement.prototype.captureStream;

function loadSegmenter() {
  segmenterPromise ||= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`);
    const make = (delegate) => ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', outputCategoryMask: true, outputConfidenceMasks: false,
    });
    try { return await make('GPU'); } catch { return make('CPU'); }
  })().catch((e) => { segmenterPromise = null; throw e; });
  return segmenterPromise;
}

/** Returns { track, stop } where track is a processed (blurred-background) video track. */
export async function startBlur(cameraTrack, radius = 12) {
  if (!blurSupported()) throw new Error('This browser does not support background blur.');
  const segmenter = await loadSegmenter();

  const video = document.createElement('video');
  video.muted = true; video.playsInline = true;
  video.srcObject = new MediaStream([cameraTrack]);
  await video.play();
  const w = video.videoWidth || 640, h = video.videoHeight || 480;

  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const person = document.createElement('canvas');
  const pctx = person.getContext('2d', { willReadFrequently: true });

  const onMask = (result) => {
    const mask = result.categoryMask;
    if (!mask) return;
    const data = mask.getAsUint8Array();
    const mw = mask.width, mh = mask.height;
    // The value that dominates the frame border is the background.
    let zeros = 0, total = 0;
    for (let x = 0; x < mw; x += 4) { total += 2; if (data[x] === 0) zeros += 1; if (data[(mh - 1) * mw + x] === 0) zeros += 1; }
    for (let y = 0; y < mh; y += 4) { total += 2; if (data[y * mw] === 0) zeros += 1; if (data[y * mw + mw - 1] === 0) zeros += 1; }
    const bg = zeros * 2 >= total ? 0 : null; // null => any non-zero value is background

    if (person.width !== mw || person.height !== mh) { person.width = mw; person.height = mh; }
    pctx.drawImage(video, 0, 0, mw, mh);
    const img = pctx.getImageData(0, 0, mw, mh);
    const px = img.data;
    for (let i = 0; i < data.length; i += 1) {
      const isBg = bg === 0 ? data[i] === 0 : data[i] !== 0;
      px[i * 4 + 3] = isBg ? 0 : 255;
    }
    pctx.putImageData(img, 0, 0);

    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(video, 0, 0, w, h);
    ctx.filter = 'none';
    ctx.drawImage(person, 0, 0, w, h);
  };

  let busy = false;
  const timer = setInterval(() => {
    if (busy || video.readyState < 2) return;
    busy = true;
    try { segmenter.segmentForVideo(video, performance.now(), onMask); } catch { /* skip frame */ }
    busy = false;
  }, 50);

  const track = canvas.captureStream(20).getVideoTracks()[0];
  return { track, stop() { clearInterval(timer); track.stop(); video.srcObject = null; } };
}
