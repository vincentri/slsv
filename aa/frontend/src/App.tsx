import { useEffect, useState } from 'react'
import { api } from './api'

type Link = { code: string; url: string; createdAt: string }

export function App() {
  const [url, setUrl] = useState('https://example.com')
  const [links, setLinks] = useState<Link[]>([])

  async function refresh() {
    const res = await api('/api/links')
    const data = await res.json()
    setLinks(data.items ?? [])
  }

  async function shorten() {
    await api('/api/shorten', { method: 'POST', body: JSON.stringify({ url }) })
    await refresh()
  }

  useEffect(() => { void refresh() }, [])

  return <main>
    <h1>slsv demo</h1>
    <p>Short links backed by Lambda, DynamoDB, SQS, Postgres, Redis, and S3.</p>
    <label>
      URL
      <input value={url} onChange={e => setUrl(e.target.value)} />
    </label>
    <button onClick={shorten}>Shorten</button>
    <ul>
      {links.map(link => <li key={link.code}><a href={`/r/${link.code}`}>{link.code}</a> &rarr; {link.url}</li>)}
    </ul>
  </main>
}
