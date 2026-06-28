import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation, Routes, Route, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  api,
  setAccount,
  isTauri,
  SsoExpiredError,
  type Overview,
  type AccountMeta,
} from '@/lib/api'
import { qk } from '@/lib/query'
import { Onboarding } from '@/views/Onboarding'
import { AccountsManager } from '@/views/AccountsManager'
import { SsoBanner } from '@/components/SsoBanner'
import { AboutModal } from '@/components/AboutModal'
import { UpdateModal } from '@/components/UpdateModal'
import { useUpdater } from '@/lib/updater'
import { OverviewView } from '@/views/Overview'
import { TableExplorer } from '@/views/TableExplorer'
import { QueueInspector } from '@/views/QueueInspector'
import { BucketBrowser } from '@/views/BucketBrowser'
import { LogViewer } from '@/views/LogViewer'
import { CacheExplorer } from '@/views/CacheExplorer'
import { LambdaList, ResourceTable, lambdaColumns, type ResourceColumn } from '@/views/LambdaList'
import { LambdaDetail } from '@/views/LambdaDetail'
import { ApiGatewayDetail } from '@/views/ApiGatewayDetail'
import { SecretDetail } from '@/views/SecretDetail'
import { EventBridgeDetail } from '@/views/EventBridgeDetail'
import { SqlDatabaseExplorer } from '@/views/SqlDatabaseExplorer'
import { SqlTableView } from '@/views/SqlTableView'
import { Badge } from '@/components/ui/badge'
import {
  Database,
  Activity,
  Archive,
  SlidersHorizontal,
  ScrollText,
  Zap,
  Globe,
  Workflow,
  Lock,
  Cloud,
  Moon,
  Sun,
  ChevronDown,
  Check,
  RefreshCw,
  Settings,
  Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const SERVICES = [
  { kind: 'database' as const, label: 'DynamoDB', icon: Database, base: '/database' },
  { kind: 'sql' as const, label: 'RDS / SQL', icon: Database, base: '/sql' },
  { kind: 'queue' as const, label: 'SQS', icon: Activity, base: '/queue' },
  {
    kind: 'bucket' as const,
    label: 'General Purpose Buckets',
    icon: Archive,
    base: '/bucket/general-purpose',
    group: { label: 'Amazon S3', icon: Archive },
    searchable: true,
    pageSize: 25,
  },
  { kind: 'lambda' as const, label: 'Lambda', icon: Zap, base: '/lambda' },
  { kind: 'apigw' as const, label: 'API Gateway', icon: Globe, base: '/apigw' },
  { kind: 'eb' as const, label: 'EventBridge', icon: Workflow, base: '/eb' },
  { kind: 'secrets' as const, label: 'Secrets', icon: Lock, base: '/secret' },
  { kind: 'logs' as const, label: 'CloudWatch', icon: ScrollText, base: '/logs' },
  { kind: 'cache' as const, label: 'ElastiCache', icon: SlidersHorizontal, base: '/cache' },
]

type ServiceKind = (typeof SERVICES)[number]['kind']

const formatBytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`

const COLUMNS: Record<ServiceKind, ResourceColumn<any>[]> = {
  database: [
    { key: 'name', label: 'Table name', mono: true },
    { key: 'count', label: 'Items', align: 'right' },
  ],
  sql: [
    { key: 'name', label: 'Database name', mono: true },
    { key: 'type', label: 'Type' },
    { key: 'tables', label: 'Tables', align: 'right' },
  ],
  queue: [
    { key: 'name', label: 'Queue name', mono: true },
    { key: 'depth', label: 'Depth', align: 'right' },
  ],
  bucket: [
    { key: 'name', label: 'Bucket name', mono: true },
    {
      key: 'created',
      label: 'Creation date',
      format: (r: { created?: string }) =>
        r.created ? new Date(r.created).toLocaleDateString() : '—',
    },
  ],
  lambda: lambdaColumns,
  apigw: [
    { key: 'name', label: 'API name', mono: true },
    { key: 'id', label: 'ID', mono: true },
    { key: 'url', label: 'URL', mono: true },
  ],
  eb: [{ key: 'name', label: 'Bus name', mono: true }],
  secrets: [{ key: 'name', label: 'Secret name', mono: true }],
  logs: [
    { key: 'name', label: 'Log group', mono: true },
    {
      key: 'storedBytes',
      label: 'Stored',
      align: 'right',
      format: (row) => formatBytes(row.storedBytes),
    },
  ],
  cache: [{ key: 'name', label: 'Cache name', mono: true }],
}

function getResources(overview: Overview, kind: ServiceKind): any[] {
  switch (kind) {
    case 'database':
      return overview.databases
    case 'sql':
      return overview.sqlDatabases ?? []
    case 'queue':
      return overview.queues
    case 'bucket':
      return overview.buckets
    case 'lambda':
      return overview.functions
    case 'apigw':
      return overview.apis
    case 'eb':
      return overview.buses ?? []
    case 'secrets':
      return overview.secrets.map((name) => ({ name }))
    case 'logs':
      return overview.logGroups ?? []
    case 'cache':
      return overview.caches
  }
}

function rowResource(kind: ServiceKind, row: any): string {
  return kind === 'apigw' ? `${row.name}::${row.id}` : row.name
}

function resourcePath(kind: ServiceKind, resource: string): string {
  const e = encodeURIComponent
  if (kind === 'lambda') return `/lambda/${e(resource)}`
  if (kind === 'logs') return `/logs/${e(resource)}`
  if (kind === 'secrets') return `/secret/${e(resource)}`
  if (kind === 'eb') return `/eb/${e(resource)}`
  if (kind === 'sql') return `/sql/${e(resource)}`
  if (kind === 'bucket') return `/bucket/general-purpose/${e(resource)}`
  if (kind === 'apigw') {
    const [name, id] = resource.split('::')
    return `/apigw/${e(name)}/${e(id)}`
  }
  return `/${kind}/${e(resource)}`
}

function ServiceListView({
  service,
  resources,
  onSelect,
}: {
  service: (typeof SERVICES)[number]
  resources: any[]
  onSelect: (r: any) => void
}) {
  return (
    <ResourceTable
      title={service.label}
      icon={service.icon}
      rows={resources}
      columns={COLUMNS[service.kind]}
      rowKey={(row) => rowResource(service.kind, row)}
      onSelect={onSelect}
      emptyText="No resources found."
      searchable={(service as any).searchable}
      pageSize={(service as any).pageSize}
    />
  )
}

// Route wrappers that pull URL params and wire back navigation
function TableExplorerRoute() {
  const { name } = useParams<{ name: string }>()
  return <TableExplorer name={decodeURIComponent(name!)} />
}
function QueueInspectorRoute() {
  const { name } = useParams<{ name: string }>()
  return <QueueInspector name={decodeURIComponent(name!)} />
}
function BucketBrowserRoute() {
  const { name } = useParams<{ name: string }>()
  return <BucketBrowser name={decodeURIComponent(name!)} />
}
function CacheExplorerRoute() {
  const { name } = useParams<{ name: string }>()
  return <CacheExplorer name={decodeURIComponent(name!)} />
}
function LogViewerRoute() {
  const { name } = useParams<{ name: string }>()
  return <LogViewer group={decodeURIComponent(name!)} />
}
function LambdaDetailRoute() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  return <LambdaDetail name={decodeURIComponent(name!)} onBack={() => navigate('/lambda')} />
}
function ApigwDetailRoute() {
  const { name, id } = useParams<{ name: string; id: string }>()
  const navigate = useNavigate()
  return (
    <ApiGatewayDetail
      id={decodeURIComponent(id!)}
      name={decodeURIComponent(name!)}
      onBack={() => navigate('/')}
    />
  )
}
function SecretDetailRoute() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  return <SecretDetail name={decodeURIComponent(name!)} onBack={() => navigate('/')} />
}
function EbDetailRoute() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  return <EventBridgeDetail busName={decodeURIComponent(name!)} onBack={() => navigate('/')} />
}
function SqlDatabaseExplorerRoute() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  return (
    <SqlDatabaseExplorer
      db={decodeURIComponent(name!)}
      onSelectTable={(t) =>
        navigate(`/sql/${encodeURIComponent(name!)}/table/${encodeURIComponent(t)}`)
      }
      onBack={() => navigate('/')}
    />
  )
}
function SqlTableViewRoute() {
  const { name, table } = useParams<{ name: string; table: string }>()
  const navigate = useNavigate()
  return (
    <SqlTableView
      db={decodeURIComponent(name!)}
      table={decodeURIComponent(table!)}
      onBack={() => navigate(`/sql/${encodeURIComponent(name!)}`)}
    />
  )
}

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()

  const [accounts, setAccounts] = useState<AccountMeta[]>([])
  const [account, setAcct] = useState<string>(() => localStorage.getItem('slsv-account') ?? '')
  const [accountOpen, setAccountOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [ssoError, setSsoError] = useState<{ profile: string; account: string } | null>(null)
  const [showAccounts, setShowAccounts] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showUpdate, setShowUpdate] = useState(false)
  const { update } = useUpdater()

  useEffect(() => {
    if (update?.mandatory) setShowUpdate(true)
  }, [update])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('slsv-theme') === 'light' ? 'light' : 'dark',
  )

  useEffect(() => {
    api
      .accounts()
      .then((list) => {
        setAccounts(list)
        const saved = localStorage.getItem('slsv-account')
        const initial = list.find((a) => a.name === saved) ? saved! : list[0]?.name
        if (initial) {
          setAccount(initial)
          setAcct(initial)
        }
        setLoaded(true)
      })
      .catch((e) => {
        setError(e.message)
        setLoaded(true)
      })
  }, [])

  // ponytail: useQuery with refetchInterval replaces manual loadOverview useCallback + setInterval.
  const overviewQ = useQuery({
    queryKey: [...qk.overview, account],
    queryFn: () => api.overview(),
    enabled: !!account,
    refetchInterval: 30_000,
  })
  useEffect(() => {
    if (overviewQ.error) {
      const e = overviewQ.error
      if (e instanceof SsoExpiredError) setSsoError({ profile: e.profile, account })
      else setError((e as Error).message)
    } else {
      setError(null)
    }
  }, [overviewQ.error, account])
  const loadOverview = () => overviewQ.refetch()
  const overview = overviewQ.data ?? null

  useEffect(() => {
    if (prevAccount.current) navigate('/')
    prevAccount.current = account
    setAccount(account)
  }, [account])
  useEffect(() => {
    localStorage.setItem('slsv-theme', theme)
  }, [theme])

  const prevAccount = useRef('')
  const switchAccount = (name: string) => {
    localStorage.setItem('slsv-account', name)
    setAccount(name)
    setAcct(name)
    setAccountOpen(false)
  }

  const meta = accounts.find((a) => a.name === account)
  const pathname = location.pathname

  if (loaded && accounts.length === 0 && isTauri) {
    return (
      <Onboarding
        theme={theme}
        onDone={() => {
          api.accounts().then((list) => {
            setAccounts(list)
            const initial = list[0]?.name
            if (initial) {
              setAccount(initial)
              setAcct(initial)
            }
          })
        }}
      />
    )
  }

  return (
    <div
      className={cn(
        theme === 'dark' && 'dark',
        'flex h-screen flex-col bg-background text-foreground overflow-hidden',
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-card px-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 font-semibold text-sm hover:text-accent-foreground transition-colors"
        >
          <Cloud size={16} className="text-accent-foreground" />
          Cloud Console
        </button>

        <div className="h-4 w-px bg-border" />

        {accounts.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setAccountOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-sm font-mono text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground"
            >
              {account}
              <ChevronDown
                size={12}
                className={cn('transition-transform', accountOpen && 'rotate-180')}
              />
            </button>
            {accountOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAccountOpen(false)} />
                <div className="absolute left-0 top-full z-20 mt-1 min-w-[140px] rounded-md border border-border bg-card shadow-md">
                  {accounts.map((a) => (
                    <button
                      key={a.name}
                      onClick={() => switchAccount(a.name)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-mono transition-colors hover:bg-accent/20"
                    >
                      <Check
                        size={12}
                        className={cn(
                          'shrink-0',
                          a.name === account ? 'text-accent-foreground' : 'opacity-0',
                        )}
                      />
                      {a.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {meta && (
          <>
            <Badge variant="muted">{meta.region}</Badge>
            {meta.endpoint && (
              <Badge variant="local" className="font-mono text-xs">
                {meta.endpoint.replace('http://', '')}
              </Badge>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-3">
          {ssoError ? (
            <SsoBanner
              profile={ssoError.profile}
              accountName={ssoError.account}
              onDone={() => {
                setSsoError(null)
                loadOverview()
              }}
            />
          ) : error ? (
            <span className="text-xs text-red-400">{error}</span>
          ) : null}
          <button
            onClick={loadOverview}
            title="Refresh"
            className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/10 hover:text-foreground transition-colors"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
          {isTauri && (
            <button
              onClick={() => setShowAccounts(true)}
              title="Manage accounts"
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/10 hover:text-foreground transition-colors"
            >
              <Settings size={13} />
            </button>
          )}
          {isTauri && (
            <button
              onClick={() => setShowAbout(true)}
              title="About"
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/10 hover:text-foreground transition-colors"
            >
              <Info size={13} />
            </button>
          )}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/10 hover:text-foreground transition-colors"
          >
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          {update && !update.mandatory && (
            <button
              onClick={() => setShowUpdate(true)}
              title="Update available"
              className="flex items-center gap-1.5 rounded border border-accent-foreground/40 bg-accent/20 px-2 py-1 text-xs text-accent-foreground hover:bg-accent/30 transition-colors"
            >
              New version available (v{update.version})
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-52 border-r border-border flex flex-col shrink-0 overflow-auto">
          <nav className="flex-1 py-2">
            <button
              onClick={() => navigate('/')}
              className={cn(
                'flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors',
                pathname === '/'
                  ? 'bg-accent/30 text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/10 hover:text-foreground',
              )}
            >
              Home
            </button>

            <div className="mt-1 border-t border-border/50" />

            {(() => {
              const rendered = new Set<string>()
              return SERVICES.map((svc) => {
                const resources = overview ? getResources(overview, svc.kind) : []
                const isOpen = pathname === svc.base || pathname.startsWith(svc.base + '/')
                const Icon = svc.icon
                const group = (svc as any).group as { label: string; icon: any } | undefined

                if (!group) {
                  return (
                    <button
                      key={svc.kind}
                      onClick={() => navigate(svc.base)}
                      className={cn(
                        'flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors',
                        isOpen
                          ? 'text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Icon size={13} className="shrink-0" />
                      <span className="flex-1 text-left">{svc.label}</span>
                      {resources.length > 0 && (
                        <Badge variant="muted" className="text-xs">
                          {resources.length}
                        </Badge>
                      )}
                    </button>
                  )
                }

                const GroupIcon = group.icon
                const groupActive = pathname.startsWith('/bucket')
                const isExpanded = groupActive || expandedGroups.has(group.label)
                const showParent = !rendered.has(group.label)
                if (showParent) rendered.add(group.label)

                return (
                  <div key={svc.kind}>
                    {showParent && (
                      <button
                        onClick={() =>
                          setExpandedGroups((s) => {
                            const n = new Set(s)
                            n.has(group.label) ? n.delete(group.label) : n.add(group.label)
                            return n
                          })
                        }
                        className={cn(
                          'flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors',
                          groupActive
                            ? 'text-accent-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <GroupIcon size={13} className="shrink-0" />
                        <span className="flex-1 text-left">{group.label}</span>
                        <ChevronDown
                          size={12}
                          className={cn('transition-transform', isExpanded && 'rotate-180')}
                        />
                      </button>
                    )}
                    {isExpanded && (
                      <button
                        onClick={() => navigate(svc.base)}
                        className={cn(
                          'flex w-full items-center gap-2 pl-8 pr-4 py-1.5 text-xs transition-colors',
                          isOpen
                            ? 'text-accent-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <span className="flex-1 text-left">{svc.label}</span>
                        {resources.length > 0 && (
                          <Badge variant="muted" className="text-xs">
                            {resources.length}
                          </Badge>
                        )}
                      </button>
                    )}
                  </div>
                )
              })
            })()}
          </nav>
        </aside>

        <main key={account} className="flex-1 overflow-auto">
          <Routes>
            <Route
              path="/"
              element={
                overview ? (
                  <OverviewView
                    data={overview}
                    meta={meta}
                    onNav={(kind) => {
                      navigate(SERVICES.find((s) => s.kind === kind)?.base ?? '/')
                    }}
                  />
                ) : (
                  !error && <div className="p-6 text-sm text-muted-foreground">Connecting…</div>
                )
              }
            />
            {SERVICES.filter((s) => s.kind !== 'lambda').map((svc) => (
              <Route
                key={svc.kind}
                path={svc.base}
                element={
                  <ServiceListView
                    service={svc}
                    resources={overview ? getResources(overview, svc.kind) : []}
                    onSelect={(r) => navigate(resourcePath(svc.kind, rowResource(svc.kind, r)))}
                  />
                }
              />
            ))}
            <Route path="/database/:name" element={<TableExplorerRoute />} />
            <Route path="/sql/:name" element={<SqlDatabaseExplorerRoute />} />
            <Route path="/sql/:name/table/:table" element={<SqlTableViewRoute />} />
            <Route path="/queue/:name" element={<QueueInspectorRoute />} />
            <Route path="/bucket/general-purpose/:name" element={<BucketBrowserRoute />} />
            <Route path="/cache/:name" element={<CacheExplorerRoute />} />
            <Route path="/logs/:name" element={<LogViewerRoute />} />
            <Route
              path="/lambda"
              element={
                overview ? (
                  <LambdaList
                    functions={overview.functions}
                    onSelect={(name) => navigate(`/lambda/${encodeURIComponent(name)}`)}
                  />
                ) : (
                  <ServiceListView service={SERVICES[4]} resources={[]} onSelect={() => {}} />
                )
              }
            />
            <Route path="/lambda/:name" element={<LambdaDetailRoute />} />
            <Route path="/apigw/:name/:id" element={<ApigwDetailRoute />} />
            <Route path="/secret/:name" element={<SecretDetailRoute />} />
            <Route path="/eb/:name" element={<EbDetailRoute />} />
          </Routes>
        </main>
      </div>
      {showAccounts && (
        <AccountsManager
          onClose={() => setShowAccounts(false)}
          onSaved={() => {
            setShowAccounts(false)
            const poll = (tries = 0) => {
              api
                .accounts()
                .then((list) => {
                  if (list.length > 0 || tries > 20) {
                    setAccounts(list)
                    const saved = localStorage.getItem('slsv-account')
                    const initial = list.find((a) => a.name === saved)?.name ?? list[0]?.name
                    if (initial) {
                      setAccount(initial)
                      setAcct(initial)
                    }
                  } else {
                    setTimeout(() => poll(tries + 1), 300)
                  }
                })
                .catch(() => tries < 20 && setTimeout(() => poll(tries + 1), 300))
            }
            setTimeout(() => poll(), 1200)
          }}
        />
      )}
      {showAbout && (
        <AboutModal
          onClose={() => setShowAbout(false)}
          updateAvailable={update?.version ?? null}
          onCheckUpdate={() => {
            setShowAbout(false)
            setShowUpdate(true)
          }}
        />
      )}
      {showUpdate && update && (
        <UpdateModal
          update={update}
          onClose={update.mandatory ? undefined : () => setShowUpdate(false)}
        />
      )}
    </div>
  )
}
