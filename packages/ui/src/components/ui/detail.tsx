import type { ReactNode } from 'react'

export function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="flex gap-4 py-2 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground text-sm w-52 shrink-0">{label}</span>
      <span className="text-sm font-mono break-all">{String(value)}</span>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{title}</h3>
      <div className="rounded-lg border border-border bg-card px-4">{children}</div>
    </div>
  )
}
