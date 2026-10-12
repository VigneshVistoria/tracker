import { apiUpload } from './api';

// Defect screenshots (pasted or screen-captured on Create Defect). Uploaded
// after the defect is created, through the same private pipeline as client
// portal attachments - the server re-checks type (by content) and size,
// this is only so the user hears about problems straight away.

export const MAX_SCREENSHOTS = 5;
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
// Above this many pixels on the longest side, shrink before upload.
const MAX_DIMENSION = 2560;
// Still above this after shrinking: re-save as JPEG.
const JPEG_THRESHOLD_BYTES = 8 * 1024 * 1024;
const JPEG_QUALITY = 0.85;

// The server takes the type from the bytes and requires the extension to
// agree, so the extension always follows the actual image type.
const EXTENSION_BY_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export const UNSUPPORTED_TYPE_MESSAGE = 'Only PNG, JPEG, WebP or GIF images can be attached.';
export const TOO_LARGE_MESSAGE = 'File too large (max 10 MB).';

const pad = (n) => String(n).padStart(2, '0');

// defect-screenshot-YYYYMMDD-HHMMSS.<ext> (local time). A second one in the
// same second gets -2, -3, ... so names stay unique on one defect.
export function screenshotFileName(mimeType, takenNames = [], now = new Date()) {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const ext = EXTENSION_BY_TYPE[mimeType] || 'png';
  let name = `defect-screenshot-${stamp}.${ext}`;
  for (let n = 2; takenNames.includes(name); n += 1) name = `defect-screenshot-${stamp}-${n}.${ext}`;
  return name;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process the image.'))), type, quality);
  });
}

// Checks the type, shrinks very large images (longest side 2560px), and
// falls back to JPEG only if it's still over 8 MB. Returns a Blob, or
// throws with a message fit to show the user.
export async function prepareScreenshot(blob) {
  return (await prepareScreenshotDetailed(blob)).blob;
}

// Same, plus what was done to it, so the user can be told:
// { blob, resizedTo: { width, height } | null, convertedToJpeg }.
export async function prepareScreenshotDetailed(blob) {
  if (!EXTENSION_BY_TYPE[blob.type]) throw new Error(UNSUPPORTED_TYPE_MESSAGE);
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error(UNSUPPORTED_TYPE_MESSAGE);
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    let result = blob;
    let canvas = null;
    let resizedTo = null;
    if (longest > MAX_DIMENSION || blob.size > JPEG_THRESHOLD_BYTES) {
      const scale = Math.min(1, MAX_DIMENSION / longest);
      canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (longest > MAX_DIMENSION) {
        result = await canvasToBlob(canvas, 'image/png');
        resizedTo = { width: canvas.width, height: canvas.height };
      }
    }
    if (result.size > JPEG_THRESHOLD_BYTES && canvas) {
      // JPEG has no transparency - paint it on white rather than black.
      const flat = document.createElement('canvas');
      flat.width = canvas.width;
      flat.height = canvas.height;
      const ctx = flat.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas, 0, 0);
      result = await canvasToBlob(flat, 'image/jpeg', JPEG_QUALITY);
    }
    if (result.size > MAX_SCREENSHOT_BYTES) throw new Error(TOO_LARGE_MESSAGE);
    return { blob: result, resizedTo, convertedToJpeg: result.type === 'image/jpeg' && blob.type !== 'image/jpeg' };
  } finally {
    bitmap.close?.();
  }
}

export function isScreenCaptureSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}

// Turns a getDisplayMedia failure into a message for the user. Chrome and
// Edge report both "cancelled the picker" and "blocked" as NotAllowedError;
// only the message text tells them apart (not guaranteed by the standard).
function captureErrorMessage(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
    if (/system|policy/i.test(err.message || '') || err.name === 'SecurityError') {
      return 'Screen capture is blocked – check your browser or system permissions.';
    }
    return 'Screen capture cancelled.';
  }
  return "Couldn't capture the screen – please try again.";
}

// Opens the browser's own picker (a window or tab - the whole-screen
// option and this Tracker tab are hidden where the browser supports it),
// grabs ONE frame as a PNG and stops every capture track straight away.
// Nothing is recorded and nothing keeps running; the caller shows the
// frame in a preview and only attaches it if the user confirms.
export async function captureScreenFrame() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'window' },
      audio: false,
      monitorTypeSurfaces: 'exclude',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
      systemAudio: 'exclude',
    });
  } catch (err) {
    throw new Error(captureErrorMessage(err));
  }
  const video = document.createElement('video');
  try {
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // Wait until a real frame is on screen, not just the metadata.
    await new Promise((resolve) => {
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => resolve());
      else setTimeout(resolve, 200);
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (!canvas.width || !canvas.height) throw new Error("Couldn't capture the screen – please try again.");
    canvas.getContext('2d').drawImage(video, 0, 0);
    return await canvasToBlob(canvas, 'image/png');
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
}

// Uploads the screenshots ({ blob, name }) to a defect in one request
// (all-or-nothing on the server). Returns the defect's attachment list.
export function uploadDefectScreenshots(taskId, screenshots) {
  const form = new FormData();
  for (const shot of screenshots) form.append('files', shot.blob, shot.name);
  return apiUpload(`/tasks/${taskId}/attachments`, form);
}
