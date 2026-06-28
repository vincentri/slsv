import { cn } from '@/lib/utils'

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('w-full overflow-auto', className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}
export const Thead = ({ children }: { children: React.ReactNode }) => (
  <thead className="border-b border-border">{children}</thead>
)
export const Tbody = ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>
export const Tr = ({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) => (
  <tr onClick={onClick} className={cn('border-b border-border/50 hover:bg-accent/20 transition-colors', onClick && 'cursor-pointer', className)}>{children}</tr>
)
export const Th = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <th className={cn('px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider', className)}>{children}</th>
)
export const Td = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <td className={cn('px-3 py-2.5 font-mono text-xs align-top', className)}>{children}</td>
)
