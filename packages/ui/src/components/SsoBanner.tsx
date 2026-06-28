import { useState } from 'react'
import { isTauri } from '@/lib/api'

interface Props {
  profile: string
  accountName: string
  onDone: () => void
}

export function SsoBanner({ profile, accountName, onDone }: Props) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string>()

  async function reauth() {
    if (!isTauri) return
    setLoading(true)
    setErr(undefined)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('sso_login', { profile })
      onDone()
    } catch (e: any) {
      setErr(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <span className="flex items-center gap-2 text-sm text-yellow-400">
      Session expired — {accountName} ({profile})
      {isTauri ? (
        <button
          onClick={reauth}
          disabled={loading}
          className="underline opacity-80 hover:opacity-100 disabled:cursor-wait"
        >
          {loading ? 'Opening browser…' : 'Re-authenticate'}
        </button>
      ) : (
        <span className="opacity-60">Run: aws sso login --profile {profile}</span>
      )}
      {err && <span className="text-red-400 text-xs">{err}</span>}
    </span>
  )
}
