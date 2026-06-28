import { useEffect, useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'

interface Account {
  name: string
  type: 'local' | 'aws-sso'
  endpoint?: string
  profile?: string
  region: string
}

function toYaml(accounts: Account[]): string {
  const lines = ['accounts:']
  for (const a of accounts) {
    lines.push(`  - name: ${a.name}`)
    lines.push(`    region: ${a.region}`)
    if (a.type === 'local' && a.endpoint) lines.push(`    endpoint: ${a.endpoint}`)
    if (a.type === 'aws-sso' && a.profile) lines.push(`    profile: ${a.profile}`)
  }
  return lines.join('\n') + '\n'
}

function parseYaml(raw: string): Account[] {
  const accounts: Account[] = []
  const lines = raw.split('\n')
  let current: Partial<Account> | null = null
  for (const line of lines) {
    if (line.match(/^  - name:/)) {
      if (current?.name) accounts.push(current as Account)
      current = {
        name: line.replace(/^  - name:\s*/, '').trim(),
        type: 'local',
        region: 'us-east-1',
      }
    } else if (current) {
      const kv = line.match(/^\s+(\w+):\s*(.+)/)
      if (!kv) continue
      const [, k, v] = kv
      if (k === 'region') current.region = v
      if (k === 'endpoint') {
        current.endpoint = v
        current.type = 'local'
      }
      if (k === 'profile') {
        current.profile = v
        current.type = 'aws-sso'
      }
    }
  }
  if (current?.name) accounts.push(current as Account)
  return accounts
}

const blank: Account = {
  name: '',
  type: 'local',
  endpoint: 'http://localhost:4566',
  region: 'us-east-1',
}

interface Props {
  onClose: () => void
  onSaved: () => void
}

export function AccountsManager({ onClose, onSaved }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<Account>({ ...blank })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string>()

  useEffect(() => {
    import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke<string>('get_config').then((yaml) => setAccounts(parseYaml(yaml))),
    )
  }, [])

  async function save(next: Account[]) {
    setSaving(true)
    setErr(undefined)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('save_config', { yaml: toYaml(next) })
      setAccounts(next)
      onSaved()
    } catch (e: any) {
      setErr(String(e))
    } finally {
      setSaving(false)
    }
  }

  function addAccount(e: React.FormEvent) {
    e.preventDefault()
    const next = [...accounts, { ...form }]
    setAdding(false)
    setForm({ ...blank })
    save(next)
  }

  function remove(name: string) {
    save(accounts.filter((a) => a.name !== name))
    setConfirmDelete(null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold">Accounts</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="divide-y divide-border">
          {accounts.map((a) => (
            <div key={a.name} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {a.type === 'local' ? a.endpoint : `profile: ${a.profile}`} · {a.region}
                </p>
              </div>
              {confirmDelete === a.name ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Remove?</span>
                  <button
                    onClick={() => remove(a.name)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(a.name)}
                  disabled={saving}
                  className="text-muted-foreground hover:text-red-400 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {adding ? (
          <form onSubmit={addAccount} className="space-y-3 border-t border-border px-5 py-4">
            <div className="flex gap-2">
              {(['local', 'aws-sso'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, type: t }))}
                  className={`flex-1 rounded border px-2 py-1 text-xs transition-colors ${form.type === t ? 'border-accent-foreground bg-accent/20' : 'border-border hover:bg-accent/10'}`}
                >
                  {t === 'local' ? 'Local' : 'AWS SSO'}
                </button>
              ))}
            </div>

            {[
              { label: 'Name', key: 'name', required: true },
              form.type === 'local'
                ? { label: 'Endpoint', key: 'endpoint', required: true }
                : { label: 'Profile', key: 'profile', required: true },
              { label: 'Region', key: 'region', required: true },
            ].map(({ label, key, required }) => (
              <label key={key} className="block">
                <span className="text-xs text-muted-foreground">{label}</span>
                <input
                  value={(form as any)[key] ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  required={required}
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent-foreground"
                />
              </label>
            ))}

            {err && <p className="text-xs text-red-400">{err}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="flex-1 rounded border border-border px-3 py-1.5 text-sm hover:bg-accent/10"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded bg-accent-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Add'}
              </button>
            </div>
          </form>
        ) : (
          <div className="border-t border-border px-5 py-3">
            <button
              onClick={() => setAdding(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-border py-2 text-sm text-muted-foreground hover:border-accent-foreground hover:text-foreground transition-colors"
            >
              <Plus size={13} /> Add account
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
