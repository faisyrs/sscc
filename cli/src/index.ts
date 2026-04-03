import { resolve } from "node:path";
import { loadPack } from "../../engine/src/loader/index.js";
import { SSCCEngine } from "../../engine/src/engine/index.js";
import { runGameLoop } from "./game-loop.js";

function printUsage(): void {
  console.log("Usage: sscc-cli <pack-path> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --seed <N>   Fixed RNG seed (default: random)");
  console.log("  --step       Start in step-by-step mode");
  console.log("  --help       Show this help");
}

function parseArgs(args: string[]): {
  packPath: string;
  seed: number | undefined;
  stepMode: boolean;
} {
  let packPath = "";
  let seed: number | undefined;
  let stepMode = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--seed" && i + 1 < args.length) {
      seed = parseInt(args[++i], 10);
      if (isNaN(seed)) {
        console.error("Error: --seed requires a numeric value");
        process.exit(1);
      }
    } else if (arg === "--step") {
      stepMode = true;
    } else if (arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      packPath = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  if (!packPath) {
    console.error("Error: pack path is required");
    printUsage();
    process.exit(1);
  }

  return { packPath, seed, stepMode };
}

async function main(): Promise<void> {
  const { packPath, seed, stepMode } = parseArgs(process.argv.slice(2));
  const resolvedPath = resolve(packPath);

  console.log(`Loading pack from: ${resolvedPath}`);
  const result = await loadPack(resolvedPath);

  if (!result.ok) {
    console.error("Pack validation failed:");
    for (const err of result.errors) {
      console.error(`  ${err.field}: ${err.message}`);
    }
    process.exit(1);
  }

  const actualSeed = seed ?? Math.floor(Math.random() * 100000);
  console.log(`Seed: ${actualSeed}`);

  const engine = new SSCCEngine(result.pack!, { seed: actualSeed });
  engine.initialize();

  console.log(`Pack loaded: ${result.pack!.manifest.name}`);
  console.log(stepMode ? "Mode: step-by-step" : "Mode: auto-advance");
  console.log("Type 'help' for commands.\n");

  await runGameLoop(engine, { stepMode });
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
