import {
  QueryClient,
  useQuery,
  useMutation,
  keepPreviousData,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query'

// ponytail: single source of truth for query keys; centralization = free dedup across views.
export const qk = {
  overview: ['overview'] as const,
  table: (name: string) => ['table', name] as const,
  queue: (name: string) => ['queue', name] as const,
  cache: (name: string, cursor?: string, match?: string) =>
    ['cache', name, cursor ?? null, match ?? null] as const,
  bucketList: (name: string, prefix: string, search: string) =>
    ['bucket', name, 'list', prefix, search] as const,
  bucketProperties: (name: string) => ['bucket', name, 'properties'] as const,
  object: (b: string, k: string) => ['bucket', b, 'object', k] as const,
  objectAcl: (b: string, k: string) => ['bucket', b, 'object-acl', k] as const,
  lambda: (name: string) => ['lambda', name] as const,
  apigw: (id: string) => ['apigw', id] as const,
  secret: (name: string) => ['secret', name] as const,
  bus: (name: string) => ['bus', name] as const,
  rule: (bus: string, rule: string) => ['rule', bus, rule] as const,
  logs: (group: string, filter?: string) => ['logs', group, filter ?? null] as const,
  sqlTables: (db: string) => ['sql', db, 'tables'] as const,
  sqlTable: (db: string, table: string) => ['sql', db, 'table', table] as const,
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: 0 },
    },
  })
}

export function useApiQuery<T>(
  key: readonly unknown[],
  fn: () => Promise<T>,
  opts?: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<T>({ queryKey: key, queryFn: fn, ...opts })
}

export function useApiMutation<T, V>(
  fn: (vars: V) => Promise<T>,
  opts?: Omit<UseMutationOptions<T, unknown, V>, 'mutationFn'>,
) {
  return useMutation<T, unknown, V>({ mutationFn: fn, ...opts })
}

export { keepPreviousData }
