# Camera

Nothing in the shell uses the camera yet. These entries come from a first
hardware test, so you know what works before you design anything around it.

## The cameras work on mainline: all three sensors stream

- **Fact (OnePlus 6, kernel 7.1.0-rc1-sdm845):** the kernel finds three sensors
  behind Qualcomm CAMSS on one media device (`/dev/media0`): `imx519`
  (`16-001a`), `imx371` (`16-0010`) and `imx376` (`17-0010`), plus two
  `lc898217xc` focus motors. The user needs to be in the `video` group (the
  image's default user is). No root is needed to capture.
- **Fact:** CAMSS only delivers **raw Bayer** (its RDI paths). There's no
  hardware ISP support, so demosaicing, white balance and exposure all happen
  in software.
- **Verified:** on the phone, 2026-11-26.

## Test the hardware with the sensor's test pattern before blaming the scene

- **Context:** the first raw frame was flat (sitting at black level), and we
  couldn't tell a dead pipeline from a covered lens or a dark room.
- **Fact:** most sensor drivers have a `test_pattern` control. Colour bars at
  the far end prove the sensor, MIPI CSI and capture all work. Then, if real
  frames are still empty, it's exposure or the scene. At default exposure
  (689 lines) with `analogue_gain=0`, an indoor scene reads as pure black level.
- **Recipe (rear imx519, no root, `v4l-utils` only):**

  ```sh
  M="media-ctl -d /dev/media0"; F=SRGGB10_1X10/4656x3496
  $M -r
  $M -l '"msm_csiphy0":1->"msm_csid0":0[1],"msm_csid0":1->"msm_vfe0_rdi0":0[1]'
  $M -V "\"imx519 16-001a\":0[fmt:$F],\"msm_csiphy0\":0[fmt:$F],\"msm_csid0\":0[fmt:$F],\"msm_vfe0_rdi0\":0[fmt:$F]"
  v4l2-ctl -d /dev/v4l-subdev19 -c test_pattern=1      # 0 = real image
  v4l2-ctl -d /dev/v4l-subdev19 -c exposure=1500 -c analogue_gain=400
  v4l2-ctl -d /dev/video0 --set-fmt-video=width=4656,height=3496,pixelformat=pRAA \
    --stream-mmap --stream-count=1 --stream-skip=6 --stream-to=/tmp/f.raw
  ```

  A frame is packed 10-bit (4 pixels in 5 bytes) with a 5824-byte row stride:
  20 360 704 bytes. To preview it without numpy, use the first 4 bytes of each
  5-byte group (the high 8 bits) and average each RGGB 2×2 block.
- **Gotcha:** subdev numbers (`v4l-subdev19`) and media links aren't stable
  across kernels. Find them with `media-ctl -p`.
- **Verified:** on the phone, 2026-11-26.

## libcamera's "simple" pipeline + software ISP gives usable frames from all three

- **Fact (pmOS libcamera 0.7.1 + `libcamera-tools`):** `cam -l` lists all three
  cameras, handled by the `simple` pipeline with the software ISP (no hardware
  ISP). `cam -c N --capture=15 -s role=viewfinder,pixelformat=BGR888
  --file=/tmp/f-#.ppm` writes viewable PPMs. Measured defaults:
  - cam 1 (imx519): 2584×1940 at **15 fps**, colour, auto-exposure works.
  - cam 2 (imx371): 4648×3496 at **4–6 fps**, colour.
  - cam 3 (imx376): 4648×3496 at **4.3 fps**, came out **greyscale**. libcamera
    warns `Failed to create camera sensor helper for imx376`.
- **Gotcha:** the image is soft and washed out: no lens shading correction, a
  generic tuning, and no autofocus loop in the soft ISP. Fine for a QR code
  or a snapshot, not a camera-app replacement.
- **Gotcha (guess, to confirm):** the "front"/"back" labels may be wrong.
  With the back of the phone pointed at a lamp, cam 2 ("Internal front
  camera", imx371) **also** showed the lamp, while cam 3 ("back", imx376)
  showed the room behind. Check by covering one lens before you trust
  `Location`.
- **Gotcha:** PipeWire runs but `wpctl status` lists no video devices, so
  browser `getUserMedia` (which goes through PipeWire/portals) probably sees
  no camera yet. Untested.
- **Gotcha:** `doas` needs a password, so an agent can't `apk add
  libcamera-tools` on its own. Ask the human.
- **Alternatives:** for a calm phone, a still capture through the daemon
  (`cam` or a GStreamer `libcamerasrc` pipeline writing a JPEG) avoids
  getting camera access into the browser at all. That would follow the
  daemon-owns-the-system rule.
- **Verified:** on the phone, 2026-11-26.

## One GStreamer process gives both a live preview and a full-size still

- **Context:** the notebook scanner needs a live viewfinder in the browser
  and a sharp still at shot time, without camera access in the browser. The
  daemon owns the camera, so it needs one process whose output it can read.
- **Fact (pmOS, GStreamer 1.28.3, libcamera 0.7.1):** `libcamerasrc` comes
  from `libcamera-gstreamer`; `jpegenc`, `multifilesink`, `videoflip` from
  `gst-plugins-base`/`gst-plugins-good`. But **`gst-launch-1.0` and
  `gst-inspect-1.0` are in `gstreamer-tools`, which neither pulls in**. Without
  doas we tested with `apk fetch gstreamer-tools` and ran the binary extracted
  from the `.apk` (a gzip tarball) under `/tmp`; the phone itself needs
  `doas apk add gstreamer-tools`.
- **Fact:** `libcamerasrc` on the imx519 negotiates `RGBA 2584×1940` (the soft
  ISP's output) with the caps below; no format had to be forced. The frame is
  landscape and sideways: `videoflip method=clockwise` makes it portrait
  1940×2584. Direction checked on an earlier `cam` capture of a notebook page
  (text read upright after a clockwise turn); the scene during this test was
  dark, so the gst still itself only proves the size.
- **Our choice:** one `gst-launch-1.0 -q` process, a `tee`, two leaky branches
  (`daemon/notebook/pipeline.mjs`):

  ```sh
  gst-launch-1.0 -q libcamerasrc camera-name=/base/soc@0/cci@ac4a000/i2c-bus@0/camera@1a \
    ! video/x-raw,width=2584,height=1940 ! videoconvert ! videoflip method=clockwise ! tee name=t \
    t. ! queue leaky=downstream max-size-buffers=1 ! videorate ! video/x-raw,framerate=10/1 \
       ! videoscale ! video/x-raw,width=405,height=540 ! jpegenc quality=70 ! fdsink fd=1 \
    t. ! queue leaky=downstream max-size-buffers=1 ! videorate ! video/x-raw,framerate=2/1 \
       ! jpegenc quality=92 ! multifilesink location=/path/still.jpg
  ```

  `-q` keeps stdout pure: it carries only concatenated JPEGs, split on
  FFD8…FFD9. Pick the camera by `camera-name` (its id from `cam -l`), not by
  enumeration order.
- **Measured (on the phone, 2026-11-26, Chromium kiosk idle alongside):**
  - first preview frame and first still **~0.7–0.8 s** after spawn;
  - preview **10.0 fps** (405×540, ~24 KB a frame), still rewritten
    **2.0×/s** (1940×2584, ~1.6–2.3 MB);
  - gst-launch CPU **~1.7 cores** (833 ticks in 5 s from `/proc/PID/stat`;
    busybox `top` shows 17 %, a share of all 8 cores). Most of it is the
    full-size `videoconvert` + rotation + 2×/s `jpegenc quality=92`.
  - `SIGINT` stops it cleanly (exit 0).
- **Gotcha:** `multifilesink` with a fixed `location` (no `%d`) is not atomic:
  per buffer it opens the file with truncate, writes, closes. Over ~9 000
  back-to-back reads during 40 rewrites we never saw a short or empty file
  (tmpfs, one ~2 MB write), but the window exists. A reader that must not see
  half a file should check the JPEG ends in FFD9 and retry, or copy it first.
  Atomic alternatives: `location=still-%d.jpg max-files=2` and read the
  older of the two, or send the still down a second pipe instead of a file.
  **Our choice:** at shot time the daemon reads the still into memory,
  accepts it only if it starts FFD8 and ends FFD9, retries up to 5× every
  100 ms, and gives ffmpeg its own copy, so a rewrite during the encode
  can't corrupt the scan (`daemon/notebook/notebook.mjs`; unit-tested with
  a truncated file, not yet seen on the phone).
- **Gotcha:** the still has a **51-px black band on its left edge** (the
  bottom rows of the sensor frame before rotation). Seen in a dark scene;
  unknown whether it is the soft ISP or optics. Crop it if it shows on paper.
- **Gotcha:** `libcamerasrc`'s `ae-enable` property defaults to `false` in
  `gst-inspect`. In a dark scene `true` gave a still of the same size (not viewed);
  check auto-exposure in daylight before relying on the default.
- **Alternatives:** two processes (`cam` for stills, a separate stream for
  preview) would fight over the one camera. A smaller capture size would cut
  CPU a lot but lose the still's resolution; a `role=viewfinder` stream plus a
  separate still-capture stream on `src_%u` might be cheaper, untested.
- **Verified:** on the phone, 2026-11-26.
- **See:** `daemon/notebook/pipeline.mjs`, `daemon/notebook/camera.mjs`.

## Stream the browser preview as MJPEG over plain HTTP, not through the state channel

- **Context:** the shell is a thin page that only talks to the daemon over
  SSE (state) and POST (actions). The viewfinder needs ~10 small JPEGs a
  second from a camera the daemon owns.
- **Fact:** Chromium renders `multipart/x-mixed-replace` (MJPEG) natively in
  an `<img>`: no JS, no decode loop, and closing the `<img>` closes the
  request, which is exactly the "someone is watching" signal the daemon
  needs to start and stop the camera.
- **Our choice:** `GET /camera/preview` streams parts
  `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: N\r\n\r\n<jpeg>\r\n`;
  a slow client skips frames (`res.writableNeedDrain`) instead of buffering.
  When the camera stops on its own (timeout, crash, screen off) the daemon
  ends the response itself; the camera state goes out on the SSE event,
  so the shell knows why. Still images (pending shot, scans) are plain GETs.
  It is the one exception to the single-transport rule: pixels only, never
  state.
- **Alternatives:** frames as base64 in SSE (+33 % bytes, a JS decode and
  `<img src>` swap per frame); a WebSocket (needs a hand-written framing
  layer in a zero-dependency daemon); WebRTC or `getUserMedia` in Chromium
  (the better call if you want real video at higher fps and your browser
  can open the camera through PipeWire/portals, which cage + libcamera
  here doesn't give us without more plumbing).
- **Verified:** Mac only with the fake camera, 2026-11-26 (curl shows the
  parts; the shell side is not built yet).
- **See:** `docs/architecture.md` → "Notebook (camera + scans)".
