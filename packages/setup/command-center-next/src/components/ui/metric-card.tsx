interface MetricCardProps {
  label: string;
  value: number | string;
}

export function MetricCard({ label, value }: MetricCardProps) {
  return (
    <article className="cc-metric">
      <span className="cc-metric-label">{label}</span>
      <strong className="cc-metric-value">{value}</strong>
    </article>
  );
}
