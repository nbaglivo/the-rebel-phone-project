// The gst-launch-1.0 argv for the notebook camera: one capture, two outputs.
// Preview: small JPEGs, concatenated on stdout. Still: a full-size JPEG at stillPath, rewritten stillFps times a second.
// Proved on the phone 2026-11-26, see docs/know-how/camera.md.

// The rear main camera (imx519), named so we don't depend on enumeration order.
export const REAR_CAMERA = '/base/soc@0/cci@ac4a000/i2c-bus@0/camera@1a'

export function buildPipeline({ stillPath, previewWidth = 405, previewHeight = 540, previewFps = 10, stillFps = 2 }) {
  return [
    '-q',
    'libcamerasrc', `camera-name=${REAR_CAMERA}`,
    '!', 'video/x-raw,width=2584,height=1940',
    '!', 'videoconvert',
    // The sensor is mounted sideways: a clockwise turn makes the frame portrait and upright.
    '!', 'videoflip', 'method=clockwise',
    '!', 'tee', 'name=t',
    't.', '!', 'queue', 'leaky=downstream', 'max-size-buffers=1',
    '!', 'videorate', '!', `video/x-raw,framerate=${previewFps}/1`,
    '!', 'videoscale', '!', `video/x-raw,width=${previewWidth},height=${previewHeight}`,
    '!', 'jpegenc', 'quality=70',
    '!', 'fdsink', 'fd=1',
    't.', '!', 'queue', 'leaky=downstream', 'max-size-buffers=1',
    '!', 'videorate', '!', `video/x-raw,framerate=${stillFps}/1`,
    '!', 'jpegenc', 'quality=92',
    '!', 'multifilesink', `location=${stillPath}`,
  ]
}
