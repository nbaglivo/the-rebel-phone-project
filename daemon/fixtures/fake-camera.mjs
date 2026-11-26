// Stands in for the gst-launch camera pipeline: JPEG preview frames on stdout,
// a still rewritten at the location=<path> argv token. FAKE_CAMERA_FAIL=1 makes it crash.

import { appendFileSync, renameSync, writeFileSync } from 'node:fs'

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/fyiiigD/9k=', 'base64')

if (process.env.FAKE_CAMERA_FAIL === '1') {
  console.error('fake camera: no sensor found')
  process.exit(1)
}

const log = (what) => process.env.FAKE_CAMERA_LOG && appendFileSync(process.env.FAKE_CAMERA_LOG, `${what}\n`)
log('start')

const location = process.argv.find((a) => a.startsWith('location='))?.slice('location='.length)

const frames = setInterval(() => process.stdout.write(JPEG), 100)
const stills = location
  ? setInterval(() => {
      const tmp = `${location}.tmp`
      writeFileSync(tmp, JPEG)
      renameSync(tmp, location)
    }, 500)
  : null

let quitting = false
function quit() {
  if (quitting) return
  quitting = true
  log('exit')
  clearInterval(frames)
  if (stills) clearInterval(stills)
  process.exit(0)
}
process.on('SIGTERM', quit)
process.stdout.on('error', quit)
process.stdin.on('end', quit)
process.stdin.on('close', quit)
process.stdin.resume()
