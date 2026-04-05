import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadPack } from '../src/loader.js';
import { SSCCEngine } from '../src/engine.js';
import type { PlayerChoiceFn } from '../src/types.js';

const PACKS_DIR = resolve(import.meta.dirname, '../../packs/wh40k-10e');

describe('Wh40k 10e pack integration', () => {
  const coreRulesPath = resolve(PACKS_DIR, 'core.rules');
  const orkArmyPath = resolve(PACKS_DIR, 'games/test-game-orks.army');
  const smArmyPath = resolve(PACKS_DIR, 'games/test-game-sm.army');

  it('loads the pack without errors', async () => {
    const pack = await loadPack(coreRulesPath, [orkArmyPath, smArmyPath]);

    // Verify sequences loaded
    expect(pack.sequences.has('game')).toBe(true);
    expect(pack.sequences.has('battleRound')).toBe(true);
    expect(pack.sequences.has('attackerTurn')).toBe(true);
    expect(pack.sequences.has('defenderTurn')).toBe(true);
    expect(pack.sequences.has('playerTurn')).toBe(true);
    expect(pack.sequences.has('commandPhase')).toBe(true);
    expect(pack.sequences.has('movementPhase')).toBe(true);
    expect(pack.sequences.has('shootingPhase')).toBe(true);
    expect(pack.sequences.has('chargePhase')).toBe(true);
    expect(pack.sequences.has('fightPhase')).toBe(true);
    expect(pack.sequences.has('battleshockTest')).toBe(true);

    // Verify rules loaded
    expect(pack.rules.length).toBeGreaterThan(0);
    const ruleIds = pack.rules.map(r => r.id);
    expect(ruleIds).toContain('CORE.AttackerTurn.SetPlayer');
    expect(ruleIds).toContain('CORE.DefenderTurn.SetPlayer');
    expect(ruleIds).toContain('CORE.Command.ClearBattleshock');
    expect(ruleIds).toContain('CORE.Command.GainCP');
    expect(ruleIds).toContain('CORE.Command.BattleshockEligible');
    expect(ruleIds).toContain('CORE.Battleshock.Roll');
    expect(ruleIds).toContain('CORE.Battleshock.Compare');
    expect(ruleIds).toContain('CORE.Movement.SelectUnit');
    expect(ruleIds).toContain('CORE.Shooting.SelectAttacker');
    expect(ruleIds).toContain('CORE.Charge.SelectCharger');
    expect(ruleIds).toContain('CORE.Fight.SelectFighter');
    expect(ruleIds).toContain('STRAT.InsaneBravery');
    expect(ruleIds).toContain('STRAT.CommandReroll');

    // Verify objects loaded
    expect(pack.objects.get('unit')).toBe('$.players.*.units');
    expect(pack.objects.get('player')).toBe('$.players');

    // Verify templates loaded
    expect(pack.templates.has('boyz')).toBe(true);
    expect(pack.templates.has('warboss')).toBe(true);
    expect(pack.templates.has('intercessors')).toBe(true);
    expect(pack.templates.has('captain')).toBe(true);

    // Verify initial state has units expanded
    const state = pack.initialState as Record<string, any>;
    expect(state['players']).toBeDefined();
    expect(state['players']['player1']).toBeDefined();
    expect(state['players']['player1']['units']).toBeDefined();
    expect(state['players']['player1']['units']['boyz_1']).toBeDefined();
    expect(state['players']['player1']['units']['boyz_1']['name']).toBe('Boyz');
    expect(state['players']['player1']['units']['boyz_1']['BaseLeadership']).toBe(7);
    expect(state['players']['player1']['units']['warboss_1']).toBeDefined();
    expect(state['players']['player1']['units']['warboss_1']['name']).toBe('Warboss');

    expect(state['players']['player2']).toBeDefined();
    expect(state['players']['player2']['units']['intercessors_1']).toBeDefined();
    expect(state['players']['player2']['units']['intercessors_1']['name']).toBe('Intercessor Squad');
    expect(state['players']['player2']['units']['captain_1']).toBeDefined();

    // Verify attacker/defender set
    expect(state['attacker']).toBe('player1');
    expect(state['defender']).toBe('player2');
  });

  it('can create an engine and advance through startOfGame', async () => {
    const pack = await loadPack(coreRulesPath, [orkArmyPath, smArmyPath]);

    // Auto-pass all choices
    const autoPass: PlayerChoiceFn = async (options, canPass) => {
      // If there are mandatory rules, pick the first one
      const mandatory = options.filter(o => o.mandatory);
      if (mandatory.length > 0) {
        return { type: 'rule', rule: mandatory[0].rule };
      }
      return { type: 'pass' };
    };

    const engine = new SSCCEngine(pack, autoPass, 42);

    // First event should be startOfGame
    const ev1 = await engine.advanceToNextEvent();
    expect(ev1).not.toBeNull();
    expect(ev1!.event).toBe('startOfGame');
  });

  it('attacker turn sets turnPlayer correctly', async () => {
    const pack = await loadPack(coreRulesPath, [orkArmyPath, smArmyPath]);

    const autoPass: PlayerChoiceFn = async (options, canPass) => {
      const mandatory = options.filter(o => o.mandatory);
      if (mandatory.length > 0) {
        return { type: 'rule', rule: mandatory[0].rule };
      }
      return { type: 'pass' };
    };

    const engine = new SSCCEngine(pack, autoPass, 42);

    // Advance through startOfGame
    await engine.advanceToNextEvent(); // startOfGame

    // Next should be attackerTurn event
    const ev2 = await engine.advanceToNextEvent();
    expect(ev2).not.toBeNull();
    expect(ev2!.event).toBe('attackerTurn');
    // After attacker turn event, turnPlayer should be set to attacker (player1)
    expect(ev2!.state['turnPlayer']).toBe('player1');
    expect(ev2!.state['opponent']).toBe('player2');
  });

  it('rule index contains expected event mappings', async () => {
    const pack = await loadPack(coreRulesPath, [orkArmyPath, smArmyPath]);

    // Rules triggered on attackerTurn
    const attackerRules = pack.ruleIndex.get('attackerTurn');
    expect(attackerRules).toBeDefined();
    expect(attackerRules!.some(r => r.id === 'CORE.AttackerTurn.SetPlayer')).toBe(true);

    // Rules triggered on/is commandPhase
    const commandRules = pack.ruleIndex.get('commandPhase');
    expect(commandRules).toBeDefined();
    expect(commandRules!.some(r => r.id === 'CORE.Command.GainCP')).toBe(true);
    expect(commandRules!.some(r => r.id === 'CORE.Command.ClearBattleshock')).toBe(true);
    expect(commandRules!.some(r => r.id === 'CORE.Command.BattleshockEligible')).toBe(true);
    expect(commandRules!.some(r => r.id === 'STRAT.InsaneBravery')).toBe(true);
  });

  it('optional rules have choice field set', async () => {
    const pack = await loadPack(coreRulesPath, [orkArmyPath, smArmyPath]);

    const insaneBravery = pack.rules.find(r => r.id === 'STRAT.InsaneBravery');
    expect(insaneBravery).toBeDefined();
    expect(insaneBravery!.choice).toBe('$.turnPlayer');
    expect(insaneBravery!.costs).toEqual({ cp: 1 });

    const commandReroll = pack.rules.find(r => r.id === 'STRAT.CommandReroll');
    expect(commandReroll).toBeDefined();
    expect(commandReroll!.choice).toBe('$.turnPlayer');
    expect(commandReroll!.costs).toEqual({ cp: 1 });
  });

  it('derived state definitions loaded', async () => {
    const pack = await loadPack(coreRulesPath, [orkArmyPath, smArmyPath]);

    expect(pack.derived.has('CurrentLeadership')).toBe(true);
    expect(pack.derived.has('CurrentToughness')).toBe(true);
    expect(pack.derived.has('CurrentSave')).toBe(true);
    expect(pack.derived.has('CurrentToHit')).toBe(true);

    const ld = pack.derived.get('CurrentLeadership')!;
    expect(ld.base.path).toBe('$.selectedUnit.BaseLeadership');
    expect(ld.aggregate).toBe('sum');
    expect(ld.clamp).toBeDefined();
  });

  it('selectors loaded', async () => {
    const pack = await loadPack(coreRulesPath, [orkArmyPath, smArmyPath]);

    expect(pack.selectors.has('turnPlayer_all_units')).toBe(true);
    expect(pack.selectors.has('turnPlayer_untested_units')).toBe(true);
    expect(pack.selectors.has('opponent_all_units')).toBe(true);

    const sel = pack.selectors.get('turnPlayer_all_units')!;
    expect(sel.object).toBe('unit');
  });
});
