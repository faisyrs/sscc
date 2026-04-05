import type { LoadedPack, State, PlayerChoiceFn, LogEntry, Snapshot } from './types.js';
import { deepClone, setFlag, unsetFlag, expireFlags } from './state.js';
import { SeededRNG } from './rng.js';
import { Sequencer } from './sequencer.js';
import { runRuleLoop, type RuleLoopContext } from './rule-loop.js';

export class SSCCEngine {
  private state: State;
  private pack: LoadedPack;
  private rng: SeededRNG;
  private sequencer: Sequencer;
  private log: LogEntry[];
  private snapshots: Snapshot[];
  private playerChoice: PlayerChoiceFn;

  constructor(pack: LoadedPack, playerChoice: PlayerChoiceFn, seed?: number) {
    this.pack = pack;
    this.state = deepClone(pack.initialState);
    this.rng = new SeededRNG(seed ?? Date.now());
    this.log = [];
    this.snapshots = [];
    this.playerChoice = playerChoice;

    // Find the entry point sequence (first sequence defined, or "game")
    const entryPoint = pack.sequences.has('game') ? 'game' : pack.sequences.keys().next().value!;
    this.sequencer = new Sequencer(pack.sequences, entryPoint);
  }

  async advanceToNextEvent(): Promise<{ event: string; state: State } | null> {
    const eventName = this.sequencer.nextEvent();
    if (!eventName) return null;

    // Step 1: Expire flags and set event flag
    this.state = expireFlags(this.state, eventName);
    this.state = setFlag(this.state, eventName);

    // Step 2: Run rule loop
    const firedOnRules = new Set<string>();
    const ctx: RuleLoopContext = {
      state: this.state,
      rules: this.pack.rules,
      ruleIndex: this.pack.ruleIndex,
      objects: this.pack.objects,
      selectors: this.pack.selectors,
      derived: this.pack.derived,
      sequences: this.pack.sequences,
      rng: this.rng,
      log: this.log,
      playerChoice: this.playerChoice,
      firedOnRules,
      currentEvent: eventName,
      snapshots: this.snapshots,
    };

    this.state = await runRuleLoop(ctx);

    // Step 3: Unset event flag
    this.state = unsetFlag(this.state, eventName);

    return { event: eventName, state: this.state };
  }

  undo(): State | null {
    const snapshot = this.snapshots.pop();
    if (!snapshot) return null;
    this.state = snapshot.state;
    this.rng.setState(snapshot.rngState);
    return this.state;
  }

  getState(): State { return this.state; }
  getLog(): LogEntry[] { return this.log; }
  getSnapshots(): Snapshot[] { return this.snapshots; }
}
