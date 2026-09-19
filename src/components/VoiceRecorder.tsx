import { useState, useRef, useCallback, useEffect } from 'react';
import WaveformVisualizer from './WaveformVisualizer';
import {
  AudioFormat,
  BitDepth,
  BitRate,
  FORMAT_OPTIONS,
  BIT_DEPTH_OPTIONS,
  BIT_RATE_OPTIONS,
  DEFAULT_BIT_DEPTH,
  DEFAULT_BIT_RATE,
  convertAudio,
  encodeWAV,
  canShareFiles,
  shareFile,
} from '../utils/audioConverter';
import { autoTrimSilence, getSilenceRegions, cutSilenceFromBuffer } from '../utils/vad';

export default function VoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<AudioFormat>('mp3');
  const [isConverting, setIsConverting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareSupported, setShareSupported] = useState(false);
  const [convertedBlob, setConvertedBlob] = useState<Blob | null>(null);
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null);
  
  // VAD (Voice Activity Detection) states
  const [silenceThreshold, setSilenceThreshold] = useState(0.02);
  const [silenceRegions, setSilenceRegions] = useState<Array<{ start: number; end: number }>>([]);
  const [isAutoTrimming, setIsAutoTrimming] = useState(false);
  
  // Audio quality settings
  const [bitDepth, setBitDepth] = useState<BitDepth>(DEFAULT_BIT_DEPTH);
  const [bitRate, setBitRate] = useState<BitRate>(DEFAULT_BIT_RATE);
  
  // Trim result message
  const [trimResultMessage, setTrimResultMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const animationRef = useRef<number>(0);

  // Check share support on mount
  useEffect(() => {
    setShareSupported(canShareFiles());
  }, []);

  // Format time as mm:ss
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Convert audio to selected format whenever format or audioBuffer changes
  useEffect(() => {
    if (!audioBuffer) {
      setConvertedBlob(null);
      if (convertedUrl) {
        URL.revokeObjectURL(convertedUrl);
        setConvertedUrl(null);
      }
      return;
    }

    const doConvert = async () => {
      setIsConverting(true);
      try {
        const blob = await convertAudio(audioBuffer, format, { bitDepth, bitRate });
        setConvertedBlob(blob);
        const url = URL.createObjectURL(blob);
        if (convertedUrl) URL.revokeObjectURL(convertedUrl);
        setConvertedUrl(url);
      } catch (err) {
        console.error('Conversion error:', err);
      } finally {
        setIsConverting(false);
      }
    };

    doConvert();
  }, [audioBuffer, format, bitDepth, bitRate]);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up audio context and analyser
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Set up MediaRecorder - record in webm for best compatibility, convert later
      const mimeType = 'audio/webm;codecs=opus';
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'audio/webm',
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        // Decode audio for waveform and conversion
        try {
          const arrayBuffer = await blob.arrayBuffer();
          const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
          setAudioBuffer(decodedBuffer);
          setDuration(decodedBuffer.duration);
          setTrimStart(0);
          setTrimEnd(1);
        } catch (err) {
          console.error('Error decoding audio:', err);
        }

        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setError('Microphone access denied. Please allow microphone access and try again.');
      console.error('Error starting recording:', err);
    }
  }, []);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsPaused(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Pause/Resume recording
  const togglePause = useCallback(() => {
    if (!mediaRecorderRef.current) return;

    if (isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } else {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isPaused]);

  // Play audio
  const playAudio = useCallback(() => {
    if (!audioUrl) return;

    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
    }

    const audio = new Audio(audioUrl);
    audioElementRef.current = audio;

    audio.onplay = () => {
      setIsPlaying(true);
      audio.currentTime = trimStart * duration;
    };

    audio.onended = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.currentTime >= trimEnd * duration) {
        audio.pause();
        setIsPlaying(false);
      }
    };

    audio.play();
  }, [audioUrl, trimStart, trimEnd, duration]);

  // Pause audio
  const pauseAudio = useCallback(() => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  // Stop audio playback
  const stopAudio = useCallback(() => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
      audioElementRef.current = null;
      setIsPlaying(false);
      setCurrentTime(0);
    }
  }, []);

  // Download audio in selected format
  const downloadAudio = useCallback(() => {
    const blob = convertedBlob || audioBlob;
    const url = convertedUrl || audioUrl;
    if (!blob || !url) return;

    const formatInfo = FORMAT_OPTIONS.find(f => f.value === format);
    const extension = formatInfo?.extension || 'webm';

    const link = document.createElement('a');
    link.href = url;
    link.download = `recording-${Date.now()}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [audioBlob, audioUrl, convertedBlob, convertedUrl, format]);

  // Share audio
  const shareAudio = useCallback(async () => {
    const blob = convertedBlob || audioBlob;
    if (!blob) return;

    const formatInfo = FORMAT_OPTIONS.find(f => f.value === format);
    const extension = formatInfo?.extension || 'webm';
    const filename = `recording-${Date.now()}.${extension}`;

    setIsSharing(true);
    try {
      await shareFile(blob, filename);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Sharing failed. Try downloading instead.');
      }
    } finally {
      setIsSharing(false);
    }
  }, [audioBlob, convertedBlob, format]);

  // Auto-trim silence using VAD - actually cuts the silence
  const autoTrimSilenceHandler = useCallback(() => {
    if (!audioBuffer) return;

    setIsAutoTrimming(true);
    
    try {
      // Detect silence regions for visualization
      const regions = getSilenceRegions(audioBuffer, {
        silenceThreshold,
        minSilenceDuration: 0.3,
      });
      setSilenceRegions(regions);

      // Actually cut the silence from the audio buffer
      const trimmedBuffer = cutSilenceFromBuffer(audioBuffer, {
        silenceThreshold,
        minSilenceDuration: 0.3,
      });

      // Update the audio buffer with trimmed version
      setAudioBuffer(trimmedBuffer);
      setDuration(trimmedBuffer.duration);
      
      // Reset trim values since we've already trimmed
      setTrimStart(0);
      setTrimEnd(1);

      // Create new blob from trimmed buffer for download
      const wavBlob = encodeWAV(trimmedBuffer, bitDepth);
      setAudioBlob(wavBlob);
      
      // Update audio URL
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      const newUrl = URL.createObjectURL(wavBlob);
      setAudioUrl(newUrl);

      // Show success message
      const silenceRemoved = audioBuffer.duration - trimmedBuffer.duration;
      if (silenceRemoved > 0) {
        setError(null);
        setTrimResultMessage(
          `✓ Removed ${silenceRemoved.toFixed(2)}s of silence. New duration: ${trimmedBuffer.duration.toFixed(2)}s`
        );
        // Clear message after 5 seconds
        setTimeout(() => setTrimResultMessage(null), 5000);
      } else {
        setTrimResultMessage('No silence detected to remove.');
        setTimeout(() => setTrimResultMessage(null), 3000);
      }
    } catch (err) {
      console.error('Auto-trim error:', err);
      setError('Failed to trim silence. Try adjusting the threshold.');
    } finally {
      setIsAutoTrimming(false);
    }
  }, [audioBuffer, silenceThreshold, bitDepth, audioUrl]);

  // Reset recorder
  const resetRecorder = useCallback(() => {
    stopAudio();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    if (convertedUrl) URL.revokeObjectURL(convertedUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setAudioBuffer(null);
    setConvertedBlob(null);
    setConvertedUrl(null);
    setRecordingTime(0);
    setCurrentTime(0);
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(1);
    setError(null);
    setSilenceRegions([]);
    setTrimResultMessage(null);
  }, [audioUrl, convertedUrl, stopAudio]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      // Space: Start/Stop recording
      if (e.code === 'Space' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (!audioBuffer && !isRecording) {
          startRecording();
        } else if (isRecording) {
          stopRecording();
        } else if (audioBuffer && !isPlaying) {
          playAudio();
        } else if (isPlaying) {
          pauseAudio();
        }
      }

      // P: Pause/Resume recording
      if (e.code === 'KeyP' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (isRecording) {
          togglePause();
        }
      }

      // R: Reset/New recording
      if (e.code === 'KeyR' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (audioBuffer) {
          resetRecorder();
        }
      }

      // D: Download
      if (e.code === 'KeyD' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (audioBuffer && !isConverting) {
          downloadAudio();
        }
      }

      // S: Share (if supported)
      if (e.code === 'KeyS' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (audioBuffer && shareSupported && !isConverting && !isSharing) {
          shareAudio();
        }
      }

      // A: Auto-trim silence
      if (e.code === 'KeyA' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (audioBuffer && !isAutoTrimming) {
          autoTrimSilenceHandler();
        }
      }

      // Escape: Stop playback
      if (e.code === 'Escape') {
        e.preventDefault();
        if (isPlaying) {
          stopAudio();
        }
      }

      // Enter: Submit (for workflow - can be customized)
      if (e.code === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (audioBuffer && !isConverting) {
          // Download and then reset for next phrase
          downloadAudio();
          setTimeout(() => {
            resetRecorder();
          }, 500);
        }
      }

      // Arrow Left/Right: Adjust trim
      if (e.code === 'ArrowLeft' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (audioBuffer) {
          setTrimStart(Math.max(0, trimStart - 0.01));
        }
      }
      if (e.code === 'ArrowRight' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (audioBuffer) {
          setTrimEnd(Math.min(1, trimEnd + 0.01));
        }
      }

      // Shift + Arrow Left/Right: Adjust end trim
      if (e.code === 'ArrowLeft' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (audioBuffer) {
          setTrimEnd(Math.max(trimStart + 0.01, trimEnd - 0.01));
        }
      }
      if (e.code === 'ArrowRight' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (audioBuffer) {
          setTrimStart(Math.min(trimEnd - 0.01, trimStart + 0.01));
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [audioBuffer, isRecording, isPlaying, isConverting, isSharing, shareSupported, isAutoTrimming, trimStart, trimEnd, startRecording, stopRecording, togglePause, resetRecorder, downloadAudio, shareAudio, autoTrimSilenceHandler, playAudio, pauseAudio, stopAudio]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (convertedUrl) URL.revokeObjectURL(convertedUrl);
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const currentFormatInfo = FORMAT_OPTIONS.find(f => f.value === format);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-indigo-950 to-gray-900 flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-3">
          <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            🎙️ Online Voice Recorder
          </span>
        </h1>
        <p className="text-gray-400 text-lg">
          Record, trim, convert & share your voice — all in your browser.
        </p>
      </div>

      {/* Main Card */}
      <div className="w-full max-w-3xl bg-gray-800/50 backdrop-blur-lg rounded-2xl shadow-2xl border border-gray-700/50 p-6 md:p-8">
        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-center">
            <div className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
            <button onClick={() => setError(null)} className="mt-2 text-xs text-red-300 hover:text-red-200 underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Recording Timer */}
        <div className="text-center mb-6">
          <div className="text-5xl md:text-6xl font-mono font-bold text-white tracking-wider">
            {isRecording || isPaused ? formatTime(recordingTime) : audioBuffer ? formatTime(duration) : '00:00'}
          </div>
          {isRecording && !isPaused && (
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
              <span className="text-red-400 text-sm font-medium">Recording...</span>
            </div>
          )}
          {isPaused && (
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="w-3 h-3 bg-yellow-500 rounded-full"></span>
              <span className="text-yellow-400 text-sm font-medium">Paused</span>
            </div>
          )}
        </div>

        {/* Waveform Visualizer */}
        <div className="mb-6">
          <WaveformVisualizer
            analyser={analyserRef.current}
            isRecording={isRecording && !isPaused}
            isPlaying={isPlaying}
            audioContext={audioContextRef.current}
            audioBuffer={audioBuffer}
            currentTime={currentTime}
            duration={duration}
            trimStart={trimStart}
            trimEnd={trimEnd}
            silenceRegions={silenceRegions}
          />
        </div>

        {/* Recording Controls */}
        <div className="flex items-center justify-center gap-4 mb-6">
          {!audioBuffer ? (
            <>
              {!isRecording ? (
                <button
                  onClick={startRecording}
                  className="w-20 h-20 bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 transition-all duration-200 hover:scale-105 active:scale-95 group relative"
                  title="Start Recording (Space)"
                >
                  <svg className="w-8 h-8 text-white group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                  </svg>
                  <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    Space
                  </span>
                </button>
              ) : (
                <>
                  <button
                    onClick={togglePause}
                    className="w-14 h-14 bg-gradient-to-br from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 rounded-full flex items-center justify-center shadow-lg shadow-yellow-500/30 transition-all duration-200 hover:scale-105 active:scale-95 relative group"
                    title={isPaused ? 'Resume (P)' : 'Pause (P)'}
                  >
                    {isPaused ? (
                      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    ) : (
                      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                      </svg>
                    )}
                    <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      P
                    </span>
                  </button>

                  <button
                    onClick={stopRecording}
                    className="w-20 h-20 bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 transition-all duration-200 hover:scale-105 active:scale-95 relative group"
                    title="Stop Recording (Space)"
                  >
                    <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 6h12v12H6z" />
                    </svg>
                    <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      Space
                    </span>
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {!isPlaying ? (
                <button
                  onClick={playAudio}
                  className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 rounded-full flex items-center justify-center shadow-lg shadow-green-500/30 transition-all duration-200 hover:scale-105 active:scale-95 relative group"
                  title="Play (Space)"
                >
                  <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    Space
                  </span>
                </button>
              ) : (
                <button
                  onClick={pauseAudio}
                  className="w-16 h-16 bg-gradient-to-br from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 rounded-full flex items-center justify-center shadow-lg shadow-yellow-500/30 transition-all duration-200 hover:scale-105 active:scale-95 relative group"
                  title="Pause (Space)"
                >
                  <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                  <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    Space
                  </span>
                </button>
              )}

              <button
                onClick={stopAudio}
                className="w-12 h-12 bg-gradient-to-br from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 relative group"
                title="Stop (Esc)"
              >
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 6h12v12H6z" />
                </svg>
                <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  Esc
                </span>
              </button>
            </>
          )}
        </div>

        {/* Post-Recording Controls */}
        {audioBuffer && (
          <div className="space-y-4">
            {/* Trim Controls */}
            <div className="bg-gray-700/30 rounded-xl p-4">
              <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                </svg>
                Trim Audio
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-gray-400 text-sm mb-1 block">Start: {formatTime(trimStart * duration)}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={trimStart}
                    onChange={(e) => setTrimStart(Math.min(parseFloat(e.target.value), trimEnd - 0.01))}
                    className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-sm mb-1 block">End: {formatTime(trimEnd * duration)}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={trimEnd}
                    onChange={(e) => setTrimEnd(Math.max(parseFloat(e.target.value), trimStart + 0.01))}
                    className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* Auto-Silence Trimmer (VAD) */}
            <div className="bg-gray-700/30 rounded-xl p-4">
              <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                Auto-Silence Trimmer (VAD)
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-gray-400 text-sm mb-1 flex items-center justify-between">
                    <span>Silence Threshold</span>
                    <span className="text-white font-medium">{(silenceThreshold * 100).toFixed(1)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0.005"
                    max="0.1"
                    step="0.005"
                    value={silenceThreshold}
                    onChange={(e) => setSilenceThreshold(parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-red-500"
                  />
                  <p className="text-gray-500 text-xs mt-1">
                    Lower = more sensitive (detects quieter sounds), Higher = less sensitive. This will permanently remove silence from your recording.
                  </p>
                </div>
                <button
                  onClick={autoTrimSilenceHandler}
                  disabled={isAutoTrimming}
                  className="w-full px-4 py-2.5 bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-lg shadow-red-500/30 transition-all duration-200 hover:scale-105 active:scale-95 flex items-center justify-center gap-2 relative group"
                  title="Cut silence from audio (A)"
                >
                  {isAutoTrimming ? (
                    <>
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Cutting Silence...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                      </svg>
                      Cut Silence Automatically
                      <kbd className="ml-2 px-1.5 py-0.5 bg-white/20 rounded text-xs">A</kbd>
                    </>
                  )}
                </button>
                {silenceRegions.length > 0 && (
                  <div className="text-gray-400 text-sm bg-gray-800/50 rounded-lg p-2">
                    <span className="text-green-400 font-medium">✓ Detected {silenceRegions.length} silence region{silenceRegions.length > 1 ? 's' : ''}</span>
                    <span className="text-gray-500"> • Red areas in waveform show detected silence</span>
                  </div>
                )}
                {trimResultMessage && (
                  <div className="text-sm bg-green-500/10 border border-green-500/30 rounded-lg p-2 text-green-400">
                    {trimResultMessage}
                  </div>
                )}
              </div>
            </div>

            {/* Format Selection */}
            <div className="bg-gray-700/30 rounded-xl p-4">
              <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                Output Format
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {FORMAT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFormat(opt.value)}
                    className={`px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${
                      format === opt.value
                        ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/20'
                        : 'bg-gray-600/50 text-gray-300 hover:bg-gray-600 hover:text-white'
                    }`}
                  >
                    <span className="block text-base font-bold">{opt.label}</span>
                    <span className="block text-xs opacity-70">.{opt.extension}</span>
                  </button>
                ))}
              </div>
              {isConverting && (
                <div className="mt-3 flex items-center gap-2 text-indigo-400 text-sm">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Converting to {currentFormatInfo?.label}...
                </div>
              )}
            </div>

            {/* Bit Depth Selection (for WAV) */}
            {(format === 'wav') && (
              <div className="bg-gray-700/30 rounded-xl p-4">
                <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                  <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Bit Depth (Resolution)
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {BIT_DEPTH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setBitDepth(opt.value)}
                      className={`px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${
                        bitDepth === opt.value
                          ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/20'
                          : 'bg-gray-600/50 text-gray-300 hover:bg-gray-600 hover:text-white'
                      }`}
                      title={opt.description}
                    >
                      <span className="block text-base font-bold">{opt.label}</span>
                      <span className="block text-xs opacity-70">{opt.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Bit Rate Selection (for MP3/OGG) */}
            {(format === 'mp3' || format === 'ogg') && (
              <div className="bg-gray-700/30 rounded-xl p-4">
                <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                  <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Bit Rate (Quality)
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {BIT_RATE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setBitRate(opt.value)}
                      className={`px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${
                        bitRate === opt.value
                          ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg shadow-orange-500/20'
                          : 'bg-gray-600/50 text-gray-300 hover:bg-gray-600 hover:text-white'
                      }`}
                      title={opt.description}
                    >
                      <span className="block text-base font-bold">{opt.label}</span>
                      <span className="block text-xs opacity-70">{opt.description}</span>
                    </button>
                  ))}
                </div>
                <p className="text-gray-500 text-xs mt-3">
                  💡 Higher bit rate = better quality but larger file size
                </p>
              </div>
            )}

            {/* Download & Share Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-gray-400 text-sm">
                {convertedBlob && (
                  <span>
                    File size: <span className="text-white font-medium">{(convertedBlob.size / 1024).toFixed(1)} KB</span>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                {/* Download Button */}
                <button
                  onClick={downloadAudio}
                  disabled={isConverting}
                  className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-lg shadow-indigo-500/30 transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-2"
                  title="Download (D)"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download {currentFormatInfo?.label}
                  <kbd className="ml-2 px-1.5 py-0.5 bg-white/20 rounded text-xs">D</kbd>
                </button>

                {/* Share Button */}
                {shareSupported && (
                  <button
                    onClick={shareAudio}
                    disabled={isConverting || isSharing}
                    className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-lg shadow-emerald-500/30 transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-2"
                    title="Share (S)"
                  >
                    {isSharing ? (
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                        Share
                        <kbd className="ml-2 px-1.5 py-0.5 bg-white/20 rounded text-xs">S</kbd>
                      </>
                    )}
                  </button>
                )}

                {/* New Recording Button */}
                <button
                  onClick={resetRecorder}
                  className="px-6 py-3 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-medium rounded-lg shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-2"
                  title="New Recording (R)"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  New
                  <kbd className="ml-2 px-1.5 py-0.5 bg-white/20 rounded text-xs">R</kbd>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Features Section */}
      <div className="w-full max-w-3xl mt-8 grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-gray-800/30 backdrop-blur-sm rounded-xl p-4 border border-gray-700/30 text-center">
          <div className="text-3xl mb-2">🔒</div>
          <h3 className="text-white font-medium mb-1">Private</h3>
          <p className="text-gray-400 text-xs">All recordings stay in your browser.</p>
        </div>
        <div className="bg-gray-800/30 backdrop-blur-sm rounded-xl p-4 border border-gray-700/30 text-center">
          <div className="text-3xl mb-2">🎵</div>
          <h3 className="text-white font-medium mb-1">Multi-Format</h3>
          <p className="text-gray-400 text-xs">Export as MP3, WAV, WebM or OGG.</p>
        </div>
        <div className="bg-gray-800/30 backdrop-blur-sm rounded-xl p-4 border border-gray-700/30 text-center">
          <div className="text-3xl mb-2">🔇</div>
          <h3 className="text-white font-medium mb-1">Auto VAD</h3>
          <p className="text-gray-400 text-xs">Auto-trim silence with voice detection.</p>
        </div>
        <div className="bg-gray-800/30 backdrop-blur-sm rounded-xl p-4 border border-gray-700/30 text-center">
          <div className="text-3xl mb-2">📤</div>
          <h3 className="text-white font-medium mb-1">Share</h3>
          <p className="text-gray-400 text-xs">Share directly via your device.</p>
        </div>
        <div className="bg-gray-800/30 backdrop-blur-sm rounded-xl p-4 border border-gray-700/30 text-center">
          <div className="text-3xl mb-2">⌨️</div>
          <h3 className="text-white font-medium mb-1">Hotkeys</h3>
          <p className="text-gray-400 text-xs">Keyboard shortcuts for speed.</p>
        </div>
      </div>

      {/* Keyboard Shortcuts */}
      <div className="w-full max-w-3xl mt-6 bg-gray-800/30 backdrop-blur-sm rounded-xl p-6 border border-gray-700/30">
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          Keyboard Shortcuts
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="flex items-center justify-between bg-gray-700/30 rounded-lg px-3 py-2">
            <span className="text-gray-300">Start/Stop Recording</span>
            <kbd className="px-2 py-1 bg-gray-600 text-white rounded text-xs font-mono">Space</kbd>
          </div>
          <div className="flex items-center justify-between bg-gray-700/30 rounded-lg px-3 py-2">
            <span className="text-gray-300">Pause/Resume</span>
            <kbd className="px-2 py-1 bg-gray-600 text-white rounded text-xs font-mono">P</kbd>
          </div>
          <div className="flex items-center justify-between bg-gray-700/30 rounded-lg px-3 py-2">
            <span className="text-gray-300">New Recording</span>
            <kbd className="px-2 py-1 bg-gray-600 text-white rounded text-xs font-mono">R</kbd>
          </div>
          <div className="flex items-center justify-between bg-gray-700/30 rounded-lg px-3 py-2">
            <span className="text-gray-300">Download</span>
            <kbd className="px-2 py-1 bg-gray-600 text-white rounded text-xs font-mono">D</kbd>
          </div>
          <div className="flex items-center justify-between bg-gray-700/30 rounded-lg px-3 py-2">
            <span className="text-gray-300">Share</span>
            <kbd className="px-2 py-1 bg-gray-600 text-white rounded text-xs font-mono">S</kbd>
          </div>
          <div className="flex items-center justify-between bg-gray-700/30 rounded-lg px-3 py-2">
            <span className="text-gray-300">Auto-Trim Silence</span>
            <kbd className="px-2 py-1 bg-gray-600 text-white rounded text-xs font-mono">A</kbd>
          </div>
          <div className="flex items-center justify-between bg-gray-700/30 rounded-lg px-3 py-2">
            <span className="text-gray-300">Stop Playback</span>
            <kbd className="px-2 py-1 bg-gray-600 text-white rounded text-xs font-mono">Esc</kbd>
          </div>
          <div className="flex items-center justify-between bg-gray-700/30 rounded-lg px-3 py-2">
            <span className="text-gray-300">Submit & Next</span>
            <kbd className="px-2 py-1 bg-gray-600 text-white rounded text-xs font-mono">Enter</kbd>
          </div>
          <div className="flex items-center justify-between bg-gray-700/30 rounded-lg px-3 py-2">
            <span className="text-gray-300">Adjust Trim Start</span>
            <div className="flex gap-1">
              <kbd className="px-2 py-1 bg-gray-600 text-white rounded text-xs font-mono">←</kbd>
              <kbd className="px-2 py-1 bg-gray-600 text-white rounded text-xs font-mono">→</kbd>
            </div>
          </div>
          <div className="flex items-center justify-between bg-gray-700/30 rounded-lg px-3 py-2">
            <span className="text-gray-300">Adjust Trim End</span>
            <div className="flex gap-1">
              <kbd className="px-2 py-1 bg-gray-600 text-white rounded text-xs font-mono">Shift</kbd>
              <kbd className="px-2 py-1 bg-gray-600 text-white rounded text-xs font-mono">←</kbd>
              <kbd className="px-2 py-1 bg-gray-600 text-white rounded text-xs font-mono">→</kbd>
            </div>
          </div>
        </div>
        <p className="text-gray-500 text-xs mt-4 text-center">
          💡 Tip: Tekan <kbd className="px-1.5 py-0.5 bg-gray-600 text-white rounded text-xs font-mono">Space</kbd> untuk mula rakaman, kemudian <kbd className="px-1.5 py-0.5 bg-gray-600 text-white rounded text-xs font-mono">Enter</kbd> untuk submit dan terus ke frasa seterusnya!
        </p>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-gray-500 text-sm">
        <p>Works best in Chrome, Firefox, and Edge. Requires microphone permission.</p>
        <p className="mt-1">Share feature available on mobile devices with native sharing support.</p>
      </div>
    </div>
  );
}
