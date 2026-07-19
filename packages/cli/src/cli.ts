import { buildProgram } from "./program.js";
import { ConfigError } from "./config.js";

// ponytail: command registration lives in program.ts so docs scripts can walk the same Command
// tree without triggering parseAsync. cli.ts is just the entrypoint.
buildProgram()
  .parseAsync(process.argv)
  .catch((e) => {
    if (e instanceof ConfigError) {
      console.error(`\n✗ ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  });