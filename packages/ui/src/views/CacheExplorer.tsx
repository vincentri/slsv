import { useState } from 'react'
import { api } from '@/lib/api'
import { useApiQuery, qk, keepPreviousData } from '@/lib/query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/table'
import { RefreshCw } from 'lucide-react'

function TtlBadge({ ttl }: { ttl: number }) {
  if (ttl === -1) return <Badge variant="muted">no expiry</Badge>
  if (ttl === -2) return <Badge variant="muted">expired</Badge>
  return <Badge variant="muted">{ttl}s</Badge>
}

export function CacheExplorer({ name }: { name: string }) {
  const [match, setMatch] = useState('*')
  const [cursor, setCursor] = useState<string | undefined>()

  // ponytail: keepPreviousData avoids flash when paginating; refetch on Scan button via refetch.
  const { data, error, isLoading, refetch } = useApiQuery(
    qk.cache(name, cursor, match),
    () => api.scanCache(name, cursor, match),
    { placeholderData: keepPreviousData },
  )

  const keys = data?.keys ?? []

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-base font-semibold">{name}</h2>
        <Badge variant="muted">Redis</Badge>
        <Input
          placeholder="Match pattern (e.g. user:*)"
          value={match}
          onChange={(e) => setMatch(e.target.value)}
          className="w-48"
        />
        <Button onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw size={13} />
          {isLoading ? 'Loading…' : 'Scan'}
        </Button>
        <p className="text-xs text-muted-foreground">SCAN, capped — safe on large keyspaces</p>
      </div>

      {error && (
        <div className="text-sm text-destructive-foreground bg-destructive/20 rounded px-3 py-2">
          {(error as Error).message}
        </div>
      )}

      {data &&
        (keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No keys matching <code>{match}</code>.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="muted">{keys.length} keys</Badge>
              {data.cursor && (
                <Button variant="outline" onClick={() => setCursor(data.cursor)}>
                  Load more
                </Button>
              )}
            </div>
            <Table>
              <Thead>
                <Tr>
                  <Th>Key</Th>
                  <Th>Type</Th>
                  <Th>TTL</Th>
                  <Th>Value</Th>
                </Tr>
              </Thead>
              <Tbody>
                {keys.map((k, i) => (
                  <Tr key={i}>
                    <Td className="max-w-xs truncate font-semibold">{k.key}</Td>
                    <Td>
                      <Badge variant="muted">{k.type}</Badge>
                    </Td>
                    <Td>
                      <TtlBadge ttl={k.ttl} />
                    </Td>
                    <Td className="max-w-sm truncate text-muted-foreground">{k.value ?? '—'}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </>
        ))}
    </div>
  )
}
