import {
  Activity,
  Archive,
  Database,
  Lock,
  ScrollText,
  SlidersHorizontal,
  Workflow,
  Zap,
} from 'lucide-react'
import { ServiceCard } from '@/components/ServiceCard'
import type { AccountMeta, Overview } from '@/lib/api'

type NavKind =
  | 'overview'
  | 'database'
  | 'sql'
  | 'queue'
  | 'bucket'
  | 'lambda'
  | 'apigw'
  | 'eb'
  | 'secrets'
  | 'logs'
  | 'cache'

export function OverviewView({
  data,
  meta,
  onNav,
}: {
  data: Overview
  meta?: AccountMeta
  onNav: (view: NavKind, name?: string) => void
}) {
  const isAws = meta?.kind === 'aws'
  const logGroups = data.logGroups ?? []

  const services = [
    { icon: Database, name: 'Amazon DynamoDB', kind: 'database' as NavKind, items: data.databases },
    { icon: Database, name: 'RDS / SQL', kind: 'sql' as NavKind, items: data.sqlDatabases ?? [] },
    { icon: Activity, name: 'Amazon SQS', kind: 'queue' as NavKind, items: data.queues },
    { icon: Archive, name: 'Amazon S3', kind: 'bucket' as NavKind, items: data.buckets },
    { icon: Zap, name: 'AWS Lambda', kind: 'lambda' as NavKind, items: data.functions },
    {
      icon: Workflow,
      name: 'Amazon EventBridge',
      kind: 'eb' as NavKind,
      items: data.buses ?? [],
      firstName: data.buses?.[0]?.name,
    },
    {
      icon: Lock,
      name: 'Secrets Manager',
      kind: 'secrets' as NavKind,
      items: data.secrets.map((s) => ({ name: s })),
      firstName: data.secrets[0],
    },
    {
      icon: ScrollText,
      name: 'CloudWatch Logs',
      kind: 'logs' as NavKind,
      items: logGroups,
      firstName: logGroups[0]?.name,
    },
    {
      icon: SlidersHorizontal,
      name: 'Amazon ElastiCache',
      kind: 'cache' as NavKind,
      items: data.caches,
    },
  ]

  return (
    <div className="space-y-8 p-6">
      {isAws && (
        <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-3 text-sm text-orange-300">
          Real AWS account ({data.region}). Read-only. Scans capped at 100 items.
        </div>
      )}

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Services
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {services.map((s) => (
            <ServiceCard
              key={s.name}
              icon={s.icon}
              name={s.name}
              count={s.items.length}
              disabled={s.items.length === 0}
              onClick={
                s.items.length > 0
                  ? () => {
                      const target =
                        (s as { firstName?: string }).firstName ??
                        (s.items[0] as { name?: string })?.name
                      onNav(s.kind, target)
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </section>
    </div>
  )
}
