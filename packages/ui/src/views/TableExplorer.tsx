import { useState } from 'react'
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { useApiQuery, qk, keepPreviousData } from '@/lib/query'
import { Search, ChevronDown, ChevronUp } from 'lucide-react'

function JsonCell({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false)
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>
  const str = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
  const isLong = str.length > 60 || str.includes('\n')
  if (!isLong) return <span>{str}</span>
  return (
    <span>
      <span
        onClick={() => setExpanded((e) => !e)}
        className="cursor-pointer text-accent-foreground flex items-center gap-1"
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {expanded ? (
          <pre className="whitespace-pre-wrap text-xs">{str}</pre>
        ) : (
          str.slice(0, 60) + '…'
        )}
      </span>
    </span>
  )
}

export function TableExplorer({ name }: { name: string }) {
  const [cursor, setCursor] = useState<string | undefined>()
  const [pk, setPk] = useState('')
  const [pkName, setPkName] = useState('id')
  const [mode, setMode] = useState<'scan' | 'query'>('scan')

  // ponytail: query vs scan switches the key + fn; enabled=false → Load button triggers refetch.
  const isQuery = mode === 'query' && pk.length > 0
  const { data, error, isLoading, refetch } = useApiQuery(
    isQuery ? qk.table(`${name}:q:${pkName}:${pk}`) : qk.table(`${name}:s:${cursor ?? ''}`),
    () => (isQuery ? api.queryTable(name, { pk, pkName }) : api.scanTable(name, cursor)),
    { enabled: false, placeholderData: keepPreviousData },
  )

  const cols = data ? [...new Set(data.items.flatMap((r) => Object.keys(r)))] : []

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-base font-semibold">{name}</h2>
        <div className="flex gap-2">
          <Button variant={mode === 'scan' ? 'default' : 'ghost'} onClick={() => setMode('scan')}>
            Scan
          </Button>
          <Button variant={mode === 'query' ? 'default' : 'ghost'} onClick={() => setMode('query')}>
            Query
          </Button>
        </div>
        {mode === 'query' && (
          <>
            <Input
              placeholder="PK name (e.g. id)"
              value={pkName}
              onChange={(e) => setPkName(e.target.value)}
              className="w-36"
            />
            <Input
              placeholder="PK value"
              value={pk}
              onChange={(e) => setPk(e.target.value)}
              className="w-48"
            />
          </>
        )}
        <Button onClick={() => refetch()} disabled={isLoading}>
          <Search size={13} />
          {isLoading ? 'Loading…' : 'Load'}
        </Button>
      </div>

      {error && (
        <div className="text-sm text-destructive-foreground bg-destructive/20 rounded px-3 py-2">
          {(error as Error).message}
        </div>
      )}

      {data && (
        <>
          <div className="flex items-center gap-2">
            <Badge variant="muted">{data.items.length} items</Badge>
            {data.cursor && (
              <Button variant="outline" onClick={() => setCursor(data.cursor)}>
                Load more
              </Button>
            )}
          </div>
          {data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items.</p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  {cols.map((c) => (
                    <Th key={c}>{c}</Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {data.items.map((row, i) => (
                  <Tr key={i}>
                    {cols.map((c) => (
                      <Td key={c}>
                        <JsonCell value={row[c]} />
                      </Td>
                    ))}
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </>
      )}
    </div>
  )
}
