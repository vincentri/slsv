# Graph Report - slsv  (2026-07-19)

## Corpus Check
- 124 files · ~54,793 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 894 nodes · 1324 edges · 71 communities (60 shown, 11 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5ac1e145`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
- compilerOptions
- Caches (ElastiCache)
- lint.ts
- functions.ts
- S3 buckets
- Lambda
- API Gateway
- Queues & Events
- eventsource.ts
- IAM exec role
- Architecture overview
- Reconcile & prune
- Getting started
- schema.ts
- Stages & targets
- slsv
- @slsv/sdk
- @slsv/cli
- schema.sql
- build.ts
- sdk.ts
- package.json

## God Nodes (most connected - your core abstractions)
1. `AppConfig` - 32 edges
2. `AwsProvider` - 26 edges
3. `deploy()` - 22 edges
4. `asTagArray()` - 21 edges
5. `slsv architecture decisions` - 21 edges
6. `buildProgram()` - 16 edges
7. `scripts` - 14 edges
8. `envKey()` - 13 edges
9. `ensureApiGateway()` - 13 edges
10. `initScaffold()` - 12 edges

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

## Communities (71 total, 11 thin omitted)

### Community 0 - "Stack Deployment Core"
Cohesion: 0.06
Nodes (38): AppConfig, loadConfig(), deploy(), DeployOutputs, hasResources(), loadEnv(), ensureFrontendDeps(), startDev() (+30 more)

### Community 1 - "Deploy Outputs & Envs"
Cohesion: 0.07
Nodes (52): FrontendDef, envKey(), deleteHttpApi(), describeInstance(), ENGINE_CFG, ensureDbInstances(), isDbAlive(), runInitSql() (+44 more)

### Community 2 - "Plan Docs & Rationale"
Cohesion: 0.05
Nodes (49): AGENTS rule: schema change must sync slsv.example.yml, @changesets/cli docs placeholder, API authorizer (Lambda REQUEST), API custom domain (Cloudflare-only, aws-only), AWS_ENDPOINT_URL injection for local target, ElastiCache replication group provisioning, CLI flag hardening (.allowExcessArguments + choices), Cloud portability via env vars (DATABASE_<NAME>, QUEUE_<NAME>, ...) (+41 more)

### Community 3 - "AWS SDK Clients"
Cohesion: 0.04
Nodes (47): @aws-sdk/client-acm, @aws-sdk/client-apigatewayv2, @aws-sdk/client-cloudfront, @aws-sdk/client-cloudwatch-logs, @aws-sdk/client-elasticache, @aws-sdk/client-eventbridge, @aws-sdk/client-iam, @aws-sdk/client-lambda (+39 more)

### Community 4 - "CLI Bundler (adm-zip)"
Cohesion: 0.13
Nodes (13): ApiConfig, BucketConfig, CacheConfig, DatabaseConfig, deepMerge(), DynamoDbConfig, DynamoDbDef, FrontendConfig (+5 more)

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
Cohesion: 0.21
Nodes (17): agentsMd(), API_DB_ENV_DEV(), API_DB_ENV_PROD(), API_DB_PKG_JSON(), API_DB_SLSV_YML(), API_DB_TSCONFIG, copyDemoTemplate(), demoTemplateDir() (+9 more)

### Community 9 - "HTTP API Handlers"
Cohesion: 0.15
Nodes (23): ApiHandler, ApiResponse, compose(), decodeBody(), eventPath(), get(), group(), InvalidJsonError (+15 more)

### Community 10 - "Changesets Tooling"
Cohesion: 0.06
Nodes (33): @changesets/cli, description, devDependencies, @changesets/cli, commander, oxfmt, oxlint, tsx (+25 more)

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
Cohesion: 0.22
Nodes (15): allowApiGatewayInvoke(), AuthConfig, buildCors(), CorsConfig, deleteAuthorizer(), ensureApiGateway(), ensureAuthorizer(), ensureHttpApi() (+7 more)

### Community 15 - "Lambda Event Router"
Cohesion: 0.11
Nodes (17): packages/sdk/src/index.ts, typedoc-plugin-markdown, categorizeByGroup, entryFileName, entryPoints, excludeExternals, excludePrivate, githubPages (+9 more)

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
Cohesion: 0.22
Nodes (12): ApiRequest, del(), LambdaEvent, patch(), put(), Route, db(), doc (+4 more)

### Community 47 - "compilerOptions"
Cohesion: 0.14
Nodes (13): packages/cli/src/**/*, packages/sdk/src/**/*, scripts/docs/**/*, compilerOptions, allowImportingTsExtensions, esModuleInterop, module, moduleResolution (+5 more)

### Community 48 - "Caches (ElastiCache)"
Cohesion: 0.17
Nodes (11): BYO / hosted DBs, Caches & Databases, Caches (ElastiCache), Databases (RDS), Liveness/recreate (--target local only), Local (Floci), Node group (default), Reconcile for caches (+3 more)

### Community 49 - "lint.ts"
Cohesion: 0.29
Nodes (9): ConfigError, ACCESSOR_LABEL, exportsSymbol(), isScannable(), lintApp(), sdkImports(), SKIP_DIRS, sourceFiles() (+1 more)

### Community 51 - "functions.ts"
Cohesion: 0.31
Nodes (8): adm-zip, adm-zip, bundleHandler(), CLI_NODE_MODULES, httpWrapper(), deployFunctions(), mapLimit(), withRoleRetry()

### Community 52 - "S3 buckets"
Cohesion: 0.20
Nodes (9): `cors: [...]`, DynamoDB, Frontend hosting bucket, `publicRead: true`, Reconcile field coverage, Reconcile for Dynamo, Reconcile for S3, S3 buckets (+1 more)

### Community 53 - "Lambda"
Cohesion: 0.22
Nodes (9): Bundle + deploy, Declaring a function, Environment, IAM, Lambda, Logs, Pre-flight lint, Provisioned concurrency (+1 more)

### Community 55 - "API Gateway"
Cohesion: 0.22
Nodes (8): API Gateway, Authorizer (`api.auth`), CloudFront single-domain mode (`frontend.cloudfront: true`), CORS, Custom domain (`api.domain`, aws-only), Declaring routes, Frontend → API wiring, SDK quick reference

### Community 56 - "Queues & Events"
Cohesion: 0.25
Nodes (8): DLQ, EventBridge event patterns (`event:`), EventBridge schedules (`cron:`), Per-message delay, Queues & Events, Reconcile, SQS queues, Stage-overlay trigger swap

### Community 57 - "eventsource.ts"
Cohesion: 0.36
Nodes (6): dlqName(), ensureEventSourceMappings(), sleep(), AwsFnOutput, ensureQueues(), QueueOutput

### Community 58 - "IAM exec role"
Cohesion: 0.29
Nodes (6): Custom tags, Floci notes, IAM exec role, Reconcile, Tracing, Why a per-app+stage role, not per-function

### Community 59 - "Architecture overview"
Cohesion: 0.29
Nodes (7): Architecture overview, Cloud portability boundary = env vars, Floci, Monorepo, Phase 1 services, Provider model, What slsv is NOT

### Community 60 - "Reconcile & prune"
Cohesion: 0.29
Nodes (7): Drift contract, Prune details, Reconcile & prune, `slsv destroy` (separate from reconcile), `slsv plan`, `slsv plan` field coverage, What's pruned vs reported

### Community 61 - "Getting started"
Cohesion: 0.29
Nodes (7): Deploy to real AWS, Getting started, Install + dev, Prerequisites, Project layout, Scaffold, Tear down

### Community 63 - "schema.ts"
Cohesion: 0.33
Nodes (4): AppConfigSchema, json, required, topKeys

### Community 64 - "Stages & targets"
Cohesion: 0.40
Nodes (5): Env / secret precedence, How names are derived, Per-stage overrides (`stages:` overlay), Stages & targets, Targets

### Community 65 - "slsv"
Cohesion: 0.40
Nodes (5): License, slsv, The yml, What's here, Why slsv

### Community 66 - "@slsv/sdk"
Cohesion: 0.40
Nodes (4): HTTP (`router`, middleware), Install, @slsv/sdk, SQL (`sql`, Drizzle)

### Community 67 - "@slsv/cli"
Cohesion: 0.50
Nodes (3): Install, Quick start, @slsv/cli

## Knowledge Gaps
- **367 isolated node(s):** `$schema`, `changelog`, `commit`, `fixed`, `linked` (+362 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `asTagArray()` connect `Deploy Outputs & Envs` to `Roadmap Plans`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `Key` connect `Roadmap Plans` to `Deploy Outputs & Envs`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Why does `dependencies` connect `AWS SDK Clients` to `functions.ts`, `CLI Package Manifest`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **What connects `$schema`, `changelog`, `commit` to the rest of the system?**
  _367 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Stack Deployment Core` be split into smaller, more focused modules?**
  _Cohesion score 0.060153776571687016 - nodes in this community are weakly interconnected._
- **Should `Deploy Outputs & Envs` be split into smaller, more focused modules?**
  _Cohesion score 0.0733162830349531 - nodes in this community are weakly interconnected._
- **Should `Plan Docs & Rationale` be split into smaller, more focused modules?**
  _Cohesion score 0.05357142857142857 - nodes in this community are weakly interconnected._