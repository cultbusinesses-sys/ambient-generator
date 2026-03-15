/**
 * server/export/encode-audio.js
 * ------------------------------
 * Writes a node-web-audio-api AudioBuffer to a WAV or MP3 file on disk.
 *
 * WAV: pure JS header + raw PCM — no ffmpeg needed, instant.
 * MP3: pipes WAV through ffmpeg for encoding.
 *
 * Returns the path to the written file.
 */

const fs      = require('fs');
const path    = require('path');
const { exec } = require('child_process');
const util    = require('util');
const execP   = util.promisify(exec);

const TEMP_DIR = process.env.TEMP_DIR ?? '/tmp';

// ---------------------------------------------------------------------------
// WAV writer
// ---------------------------------------------------------------------------

/**
 * Write AudioBuffer to a WAV file.
 * @param {import('node-web-audio-api').AudioBuffer} audioBuffer
 * @param {string} outPath  - full file path including .wav extension
 */
function writeWAV(audioBuffer, outPath) {
  const nCh  = audioBuffer.numberOfChannels;
  const sr   = audioBuffer.sampleRate;
  const len  = audioBuffer.length;
  const bps  = 2;
  const ba   = nCh * bps;
  const ds   = len * ba;
  const buf  = Buffer.alloc(44 + ds);

  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + ds, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);        // sub-chunk size
  buf.writeUInt16LE(1, 20);         // PCM
  buf.writeUInt16LE(nCh, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * ba, 28);   // byte rate
  buf.writeUInt16LE(ba, 32);        // block align
  buf.writeUInt16LE(16, 34);        // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(ds, 40);

  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < nCh; ch++) {
      const s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
      buf.writeInt16LE(s < 0 ? s * 32768 : s * 32767, off);
      off += 2;
    }
  }

  fs.writeFileSync(outPath, buf);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode AudioBuffer → WAV file on disk.
 * @param {import('node-web-audio-api').AudioBuffer} audioBuffer
 * @param {string} id  - unique render ID for temp filename
 * @returns {string}   path to the WAV file
 */
function encodeWAV(audioBuffer, id) {
  const outPath = path.join(TEMP_DIR, `${id}.wav`);
  writeWAV(audioBuffer, outPath);
  return outPath;
}

/**
 * Encode AudioBuffer → MP3 file using ffmpeg.
 * @param {import('node-web-audio-api').AudioBuffer} audioBuffer
 * @param {string} id
 * @param {number} [bitrate]  - kbps (default 128)
 * @returns {Promise<string>} path to the MP3 file
 */
async function encodeMP3(audioBuffer, id, bitrate = 128) {
  // Write WAV first
  const wavPath = path.join(TEMP_DIR, `${id}_src.wav`);
  writeWAV(audioBuffer, wavPath);

  const mp3Path = path.join(TEMP_DIR, `${id}.mp3`);

  // ffmpeg: read WAV, encode to MP3
  await execP(
    `ffmpeg -y -i "${wavPath}" -codec:a libmp3lame -b:a ${bitrate}k "${mp3Path}"`
  );

  // Clean up intermediate WAV
  fs.unlinkSync(wavPath);

  return mp3Path;
}

/**
 * Clean up a temp file safely.
 * @param {string} filePath
 */
function cleanUp(filePath) {
  try { fs.unlinkSync(filePath); } catch (_) {}
}

module.exports = { encodeWAV, encodeMP3, cleanUp };
