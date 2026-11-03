import type { ReactNode } from 'react';

export function DashboardCard({ title, extra, children, className = '' }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`dashboard-card ${className}`}>
    {title && <div className="dashboard-card-heading"><h2>{title}</h2>{extra}</div>}
    {children}
  </section>;
}
