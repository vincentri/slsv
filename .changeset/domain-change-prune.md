---
'@slsv/cli': patch
---

Changing `api.domain` now cleans up the old subdomain

When you point `api.domain` at a new subdomain, deploy tears down the previous one instead of
orphaning it: after wiring the new domain, `ensureApiDomain` prunes any other custom domain still
mapped to this app's API — the old domain name + mapping, the slsv-minted ACM cert, and both
Cloudflare records (public + validation). Discovery-based (doesn't need the old value from the
yml). BYO wildcard certs are never touched (only an exact-DomainName match is deleted). Prune
failures warn and continue so a stray old domain can't block the deploy.
