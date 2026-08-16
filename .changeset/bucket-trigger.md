---
"@slsv/cli": patch
"@slsv/sdk": patch
---

New `bucket:` function trigger — S3 event notifications. `bucket: { name, events?: [created|removed], prefix?, suffix? }` or an array of those blocks (multiple buckets/filters fan-in to one function). Wired via AddPermission + PutBucketNotificationConfiguration, merged per declared bucket so add/change/remove converge on redeploy. Lint validates the target bucket is declared; a trigger-target bucket no longer warns as unused. Verified end-to-end on Floci.
