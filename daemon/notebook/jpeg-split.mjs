// Cuts a byte stream of concatenated JPEGs into whole images (FFD8 ... FFD9).

const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])

export function createJpegSplitter(onFrame) {
  let buf = Buffer.alloc(0)
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
    for (;;) {
      const start = buf.indexOf(SOI)
      if (start === -1) {
        buf = buf.subarray(Math.max(0, buf.length - 1))
        return
      }
      const end = buf.indexOf(EOI, start + 2)
      if (end === -1) {
        buf = buf.subarray(start)
        return
      }
      onFrame(Buffer.from(buf.subarray(start, end + 2)))
      buf = buf.subarray(end + 2)
    }
  }
}
