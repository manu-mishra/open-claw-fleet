interface StatusBadgeProps {
  value: string;
  tone?: "neutral" | "good" | "warn" | "alert";
}

function toneClassName(tone: StatusBadgeProps["tone"]): string {
  switch (tone) {
    case "good":
      return "is-good";
    case "warn":
      return "is-warn";
    case "alert":
      return "is-alert";
    default:
      return "is-neutral";
  }
}

export function StatusBadge({ value, tone = "neutral" }: StatusBadgeProps) {
  return <span className={`cc-badge ${toneClassName(tone)}`}>{value}</span>;
}
