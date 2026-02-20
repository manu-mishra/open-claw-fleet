interface PanelProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Panel({ title, subtitle, actions, children, className }: PanelProps) {
  const classes = className ? `cc-panel ${className}` : "cc-panel";
  return (
    <section className={classes}>
      <header className="cc-panel-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div>{actions}</div> : null}
      </header>
      <div className="cc-panel-content">{children}</div>
    </section>
  );
}
