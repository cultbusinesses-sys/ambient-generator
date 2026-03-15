/**
 * audio-export.js
 * ---------------
 * Converts a rendered AudioBuffer into a downloadable WAV or MP3 file.
 *
 * Responsibilities:
 *   - Encode AudioBuffer → WAV (pure JS, no library, very fast)
 *   - Encode AudioBuffer → MP3 (via lamejs loaded from CDN)
 *   - Report encoding progress via callback
 *   - Trigger browser download
 *   - Return a Blob URL for the video-export pipeline
 *
 * Speed targets (matches audio-engine.js render speed):
 *   WAV  — essentially instant (just an ArrayBuffer copy + header)
 *   MP3  — ~2–5s for 1 hour of audio at 128kbps
 *
 * Usage:
 *   const exporter = new AudioExporter();
 *
 *   // Download as WAV:
 *   await exporter.downloadWAV(audioBuffer, 'ambient-track');
 *
 *   // Download as MP3:
 *   await exporter.downloadMP3(audioBuffer, 'ambient-track', (p) => console.log(p));
 *
 *   // Get a Blob URL (for video pipeline):
 *   const url = await exporter.toBlobURL(audioBuffer, 'wav');
 */

export class AudioExporter {

  constructor() {
    this._lamejsLoaded = false;
    this._lame         = null;
  }

  // ---------------------------------------------------------------------------
  // Public: Download WAV
  // ---------------------------------------------------------------------------

  /**
   * Encodes AudioBuffer to WAV and triggers a browser download.
   * Synchronous encoding — instant for any duration.
   *
   * @param {AudioBuffer} audioBuffer
   * @param {string}      [filename]     - without extension (default 'ambient')
   * @param {Function}    [onProgress]   - called with 0..1
   */
  async downloadWAV(audioBuffer, filename = 'ambient', onProgress) {
    if (onProgress) onProgress(0.1);
    const blob = this._encodeWAV(audioBuffer);
    if (onProgress) onProgress(0.95);
    this._triggerDownload(blob, `${filename}.wav`);
    if (onProgress) onProgress(1.0);
    return blob;
  }

  // ---------------------------------------------------------------------------
  // Public: Download MP3
  // ---------------------------------------------------------------------------

  /**
   * Encodes AudioBuffer to MP3 at 128kbps and triggers a browser download.
   * Uses lamejs (loaded from CDN on first call).
   *
   * @param {AudioBuffer} audioBuffer
   * @param {string}      [filename]
   * @param {Function}    [onProgress]  - called with 0..1
   * @param {number}      [bitrate]     - kbps, default 128
   */
  async downloadMP3(audioBuffer, filename = 'ambient', onProgress, bitrate = 128) {
    if (onProgress) onProgress(0.02);

    await this._ensureLamejs();
    if (onProgress) onProgress(0.05);

    const blob = await this._encodeMP3(audioBuffer, bitrate, onProgress);
    this._triggerDownload(blob, `${filename}.mp3`);
    if (onProgress) onProgress(1.0);
    return blob;
  }

  // ---------------------------------------------------------------------------
  // Public: Get Blob URL (used by video-export.js)
  // ---------------------------------------------------------------------------

  /**
   * Returns a temporary object URL for the encoded audio.
   * The caller is responsible for revoking it with URL.revokeObjectURL().
   *
   * @param {AudioBuffer} audioBuffer
   * @param {'wav'|'mp3'} format
   * @param {Function}    [onProgress]
   * @returns {Promise<string>} object URL
   */
  async toBlobURL(audioBuffer, format = 'wav', onProgress) {
    let blob;
    if (format === 'mp3') {
      await this._ensureLamejs();
      blob = await this._encodeMP3(audioBuffer, 128, onProgress);
    } else {
      blob = this._encodeWAV(audioBuffer);
      if (onProgress) onProgress(1.0);
    }
    return URL.createObjectURL(blob);
  }

  // ---------------------------------------------------------------------------
  // WAV Encoder — pure JS, no dependencies
  // ---------------------------------------------------------------------------

  /**
   * Encodes an AudioBuffer to a 16-bit PCM WAV Blob.
   * Interleaves all channels. Handles mono and stereo.
   *
   * WAV format:
   *   RIFF header (4) + file size (4) + WAVE (4)
   *   fmt  chunk: 24 bytes
   *   data chunk: header (8) + samples
   *
   * @param {AudioBuffer} ab
   * @returns {Blob}
   */
  _encodeWAV(ab) {
    const numChannels  = ab.numberOfChannels;
    const sampleRate   = ab.sampleRate;
    const numSamples   = ab.length;
    const bytesPerSamp = 2;                              // 16-bit
    const blockAlign   = numChannels * bytesPerSamp;
    const byteRate     = sampleRate * blockAlign;
    const dataSize     = numSamples * blockAlign;
    const totalSize    = 44 + dataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view   = new DataView(buffer);

    // Helper: write ASCII string at byte offset
    const str = (offset, s) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };

