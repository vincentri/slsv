import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { useApiQuery, qk } from '@/lib/query'
import { ArrowLeft } from 'lucide-react'

export function SqlTableView({
  db,
  table,
  onBack,
}: {
  db: string
  table: string
  onBack: () => void
}) {
  const { data, error, isLoading } = useApiQuery(qk.sqlTable(db, table), () =>
    api.peekSqlTable(db, table, 100),
  )

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={onBack} className="h-7 w-7 p-0">
          <ArrowLeft size={13} />
        </Button>
        <h2 className="text-base font-semibold font-mono">{table}</h2>
        <span className="text-xs text-muted-foreground">in {db}</span>
        {data && (
          <Badge variant="muted">
            {data.rows.length} rows × {data.columns.length} cols
          </Badge>
        )}
      </div>

      {error && (
        <div className="text-sm text-destructive-foreground bg-destructive/20 rounded px-3 py-2">
          {(error as Error).message}
        </div>
      )}

      {data && data.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Empty table.</p>
      )}

      {data && data.rows.length > 0 && (
        <div className="rounded border border-border overflow-auto max-h-[70vh]">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 sticky top-0">
              <tr>
                {data.columns.map((c) => (
                  <th key={c} className="text-left px-3 py-2 font-medium font-mono">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i} className="border-t border-border/50 hover:bg-accent/5">
                  {data.columns.map((c) => (
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
      )}

      {!data && !error && isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </div>
  )
}
