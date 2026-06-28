import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type ObjectAcl, type BucketMeta } from '@/lib/api'
import { qk } from '@/lib/query'
import {
  ChevronRight,
  ChevronLeft,
  Download,
  Trash2,
  X,
  MoreVertical,
  RefreshCw,
  Search,
  Folder,
  Copy,
  Check,
  File,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Section, Row } from '@/components/ui/detail'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
function val(x: string | undefined | null, fallback = 'Disabled') {
  return x ?? fallback
}

// ─── Preview ────────────────────────────────────────────────────────────────
function PreviewSection({ rawUrl, contentType }: { rawUrl: string; contentType: string }) {
  const [text, setText] = useState<string | null>(null)
  const isImage = /^image\//.test(contentType)
  const isPdf = contentType === 'application/pdf'
  const isVideo = /^video\//.test(contentType)
  const isAudio = /^audio\//.test(contentType)
  const isText =
    /^text\//.test(contentType) ||
    contentType === 'application/json' ||
    contentType === 'application/xml'

  useEffect(() => {
    if (isText) {
      setText(null)
      fetch(rawUrl)
        .then((r) => r.text())
        .then(setText)
        .catch(() => setText('(error loading preview)'))
    }
  }, [rawUrl, isText])

  if (isImage)
    return (
      <Section title="Preview">
        <div className="py-2">
          <img src={rawUrl} alt="preview" className="max-h-56 max-w-full object-contain rounded" />
        </div>
      </Section>
    )
  if (isPdf)
    return (
      <Section title="Preview">
        <div className="py-2">
          <iframe src={rawUrl} className="w-full h-64 rounded border border-border" />
        </div>
      </Section>
    )
  if (isVideo)
    return (
      <Section title="Preview">
        <div className="py-2">
          <video controls className="w-full max-h-56 rounded">
            <source src={rawUrl} type={contentType} />
          </video>
        </div>
      </Section>
    )
  if (isAudio)
    return (
      <Section title="Preview">
        <div className="py-2">
          <audio controls className="w-full">
            <source src={rawUrl} type={contentType} />
          </audio>
        </div>
      </Section>
    )
  if (isText)
    return (
      <Section title="Preview">
        <div className="py-2">
          <pre className="text-xs overflow-auto max-h-56 font-mono whitespace-pre-wrap break-all">
            {text ?? 'Loading…'}
          </pre>
        </div>
      </Section>
    )
  return (
    <Section title="Preview">
      <p className="text-xs text-muted-foreground">Preview not available for this file type.</p>
    </Section>
  )
}

