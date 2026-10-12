'use client';

interface ProgressBarProps {
  progress: number;
  label?: string;
  showPercentage?: boolean;
}

export function ProgressBar({
  progress,
  label,
  showPercentage = true,
}: ProgressBarProps) {
  return (
    <div className="w-full">
      {(label || showPercentage) && (
        <div className="flex justify-between mb-1 text-sm">
          {label && <span className="text-muted-foreground">{label}</span>}
          {showPercentage && (
            <span className="text-muted-foreground">{Math.round(progress)}%</span>
          )}
        </div>
      )}
      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
        <div
          className="bg-primary h-full rounded-full transition-all duration-300 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
    </div>
  );
}
