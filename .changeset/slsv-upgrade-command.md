---
"@slsv/cli": minor
---

New `slsv upgrade` command — resolves the latest published version directly from the npm
registry (bypassing the package manager's cached `latest` dist-tag) and reinstalls the
global CLI through whichever package manager owns the running binary (npm/pnpm/yarn),
pinned to the exact version. `--force` reinstalls even when already current. Linked/local
installs (dev checkouts) print relink guidance instead of attempting an update.
