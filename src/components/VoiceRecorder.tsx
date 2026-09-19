import { useState, useRef, useCallback, useEffect } from 'react';
import WaveformVisualizer from './WaveformVisualizer';

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
  const [format, setFormat] = useState<'webm' | 'mp3' | 'wav'>('webm');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const animationRef = useRef<number>(0);

  // Format time as mm:ss
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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

      // Set up MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
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

        // Decode audio for waveform
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
      // Set start time based on trim
      audio.currentTime = trimStart * duration;
    };

    audio.onended = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime);
      // Stop at trim end
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

  // Download audio
  const downloadAudio = useCallback(() => {
    if (!audioBlob) return;

    const link = document.createElement('a');
    link.href = audioUrl || '';
    link.download = `recording-${Date.now()}.${format === 'webm' ? 'webm' : format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [audioBlob, audioUrl, format]);

  // Reset recorder
  const resetRecorder = useCallback(() => {
    stopAudio();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioBlob(null);
    setAudioUrl(null);
    setAudioBuffer(null);
    setRecordingTime(0);
    setCurrentTime(0);
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(1);
    setError(null);
  }, [audioUrl, stopAudio]);

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
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

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
          Record your voice directly in the browser. No installation needed.
        </p>
      </div>

      {/* Main Card */}
      <div className="w-full max-w-3xl bg-gray-800/50 backdrop-blur-lg rounded-2xl shadow-2xl border border-gray-700/50 p-6 md:p-8">
        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-center">
            {error}
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
          />
        </div>

        {/* Recording Controls */}
        <div className="flex items-center justify-center gap-4 mb-6">
          {!audioBuffer ? (
            <>
              {/* Start/Stop Recording Button */}
              {!isRecording ? (
                <button
                  onClick={startRecording}
                  className="w-20 h-20 bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 transition-all duration-200 hover:scale-105 active:scale-95"
                  title="Start Recording"
                >
                  <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                  </svg>
                </button>
              ) : (
                <>
                  {/* Pause/Resume Button */}
                  <button
                    onClick={togglePause}
                    className="w-14 h-14 bg-gradient-to-br from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 rounded-full flex items-center justify-center shadow-lg shadow-yellow-500/30 transition-all duration-200 hover:scale-105 active:scale-95"
                    title={isPaused ? 'Resume' : 'Pause'}
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
                  </button>

                  {/* Stop Button */}
                  <button
                    onClick={stopRecording}
                    className="w-20 h-20 bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 transition-all duration-200 hover:scale-105 active:scale-95"
                    title="Stop Recording"
                  >
                    <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 6h12v12H6z" />
                    </svg>
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {/* Playback Controls */}
              {!isPlaying ? (
                <button
                  onClick={playAudio}
                  className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 rounded-full flex items-center justify-center shadow-lg shadow-green-500/30 transition-all duration-200 hover:scale-105 active:scale-95"
                  title="Play"
                >
                  <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={pauseAudio}
                  className="w-16 h-16 bg-gradient-to-br from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 rounded-full flex items-center justify-center shadow-lg shadow-yellow-500/30 transition-all duration-200 hover:scale-105 active:scale-95"
                  title="Pause"
                >
                  <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                </button>
              )}

              <button
                onClick={stopAudio}
                className="w-12 h-12 bg-gradient-to-br from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
                title="Stop"
              >
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 6h12v12H6z" />
                </svg>
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

            {/* Format & Download */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <label className="text-gray-400 text-sm">Format:</label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as 'webm' | 'mp3' | 'wav')}
                  className="bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
                >
                  <option value="webm">WebM</option>
                  <option value="wav">WAV</option>
                </select>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={downloadAudio}
                  className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/30 transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </button>

                <button
                  onClick={resetRecorder}
                  className="px-6 py-3 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-medium rounded-lg shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  New Recording
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Features Section */}
      <div className="w-full max-w-3xl mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800/30 backdrop-blur-sm rounded-xl p-4 border border-gray-700/30 text-center">
          <div className="text-3xl mb-2">🔒</div>
          <h3 className="text-white font-medium mb-1">Private & Secure</h3>
          <p className="text-gray-400 text-sm">All recordings stay in your browser. Nothing is uploaded.</p>
        </div>
        <div className="bg-gray-800/30 backdrop-blur-sm rounded-xl p-4 border border-gray-700/30 text-center">
          <div className="text-3xl mb-2">⚡</div>
          <h3 className="text-white font-medium mb-1">No Installation</h3>
          <p className="text-gray-400 text-sm">Works directly in your browser. No plugins needed.</p>
        </div>
        <div className="bg-gray-800/30 backdrop-blur-sm rounded-xl p-4 border border-gray-700/30 text-center">
          <div className="text-3xl mb-2">🎵</div>
          <h3 className="text-white font-medium mb-1">Easy to Use</h3>
          <p className="text-gray-400 text-sm">Record, trim, and download in seconds.</p>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-gray-500 text-sm">
        <p>Works best in Chrome, Firefox, and Edge. Requires microphone permission.</p>
      </div>
    </div>
  );
}
