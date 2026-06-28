import { cn } from '@/lib/utils'

type Props = { children: React.ReactNode; variant?: 'default' | 'aws' | 'local' | 'muted'; className?: string }

export function Badge({ children, variant = 'default', className }: Props) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      variant === 'aws' && 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
      variant === 'local' && 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
      variant === 'default' && 'bg-muted text-muted-foreground',
      variant === 'muted' && 'bg-muted/50 text-muted-foreground',
      className,
    )}>
      {children}
    </span>
  )
}
