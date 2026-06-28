import { useState } from 'react'
import { api } from '@/lib/api'
import { useApiQuery, qk } from '@/lib/query'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

function RuleRow({
  rule,
  onSelect,
  active,
}: {
  rule: import('@/lib/api').EventBusRule
  onSelect: () => void
  active: boolean
}) {
  const type = rule.scheduleExpression
    ? 'schedule'
    : rule.eventPattern
      ? 'event pattern'
      : 'unknown'
  const value = rule.scheduleExpression ?? (rule.eventPattern ? '{ … }' : '—')
  const enabled = rule.state === 'ENABLED'

  return (
    <tr
      onClick={onSelect}
      className={cn(
        'cursor-pointer transition-colors hover:bg-accent/10 border-t border-border/50 first:border-0',
        active && 'bg-accent/20',
      )}
    >
      <td className="px-4 py-3">
        <span className="font-mono text-xs text-accent-foreground">{rule.name}</span>
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            'text-xs font-medium',
            enabled ? 'text-green-400' : 'text-muted-foreground',
          )}
        >
          {rule.state ?? '—'}
        </span>
      </td>
      <td className="px-4 py-3">
        <Badge variant="muted" className="text-xs capitalize">
          {type}
        </Badge>
      </td>
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground truncate max-w-xs">
        {value}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground truncate">
        {rule.description ?? '—'}
      </td>
    </tr>
  )
}

function RuleDetailPanel({
  busName,
  ruleName,
  onClose,
}: {
  busName: string
  ruleName: string
  onClose: () => void
}) {
  const { data: detail, error, isLoading } = useApiQuery(qk.rule(busName, ruleName), () =>
    api.getRule(busName, ruleName),
  )

  return (
    <div className="border-l border-border w-80 shrink-0 overflow-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight size={14} />
        </button>
        <span className="text-sm font-medium font-mono truncate">{ruleName}</span>
      </div>

      {error && (
        <div className="text-xs text-destructive-foreground bg-destructive/20 rounded px-2 py-1">
          {(error as Error).message}
        </div>
      )}
      {!detail && !error && isLoading && (
        <div className="text-xs text-muted-foreground">Loading…</div>
      )}

      {detail && (
        <div className="space-y-4 text-sm">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">State</p>
            <span
              className={cn(
                'text-xs font-medium',
                detail.state === 'ENABLED' ? 'text-green-400' : 'text-muted-foreground',
              )}
            >
              {detail.state}
            </span>
          </div>

          {detail.scheduleExpression && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Schedule</p>
              <code className="block text-xs font-mono bg-muted/20 rounded px-2 py-1">
                {detail.scheduleExpression}
              </code>
            </div>
          )}

          {detail.eventPattern && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Event Pattern
              </p>
              <pre className="text-xs font-mono bg-muted/20 rounded px-2 py-2 overflow-auto max-h-40">
                {JSON.stringify(JSON.parse(detail.eventPattern), null, 2)}
              </pre>
            </div>
          )}

          {detail.description && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Description</p>
              <p className="text-xs">{detail.description}</p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Targets ({detail.targets.length})
            </p>
            {detail.targets.length === 0 ? (
              <p className="text-xs text-muted-foreground">No targets.</p>
            ) : (
              detail.targets.map((t) => (
                <div key={t.id} className="rounded bg-muted/20 px-2 py-1.5 space-y-0.5">
                  <p className="text-xs font-medium">{t.id}</p>
                  <p className="text-xs font-mono text-muted-foreground break-all">{t.arn}</p>
                </div>
              ))
            )}
          </div>

          {detail.arn && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Rule ARN</p>
              <p className="text-xs font-mono break-all text-muted-foreground">{detail.arn}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function EventBridgeDetail({ busName, onBack }: { busName: string; onBack: () => void }) {
  const { data: rules, error, isLoading } = useApiQuery(qk.bus(busName), () => api.getBus(busName))
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft size={14} /> Event Buses
          </button>
          <span className="text-muted-foreground">/</span>
          <h2 className="text-base font-semibold">{busName}</h2>
          <Badge variant="muted">event bus</Badge>
          {rules && <Badge variant="muted">{rules.length} rules</Badge>}
        </div>

        {error && (
          <div className="text-sm text-destructive-foreground bg-destructive/20 rounded px-3 py-2">
            {(error as Error).message}
          </div>
        )}
        {!rules && !error && isLoading && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}

        {rules && rules.length === 0 && (
          <p className="text-sm text-muted-foreground">No rules on this bus.</p>
        )}

        {rules && rules.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Rule name
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">State</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Type</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Expression / Pattern
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <RuleRow
                    key={rule.name}
                    rule={rule}
                    active={selected === rule.name}
                    onSelect={() => setSelected((s) => (s === rule.name ? null : rule.name))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <RuleDetailPanel busName={busName} ruleName={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
