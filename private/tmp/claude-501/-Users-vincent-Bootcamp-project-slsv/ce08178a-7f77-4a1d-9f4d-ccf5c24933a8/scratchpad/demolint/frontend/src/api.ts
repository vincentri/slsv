// API base URL resolution (precedence):
//   1. VITE_API_URL       — you set it (shell / .env), e.g. a custom domain. Always wins.
//   2. VITE_SLSV_API_URL  — slsv injects the deployed API Gateway URL at build time.
//   3. ''                 — relative; local `slsv dev` proxies /api → backend.
const API_BASE = import.meta.env.VITE_API_URL || import.meta.env.VITE_SLSV_API_URL || ''

export const api = (path: string, init?: RequestInit) => fetch(`${API_BASE}${path}`, init)
