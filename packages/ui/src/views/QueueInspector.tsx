import { useState } from 'react'
import { api } from '@/lib/api'
import { useApiQuery, qk } from '@/lib/query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/table'
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

function JsonBody({ body }: { body?: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!body) return <span className="text-muted-foreground">—</span>
  try {
    const parsed = JSON.parse(body)
    const pretty = JSON.stringify(parsed, null, 2)
    return (
      <span onClick={() => setExpanded((e) => !e)} className="cursor-pointer">
        {expanded ? (
          <>
            <ChevronUp size={12} className="inline mr-1 text-accent-foreground" />
            <pre className="whitespace-pre-wrap text-xs mt-1">{pretty}</pre>
          </>
        ) : (
          <>
            <ChevronDown size={12} className="inline mr-1 text-muted-foreground" />
            {body.slice(0, 80)}
            {body.length > 80 ? '…' : ''}
          </>
        )}
      </span>
    )
  } catch {
    return <span>{body}</span>
  }
}

export function QueueInspector({ name }: { name: string }) {
  // ponytail: enabled=false → no auto-fetch; Peek button triggers refetch.
  const { data: msgs, error, isLoading, refetch } = useApiQuery(
    qk.queue(name),
    () => api.peekQueue(name),
    { enabled: false },
  )

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold">{name}</h2>
        <Badge variant="muted">SQS</Badge>
        <Button onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw size={13} />
          {isLoading ? 'Loading…' : 'Peek'}
        </Button>
        <p className="text-xs text-muted-foreground">Non-destructive — messages stay in queue</p>
      </div>

      {error && (
        <div className="text-sm text-destructive-foreground bg-destructive/20 rounded px-3 py-2">
          {(error as Error).message}
        </div>
      )}

      {msgs &&
        (msgs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Queue empty.</p>
        ) : (
          <>
            <Badge variant="muted">{msgs.length} visible</Badge>
            <Table>
              <Thead>
                <Tr>
                  <Th>Message ID</Th>
                  <Th>Body</Th>
                </Tr>
              </Thead>
              <Tbody>
                {msgs.map((m, i) => (
                  <Tr key={i}>
                    <Td className="text-muted-foreground w-64">{m.id}</Td>
                    <Td>
                      <JsonBody body={m.body} />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </>
        ))}
    </div>
  )
}
