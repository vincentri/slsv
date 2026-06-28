import { api } from '@/lib/api'
import { useApiQuery, qk } from '@/lib/query'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, Lock, ShieldOff } from 'lucide-react'

function Row({ label, value }: { label: string; value?: string | number | boolean | null }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="flex gap-4 py-2 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground text-sm w-48 shrink-0">{label}</span>
      <span className="text-sm font-mono break-all">{String(value)}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {title}
      </h3>
      <div className="rounded-lg border border-border bg-card px-4">{children}</div>
    </div>
  )
}

export function SecretDetail({ name, onBack }: { name: string; onBack: () => void }) {
  const { data: secret, error, isLoading } = useApiQuery(qk.secret(name), () =>
    api.getSecret(name),
  )

  const tags = secret ? Object.entries(secret.tags) : []

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} /> Secrets
        </button>
        <span className="text-muted-foreground">/</span>
        <Lock size={14} className="text-muted-foreground" />
        <h2 className="text-base font-semibold font-mono">{name}</h2>
        {secret?.rotationEnabled && <Badge variant="muted">rotation on</Badge>}
      </div>

      {/* Safety notice */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
        <ShieldOff size={14} className="shrink-0" />
        Secret values are never retrieved — metadata only.
      </div>

      {error && (
        <div className="text-sm text-destructive-foreground bg-destructive/20 rounded px-3 py-2">
          {(error as Error).message}
        </div>
      )}
      {!secret && !error && isLoading && (
        <div className="text-sm text-muted-foreground">Loading…</div>
      )}

      {secret && (
        <>
          <Section title="General">
            <Row label="Secret ARN" value={secret.arn} />
            <Row
              label="Created"
              value={secret.createdDate ? new Date(secret.createdDate).toLocaleString() : undefined}
            />
            <Row
              label="Last changed"
              value={
                secret.lastChangedDate
                  ? new Date(secret.lastChangedDate).toLocaleString()
                  : undefined
              }
            />
            <Row
              label="Last accessed"
              value={
                secret.lastAccessedDate
                  ? new Date(secret.lastAccessedDate).toLocaleString()
                  : undefined
              }
            />
          </Section>

          <Section title="Rotation">
            <Row label="Rotation enabled" value={secret.rotationEnabled ? 'Yes' : 'No'} />
            {secret.rotationEnabled && secret.rotationRules?.AutomaticallyAfterDays && (
              <Row
                label="Rotate every"
                value={`${secret.rotationRules.AutomaticallyAfterDays} days`}
              />
            )}
          </Section>

          {tags.length > 0 && (
            <Section title="Tags">
              {tags.map(([k, v]) => (
                <Row key={k} label={k} value={v} />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  )
}
