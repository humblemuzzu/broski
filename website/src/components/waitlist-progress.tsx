"use client";

import { useEffect, useState } from "react";

interface WaitlistProgressProps {
  goal?: number;
  refreshInterval?: number; // in milliseconds
}

export function WaitlistProgress({
  goal = 10000,
  refreshInterval = 30000, // 30 seconds default
}: WaitlistProgressProps) {
  const [count, setCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCount = async () => {
    try {
      const response = await fetch("/api/waitlist-count");
      const data = await response.json();
      if (data.success) {
        setCount(data.count);
      }
    } catch (error) {
      console.error("Failed to fetch waitlist count:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCount();

    // Set up polling for real-time updates
    const interval = setInterval(fetchCount, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval]);

  const percentage = Math.min((count / goal) * 100, 100);

  // Format number with commas
  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  return (
    <div className="w-full max-w-xl mx-auto space-y-3">
      {/* Progress Bar */}
      <div className="relative h-2 bg-muted/30 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/80 to-primary rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${isLoading ? 0 : percentage}%` }}
        />
        {/* Animated glow effect at the end */}
        {!isLoading && percentage > 0 && (
          <div
            className="absolute inset-y-0 w-8 bg-gradient-to-r from-transparent to-primary/50 rounded-full blur-sm animate-pulse"
            style={{ left: `calc(${percentage}% - 1rem)` }}
          />
        )}
      </div>

      {/* Count Display */}
      <div className="flex items-center justify-center gap-2 text-sm">
        <span className="font-semibold text-foreground tabular-nums">
          {isLoading ? "..." : formatNumber(count)}
        </span>
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground tabular-nums">
          {formatNumber(goal)}
        </span>
        <span className="text-muted-foreground/60 ml-1">on the waitlist</span>
      </div>
    </div>
  );
}
