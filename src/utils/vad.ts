// Voice Activity Detection (VAD) utilities

export interface SilenceDetectionResult {
  voiceStart: number; // Start of voice in seconds
  voiceEnd: number;   // End of voice in seconds
  silenceAtStart: number; // Duration of silence at start
  silenceAtEnd: number;   // Duration of silence at end
}

export interface VADOptions {
  silenceThreshold: number; // RMS threshold below which audio is considered silent (0-1)
  minSilenceDuration: number; // Minimum silence duration in seconds
  minVoiceDuration: number; // Minimum voice duration in seconds to be considered valid
}

const DEFAULT_OPTIONS: VADOptions = {
  silenceThreshold: 0.02,
  minSilenceDuration: 0.3,
  minVoiceDuration: 0.1,
};

/**
 * Calculate RMS (Root Mean Square) of audio samples
 */
function calculateRMS(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  const length = end - start;
  
  for (let i = start; i < end; i++) {
    sum += samples[i] * samples[i];
  }
  
  return Math.sqrt(sum / length);
}

/**
 * Detect voice activity and silence regions in audio buffer
 */
export function detectVoiceActivity(
  audioBuffer: AudioBuffer,
  options: Partial<VADOptions> = {}
): SilenceDetectionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  
  // Analyze audio in small windows
  const windowSize = Math.floor(sampleRate * 0.03); // 30ms windows
  const numWindows = Math.floor(channelData.length / windowSize);
  
  // Calculate RMS for each window
  const rmsValues: number[] = [];
  for (let i = 0; i < numWindows; i++) {
    const start = i * windowSize;
    const end = start + windowSize;
    rmsValues.push(calculateRMS(channelData, start, end));
  }
  
  // Find voice regions (above threshold)
  const isVoice = rmsValues.map(rms => rms >= opts.silenceThreshold);
  
  // Find first and last voice sample
  let firstVoiceWindow = -1;
  let lastVoiceWindow = -1;
  
  for (let i = 0; i < isVoice.length; i++) {
    if (isVoice[i]) {
      if (firstVoiceWindow === -1) {
        firstVoiceWindow = i;
      }
      lastVoiceWindow = i;
    }
  }
  
  // If no voice detected, return full duration
  if (firstVoiceWindow === -1) {
    return {
      voiceStart: 0,
      voiceEnd: duration,
      silenceAtStart: 0,
      silenceAtEnd: 0,
    };
  }
  
  // Convert window indices to time
  const windowDuration = windowSize / sampleRate;
  let voiceStart = firstVoiceWindow * windowDuration;
  let voiceEnd = (lastVoiceWindow + 1) * windowDuration;
  
  // Apply minimum silence duration padding
  const minSilenceSamples = Math.floor(opts.minSilenceDuration / windowDuration);
  
  // Extend voice start backwards if there's voice activity nearby
  if (firstVoiceWindow > 0) {
    for (let i = firstVoiceWindow - 1; i >= Math.max(0, firstVoiceWindow - minSilenceSamples); i--) {
      if (isVoice[i]) {
        voiceStart = i * windowDuration;
        break;
      }
    }
  }
  
  // Extend voice end forwards if there's voice activity nearby
  if (lastVoiceWindow < isVoice.length - 1) {
    for (let i = lastVoiceWindow + 1; i < Math.min(isVoice.length, lastVoiceWindow + minSilenceSamples); i++) {
      if (isVoice[i]) {
        voiceEnd = (i + 1) * windowDuration;
        break;
      }
    }
  }
  
  // Ensure minimum voice duration
  if (voiceEnd - voiceStart < opts.minVoiceDuration) {
    voiceStart = Math.max(0, voiceStart - opts.minVoiceDuration / 2);
    voiceEnd = Math.min(duration, voiceEnd + opts.minVoiceDuration / 2);
  }
  
  return {
    voiceStart,
    voiceEnd,
    silenceAtStart: voiceStart,
    silenceAtEnd: duration - voiceEnd,
  };
}

/**
 * Auto-trim silence from audio buffer
 */
