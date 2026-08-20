// Cloudflare DNS API — upsert/delete records so ACM validation + the public CNAME are wired
// with zero manual steps. Token from CLOUDFLARE_API_TOKEN (Zone.DNS edit on the zone).
// ponytail: Cloudflare only. Route53/other DNS = a future `dns.provider` branch; today the
// schema pins `provider: cloudflare`. No SDK — plain fetch (native on node 20).
const API = "https://api.cloudflare.com/client/v4";

function token(): string {
  const t = process.env.CLOUDFLARE_API_TOKEN;
  if (!t) throw new Error("CLOUDFLARE_API_TOKEN not set (needed for api.domain DNS automation)");
  return t;
}

async function cf(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? undefined),
    },
  });
  const body: any = await res.json();
  if (!body.success)
    throw new Error(`Cloudflare ${init?.method ?? "GET"} ${path}: ${JSON.stringify(body.errors)}`);
  return body.result;
}

// Find the Cloudflare zone that owns a hostname — the token's zone whose name is a suffix of
// the domain, longest match wins (api.myapp.com → zone myapp.com). Lets the user give just the
// domain; no separate zone field.
export async function cfZoneIdForDomain(domain: string): Promise<string> {
  const zones: { id: string; name: string }[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${API}/zones?per_page=50&page=${page}`, {
      headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    });
    const body: any = await res.json();
    if (!body.success)
      throw new Error(`Cloudflare GET /zones?per_page=50&page=${page}: ${JSON.stringify(body.errors)}`);
    zones.push(...(body.result ?? []));
    const info = body.result_info;
    if (!info || page >= info.total_pages || (body.result?.length ?? 0) < 50) break;
    page++;
  }
  const match = zones
    .filter((z) => domain === z.name || domain.endsWith(`.${z.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!match) throw new Error(`no Cloudflare zone owns ${domain} (does the token have access?)`);
  return match.id;
}

// Create-or-update a CNAME (idempotent by name). ttl:1 = "auto".
export async function cfUpsertCname(
  zoneId: string,
  name: string,
  content: string,
  proxied: boolean,
): Promise<void> {
  const existing = await cf(
    `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`,
  );
  const rec = { type: "CNAME", name, content, ttl: 1, proxied };
  if (existing?.length) {
    await cf(`/zones/${zoneId}/dns_records/${existing[0].id}`, {
      method: "PUT",
      body: JSON.stringify(rec),
    });
  } else {
    await cf(`/zones/${zoneId}/dns_records`, { method: "POST", body: JSON.stringify(rec) });
  }
}

export async function cfDeleteByName(zoneId: string, name: string): Promise<void> {
  const existing = await cf(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`);
  for (const r of existing ?? [])
    await cf(`/zones/${zoneId}/dns_records/${r.id}`, { method: "DELETE" });
}
