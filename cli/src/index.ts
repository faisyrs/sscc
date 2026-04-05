#!/usr/bin/env node
import * as readline from 'readline';
import { loadPack, SSCCEngine } from '@sscc/engine';
import type { PlayerChoiceFn, MatchedRule, State, RuleLoopChoice } from '@sscc/engine';
import { renderEventBanner, renderChoices, renderState, renderLog } from './renderer.js';

const args = process.argv.slice(2);

// Extract --seed flag
let seed: number | undefined;
const seedIdx = args.indexOf('--seed');
if (seedIdx !== -1 && seedIdx + 1 < args.length) {
  seed = parseInt(args[seedIdx + 1], 10);
  args.splice(seedIdx, 2);
}

if (args.length < 3) {
  console.error('Usage: sscc <core.rules> <army1.army> <army2.army> [--seed N]');
  process.exit(1);
}

const [coreRules, ...armyFiles] = args;

async function main() {
  console.log('Loading pack...');
  const pack = await loadPack(coreRules, armyFiles);
  console.log(`Loaded: ${pack.rules.length} rules, ${pack.sequences.size} sequences`);

  // Create readline interface
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve));

  // Player choice callback
  const playerChoice: PlayerChoiceFn = async (options, canPass, state) => {
    console.log(renderState(state));
    console.log(renderChoices(options, canPass));

    while (true) {
      const input = (await ask('\n> ')).trim().toLowerCase();

      if (input === 'p' && canPass) return { type: 'pass' };
      if (input === 'help') {
        console.log(
          '  Commands: 1-N (select), P (pass), E (edit), U (undo), log, state, quit',
        );
        continue;
      }
      if (input === 'e') {
        const path = await ask('  Path: ');
        const valueStr = await ask('  Value (JSON): ');
        try {
          return {
            type: 'editState',
            editPath: path.trim(),
            editValue: JSON.parse(valueStr.trim()),
          };
        } catch {
          console.log('  Invalid JSON.');
          continue;
        }
      }
      if (input === 'u') {
        console.log('  (Undo not yet connected at this level)');
        continue;
      }
      if (input === 'log') {
        console.log(renderLog(engine.getLog()));
        continue;
      }
      if (input === 'state') {
        console.log(JSON.stringify(engine.getState(), null, 2));
        continue;
      }
      if (input === 'q' || input === 'quit') {
        rl.close();
        process.exit(0);
      }

      const num = parseInt(input, 10);
      if (num >= 1 && num <= options.length) {
        return { type: 'rule', rule: options[num - 1].rule };
      }

      console.log(
        `  Enter 1-${options.length}${canPass ? ', P' : ''}, E, or quit.`,
      );
    }
  };

  const engine = new SSCCEngine(pack, playerChoice, seed);

  console.log('\n  SSCC Engine v0.1.0 — Interactive Mode');
  console.log('  Type "help" at any prompt.\n');

  // Main event loop
  while (true) {
    const result = await engine.advanceToNextEvent();
    if (!result) {
      console.log('\n=== GAME OVER ===');
      break;
    }
    console.log(`\n--- ${result.event} ---`);
  }

  rl.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
