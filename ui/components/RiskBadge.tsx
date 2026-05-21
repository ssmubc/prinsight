import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";

type Risk = "LOW" | "MEDIUM" | "HIGH";

const config: Record<Risk, { label: string; styles: string; icon: React.ReactNode }> = {
  LOW: {
    label: "LOW RISK",
    styles:
      "from-emerald-500/20 to-teal-500/20 border-emerald-400/30 text-emerald-300",
    icon: <CheckCircle2 className="h-5 w-5" />,
  },
  MEDIUM: {
    label: "MEDIUM RISK",
    styles:
      "from-amber-500/20 to-orange-500/20 border-amber-400/30 text-amber-300",
    icon: <Clock className="h-5 w-5" />,
  },
  HIGH: {
    label: "HIGH RISK",
    styles: "from-rose-500/20 to-red-500/20 border-rose-400/30 text-rose-300",
    icon: <AlertTriangle className="h-5 w-5" />,
  },
};

export function RiskBadge({
  risk,
  confidence,
}: {
  risk: Risk;
  confidence?: number;
}) {
  const cfg = config[risk];
  return (
    <div
      className={`inline-flex items-center gap-3 rounded-2xl border bg-gradient-to-r ${cfg.styles} px-5 py-3`}
    >
      {cfg.icon}
      <div className="flex flex-col leading-tight">
        <span className="text-xs font-semibold uppercase tracking-wider opacity-80">
          {cfg.label}
        </span>
        {confidence !== undefined && (
          <span className="text-lg font-bold">
            {(confidence * 100).toFixed(1)}% confidence
          </span>
        )}
      </div>
    </div>
  );
}
