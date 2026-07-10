import { Command, Option } from "commander";
import path from "path";
import { existsSync } from "fs";
import { loadConfig, ConfigError } from "./config.js";
import { AwsProvider } from "./providers/aws/index.js";
import { deploy } from "./deploy.js";
import { startDev } from "./dev.js";
import { initScaffold, initOutroMessage, type Template, type Stack } from "./init.js";

const program = new Command();

// Stage name becomes part of every AWS resource name — keep it AWS-safe.
function validStage(stage: string): string {
  if (!/^[a-z0-9-]+$/.test(stage)) {
    console.error(`Invalid --stage "${stage}": use lowercase letters, digits, and hyphens only.`);
    process.exit(1);
  }
  return stage;
}

program.name("slsv").description("Simple local-AWS serverless framework").version("0.0.1");

program
  .command("init [name]")
  .description("Scaffold a new slsv app")
  .option("--demo", "Scaffold the full demo (HTTP + queue + cron + webhook)", false)
  .option("--yes", "Skip prompts, use current directory name (CI-friendly)", false)
  .action(async (name: string | undefined, opts: { demo: boolean; yes: boolean }) => {
    const template: Template = opts.demo ? "demo" : "minimal";
    const cwd = process.cwd();

    if (name) {
      runScaffold(name, cwd, template, "fullstack");
      return;
    }

    if (opts.yes || !process.stdout.isTTY) {
      runScaffold(path.basename(cwd), cwd, template, "fullstack");
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

    const stack = stackResult as Stack;
    const appName = result as string;

    const s = spinner();
    s.start("Scaffolding...");
    initScaffold(appName, cwd, template, stack);
    s.stop("Done");

    outro(`Created ./${appName}  →  ${initOutroMessage(appName, stack, template)}`);
  });

function runScaffold(name: string, cwd: string, template: Template, stack: Stack) {
  initScaffold(name, cwd, template, stack);
  console.log(`Created ${name}/`);
  console.log(`Next: ${initOutroMessage(name, stack, template)}`);
}

program
  .command("dev")
  .description("Start Floci, deploy, then watch for changes")
  .option("--stage <name>", "deployment stage (namespaces resources)", "dev")
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
  .command("deploy")
  .description("Deploy (default: local, --target aws for real AWS)")
  .allowExcessArguments(false) // reject stray operands (e.g. `deploy -- target aws`) — see destroy
  .addOption(
    new Option("--target <target>", "local or aws").choices(["local", "aws"]).default("local"),
  )
  .option("--stage <name>", "deployment stage (namespaces resources)", "dev")
  .action(async (opts: { target: "local" | "aws"; stage: string }) => {
    const cwd = process.cwd();
    const stage = validStage(opts.stage);
    const cfg = loadConfig(cwd, stage);
    const provider = new AwsProvider(opts.target);

    if (opts.target === "local") await provider.startLocalEmulator(cwd, cfg);

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
  // Reject stray operands: `slsv destroy -- target aws` (space after --) made commander treat
  // `target aws` as ignored positionals and silently fell back to --target local, so a real-AWS
  // destroy quietly hit Floci and left the billable stack running. Error loud instead.
  .allowExcessArguments(false)
  .option("--stage <name>", "deployment stage to destroy", "dev")
  // .choices() rejects typos (`--target awss`) that otherwise resolve to aws (makeClients treats
  // any non-local value as aws).
  .addOption(
    new Option("--target <target>", "local or aws").choices(["local", "aws"]).default("local"),
  )
  .option("-y, --yes", "Skip confirmation prompt", false)
  .action(async (opts: { stage: string; target: "local" | "aws"; yes: boolean }) => {
    const cwd = process.cwd();
    const stage = validStage(opts.stage);
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

program.parseAsync(process.argv).catch((e) => {
  // ConfigError: friendly message, no stack (bad slsv.yml, not a slsv bug).
  if (e instanceof ConfigError) {
    console.error(`\n✗ ${e.message}\n`);
    process.exit(1);
  }
  throw e;
});