export function autoTrimSilence(
  audioBuffer: AudioBuffer,
  options: Partial<VADOptions> = {}
): { startTrim: number; endTrim: number } {
  const result = detectVoiceActivity(audioBuffer, options);
  const duration = audioBuffer.duration;
  
  // Convert to trim percentages (0-1)
  const startTrim = result.voiceStart / duration;
  const endTrim = result.voiceEnd / duration;
  
  return {
    startTrim: Math.max(0, Math.min(1, startTrim)),
    endTrim: Math.max(0, Math.min(1, endTrim)),
  };
}

/**
 * Get silence regions in audio for visualization
 */
export function getSilenceRegions(
  audioBuffer: AudioBuffer,
  options: Partial<VADOptions> = {}
): Array<{ start: number; end: number }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  
  const windowSize = Math.floor(sampleRate * 0.03);
  const numWindows = Math.floor(channelData.length / windowSize);
  const windowDuration = windowSize / sampleRate;
  
  const regions: Array<{ start: number; end: number }> = [];
  let inSilence = false;
  let silenceStart = 0;
  let silenceWindowCount = 0;
  
  for (let i = 0; i < numWindows; i++) {
    const start = i * windowSize;
    const end = start + windowSize;
    const rms = calculateRMS(channelData, start, end);
    const isSilent = rms < opts.silenceThreshold;
    
    if (isSilent && !inSilence) {
      // Start of silence
      inSilence = true;
      silenceStart = i * windowDuration;
      silenceWindowCount = 1;
    } else if (isSilent && inSilence) {
      // Continue silence
      silenceWindowCount++;
    } else if (!isSilent && inSilence) {
      // End of silence
      inSilence = false;
      const silenceDuration = silenceWindowCount * windowDuration;
      
      // Only add if silence is long enough
      if (silenceDuration >= opts.minSilenceDuration) {
        regions.push({
          start: silenceStart,
          end: i * windowDuration,
        });
      }
    }
  }
  
  // Handle trailing silence
  if (inSilence) {
    const silenceDuration = silenceWindowCount * windowDuration;
    if (silenceDuration >= opts.minSilenceDuration) {
      regions.push({
        start: silenceStart,
        end: audioBuffer.duration,
      });
    }
  }
  
  return regions;
}

/**
 * Actually cut/remove silence from audio buffer
 * Returns a new AudioBuffer with silence removed
 */
export function cutSilenceFromBuffer(
  audioBuffer: AudioBuffer,
  options: Partial<VADOptions> = {}
): AudioBuffer {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  
  // Get all silence regions
  const silenceRegions = getSilenceRegions(audioBuffer, opts);
  
  // If no silence found, return original buffer
  if (silenceRegions.length === 0) {
    return audioBuffer;
  }
  
  // Calculate voice regions (non-silence parts)
  const voiceRegions: Array<{ start: number; end: number }> = [];
  let currentTime = 0;
  
  for (const silence of silenceRegions) {
    if (silence.start > currentTime) {
      voiceRegions.push({
        start: currentTime,
        end: silence.start,
      });
    }
    currentTime = silence.end;
  }
  
  // Add remaining voice after last silence
  if (currentTime < duration) {
    voiceRegions.push({
      start: currentTime,
      end: duration,
    });
  }
  
  // If no voice regions, return original
  if (voiceRegions.length === 0) {
    return audioBuffer;
  }
  
  // Calculate total voice duration
  const totalVoiceDuration = voiceRegions.reduce((sum, region) => sum + (region.end - region.start), 0);
  const totalVoiceSamples = Math.floor(totalVoiceDuration * sampleRate);
  
  // Create new AudioBuffer
  const newBuffer = new AudioContext().createBuffer(
    numChannels,
    totalVoiceSamples,
    sampleRate
  );
  
  // Copy voice regions to new buffer
  let writeOffset = 0;
  for (const region of voiceRegions) {
    const startSample = Math.floor(region.start * sampleRate);
    const endSample = Math.floor(region.end * sampleRate);
    const regionLength = endSample - startSample;
    
    for (let channel = 0; channel < numChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);
      
      for (let i = 0; i < regionLength; i++) {
        targetData[writeOffset + i] = sourceData[startSample + i];
      }
    }
    
    writeOffset += regionLength;
  }
  
  return newBuffer;
}
