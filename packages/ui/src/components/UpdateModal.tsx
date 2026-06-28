import { useState } from 'react'
import { Download } from 'lucide-react'
import type { UpdateInfo } from '@/lib/updater'

interface Props {
  update: UpdateInfo
  onClose?: () => void // omitted when mandatory
}

export function UpdateModal({ update, onClose }: Props) {
  const [installing, setInstalling] = useState(false)
  const [pct, setPct] = useState(0)
  const [err, setErr] = useState<string>()

  async function run() {
    setInstalling(true)
    setErr(undefined)
    try {
      await update.install(setPct)
      // relaunches on success — code below won't run
    } catch (e: any) {
      setErr(String(e))
      setInstalling(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Download size={16} className="text-accent-foreground" />
          <h2 className="font-semibold">Update available — v{update.version}</h2>
        </div>

        <div className="space-y-3 px-5 py-4">
          {update.mandatory && (
            <p className="text-xs text-yellow-400">This update is required to continue.</p>
          )}
          {update.notes && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-3 text-xs text-muted-foreground">
              {update.notes}
            </pre>
          )}

          {installing && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded bg-background">
                <div
                  className="h-full bg-accent-foreground transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {pct}% — installing, app will restart…
              </p>
            </div>
          )}

          {err && <p className="text-xs text-red-400">{err}</p>}

          <div className="flex gap-2 pt-1">
            {!update.mandatory && onClose && (
              <button
                onClick={onClose}
                disabled={installing}
                className="flex-1 rounded border border-border px-3 py-1.5 text-sm hover:bg-accent/10 disabled:opacity-40"
              >
                Later
              </button>
            )}
            <button
              onClick={run}
              disabled={installing}
              className="flex-1 rounded bg-accent-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {installing ? 'Installing…' : 'Update & restart'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
