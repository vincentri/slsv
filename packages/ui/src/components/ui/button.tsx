import { cn } from '@/lib/utils'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'ghost' | 'outline' }

export function Button({ className, variant = 'default', ...props }: Props) {
  return (
    <button className={cn(
      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
      variant === 'default' && 'bg-accent text-accent-foreground hover:bg-accent/80',
      variant === 'ghost' && 'hover:bg-accent/20 text-muted-foreground hover:text-foreground',
      variant === 'outline' && 'border border-border hover:bg-accent/20',
      className,
    )} {...props} />
  )
}
