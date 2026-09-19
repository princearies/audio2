// Audio format conversion utilities

export type AudioFormat = 'webm' | 'mp3' | 'wav' | 'ogg';
export type BitDepth = 8 | 16 | 24 | 32;
export type BitRate = 64 | 96 | 128 | 192 | 256 | 320;

export interface FormatOption {
  value: AudioFormat;
  label: string;
  mimeType: string;
  extension: string;
}

export interface BitDepthOption {
  value: BitDepth;
  label: string;
  description: string;
}

export interface BitRateOption {
  value: BitRate;
  label: string;
  description: string;
}

export const FORMAT_OPTIONS: FormatOption[] = [
  { value: 'mp3', label: 'MP3', mimeType: 'audio/mpeg', extension: 'mp3' },
  { value: 'wav', label: 'WAV', mimeType: 'audio/wav', extension: 'wav' },
  { value: 'webm', label: 'WebM', mimeType: 'audio/webm', extension: 'webm' },
  { value: 'ogg', label: 'OGG', mimeType: 'audio/ogg', extension: 'ogg' },
];

export const BIT_DEPTH_OPTIONS: BitDepthOption[] = [
  { value: 8, label: '8-bit', description: 'Low quality, small size' },
  { value: 16, label: '16-bit', description: 'Standard quality (CD)' },
  { value: 24, label: '24-bit', description: 'High quality (Studio)' },
  { value: 32, label: '32-bit', description: 'Maximum quality' },
];

export const BIT_RATE_OPTIONS: BitRateOption[] = [
  { value: 64, label: '64 kbps', description: 'Voice/Low quality' },
  { value: 96, label: '96 kbps', description: 'Speech/Mobile' },
  { value: 128, label: '128 kbps', description: 'Standard (Default)' },
  { value: 192, label: '192 kbps', description: 'Good quality' },
  { value: 256, label: '256 kbps', description: 'High quality' },
  { value: 320, label: '320 kbps', description: 'Maximum quality' },
];

export const DEFAULT_BIT_RATE: BitRate = 128;
export const DEFAULT_BIT_DEPTH: BitDepth = 16;

// Encode AudioBuffer to WAV format with configurable bit depth
export function encodeWAV(audioBuffer: AudioBuffer, bitDepth: BitDepth = 16): Blob {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM

  const samples = interleave(audioBuffer);
  const bytesPerSample = bitDepth / 8;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitDepth, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write samples based on bit depth
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    
    if (bitDepth === 8) {
      // 8-bit is unsigned
      const intSample = Math.floor((sample + 1) * 127.5);
      view.setUint8(offset, intSample);
      offset += 1;
    } else if (bitDepth === 16) {
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    } else if (bitDepth === 24) {
      const intSample = sample < 0 ? sample * 0x800000 : sample * 0x7FFFFF;
      const bytes = [
        intSample & 0xFF,
        (intSample >> 8) & 0xFF,
        (intSample >> 16) & 0xFF,
      ];
      view.setUint8(offset, bytes[0]);
      view.setUint8(offset + 1, bytes[1]);
      view.setUint8(offset + 2, bytes[2]);
      offset += 3;
    } else if (bitDepth === 32) {
      const intSample = sample < 0 ? sample * 0x80000000 : sample * 0x7FFFFFFF;
      view.setInt32(offset, intSample, true);
      offset += 4;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function interleave(audioBuffer: AudioBuffer): Float32Array {
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const result = new Float32Array(length * numChannels);

  if (numChannels === 1) {
    result.set(audioBuffer.getChannelData(0));
    return result;
  }

  let inputIndex = 0;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      result[inputIndex++] = audioBuffer.getChannelData(channel)[i];
    }
  }

  return result;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Encode AudioBuffer to MP3 format using lamejs with configurable bit rate
export async function encodeMP3(audioBuffer: AudioBuffer, bitRate: BitRate = 128): Promise<Blob> {
  const lamejs = await import('lamejs');

  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, bitRate);

  const samples = audioBuffer.getChannelData(0);
  const sampleBlockSize = 1152;
  const mp3Data: Int8Array[] = [];

  // Convert Float32 to Int16
  const left = floatTo16BitPCM(samples);

  let right: Int16Array | null = null;
  if (numChannels > 1) {
    right = floatTo16BitPCM(audioBuffer.getChannelData(1));
  }

  for (let i = 0; i < left.length; i += sampleBlockSize) {
    const leftChunk = left.subarray(i, i + sampleBlockSize);
    let mp3buf: Int8Array;

    if (numChannels === 1) {
      mp3buf = mp3encoder.encodeBuffer(leftChunk);
    } else {
      const rightChunk = right!.subarray(i, i + sampleBlockSize);
      mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    }

    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }

  const end = mp3encoder.flush();
  if (end.length > 0) {
    mp3Data.push(end);
  }

  // Combine all chunks into a single ArrayBuffer
  const totalLength = mp3Data.reduce((acc, buf) => acc + buf.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of mp3Data) {
    combined.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), offset);
    offset += buf.length;
  }
  return new Blob([combined.buffer], { type: 'audio/mp3' });
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return output;
}

