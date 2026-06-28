import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

export function ServiceCard({
  icon: Icon,
  name,
  count,
  onClick,
  disabled,
}: {
  icon: LucideIcon
  name: string
  count: number
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all',
        !disabled && 'hover:border-accent/60 hover:bg-accent/10 cursor-pointer',
        disabled && 'opacity-40 cursor-default',
      )}
    >
      <div className="flex items-center gap-2">
        <div className="rounded-md bg-accent/20 p-2">
          <Icon size={16} className="text-accent-foreground" />
        </div>
        <span className="text-xs font-medium text-muted-foreground">{name}</span>
      </div>
      <span className="text-2xl font-bold tabular-nums">{count}</span>
      <span className="text-xs text-muted-foreground">
        {count === 1 ? 'resource' : 'resources'}
      </span>
    </button>
  )
}
