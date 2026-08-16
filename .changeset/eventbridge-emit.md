---
"@slsv/sdk": patch
"@slsv/cli": patch
---

EventBridge publish support: `emit(detailType, detail, { source? })` in @slsv/sdk puts an event on the default bus (Source defaults to the app name via new SLSV_APP env, injected into every function), throwing on per-entry failure. Exec role gains `events:PutEvents` scoped to the default bus, so producers need no manual IAM. Consumers keep subscribing with `event: { pattern }` — works across separate slsv apps on the shared default bus. Verified end-to-end on Floci.
