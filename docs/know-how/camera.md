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
