# Graph Report - .  (2026-07-18)

## Corpus Check
- Corpus is ~46,803 words - fits in a single context window. You may not need a graph.

## Summary
- 726 nodes · 1141 edges · 46 communities (39 shown, 7 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Stack Deployment Core
- Deploy Outputs & Envs
- Plan Docs & Rationale
- AWS SDK Clients
- CLI Bundler (adm-zip)
- CLI Package Manifest
- SDK Package Manifest
- Demo Frontend Package
- CLI Command Surface
- HTTP API Handlers
- Changesets Tooling
- Demo Backend Package
- Data Layer SDK Deps
- Link Store (Demo)
- API Gateway Auth & CORS
- Lambda Event Router
- Cloudflare DNS
- CLI tsconfig
- SQS Queue Helper
- S3 Storage Helper
- SDK tsconfig
- Frontend tsconfig
- Demo Backend tsconfig
- Redis Cache Client
- Changeset Config
- Frontend React App
- SQL Adapter (Demo)
- DynamoDb Client Surface
- S3 PNG Smoke Seed
- Secrets Manager
- Prettier Config
- OpenCode Plugin Config
- Track Click Handler
- Graphify Plugin (opencode)
- Vite Type Definitions
- HTTP API Tests
- Roadmap Plans
- Agent Conventions
- Smoke Shell Script

## God Nodes (most connected - your core abstractions)
1. `AppConfig` - 32 edges
2. `AwsProvider` - 26 edges
3. `asTagArray()` - 21 edges
4. `slsv architecture decisions` - 21 edges
5. `deploy()` - 18 edges
6. `envKey()` - 13 edges
7. `ensureApiGateway()` - 13 edges
8. `initScaffold()` - 11 edges
9. `lintApp()` - 11 edges
10. `DbClient` - 11 edges

## Surprising Connections (you probably didn't know these)
- `slsv.yml reference schema` --semantically_similar_to--> `slsv.yml full reference (canonical schema)`  [INFERRED] [semantically similar]
  README.md → packages/cli/templates/slsv.example.yml
- `@smithy/types dedupe override (rationale)` --semantically_similar_to--> `esbuild bundling (no externals, minify, keepNames)`  [INFERRED] [semantically similar]
  pnpm-workspace.yaml → CLAUDE.md
- `slsv framework overview` --references--> `slsv architecture decisions`  [EXTRACTED]
  README.md → CLAUDE.md
- `demo template AGENTS.md (how this slsv app works)` --references--> `SDK router (zero-dep mini HTTP framework)`  [EXTRACTED]
  packages/cli/templates/demo/AGENTS.md → CLAUDE.md
- `demo template slsv.yml` --implements--> `Templates (slsv init minimal/demo)`  [INFERRED]
  packages/cli/templates/demo/slsv.yml → CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **slsv drift + reconcile + destroy (deploy-time data lifecycle)** — claude_reconcile_orphan_prune, claude_drift_model, claude_destroy_discovery, claude_stages_namespace [INFERRED 0.85]
- **Floci local-emulator workarounds (endpoint + registry desyncs)** — claude_floci_local_emulator, claude_local_valkey_endpoint_resolution, claude_databases_locally, claude_aws_endpoint_url [INFERRED 0.85]
- **demo template scaffolds (slsv.yml + pnpm-workspace + frontend HTML)** — cli_templates_demo_slsv_yml, cli_templates_demo_pnpm_workspace, cli_templates_demo_frontend_pnpm_workspace, cli_templates_demo_frontend_index_html, cli_templates_demo_agents, concept_dangerously_allow_all_builds [INFERRED 0.95]

## Communities (46 total, 7 thin omitted)

### Community 0 - "Stack Deployment Core"
Cohesion: 0.06
Nodes (42): AppConfig, dlqName(), FrontendDef, deploy(), deleteHttpApi(), Clients, LOCAL_CFG, makeClients() (+34 more)

### Community 1 - "Deploy Outputs & Envs"
Cohesion: 0.09
Nodes (41): DynamoDbDef, DeployOutputs, hasResources(), envKey(), describeInstance(), ENGINE_CFG, ensureDbInstances(), isDbAlive() (+33 more)

### Community 2 - "Plan Docs & Rationale"
Cohesion: 0.05
Nodes (49): AGENTS rule: schema change must sync slsv.example.yml, @changesets/cli docs placeholder, API authorizer (Lambda REQUEST), API custom domain (Cloudflare-only, aws-only), AWS_ENDPOINT_URL injection for local target, ElastiCache replication group provisioning, CLI flag hardening (.allowExcessArguments + choices), Cloud portability via env vars (DATABASE_<NAME>, QUEUE_<NAME>, ...) (+41 more)

### Community 3 - "AWS SDK Clients"
Cohesion: 0.04
Nodes (47): @aws-sdk/client-acm, @aws-sdk/client-apigatewayv2, @aws-sdk/client-cloudfront, @aws-sdk/client-cloudwatch-logs, @aws-sdk/client-elasticache, @aws-sdk/client-eventbridge, @aws-sdk/client-iam, @aws-sdk/client-lambda (+39 more)

### Community 4 - "CLI Bundler (adm-zip)"
Cohesion: 0.08
Nodes (32): adm-zip, adm-zip, bundleHandler(), CLI_NODE_MODULES, httpWrapper(), ApiConfig, BucketConfig, CacheConfig (+24 more)

### Community 5 - "CLI Package Manifest"
Cohesion: 0.05
Nodes (38): bin, slsv, description, devDependencies, tsup, tsx, @types/adm-zip, @types/node (+30 more)

### Community 6 - "SDK Package Manifest"
Cohesion: 0.06
Nodes (35): description, devDependencies, tsup, @types/node, @types/pg, typescript, vite, vitest (+27 more)

### Community 7 - "Demo Frontend Package"
Cohesion: 0.06
Nodes (30): dependencies, react, react-dom, devDependencies, oxfmt, oxlint, @types/react, @types/react-dom (+22 more)

### Community 8 - "CLI Command Surface"
Cohesion: 0.13
Nodes (23): program, runScaffold(), agentsMd(), API_DB_ENV_DEV(), API_DB_ENV_PROD(), API_DB_PKG_JSON(), API_DB_SLSV_YML(), API_DB_TSCONFIG (+15 more)

### Community 9 - "HTTP API Handlers"
Cohesion: 0.15
Nodes (23): ApiHandler, ApiResponse, compose(), decodeBody(), eventPath(), get(), group(), InvalidJsonError (+15 more)

### Community 10 - "Changesets Tooling"
Cohesion: 0.09
Nodes (21): @changesets/cli, description, devDependencies, @changesets/cli, oxfmt, oxlint, oxfmt, oxlint (+13 more)

### Community 11 - "Demo Backend Package"
Cohesion: 0.09
Nodes (21): dependencies, @slsv/sdk, devDependencies, @types/node, @types/pg, typescript, vite, vitest (+13 more)

### Community 12 - "Data Layer SDK Deps"
Cohesion: 0.10
Nodes (21): @aws-sdk/lib-dynamodb, @aws-sdk/s3-request-presigner, drizzle-orm, ioredis, dependencies, @aws-sdk/client-dynamodb, @aws-sdk/client-s3, @aws-sdk/client-secrets-manager (+13 more)

### Community 13 - "Link Store (Demo)"
Cohesion: 0.16
Nodes (11): Link, shortId(), store, check, healthRoutes, create, linkRoutes, list (+3 more)

### Community 14 - "API Gateway Auth & CORS"
Cohesion: 0.24
Nodes (14): allowApiGatewayInvoke(), AuthConfig, buildCors(), CorsConfig, deleteAuthorizer(), ensureApiGateway(), ensureAuthorizer(), ensureHttpApi() (+6 more)

### Community 15 - "Lambda Event Router"
Cohesion: 0.22
Nodes (12): ApiRequest, del(), LambdaEvent, patch(), put(), Route, db(), doc (+4 more)

### Community 16 - "Cloudflare DNS"
Cohesion: 0.34
Nodes (12): cf(), cfDeleteByName(), cfUpsertCname(), cfZoneIdForDomain(), token(), Api, deleteCertWhenFree(), destroyApiDomain() (+4 more)

### Community 17 - "CLI tsconfig"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck (+4 more)

### Community 18 - "SQS Queue Helper"
Cohesion: 0.17
Nodes (6): queue(), makeQueue(), sqs, { send }, QueueClient, ReceivedMessage

### Community 19 - "S3 Storage Helper"
Cohesion: 0.17
Nodes (5): storage(), makeStorage(), s3, { send, getSignedUrl }, StorageClient

### Community 20 - "SDK tsconfig"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck (+4 more)

### Community 21 - "Frontend tsconfig"
Cohesion: 0.18
Nodes (10): compilerOptions, jsx, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 22 - "Demo Backend tsconfig"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 23 - "Redis Cache Client"
Cohesion: 0.18
Nodes (4): cache(), clients, makeCache(), CacheClient

### Community 24 - "Changeset Config"
Cohesion: 0.20
Nodes (9): access, baseBranch, changelog, commit, fixed, ignore, linked, $schema (+1 more)

### Community 25 - "Frontend React App"
Cohesion: 0.28
Nodes (5): api(), App(), Link, fetchMock, load()

### Community 26 - "SQL Adapter (Demo)"
Cohesion: 0.28
Nodes (5): sql(), cache, makeSql(), SqlClient, resolve()

### Community 28 - "S3 PNG Smoke Seed"
Cohesion: 0.32
Nodes (6): crc32(), makePng(), PNG_BLACK, PNG_GRAY, pngChunk(), s3

### Community 29 - "Secrets Manager"
Cohesion: 0.33
Nodes (5): secret(), cache, getSecret(), sm, { send }

### Community 30 - "Prettier Config"
Cohesion: 0.33
Nodes (5): arrowParens, printWidth, semi, singleQuote, trailingComma

### Community 31 - "OpenCode Plugin Config"
Cohesion: 0.50
Nodes (3): plugin, $schema, .opencode/plugins/graphify.js

### Community 36 - "Roadmap Plans"
Cohesion: 1.00
Nodes (3): Plan: dynamic yml generation by stack type, Plan: make functions optional in zod schema, Plan: stack selection prompt in slsv init

## Knowledge Gaps
- **253 isolated node(s):** `$schema`, `changelog`, `commit`, `fixed`, `linked` (+248 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `asTagArray()` connect `Deploy Outputs & Envs` to `Stack Deployment Core`, `Lambda Event Router`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._
- **Why does `Key` connect `Lambda Event Router` to `Deploy Outputs & Envs`?**
  _High betweenness centrality (0.120) - this node is a cross-community bridge._
- **Why does `dependencies` connect `AWS SDK Clients` to `CLI Bundler (adm-zip)`, `CLI Package Manifest`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **What connects `$schema`, `changelog`, `commit` to the rest of the system?**
  _253 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Stack Deployment Core` be split into smaller, more focused modules?**
  _Cohesion score 0.061971830985915494 - nodes in this community are weakly interconnected._
- **Should `Deploy Outputs & Envs` be split into smaller, more focused modules?**
  _Cohesion score 0.08672699849170437 - nodes in this community are weakly interconnected._
- **Should `Plan Docs & Rationale` be split into smaller, more focused modules?**
  _Cohesion score 0.05357142857142857 - nodes in this community are weakly interconnected._