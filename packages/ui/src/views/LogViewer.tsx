import { useState } from 'react'
import { api } from '@/lib/api'
import { useApiQuery, qk } from '@/lib/query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { RefreshCw } from 'lucide-react'

export function LogViewer({ group }: { group: string }) {
  const [filter, setFilter] = useState('')
  const [follow, setFollow] = useState(false)

  // ponytail: refetchInterval as a function toggles polling cleanly — replaces manual setInterval.
  const { data: logs, error, isLoading, refetch } = useApiQuery(
    qk.logs(group, filter),
    () => api.tailLogs(group, undefined, filter || undefined),
    { refetchInterval: follow ? 3000 : false },
  )

  const level = (msg: string) => {
    const m = msg.toUpperCase()
    if (m.includes('ERROR') || m.includes('FATAL')) return 'text-red-400'
    if (m.includes('WARN')) return 'text-yellow-400'
    return 'text-foreground'
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-base font-semibold font-mono truncate max-w-md">{group}</h2>
        <Badge variant="muted">CloudWatch</Badge>
        <Input
          placeholder="Filter text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-48"
        />
        <Button onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw size={13} />
          {isLoading ? 'Loading…' : 'Refresh'}
        </Button>
        <Button variant={follow ? 'default' : 'outline'} onClick={() => setFollow((f) => !f)}>
          {follow ? 'Following…' : 'Follow'}
        </Button>
      </div>

      {error && (
        <div className="text-sm text-destructive-foreground bg-destructive/20 rounded px-3 py-2">
          {(error as Error).message}
        </div>
      )}

      {logs &&
        (logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No logs.</p>
        ) : (
          <>
            <Badge variant="muted">{logs.length} events</Badge>
            <div className="font-mono text-xs space-y-0.5 max-h-[70vh] overflow-auto bg-muted/10 rounded-lg p-3">
              {logs.map((e, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-muted-foreground shrink-0 w-24">
                    {e.time ? new Date(e.time).toLocaleTimeString() : ''}
                  </span>
                  <span className={level(e.msg ?? '')}>{(e.msg ?? '').trim()}</span>
                </div>
              ))}
            </div>
          </>
        ))}
    </div>
  )
}
