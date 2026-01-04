'use client';

import { useEffect, useRef } from 'react';

interface WaveformVisualizerProps {
  isRecording: boolean;
  isPaused: boolean;
}

export function WaveformVisualizer({ isRecording, isPaused }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (!isRecording || isPaused) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      // Draw flat line when not recording
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#f3f4f6';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.beginPath();
          ctx.moveTo(0, canvas.height / 2);
          ctx.lineTo(canvas.width, canvas.height / 2);
          ctx.strokeStyle = '#d1d5db';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      return;
    }

    const setupAudio = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();

        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        source.connect(analyser);
        analyserRef.current = analyser;
        dataArrayRef.current = dataArray;

        const draw = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;

          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          animationRef.current = requestAnimationFrame(draw);

          analyser.getByteFrequencyData(dataArray);

          ctx.fillStyle = '#f3f4f6';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const barWidth = (canvas.width / bufferLength) * 2.5;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height * 0.8;

            const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
            gradient.addColorStop(0, '#3b82f6');
            gradient.addColorStop(1, '#60a5fa');

            ctx.fillStyle = gradient;
            ctx.fillRect(
              x,
              (canvas.height - barHeight) / 2,
              barWidth - 1,
              barHeight
            );

            x += barWidth;
          }
        };

        draw();

        return () => {
          stream.getTracks().forEach((track) => track.stop());
          audioContext.close();
        };
      } catch (error) {
        console.error('Error setting up audio visualization:', error);
      }
    };

    const cleanup = setupAudio();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      cleanup?.then((fn) => fn?.());
    };
  }, [isRecording, isPaused]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={100}
      className="w-full h-24 rounded-lg bg-gray-100"
    />
  );
}
