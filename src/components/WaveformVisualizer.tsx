import { useEffect, useRef } from 'react';

interface WaveformVisualizerProps {
  analyser: AnalyserNode | null;
  isRecording: boolean;
  isPlaying: boolean;
  audioContext: AudioContext | null;
  audioBuffer: AudioBuffer | null;
  currentTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  silenceRegions?: Array<{ start: number; end: number }>;
}

export default function WaveformVisualizer({
  analyser,
  isRecording,
  isPlaying,
  audioContext,
  audioBuffer,
  currentTime,
  duration,
  trimStart,
  trimEnd,
  silenceRegions = [],
}: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      // Draw background
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, width, height);

      if (isRecording && analyser) {
        // Real-time recording visualization
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(dataArray);

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#4ade80';
        ctx.beginPath();

        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();
      } else if (audioBuffer && audioContext) {
        // Recorded audio waveform
        const channelData = audioBuffer.getChannelData(0);
        const step = Math.ceil(channelData.length / width);
        const amp = height / 2;

        // Draw waveform bars
        const barWidth = 3;
        const gap = 1;
        const totalBarWidth = barWidth + gap;
        const numBars = Math.floor(width / totalBarWidth);

        for (let i = 0; i < numBars; i++) {
          const dataIndex = Math.floor((i / numBars) * channelData.length);
          let min = 1.0;
          let max = -1.0;

          for (let j = 0; j < step; j++) {
            const datum = channelData[dataIndex + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
          }

          const barHeight = Math.max(1, (max - min) * amp);
          const x = i * totalBarWidth;
          const y = amp - barHeight / 2;

          // Color based on position relative to trim and playback
          const barPosition = i / numBars;
          const progressPos = duration > 0 ? currentTime / duration : 0;

          if (barPosition >= trimStart && barPosition <= trimEnd) {
            if (isPlaying && barPosition <= progressPos) {
              ctx.fillStyle = '#4ade80'; // Green for played portion
            } else {
              ctx.fillStyle = '#6366f1'; // Purple for active trim area
            }
          } else {
            ctx.fillStyle = '#374151'; // Gray for trimmed out area
          }

          ctx.fillRect(x, y, barWidth, barHeight);
        }

        // Draw trim markers
        const trimStartX = trimStart * width;
        const trimEndX = trimEnd * width;

        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);

        // Start trim line
        ctx.beginPath();
        ctx.moveTo(trimStartX, 0);
        ctx.lineTo(trimStartX, height);
        ctx.stroke();

        // End trim line
        ctx.beginPath();
        ctx.moveTo(trimEndX, 0);
        ctx.lineTo(trimEndX, height);
        ctx.stroke();

        ctx.setLineDash([]);

        // Draw silence regions
        if (silenceRegions.length > 0) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.2)'; // Semi-transparent red
          for (const region of silenceRegions) {
            const regionStartX = (region.start / duration) * width;
            const regionEndX = (region.end / duration) * width;
            const regionWidth = regionEndX - regionStartX;
            ctx.fillRect(regionStartX, 0, regionWidth, height);
          }
        }

        // Draw playback position
        if (isPlaying && duration > 0) {
          const progressPosPlay = currentTime / duration;
          const playX = progressPosPlay * width;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(playX, 0);
          ctx.lineTo(playX, height);
          ctx.stroke();
        }
      } else {
        // Idle state - draw center line
        ctx.strokeStyle = '#4b5563';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [analyser, isRecording, isPlaying, audioContext, audioBuffer, currentTime, duration, trimStart, trimEnd, silenceRegions]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={150}
      className="w-full h-[150px] rounded-lg border border-gray-700"
    />
  );
}
