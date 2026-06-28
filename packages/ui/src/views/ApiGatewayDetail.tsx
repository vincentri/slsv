import { useState } from 'react'
import { api } from '@/lib/api'
import { useApiQuery, qk } from '@/lib/query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChevronLeft, Copy, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'routes' | 'stages'

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-blue-500/20 text-blue-300',
  POST: 'bg-green-500/20 text-green-300',
  PUT: 'bg-yellow-500/20 text-yellow-300',
  PATCH: 'bg-orange-500/20 text-orange-300',
  DELETE: 'bg-red-500/20 text-red-300',
  OPTIONS: 'bg-muted text-muted-foreground',
  ANY: 'bg-purple-500/20 text-purple-300',
}

export function ApiGatewayDetail({
  id,
  name,
  onBack,
}: {
  id: string
  name: string
  onBack: () => void
}) {
  const [tab, setTab] = useState<Tab>('routes')
  const { data: detail, error, isLoading } = useApiQuery(qk.apigw(id), () => api.getApi(id))

  const copy = (text: string) => navigator.clipboard.writeText(text)

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} /> APIs
        </button>
        <span className="text-muted-foreground">/</span>
        <h2 className="text-base font-semibold">{name}</h2>
        <Badge variant="muted" className="font-mono text-xs">
          {id}
        </Badge>
        <Badge variant="muted">REST API</Badge>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList className="flex h-auto justify-start gap-1 rounded-none border-b border-border bg-transparent p-0 text-muted-foreground">
          <TabsTrigger
            value="routes"
            className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-2 text-sm shadow-none data-[state=active]:border-accent-foreground data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            Resources
          </TabsTrigger>
          <TabsTrigger
            value="stages"
            className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-2 text-sm shadow-none data-[state=active]:border-accent-foreground data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            Stages
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {error && (
        <div className="text-sm text-destructive-foreground bg-destructive/20 rounded px-3 py-2">
          {(error as Error).message}
        </div>
      )}
      {!detail && !error && isLoading && (
        <div className="text-sm text-muted-foreground">Loading…</div>
      )}

      {detail && tab === 'routes' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="muted">{detail.routes.length} routes</Badge>
          </div>
          {detail.routes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No routes found.</p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-24">
                      Method
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Path
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Integration
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.routes.map((r, i) => (
                    <tr
                      key={i}
                      className={cn('transition-colors', i > 0 && 'border-t border-border/50')}
                    >
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            'inline-block px-2 py-0.5 rounded text-xs font-bold font-mono',
                            METHOD_COLORS[r.method] ?? METHOD_COLORS.ANY,
                          )}
                        >
                          {r.method}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-accent-foreground">
                        {r.path}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {r.integration ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {detail && tab === 'stages' && (
        <div className="space-y-3">
          {detail.stages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stages deployed.</p>
          ) : (
            detail.stages.map((s) => (
              <div key={s.name} className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Badge variant="muted">stage</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono text-accent-foreground bg-muted/30 rounded px-2 py-1 truncate">
                    {s.url}
                  </code>
                  <Button
                    variant="ghost"
                    className="h-7 w-7 p-0 shrink-0"
                    onClick={() => copy(s.url)}
                  >
                    <Copy size={12} />
                  </Button>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    <Button variant="ghost" className="h-7 w-7 p-0 shrink-0">
                      <ExternalLink size={12} />
                    </Button>
                  </a>
                </div>
                <div className="flex gap-6 text-xs text-muted-foreground">
                  {s.createdDate && <span>Created {new Date(s.createdDate).toLocaleString()}</span>}
                  {s.lastUpdated && <span>Updated {new Date(s.lastUpdated).toLocaleString()}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
