import { useEffect, useState } from 'react'
import { isTauri } from './api'

export interface UpdateInfo {
  version: string
  notes: string
  mandatory: boolean
  install: (onProgress?: (pct: number) => void) => Promise<void>
}

// Convention: a release whose notes contain [FORCE] is mandatory — blocks the UI
// until installed. Keeps force-update signalling in the manifest, no extra infra.
function parseMandatory(notes: string) {
  return /\[FORCE\]/i.test(notes)
}

export function useUpdater(): { update: UpdateInfo | null; checking: boolean } {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!isTauri) return
    let cancelled = false

    async function run() {
      setChecking(true)
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const found = await check()
        if (!found || cancelled) return
        const notes = found.body ?? ''
        setUpdate({
          version: found.version,
          notes: notes.replace(/\[FORCE\]/gi, '').trim(),
          mandatory: parseMandatory(notes),
          install: async (onProgress) => {
            let total = 0
            let got = 0
            await found.downloadAndInstall((e) => {
              if (e.event === 'Started') total = e.data.contentLength ?? 0
              else if (e.event === 'Progress') {
                got += e.data.chunkLength
                if (total) onProgress?.(Math.round((got / total) * 100))
              }
            })
            const { relaunch } = await import('@tauri-apps/plugin-process')
            await relaunch()
          },
        })
      } catch {
        // offline or no manifest — silently skip
      } finally {
        if (!cancelled) setChecking(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [])

  return { update, checking }
}