// Get the best MIME type for MediaRecorder based on format
export function getMediaRecorderMimeType(format: AudioFormat): string {
  switch (format) {
    case 'webm':
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        return 'audio/webm;codecs=opus';
      }
      return 'audio/webm';
    case 'ogg':
      if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        return 'audio/ogg;codecs=opus';
      }
      return 'audio/ogg';
    default:
      return 'audio/webm';
  }
}

// Convert audio buffer to desired format with quality options
export async function convertAudio(
  audioBuffer: AudioBuffer,
  format: AudioFormat,
  options: {
    bitDepth?: BitDepth;
    bitRate?: BitRate;
  } = {}
): Promise<Blob> {
  const { bitDepth = DEFAULT_BIT_DEPTH, bitRate = DEFAULT_BIT_RATE } = options;

  switch (format) {
    case 'wav':
      return encodeWAV(audioBuffer, bitDepth);
    case 'mp3':
      return encodeMP3(audioBuffer, bitRate);
    case 'webm':
    case 'ogg':
    default:
      // For webm/ogg, we'll encode as WAV and let the user know
      // Or we can re-encode using MediaRecorder
      return await reEncodeWithMediaRecorder(audioBuffer, format);
  }
}

// Re-encode using MediaRecorder for webm/ogg
async function reEncodeWithMediaRecorder(
  audioBuffer: AudioBuffer,
  format: AudioFormat
): Promise<Blob> {
  const mimeType = getMediaRecorderMimeType(format);

  if (!MediaRecorder.isTypeSupported(mimeType)) {
    // Fallback to WAV
    return encodeWAV(audioBuffer);
  }

  const audioCtx = new AudioContext({ sampleRate: audioBuffer.sampleRate });

  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;

  const destination = audioCtx.createMediaStreamDestination();
  source.connect(destination);

  const stream = destination.stream;
  const mediaRecorder = new MediaRecorder(stream, { mimeType });

  const chunks: Blob[] = [];

  const promise = new Promise<Blob>((resolve) => {
    mediaRecorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      resolve(blob);
    };

    mediaRecorder.start();

    source.onended = () => {
      setTimeout(() => {
        mediaRecorder.stop();
        stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        audioCtx.close();
      }, 100);
    };

    source.start();
  });

  return promise;
}

// Check if Web Share API with files is supported
export function canShareFiles(): boolean {
  return typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File([''], 'test.mp3', { type: 'audio/mp3' })] });
}

// Share file using Web Share API
export async function shareFile(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({
      files: [file],
      title: 'Voice Recording',
      text: 'Check out my voice recording!',
    });
  } else {
    throw new Error('Sharing files is not supported on this device/browser');
  }
}
