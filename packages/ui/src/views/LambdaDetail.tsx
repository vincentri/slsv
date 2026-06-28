import { useState } from 'react'
import { api } from '@/lib/api'
import { useApiQuery, qk } from '@/lib/query'
import { LogViewer } from '@/views/LogViewer'
import { Badge } from '@/components/ui/badge'
import { Row, Section } from '@/components/ui/detail'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'config' | 'logs'

export function LambdaDetail({ name, onBack }: { name: string; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('config')
  const { data: cfg, error, isLoading } = useApiQuery(qk.lambda(name), () => api.getFunction(name))

  const logGroup = cfg?.logGroup ?? `/aws/lambda/${name}`

  const stateColor = !cfg?.state
    ? ''
    : cfg.state === 'Active'
      ? 'text-green-400'
      : cfg.state === 'Failed'
        ? 'text-red-400'
        : 'text-yellow-400'

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} /> Functions
        </button>
        <span className="text-muted-foreground">/</span>
        <h2 className="text-base font-semibold font-mono">{name}</h2>
        {cfg?.state && <span className={cn('text-xs font-medium', stateColor)}>{cfg.state}</span>}
        {cfg?.runtime && <Badge variant="muted">{cfg.runtime}</Badge>}
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList className="flex h-auto justify-start gap-1 rounded-none border-b border-border bg-transparent p-0 text-muted-foreground">
          <TabsTrigger
            value="config"
            className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-2 text-sm shadow-none data-[state=active]:border-accent-foreground data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            Configuration
          </TabsTrigger>
          <TabsTrigger
            value="logs"
            className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-2 text-sm shadow-none data-[state=active]:border-accent-foreground data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            Logs
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {error && (
        <div className="text-sm text-destructive-foreground bg-destructive/20 rounded px-3 py-2">
          {(error as Error).message}
        </div>
      )}
      {!cfg && !error && isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {cfg && tab === 'config' && (
        <div>
          <Section title="General">
            <Row label="Function ARN" value={cfg.arn} />
            <Row label="State" value={cfg.state} />
            <Row label="Last update status" value={cfg.lastUpdateStatus} />
            <Row label="Version" value={cfg.version} />
            <Row label="Package type" value={cfg.packageType} />
            <Row label="Architectures" value={cfg.architectures.join(', ')} />
            <Row label="Runtime" value={cfg.runtime} />
            <Row label="Handler" value={cfg.handler} />
            <Row label="Memory" value={cfg.memory ? `${cfg.memory} MB` : undefined} />
            <Row label="Timeout" value={cfg.timeout ? `${cfg.timeout} seconds` : undefined} />
            <Row
              label="Ephemeral storage (/tmp)"
              value={cfg.ephemeralStorage ? `${cfg.ephemeralStorage} MB` : undefined}
            />
            <Row
              label="Code size"
              value={cfg.codeSize ? `${(cfg.codeSize / 1024).toFixed(1)} KB` : undefined}
            />
            <Row label="Code SHA-256" value={cfg.codeSha256} />
            <Row
              label="Last modified"
              value={cfg.lastModified ? new Date(cfg.lastModified).toLocaleString() : undefined}
            />
          </Section>

          <Section title="Permissions">
            <Row label="Execution role" value={cfg.role} />
          </Section>

          {Object.keys(cfg.env).length > 0 && (
            <Section title="Environment variables">
              {Object.entries(cfg.env).map(([k, v]) => (
                <Row key={k} label={k} value={v} />
              ))}
            </Section>
          )}

          {cfg.layers.length > 0 && (
            <Section title="Layers">
              {cfg.layers.map((l, i) => (
                <Row key={i} label={`Layer ${i + 1}`} value={l} />
              ))}
            </Section>
          )}

          {(cfg.tracingMode || cfg.dlqTarget || cfg.logGroup) && (
            <Section title="Advanced">
              <Row label="X-Ray tracing" value={cfg.tracingMode} />
              <Row label="Dead-letter target" value={cfg.dlqTarget} />
              <Row label="Log group" value={cfg.logGroup} />
            </Section>
          )}
        </div>
      )}

      {tab === 'logs' && <LogViewer group={logGroup} />}
    </div>
  )
}
