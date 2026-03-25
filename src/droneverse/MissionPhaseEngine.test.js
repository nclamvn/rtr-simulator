import { describe, it, expect } from 'vitest';
import { MissionPhaseEngine } from './MissionPhaseEngine.js';

describe('MissionPhaseEngine', () => {
  const mockPhases = [
    { name: 'Phase 1', objectives: [{ id: 'obj1', desc: 'Test', check: () => true }], transition: (pt) => pt > 5 },
    { name: 'Phase 2', objectives: [{ id: 'obj2', desc: 'Test 2', check: () => false }], transition: (_, __, ___, os) => os['obj2'] },
    { name: 'Phase 3', objectives: [], transition: (pt) => pt > 3 },
  ];

  it('initializes at phase 0', () => {
    const pe = new MissionPhaseEngine(mockPhases);
    expect(pe.currentPhase).toBe(0);
    expect(pe.completed).toBe(false);
    expect(pe.getCurrentPhase().name).toBe('Phase 1');
  });

  it('checks objectives', () => {
    const pe = new MissionPhaseEngine(mockPhases);
    pe.checkObjectives([], []);
    expect(pe.objectiveStatus['obj1']).toBe(true);
  });

  it('advances phase on transition', () => {
    const pe = new MissionPhaseEngine(mockPhases);
    const result = pe.checkTransition(6, [], []);
    expect(result.type).toBe('PHASE_ADVANCE');
    expect(pe.currentPhase).toBe(1);
  });

  it('completes mission after all phases', () => {
    const phases = [
      { name: 'P1', objectives: [], transition: () => true },
      { name: 'P2', objectives: [], transition: () => true },
    ];
    const pe = new MissionPhaseEngine(phases);
    pe.checkTransition(1, [], []);
    const result = pe.checkTransition(2, [], []);
    expect(result.type).toBe('MISSION_COMPLETE');
    expect(pe.completed).toBe(true);
  });

  it('does not advance when transition not met', () => {
    const pe = new MissionPhaseEngine(mockPhases);
    const result = pe.checkTransition(2, [], []); // needs > 5
    expect(result).toBeNull();
    expect(pe.currentPhase).toBe(0);
  });
});
