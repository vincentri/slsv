import { useState } from 'react'
import { Cloud } from 'lucide-react'

type AccountType = 'local' | 'aws-sso'

interface Props {
  onDone: () => void
  theme: 'light' | 'dark'
}

export function Onboarding({ onDone, theme }: Props) {
  const [type, setType] = useState<AccountType>('local')
  const [name, setName] = useState('local')
  const [endpoint, setEndpoint] = useState('http://localhost:4566')
  const [profile, setProfile] = useState('')
  const [region, setRegion] = useState('us-east-1')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string>()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErr(undefined)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const acct: Record<string, string> = { name, region }
      if (type === 'local') acct.endpoint = endpoint
      else acct.profile = profile

      const yaml = `accounts:\n  - name: ${acct.name}\n    region: ${acct.region}\n${
        type === 'local' ? `    endpoint: ${acct.endpoint}` : `    profile: ${acct.profile}`
      }\n`

      await invoke('save_config', { yaml })
      await new Promise((r) => setTimeout(r, 800))
      onDone()
    } catch (e: any) {
      setErr(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={`${theme === 'dark' ? 'dark' : ''} flex h-screen items-center justify-center bg-background text-foreground`}
    >
      <div className="w-full max-w-sm space-y-6 p-8">
        <div className="flex items-center gap-2">
          <Cloud size={20} className="text-accent-foreground" />
          <h1 className="text-lg font-semibold">Connect an account</h1>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType('local')}
              className={`flex-1 rounded border px-3 py-1.5 text-sm transition-colors ${type === 'local' ? 'border-accent-foreground bg-accent/20' : 'border-border hover:bg-accent/10'}`}
            >
              Local (MiniStack)
            </button>
            <button
              type="button"
              onClick={() => setType('aws-sso')}
              className={`flex-1 rounded border px-3 py-1.5 text-sm transition-colors ${type === 'aws-sso' ? 'border-accent-foreground bg-accent/20' : 'border-border hover:bg-accent/10'}`}
            >
              AWS SSO
            </button>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-muted-foreground">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent-foreground"
                required
              />
            </label>

            {type === 'local' ? (
              <label className="block">
                <span className="text-xs text-muted-foreground">Endpoint</span>
                <input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent-foreground"
                  required
                />
              </label>
            ) : (
              <label className="block">
                <span className="text-xs text-muted-foreground">AWS Profile</span>
                <input
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                  placeholder="my-sso-profile"
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent-foreground"
                  required
                />
              </label>
            )}

            <label className="block">
              <span className="text-xs text-muted-foreground">Region</span>
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent-foreground"
                required
              />
            </label>
          </div>

          {err && <p className="text-xs text-red-400">{err}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded bg-accent-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
          >
            {saving ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  )
}
