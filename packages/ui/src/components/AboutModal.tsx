import { useEffect, useState } from 'react'
import { X, Cloud } from 'lucide-react'
import { isTauri } from '@/lib/api'

interface Props {
  onClose: () => void
  onCheckUpdate?: () => void
  updateAvailable?: string | null
}

export function AboutModal({ onClose, onCheckUpdate, updateAvailable }: Props) {
  const [version, setVersion] = useState('—')
  const [name, setName] = useState('slsv UI')

  useEffect(() => {
    if (!isTauri) return
    import('@tauri-apps/api/app').then(async (app) => {
      setVersion(await app.getVersion())
      setName(await app.getName())
    })
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold">About</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3 px-5 py-6">
          <Cloud size={32} className="text-accent-foreground" />
          <div className="text-center">
            <p className="font-medium">{name}</p>
            <p className="text-xs text-muted-foreground font-mono">v{version}</p>
          </div>

          {updateAvailable ? (
            <button
              onClick={onCheckUpdate}
              className="rounded bg-accent-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
            >
              Update to v{updateAvailable}
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">You're up to date</p>
          )}
        </div>
      </div>
    </div>
  )
}