    // RIFF chunk descriptor
    str(0,  'RIFF');
    view.setUint32(4,  totalSize - 8, true);   // file size - 8
    str(8,  'WAVE');

    // fmt sub-chunk
    str(12, 'fmt ');
    view.setUint32(16, 16,           true);    // sub-chunk size (PCM)
    view.setUint16(20, 1,            true);    // audio format (1 = PCM)
    view.setUint16(22, numChannels,  true);
    view.setUint32(24, sampleRate,   true);
    view.setUint32(28, byteRate,     true);
    view.setUint16(32, blockAlign,   true);
    view.setUint16(34, 16,           true);    // bits per sample

    // data sub-chunk
    str(36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave channel data
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        // Clamp float → int16
        const sample = Math.max(-1, Math.min(1, ab.getChannelData(ch)[i]));
        const int16  = sample < 0 ? sample * 32768 : sample * 32767;
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  // ---------------------------------------------------------------------------
  // MP3 Encoder — uses lamejs
  // ---------------------------------------------------------------------------

  /**
   * Loads lamejs from CDN if not already loaded.
   * lamejs is a pure-JS MP3 encoder port of LAME.
   */
  async _ensureLamejs() {
    if (this._lamejsLoaded) return;

    return new Promise((resolve, reject) => {
      // Check if already on the page
      if (window.lamejs) {
        this._lame         = window.lamejs;
        this._lamejsLoaded = true;
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src   = 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js';

      script.onload = () => {
        this._lame         = window.lamejs;
        this._lamejsLoaded = true;
        resolve();
      };

      script.onerror = () => reject(new Error('AudioExporter: failed to load lamejs from CDN'));
      document.head.appendChild(script);
    });
  }

  /**
   * Encodes AudioBuffer → MP3 using lamejs.
   * Processes audio in chunks to allow progress reporting.
   *
   * @param {AudioBuffer} ab
   * @param {number}      bitrate     - kbps
   * @param {Function}    [onProgress]
   * @returns {Promise<Blob>}
   */
  async _encodeMP3(ab, bitrate, onProgress) {
    const numChannels = ab.numberOfChannels;
    const sampleRate  = ab.sampleRate;
    const numSamples  = ab.length;

    // lamejs works with int16 samples
    const left  = this._floatToInt16(ab.getChannelData(0));
    const right = numChannels > 1
      ? this._floatToInt16(ab.getChannelData(1))
      : left;   // duplicate mono to right channel

    // Create MP3 encoder
    const mp3encoder = new this._lame.Mp3Encoder(2, sampleRate, bitrate);
    const mp3Data    = [];

    // Process in 1152-sample chunks (MP3 frame size)
    const CHUNK = 1152;
    let   processed = 0;

    while (processed < numSamples) {
      const end      = Math.min(processed + CHUNK, numSamples);
      const leftChunk  = left.subarray(processed, end);
      const rightChunk = right.subarray(processed, end);

      const encoded = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      if (encoded.length > 0) mp3Data.push(encoded);

      processed = end;

      if (onProgress) {
        onProgress(0.05 + (processed / numSamples) * 0.9);
      }

      // Yield to the event loop every 100 chunks to avoid blocking the UI
      if ((processed / CHUNK) % 100 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Flush remaining bytes
    const flushed = mp3encoder.flush();
    if (flushed.length > 0) mp3Data.push(flushed);

    if (onProgress) onProgress(0.98);

    return new Blob(mp3Data, { type: 'audio/mpeg' });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Converts Float32Array (range -1..1) to Int16Array for lamejs.
   * @param {Float32Array} floats
   * @returns {Int16Array}
   */
  _floatToInt16(floats) {
    const int16 = new Int16Array(floats.length);
    for (let i = 0; i < floats.length; i++) {
      const s    = Math.max(-1, Math.min(1, floats[i]));
      int16[i]   = s < 0 ? s * 32768 : s * 32767;
    }
    return int16;
  }

  /**
   * Triggers a browser file download from a Blob.
   * @param {Blob}   blob
   * @param {string} filename  - with extension
   */
  _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href    = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a short delay to ensure the download starts
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---------------------------------------------------------------------------
  // Metadata helpers — useful for filenames
  // ---------------------------------------------------------------------------

  /**
   * Generates a filename from a config object.
   * Example: "ambient-A-dorian-10m"
   *
   * @param {Object} config   - music config
   * @param {number} duration - seconds
   * @returns {string}
   */
  static buildFilename(config, duration) {
    const root  = (config.rootNote  ?? 'A').replace('#', 's');
    const scale = (config.scaleName ?? 'ambient').split('_')[0];
    const dur   = duration < 60 ? `${duration}s`
                : duration < 3600 ? `${Math.round(duration / 60)}m`
                : `${Math.round(duration / 3600)}hr`;
    return `ambient-${root}-${scale}-${dur}`;
  }
}
