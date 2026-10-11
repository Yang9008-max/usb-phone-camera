'use strict';

// Content-Length is essential here: the Android server omits CRLF after JPEG bodies.
class MjpegDecoder {
  constructor(boundary, onFrame) {
    if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) throw Error('无效的 MJPEG boundary');
    this.marker = Buffer.from('--' + boundary);
    this.buffer = Buffer.alloc(0);
    this.length = null;
    this.onFrame = onFrame;
  }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 16 * 1024 * 1024) throw Error('视频帧超过大小限制');
    while (true) {
      if (this.length !== null) {
        if (this.buffer.length < this.length) return;
        const jpeg = this.buffer.subarray(0, this.length);
        this.buffer = this.buffer.subarray(this.length);
        this.length = null;
        if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9) {
          throw Error('收到的帧不是完整 JPEG');
        }
        this.onFrame(Buffer.from(jpeg));
        continue;
      }
      const start = this.buffer.indexOf(this.marker);
      if (start < 0) {
        this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - this.marker.length));
        return;
      }
      if (start > 0) this.buffer = this.buffer.subarray(start);
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end < 0) {
        if (this.buffer.length > 8192) throw Error('MJPEG 帧头过长');
        return;
      }
      const headers = this.buffer.subarray(0, end).toString('latin1');
      const match = /\r\nContent-Length:\s*(\d+)\s*(?:\r\n|$)/i.exec(headers);
      if (!match) throw Error('视频源缺少帧 Content-Length');
      const length = Number(match[1]);
      if (!Number.isSafeInteger(length) || length < 4 || length > 8 * 1024 * 1024) throw Error('无效的视频帧大小');
      this.buffer = this.buffer.subarray(end + 4);
      this.length = length;
    }
  }
}
module.exports = { MjpegDecoder };
