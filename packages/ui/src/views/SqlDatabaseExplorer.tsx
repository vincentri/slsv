import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api, type SqlQueryResult } from '@/lib/api'
import { useApiQuery, useApiMutation, qk } from '@/lib/query'
import { ArrowLeft, Table2, Database as DbIcon, Play } from 'lucide-react'

export function SqlDatabaseExplorer({
  db,
  onSelectTable,
  onBack,
}: {
  db: string
  onSelectTable: (table: string) => void
  onBack: () => void
}) {
  const { data: tables, error, isLoading } = useApiQuery(qk.sqlTables(db), () =>
    api.listSqlTables(db),
  )
  const [filter, setFilter] = useState('')
  const [query, setQuery] = useState('SELECT * FROM ')
  const [result, setResult] = useState<SqlQueryResult | null>(null)

  const runM = useApiMutation((q: string) => api.runSqlQuery(db, q), {
    onSuccess: setResult,
  })

  const filtered = tables?.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase())) ?? []

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={onBack} className="h-7 w-7 p-0">
          <ArrowLeft size={13} />
        </Button>
        <DbIcon size={16} className="text-accent-foreground" />
        <h2 className="text-base font-semibold">{db}</h2>
        {tables && <Badge variant="muted">{tables.length} tables</Badge>}
      </div>

      {error && (
        <div className="text-sm text-destructive-foreground bg-destructive/20 rounded px-3 py-2">
          {(error as Error).message}
        </div>
      )}
      {!!runM.error && (
        <div className="text-sm text-destructive-foreground bg-destructive/20 rounded px-3 py-2">
          {(runM.error as Error).message}
        </div>
      )}

      {tables ? (
        <>
          <div className="flex items-center gap-2">
            <Input
              placeholder="filter tables…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-64"
            />
          </div>

          <div className="space-y-1">
            {filtered.map((t) => (
              <button
                key={t.name}
                onClick={() => onSelectTable(t.name)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm rounded hover:bg-accent/10 text-left"
              >
                <Table2 size={13} className="text-muted-foreground shrink-0" />
                <span className="font-mono text-foreground">{t.name}</span>
                <Badge variant="muted" className="ml-auto">
                  {t.type === 'BASE TABLE' || t.type === 'BASE TABLE' ? 'table' : t.type}
                </Badge>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground px-3 py-2">No tables match.</p>
            )}
          </div>

          <div className="border-t border-border/50 pt-4 mt-6 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Run query</span>
              <span className="text-xs text-muted-foreground">(SELECT / WITH / EXPLAIN only)</span>
            </div>
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 font-mono text-xs"
              />
              <Button onClick={() => runM.mutate(query)} disabled={runM.isPending}>
                <Play size={13} />
                {runM.isPending ? 'Running…' : 'Run'}
              </Button>
            </div>
            {result && <SqlResultView result={result} />}
          </div>
        </>
      ) : (
        !error &&
        isLoading && <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </div>
  )
}

function SqlResultView({ result }: { result: SqlQueryResult }) {
  if (result.rows.length === 0) return <p className="text-sm text-muted-foreground">No rows.</p>
  return (
    <div className="rounded border border-border overflow-auto max-h-96">
      <table className="w-full text-xs">
        <thead className="bg-muted/30 sticky top-0">
          <tr>
            {result.columns.map((c) => (
              <th key={c} className="text-left px-3 py-2 font-medium font-mono">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="border-t border-border/50 hover:bg-accent/5">
              {result.columns.map((c) => (
                <td key={c} className="px-3 py-1.5 font-mono">
                  {row[c] === null || row[c] === undefined ? (
                    <span className="text-muted-foreground">—</span>
                  ) : typeof row[c] === 'object' ? (
                    JSON.stringify(row[c])
                  ) : (
                    String(row[c])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
