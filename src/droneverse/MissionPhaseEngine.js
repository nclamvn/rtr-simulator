export class MissionPhaseEngine {
  constructor(phases) {
    this.phases = phases;
    this.currentPhase = 0;
    this.phaseStartTime = 0;
    this.completed = false;
    this.objectiveStatus = {};
  }
  getCurrentPhase() { return this.phases[this.currentPhase] || null; }
  checkObjectives(drones, threats) {
    const phase = this.getCurrentPhase();
    if (!phase || this.completed) return;
    for (const obj of (phase.objectives || [])) {
      if (!this.objectiveStatus[obj.id]) {
        this.objectiveStatus[obj.id] = obj.check(drones, threats);
      }
    }
  }
  checkTransition(elapsed, drones, threats) {
    if (this.completed) return null;
    const phase = this.getCurrentPhase();
    if (!phase) return null;
    const met = phase.transition(elapsed - this.phaseStartTime, drones, threats, this.objectiveStatus);
    if (met) {
      this.currentPhase++;
      this.phaseStartTime = elapsed;
      if (this.currentPhase >= this.phases.length) {
        this.completed = true;
        return { type: "MISSION_COMPLETE" };
      }
      return { type: "PHASE_ADVANCE", phase: this.phases[this.currentPhase] };
    }
    return null;
  }
}
