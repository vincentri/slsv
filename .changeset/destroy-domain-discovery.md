---
'@slsv/cli': patch
---

`slsv destroy` removes the API custom domain even when dropped from the yml

Domain teardown on destroy is now discovery-based like the rest of destroy: `sweepApiDomains`
enumerates every API-Gateway domain mapped to the app's API and tears each down (name + mapping +
slsv-minted cert + both Cloudflare records), so a domain already removed from `slsv.yml` is still
cleaned up (previously destroy was yml-driven and silently skipped it). A BYO `certArn` on the
domain still in the yml is honored (its cert is left alone). Failures are surfaced and the command
exits non-zero after attempting every domain.
