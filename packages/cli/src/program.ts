import { Command, Option } from "commander";
import path from "path";
import { existsSync } from "fs";
import { loadConfig } from "./config.js";
import { AwsProvider } from "./providers/aws/index.js";
import { renderPlan } from "./providers/aws/plan.js";
import { deploy } from "./deploy.js";
import { startDev } from "./dev.js";
import { initScaffold, initOutroMessage, type Template, type Stack } from "./init.js";

export function validStage(stage: string): string {
  if (!/^[a-z0-9-]+$/.test(stage)) {
    console.error(`Invalid --stage "${stage}": use lowercase letters, digits, and hyphens only.`);
    process.exit(1);
  }
  return stage;
}

function runScaffold(name: string, cwd: string, template: Template, stack: Stack) {
  initScaffold(name, cwd, template, stack);
  console.log(`Created ${name}/`);
  console.log(`Next: ${initOutroMessage(name, stack, template)}`);
}

// ponytail: extracted from cli.ts so docs scripts (scripts/docs/cli.ts) can walk registered
// commands without triggering parseAsync. Adding commands here is identical to before — this
// function just defers construction. cli.ts is now a thin runner.
export function buildProgram(): Command {
  const program = new Command();

  program.name("slsv").description("Simple local-AWS serverless framework").version("0.0.1");

  program
    .command("init [name]")
    .description("Scaffold a new slsv app")
    .option("--demo", "Scaffold the full demo (HTTP + queue + cron + webhook)", false)
    .option("--db", "Scaffold an API-only app wired to an external Postgres (URL in secrets:)", false)
    .option("--yes", "Skip prompts, use current directory name (CI-friendly)", false)
    .action(async (name: string | undefined, opts: { demo: boolean; db: boolean; yes: boolean }) => {
      const template: Template = opts.demo ? "demo" : opts.db ? "api-db" : "minimal";
      const flagStack: Stack = template === "api-db" ? "backend" : "fullstack";
      const cwd = process.cwd();

      if (name) {
        runScaffold(name, cwd, template, flagStack);
        return;
      }

      if (opts.yes || !process.stdout.isTTY) {
        runScaffold(path.basename(cwd), cwd, template, flagStack);
        return;
      }

      const { intro, text, select, isCancel, cancel, spinner, outro } =
        await import("@clack/prompts");

      intro("slsv");

      const result = await text({
        message: "App name",
        placeholder: path.basename(cwd),
        defaultValue: path.basename(cwd),
        validate(value) {
          if (!value) return "Name is required";
          if (!/^[a-z0-9-]+$/.test(value)) return "Lowercase letters, numbers, dashes only";
          if (existsSync(path.join(cwd, value))) return `Directory "${value}" already exists`;
        },
      });

      if (isCancel(result)) {
        cancel("Cancelled.");
        process.exit(0);
      }

      const templateResult = await select({
        message: "Template",
        initialValue: template,
        options: [
          { value: "minimal", label: "Minimal", hint: "1 HTTP fn + in-memory store" },
          { value: "demo", label: "Demo", hint: "HTTP + queue + cron + webhook + stores" },
          { value: "api-db", label: "API + Postgres", hint: "API-only, external Postgres via URL" },
        ],
      });

      if (isCancel(templateResult)) {
        cancel("Cancelled.");
        process.exit(0);
      }

      const chosenTemplate = templateResult as Template;

      let stack: Stack = "backend";
      if (chosenTemplate !== "api-db") {
        const stackResult = await select({
          message: "What are you building?",
          options: [
            { value: "fullstack", label: "Fullstack", hint: "API + frontend (Vite)" },
            { value: "backend", label: "Backend only", hint: "API + database, no frontend" },
            { value: "frontend", label: "Frontend only", hint: "Static site (Vite), no API" },
          ],
        });

        if (isCancel(stackResult)) {
          cancel("Cancelled.");
          process.exit(0);
        }
        stack = stackResult as Stack;
      }

      const appName = result as string;

      const s = spinner();
      s.start("Scaffolding...");
      initScaffold(appName, cwd, chosenTemplate, stack);
      s.stop("Done");

      outro(`Created ./${appName}  →  ${initOutroMessage(appName, stack, chosenTemplate)}`);
    });

  program
    .command("dev")
    .description("Start Floci, deploy, then watch for changes")
    // Local dev runs under stage `local` — keeps it distinct from a real server `dev` stack
    // (`slsv deploy --stage dev`) so the two never share resource names. Override with --stage.
    .option("--stage <name>", "deployment stage (namespaces resources)", "local")
    .action(async (opts: { stage: string }) => {
      const cwd = process.cwd();
      const stage = validStage(opts.stage);
      const cfg = loadConfig(cwd, stage);
      const provider = new AwsProvider("local");

      await provider.startLocalEmulator(cwd, cfg);
      const outputs = await deploy(cfg, provider, cwd, "dev", stage);

      if (outputs.apiUrl) console.log(`\nAPI → ${outputs.apiUrl}`);
      if (outputs.frontendUrl) console.log(`Frontend → ${outputs.frontendUrl}`);

      await startDev(cfg, provider, cwd, stage, outputs.apiUrl);
    });

  program
    .command("plan")
    .description("Preview what a deploy would change (read-only diff of AWS vs slsv.yml)")
    .allowExcessArguments(false)
    .addOption(
      new Option("--target <target>", "local or aws").choices(["local", "aws"]).default("local"),
    )
    .option("--stage <name>", "deployment stage", "dev")
    .action(async (opts: { target: "local" | "aws"; stage: string }) => {
      const cwd = process.cwd();
      const stage = validStage(opts.stage);
      const cfg = loadConfig(cwd, stage);
      const provider = new AwsProvider(opts.target);
      if (opts.target === "local") await provider.startLocalEmulator(cwd, cfg);
      console.log(renderPlan(await provider.plan(cfg, stage)));
    });

  program
    .command("deploy")
    .description("Deploy (default: local, --target aws for real AWS)")
    .allowExcessArguments(false)
    .addOption(
      new Option("--target <target>", "local or aws").choices(["local", "aws"]).default("local"),
    )
    .option("--stage <name>", "deployment stage (namespaces resources)", "dev")
    .option("-y, --yes", "Skip the destructive-change confirmation prompt", false)
    .action(async (opts: { target: "local" | "aws"; stage: string; yes: boolean }) => {
      const cwd = process.cwd();
      const stage = validStage(opts.stage);
      const cfg = loadConfig(cwd, stage);
      const provider = new AwsProvider(opts.target);

      if (opts.target === "local") await provider.startLocalEmulator(cwd, cfg);

      const result = await provider.plan(cfg, stage);
      console.log(renderPlan(result));
      const willDestroy = result.changes.some((c) => c.action === "delete" && c.destructive);
      if (opts.target === "aws" && willDestroy && !opts.yes) {
        if (!process.stdout.isTTY) {
          console.error("\nNon-interactive: pass --yes to confirm the destructive deploy.");
          process.exit(1);
        }
        const { confirm, isCancel } = await import("@clack/prompts");
        const ok = await confirm({ message: "Apply — including the destructive deletes above?" });
        if (isCancel(ok) || !ok) {
          console.log("Cancelled.");
          return;
        }
      }

      const outputs = await deploy(cfg, provider, cwd, "deploy", stage);

      if (outputs.apiUrl) console.log(`\nAPI → ${outputs.apiUrl}`);
      if (outputs.frontendUrl) console.log(`Frontend → ${outputs.frontendUrl}`);
    });

  program
    .command("logs <function>")
    .description("Tail CloudWatch logs for a function")
    .option("-f, --follow", "Follow log output", false)
    .option("--stage <name>", "deployment stage", "dev")
    .option("--target <target>", "local or aws", "local")
    .action(
      async (fnName: string, opts: { follow: boolean; stage: string; target: "local" | "aws" }) => {
        const stage = validStage(opts.stage);
        const cfg = loadConfig(process.cwd(), stage);
        const provider = new AwsProvider(opts.target);
        await provider.tailLogs(`${cfg.app}-${stage}-${fnName}`, opts.follow);
      },
    );

  program
    .command("destroy")
    .description("Delete this app's slsv.yml resources (Lambda/Dynamo/S3/SQS/secrets/caches/db).")
    .allowExcessArguments(false)
    .option("--stage <name>", "deployment stage to destroy", "dev")
    .addOption(
      new Option("--target <target>", "local or aws").choices(["local", "aws"]).default("local"),
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .action(async (opts: { stage: string; target: "local" | "aws"; yes: boolean }) => {
      const cwd = process.cwd();
      const stage = validStage(opts.stage);
      const { config: dotenv } = await import("dotenv");
      dotenv({ path: path.join(cwd, `.env.${stage}`) });
      dotenv({ path: path.join(cwd, ".env") });
      const cfg = loadConfig(cwd, stage);

      if (!opts.yes) {
        if (!process.stdout.isTTY) {
          console.error("Non-interactive: pass --yes to confirm destroy.");
          process.exit(1);
        }
        const { confirm, isCancel } = await import("@clack/prompts");
        const ok = await confirm({
          message: `Destroy ${cfg.app}-${stage}-* on ${opts.target}?`,
        });
        if (isCancel(ok) || !ok) {
          console.log("Cancelled.");
          return;
        }
      }

      const provider = new AwsProvider(opts.target);
      console.log(`Deleting ${cfg.app}-${stage}-* on ${opts.target}...`);
      await provider.destroyResources(cfg, stage);
      console.log("Resources deleted.");
    });

  return program;
}