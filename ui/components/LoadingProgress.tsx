"use client";

import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";

export function LoadingProgress({
  steps,
  estimatedSecondsPerStep = 30,
}: {
  steps: string[];
  estimatedSecondsPerStep?: number;
}) {
  const [activeStep, setActiveStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => {
      const secs = Math.floor((Date.now() - start) / 1000);
      setElapsed(secs);
      // Advance through steps based on elapsed time — purely indicative,
      // not tied to actual backend progress
      const idx = Math.min(
        Math.floor(secs / estimatedSecondsPerStep),
        steps.length - 1
      );
      setActiveStep(idx);
    }, 1000);
    return () => clearInterval(tick);
  }, [steps.length, estimatedSecondsPerStep]);

  return (
    <div className="glass animate-slide-up space-y-6 p-8">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
        <span className="text-sm font-medium text-slate-300">
          Working — {Math.floor(elapsed / 60)}m {elapsed % 60}s elapsed
        </span>
      </div>
      <ul className="space-y-3">
        {steps.map((step, i) => {
          const done = i < activeStep;
          const active = i === activeStep;
          return (
            <li
              key={i}
              className={`flex items-center gap-3 text-sm transition-opacity ${
                done || active ? "opacity-100" : "opacity-40"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                  done
                    ? "bg-emerald-500/20 text-emerald-300"
                    : active
                    ? "bg-cyan-500/20 text-cyan-300"
                    : "bg-white/5 text-slate-500"
                }`}
              >
                {done ? (
                  <Check className="h-3.5 w-3.5" />
                ) : active ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span className="text-xs">{i + 1}</span>
                )}
              </span>
              <span className={done ? "text-slate-300 line-through" : active ? "text-slate-100" : "text-slate-500"}>
                {step}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-500">
        Progress steps are estimates — the backend is one long synchronous
        operation, so the indicator advances on time rather than actual
        completion.
      </p>
    </div>
  );
}
