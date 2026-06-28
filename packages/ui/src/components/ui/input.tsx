import { cn } from '@/lib/utils'

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input className={cn(
      'flex h-8 rounded-md border border-border bg-background px-3 py-1 text-sm font-mono',
      'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
      className,
    )} {...props} />
  )
}
