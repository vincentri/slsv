import { useState } from 'react'
import type { FunctionSummary } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/table'
import { Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type ResourceColumn<T> = {
  key: string
  label: string
  align?: 'left' | 'right'
  mono?: boolean
  format?: (row: T) => React.ReactNode
}

export function ResourceTable<T>({
  title,
  icon: Icon,
  rows,
  columns,
  rowKey,
  onSelect,
  emptyText,
  searchable,
  pageSize,
}: {
  title: string
  icon: LucideIcon
  rows: T[]
  columns: ResourceColumn<T>[]
  rowKey: (row: T) => string
  onSelect: (row: T) => void
  emptyText: string
  searchable?: boolean
  pageSize?: number
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const filtered =
    searchable && search
      ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()))
      : rows
  const totalPages = pageSize ? Math.ceil(filtered.length / pageSize) : 1
  const paged = pageSize ? filtered.slice(page * pageSize, (page + 1) * pageSize) : filtered

  if (rows.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">{emptyText}</div>
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Icon size={16} className="text-accent-foreground" />
          {title}
          <Badge variant="muted">{rows.length}</Badge>
        </h2>
        {searchable && (
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            placeholder="Search…"
            className="ml-auto px-2.5 py-1 text-xs rounded border border-border bg-background w-48 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        )}
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-muted/30 hover:bg-muted/30">
              {columns.map((col) => (
                <Th key={col.key} className={col.align === 'right' ? 'text-right' : undefined}>
                  {col.label}
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {paged.length === 0 ? (
              <Tr>
                <td
                  colSpan={columns.length}
                  className="text-center text-muted-foreground py-6 text-sm"
                >
                  No results
                </td>
              </Tr>
            ) : (
              paged.map((row) => (
                <Tr key={rowKey(row)} onClick={() => onSelect(row)}>
                  {columns.map((col) => (
                    <Td
                      key={col.key}
                      className={`${col.align === 'right' ? 'text-right' : ''} ${col.mono ? 'font-mono text-accent-foreground' : 'text-muted-foreground'}`}
                    >
                      {col.format ? col.format(row) : ((row as any)[col.key] ?? '—')}
                    </Td>
                  ))}
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{filtered.length} items</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40"
            >
              ←
            </button>
            <span className="px-2">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40"
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export const lambdaColumns: ResourceColumn<FunctionSummary>[] = [
  { key: 'name', label: 'Function name', mono: true },
  { key: 'runtime', label: 'Runtime' },
  {
    key: 'memory',
    label: 'Memory',
    align: 'right',
    format: (fn) => (fn.memory ? `${fn.memory} MB` : '—'),
  },
  {
    key: 'timeout',
    label: 'Timeout',
    align: 'right',
    format: (fn) => (fn.timeout ? `${fn.timeout}s` : '—'),
  },
  {
    key: 'lastModified',
    label: 'Last modified',
    format: (fn) => (fn.lastModified ? new Date(fn.lastModified).toLocaleString() : '—'),
  },
]

export function LambdaList({
  functions,
  onSelect,
}: {
  functions: FunctionSummary[]
  onSelect: (name: string) => void
}) {
  return (
    <ResourceTable
      title="Lambda Functions"
      icon={Zap}
      rows={functions}
      columns={lambdaColumns}
      rowKey={(fn) => fn.name}
      onSelect={(fn) => onSelect(fn.name)}
      emptyText="No functions found."
    />
  )
}
