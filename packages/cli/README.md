# @slsv/cli

The `slsv` CLI — a simple local-AWS serverless framework. One `slsv.yml` describes
the whole app; `slsv dev` brings the stack up on [Floci](https://github.com/flociorg/floci)
locally; `slsv deploy --target aws` ships to real AWS — no handler rewrites.

> Published as `@slsv/cli` (npm blocks the bare name `slsv` as too similar to
> existing packages). The command you run is still **`slsv`**.

## Install

```sh
pnpm add -g @slsv/cli    # or: npm i -g @slsv/cli
```

Requires **pnpm** for the apps it scaffolds (`slsv dev`, frontend build assume it).

## Quick start

```sh
slsv init my-app
cd my-app && pnpm install
slsv dev
```

Full docs: [github.com/vincentri/slsv](https://github.com/vincentri/slsv#readme).

MIT