// ─── Object permissions tab ──────────────────────────────────────────────────
function ObjectPermissionsTab({ acl, loading }: { acl: ObjectAcl | null; loading: boolean }) {
  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>
  if (!acl) return <p className="text-sm text-muted-foreground p-4">Failed to load permissions.</p>
  return (
    <div className="p-6 space-y-4">
      <Section title="Owner">
        <Row label="Display name" value={val(acl.owner, 'Unknown')} />
      </Section>
      <Section title="Access Control List (ACL)">
        {acl.grants.length ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-1.5 font-medium w-1/2">Grantee</th>
                <th className="text-left py-1.5 font-medium">Permission</th>
              </tr>
            </thead>
            <tbody>
              {acl.grants.map((g, i) => (
                <tr key={i} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5 pr-4 break-all text-muted-foreground">{g.grantee}</td>
                  <td className="py-1.5 font-mono">{g.permission}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Row label="Grants" value="No grants" />
        )}
      </Section>
    </div>
  )
}

// ─── Object drawer ───────────────────────────────────────────────────────────
function ObjectDrawer({
  bucketName,
  objKey,
  onClose,
  onDeleted,
}: {
  bucketName: string
  objKey: string
  onClose: () => void
  onDeleted: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<'properties' | 'permissions'>('properties')

  // ponytail: headObject on mount; ACL lazy on Permissions tab.
  const detailQ = useQuery({
    queryKey: qk.object(bucketName, objKey),
    queryFn: () => api.headObject(bucketName, objKey),
  })
  const aclQ = useQuery({
    queryKey: qk.objectAcl(bucketName, objKey),
    queryFn: () => api.getObjectAcl(bucketName, objKey),
    enabled: tab === 'permissions',
  })
  const detail = detailQ.data ?? null
  const loading = detailQ.isLoading
  const loadErr = detailQ.error ? (detailQ.error as Error).message : null
  const acl = aclQ.data ?? null
  const aclLoading = aclQ.isLoading

  const name = objKey.split('/').pop()!
  const rawUrl = api.rawObjectUrl(bucketName, objKey)
  // Public-facing URL for display / download
  const displayUrl = window.location.origin + rawUrl

  function handleDelete() {
    setDeleting(true)
    api
      .deleteObject(bucketName, objKey)
      .then(() => {
        onDeleted()
        onClose()
      })
      .catch(() => setDeleting(false))
  }

  function copyUrl() {
    navigator.clipboard.writeText(displayUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-40 bg-black/20"
        style={{ top: '48px', marginTop: 0 }}
        onClick={onClose}
      />
      <div
        className="fixed right-0 bottom-0 z-50 w-[520px] max-w-full flex flex-col bg-background border-l border-border shadow-xl"
        style={{ top: '48px', marginTop: 0, animation: 'slideInRight 0.2s ease-out' }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0"
          style={{ marginTop: 0 }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{name}</p>
            {objKey !== name && <p className="text-xs text-muted-foreground truncate">{objKey}</p>}
          </div>
          <a
            href={rawUrl}
            download={name}
            title="Download"
            className="p-1.5 rounded text-foreground/60 hover:text-foreground hover:bg-accent/20 transition-colors"
          >
            <Download size={14} />
          </a>
          <button
            onClick={() => setConfirm(true)}
            title="Delete"
            className="p-1.5 rounded text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body — no extra padding, sections handle their own */}
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {loading && <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>}

          {loadErr && !loading && (
            <div className="px-4 py-6 text-sm text-destructive">{loadErr}</div>
          )}

          {detail && !loading && (
            <>
              {/* Preview first */}
              <div className="px-4 py-3">
                <PreviewSection rawUrl={rawUrl} contentType={detail.contentType} />
              </div>

              {/* Object URL */}
              <div className="px-4 py-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Object URL
                </p>
                <div className="flex items-center gap-1.5">
                  <code className="text-xs bg-muted rounded px-2 py-1 flex-1 truncate">
                    {displayUrl}
                  </code>
                  <button
                    onClick={copyUrl}
                    title="Copy URL"
                    className="p-1.5 rounded text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors shrink-0"
                  >
                    {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                  </button>
                </div>
              </div>

              {/* Object overview */}
              <div className="px-4 py-3">
                <Section title="Object overview">
                  <Row label="Key" value={detail.key} />
                  <Row label="Size" value={formatBytes(detail.size)} />
                  <Row
                    label="Last modified"
                    value={detail.modified ? new Date(detail.modified).toLocaleString() : undefined}
                  />
                  <Row label="ETag" value={detail.etag} />
                  <Row label="Version ID" value={val(detail.versionId, 'N/A')} />
                </Section>
              </div>

              <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
                <TabsList className="flex h-auto justify-start gap-0 rounded-none border-b border-border bg-transparent px-4 pt-3 text-muted-foreground">
                  {(['properties', 'permissions'] as const).map((t) => (
                    <TabsTrigger
                      key={t}
                      value={t}
                      className="rounded-none border-b-2 border-transparent bg-transparent px-3 py-2 text-sm font-medium capitalize shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                    >
                      {t}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {tab === 'properties' && (
                <>
                  {/* Properties */}
                  <div className="px-4 py-3">
                    <Section title="Properties">
                      <Row label="Content type" value={detail.contentType} />
                      <Row label="Storage class" value={detail.storageClass ?? 'STANDARD'} />
                      <Row
                        label="Server-side encryption"
                        value={val(detail.serverSideEncryption, 'None')}
                      />
                      <Row
                        label="Checksum algorithm"
                        value={val(detail.checksumAlgorithm, 'None')}
                      />
                    </Section>
                  </div>

                  {/* HTTP headers */}
                  <div className="px-4 py-3">
                    <Section title="HTTP headers">
                      <Row label="Cache-Control" value={val(detail.cacheControl, 'Not set')} />
                      <Row
                        label="Content-Encoding"
                        value={val(detail.contentEncoding, 'Not set')}
                      />
                      <Row
                        label="Content-Disposition"
                        value={val(detail.contentDisposition, 'Not set')}
                      />
                      <Row
                        label="Expires"
                        value={
                          detail.expires ? new Date(detail.expires).toLocaleString() : 'Not set'
                        }
                      />
                    </Section>
                  </div>

                  {/* Metadata */}
                  {detail.metadata && Object.keys(detail.metadata).length > 0 && (
                    <div className="px-4 py-3">
                      <Section title="User metadata">
                        {Object.entries(detail.metadata).map(([k, v]) => (
                          <Row key={k} label={k} value={v} />
                        ))}
                      </Section>
                    </div>
                  )}
                </>
              )}

              {tab === 'permissions' && (
                <>
                  <ObjectPermissionsTab acl={acl} loading={aclLoading} />
                  <div className="px-4 pb-3 text-xs text-muted-foreground">
                    Bucket-level public access and policies may further restrict access to this
                    object.
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="w-[360px] max-w-full">
          <DialogHeader>
            <DialogTitle>Delete object?</DialogTitle>
            <DialogDescription className="break-all">{objKey}</DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
          <DialogFooter>
            <button
              onClick={() => setConfirm(false)}
              className="px-3 py-1.5 text-sm rounded border border-border hover:bg-accent/20 transition-colors"
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              className="px-3 py-1.5 text-sm rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Three-dot menu ──────────────────────────────────────────────────────────
function ObjMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-20 w-28 rounded border border-border bg-background shadow-md text-sm">
          <button
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Properties tab ──────────────────────────────────────────────────────────
function PropertiesTab({ meta, loading }: { meta: BucketMeta | null; loading: boolean }) {
  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>
  if (!meta) return <p className="text-sm text-muted-foreground p-4">Failed to load properties.</p>
  return (
    <div className="p-6 space-y-4">
      <Section title="Bucket overview">
        <Row label="ARN" value={meta.arn} />
        <Row label="AWS Region" value={meta.region} />
        <Row
          label="Creation date"
          value={meta.created ? new Date(meta.created).toLocaleString() : undefined}
        />
      </Section>
      <Section title="Bucket owner">
        <Row label="Owner" value={val(meta.owner)} />
      </Section>
      <Section title="Bucket versioning">
        <Row label="Versioning" value={val(meta.versioning)} />
      </Section>
      <Section title="Default encryption">
        <Row label="Encryption" value={val(meta.encryption)} />
      </Section>
      <Section title="Tags">
        {meta.tags && Object.entries(meta.tags).length > 0 ? (
          Object.entries(meta.tags).map(([k, v]) => <Row key={k} label={k} value={v} />)
        ) : (
          <Row label="Tags" value="0 Tags" />
        )}
      </Section>
      <Section title="Server access logging">
        <Row label="Server access logging" value={val(meta.serverAccessLogging)} />
      </Section>
      <Section title="Event notifications">
        <Row label="Event notifications" value={`${meta.eventNotifications ?? 0} configurations`} />
        <Row label="Amazon EventBridge" value={meta.eventBridge ? 'Enabled' : 'Off'} />
      </Section>
      <Section title="Transfer acceleration">
        <Row label="Transfer acceleration" value={val(meta.transferAcceleration)} />
      </Section>
      <Section title="Object Lock">
        <Row label="Object Lock" value={val(meta.objectLock)} />
      </Section>
      <Section title="Requester pays">
        <Row label="Requester pays" value={val(meta.requesterPays, 'Disabled')} />
      </Section>
      <Section title="Static website hosting">
        <Row label="Static website hosting" value={val(meta.website, 'Disabled')} />
      </Section>
    </div>
  )
}

// ─── Permissions tab ─────────────────────────────────────────────────────────
function PermissionsTab({ meta, loading }: { meta: BucketMeta | null; loading: boolean }) {
  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>
  if (!meta) return <p className="text-sm text-muted-foreground p-4">Failed to load permissions.</p>
  const pab = meta.publicAccessBlock
  const flag = (v: boolean | undefined) => (v == null ? 'Not configured' : v ? 'On' : 'Off')
  return (
    <div className="p-6 space-y-4">
      <Section title="Block Public Access">
        <Row label="Block all public access via new ACLs" value={flag(pab?.blockPublicAcls)} />
        <Row label="Block all public access via any ACLs" value={flag(pab?.ignorePublicAcls)} />
        <Row
          label="Block public access via new bucket policies"
          value={flag(pab?.blockPublicPolicy)}
        />
        <Row
          label="Block public and cross-account access via any policies"
          value={flag(pab?.restrictPublicBuckets)}
        />
      </Section>
      <Section title="Bucket Ownership">
        <Row label="Object Ownership" value={val(meta.ownershipControls)} />
      </Section>
      <Section title="Access Control List (ACL)">
        {meta.aclGrants?.length ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-1.5 font-medium w-1/2">Grantee</th>
                <th className="text-left py-1.5 font-medium">Permission</th>
              </tr>
            </thead>
            <tbody>
              {meta.aclGrants.map((g, i) => (
                <tr key={i} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5 pr-4 break-all text-muted-foreground">{g.grantee}</td>
                  <td className="py-1.5 font-mono">{g.permission}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Row label="Grants" value="No grants" />
        )}
      </Section>
      <Section title="Cross-origin resource sharing (CORS)">
        <Row label="CORS" value={val(meta.cors, '0 rules')} />
      </Section>
      <Section title="Bucket Policy">
        {meta.policy ? (
          <pre className="py-3 text-xs font-mono overflow-auto max-h-64 whitespace-pre-wrap break-all">
            {(() => {
              try {
                return JSON.stringify(JSON.parse(meta.policy!), null, 2)
              } catch {
                return meta.policy
              }
            })()}
          </pre>
        ) : (
          <Row label="Policy" value="No policy" />
        )}
      </Section>
    </div>
  )
}

// ─── Main BucketBrowser ──────────────────────────────────────────────────────
export function BucketBrowser({ name }: { name: string }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'objects' | 'properties' | 'permissions'>('objects')

  // Objects tab state — prefix synced to URL ?prefix= for refresh/back support
  const [searchParams, setSearchParams] = useSearchParams()
  const folderPrefix = searchParams.get('prefix') ?? ''
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Drawer
  const [drawer, setDrawer] = useState<string | null>(null)

  // ponytail: debounce search → separate state; key change cancels in-flight via Query's auto-abort.
  function handleSearchChange(val: string) {
    setSearch(val)
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(val), 300)
  }

  // Infinite list — one query per (bucket, prefix, search) combo; cursor-based pagination.
  const listQ = useInfiniteQuery({
    queryKey: qk.bucketList(name, folderPrefix, debouncedSearch),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.listObjects(name, {
        prefix: folderPrefix,
        token: pageParam,
        search: debouncedSearch || undefined,
      }),
    getNextPageParam: (last) => last.nextToken,
  })
  const folders = listQ.data?.pages.flatMap((p) => p.folders) ?? []
  const objects = listQ.data?.pages.flatMap((p) => p.objects) ?? []
  const nextToken = listQ.data?.pages[listQ.data.pages.length - 1]?.nextToken
  const listLoading = listQ.isLoading || listQ.isFetchingNextPage
  const loadMoreLoading = listQ.isFetchingNextPage
  const listError = listQ.error

  function navigateTo(newPrefix: string) {
    const next = new URLSearchParams(searchParams)
    if (newPrefix) next.set('prefix', newPrefix)
    else next.delete('prefix')
    next.delete('token')
    setSearchParams(next, { replace: false })
    setSearch('')
    setDebouncedSearch('')
  }

  function goUp() {
    const parts = folderPrefix.replace(/\/$/, '').split('/')
    parts.pop()
    const up = parts.length > 0 ? parts.join('/') + '/' : ''
    navigateTo(up)
  }

  // Properties tab — lazy via enabled flag; bucket-level meta reused by Permissions tab.
  const metaQ = useQuery({
    queryKey: qk.bucketProperties(name),
    queryFn: () => api.getBucket(name),
    enabled: tab === 'properties' || tab === 'permissions',
  })

  function handleDelete(key: string) {
    api.deleteObject(name, key).then(() => {
      qc.invalidateQueries({ queryKey: qk.bucketList(name, folderPrefix, debouncedSearch) })
      toast.success('Object deleted')
    })
  }

  const breadcrumbParts = folderPrefix ? folderPrefix.replace(/\/$/, '').split('/') : []

  return (
    <div className="flex flex-col h-full">
      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList className="flex h-auto shrink-0 justify-start gap-0 rounded-none border-b border-border bg-transparent px-6 pt-4 text-muted-foreground">
          {(['objects', 'properties', 'permissions'] as const).map((t) => (
            <TabsTrigger
              key={t}
              value={t}
              className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-2 text-sm font-medium capitalize shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === 'properties' && (
        <div className="flex-1 overflow-y-auto">
          <PropertiesTab meta={metaQ.data ?? null} loading={metaQ.isLoading} />
        </div>
      )}

      {tab === 'permissions' && (
        <div className="flex-1 overflow-y-auto">
          <PermissionsTab meta={metaQ.data ?? null} loading={metaQ.isLoading} />
        </div>
      )}

      {tab === 'objects' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-6 py-3 border-b border-border shrink-0">
            {/* Back button */}
            {folderPrefix && (
              <button
                onClick={goUp}
                title="Go up one level"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft size={14} /> Up
              </button>
            )}
            {/* Breadcrumb */}
            <div className="flex items-center gap-1 text-sm flex-1 min-w-0 overflow-hidden">
              <button
                onClick={() => navigateTo('')}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0 truncate max-w-[120px]"
                title={name}
              >
                {name}
              </button>
              {breadcrumbParts.map((part, i) => {
                const prefix = breadcrumbParts.slice(0, i + 1).join('/') + '/'
                return (
                  <span key={prefix} className="flex items-center gap-1 min-w-0">
                    <ChevronRight size={12} className="text-muted-foreground shrink-0" />
                    <button
                      onClick={() => navigateTo(prefix)}
                      className={cn(
                        'transition-colors truncate max-w-[100px]',
                        i === breadcrumbParts.length - 1
                          ? 'text-foreground font-medium'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {part}
                    </button>
                  </span>
                )
              })}
            </div>
            {/* Search */}
            <div className="relative shrink-0">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <input
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search by prefix…"
                className="pl-6 pr-2 py-1 text-xs rounded border border-border bg-background w-40 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {search && (
                <button
                  onClick={() => handleSearchChange('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X size={10} />
                </button>
              )}
            </div>
            {/* Refresh */}
            <button
              onClick={() => listQ.refetch()}
              title="Refresh"
              className="p-1.5 rounded text-muted-foreground hover:bg-muted transition-colors shrink-0"
            >
              <RefreshCw size={14} className={listLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left px-6 py-2 font-medium">Name</th>
                  <th className="text-right px-4 py-2 font-medium w-28">Size</th>
                  <th className="text-left px-4 py-2 font-medium w-48">Last modified</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {listLoading && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground text-sm">
                      Loading…
                    </td>
                  </tr>
                )}
                {!listLoading && listError && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-sm text-destructive">
                      {(listError as Error).message}
                    </td>
                  </tr>
                )}
                {!listLoading && !listError && folders.length === 0 && objects.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground text-sm">
                      No objects found.
                    </td>
                  </tr>
                )}
                {!listLoading && folderPrefix && (
                  <tr
                    onClick={goUp}
                    className="border-b border-border/50 cursor-pointer hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-6 py-2.5">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <ChevronLeft size={14} className="shrink-0" />
                        <span className="font-mono">..</span>
                      </div>
                    </td>
                    <td colSpan={3} />
                  </tr>
                )}
                {!listLoading &&
                  folders.map((f) => {
                    const label = f.replace(folderPrefix, '').replace(/\/$/, '')
                    return (
                      <tr
                        key={f}
                        onClick={() => navigateTo(f)}
                        className="border-b border-border/50 cursor-pointer hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-6 py-2.5 font-medium">
                          <span className="flex items-center gap-2">
                            <Folder size={14} className="text-muted-foreground shrink-0" />
                            {label}/
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">—</td>
                        <td className="px-4 py-2.5 text-muted-foreground">—</td>
                        <td className="px-2 py-2.5" />
                      </tr>
                    )
                  })}
                {!listLoading &&
                  objects.map((o) => {
                    const label = o.key.replace(folderPrefix, '')
                    return (
                      <tr
                        key={o.key}
                        onClick={() => setDrawer(o.key)}
                        className="border-b border-border/50 cursor-pointer hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-6 py-2.5 font-medium">
                          <span className="flex items-center gap-2">
                            <File size={14} className="text-muted-foreground shrink-0" />
                            {label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {formatBytes(o.size)}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {o.modified ? new Date(o.modified).toLocaleString() : '—'}
                        </td>
                        <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <ObjMenu onDelete={() => handleDelete(o.key)} />
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>

            {/* Load more */}
            {nextToken && !loadMoreLoading && (
              <div className="flex justify-center py-4">
                <button
                  onClick={() => listQ.fetchNextPage()}
                  disabled={loadMoreLoading}
                  className="px-4 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors text-muted-foreground"
                >
                  {loadMoreLoading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Drawer */}
      {drawer && (
        <ObjectDrawer
          bucketName={name}
          objKey={drawer}
          onClose={() => setDrawer(null)}
          onDeleted={() => {
            qc.invalidateQueries({ queryKey: qk.bucketList(name, folderPrefix, debouncedSearch) })
            toast.success('Object deleted')
          }}
        />
      )}
    </div>
  )
}
