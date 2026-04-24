"""Operational mode state machine per document Section 9.

4 modes: Nominal → Degraded Visual → Inertial Only → Aborted.
Terminal Homing overrides when close to target.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class OperationalMode(Enum):
    NOMINAL = "nominal"
    DEGRADED_VISUAL = "degraded_visual"
    INERTIAL_ONLY = "inertial_only"
    TERMINAL_HOMING = "terminal_homing"
    ABORTED = "aborted"


@dataclass
class ModeConfig:
    visual_timeout_s: float = 10.0
    inertial_timeout_s: float = 30.0
    abort_timeout_s: float = 120.0
    terminal_distance: float = 100.0
    altitude_boost_m: float = 20.0


class ModeManager:
    """Operational mode state machine."""

    def __init__(self, config: ModeConfig | None = None) -> None:
        self.config = config or ModeConfig()
        self.mode = OperationalMode.NOMINAL
        self.last_update_time: float = 0.0
        self.mode_history: list[tuple[float, OperationalMode]] = []
        self._time_in: dict[str, float] = {m.value: 0.0 for m in OperationalMode}
        self._last_t: float = 0.0

    def tick(
        self,
        t: float,
        update_received: bool,
        distance_to_target: float,
    ) -> OperationalMode:
        """Evaluate mode transitions. Called every timestep."""
        cfg = self.config
        dt = t - self._last_t if t > self._last_t else 0.0
        self._last_t = t

        # Track time in current mode
        self._time_in[self.mode.value] = self._time_in.get(self.mode.value, 0.0) + dt

        # Terminal override
        if distance_to_target < cfg.terminal_distance:
            if self.mode != OperationalMode.TERMINAL_HOMING:
                self._transition(t, OperationalMode.TERMINAL_HOMING)
            return self.mode

        # Update received → reset to NOMINAL
        if update_received:
            self.last_update_time = t
            if self.mode not in (OperationalMode.TERMINAL_HOMING, OperationalMode.ABORTED):
                if self.mode != OperationalMode.NOMINAL:
                    self._transition(t, OperationalMode.NOMINAL)
                self.mode = OperationalMode.NOMINAL
            return self.mode

        # Time since last update
        gap = t - self.last_update_time

        if gap > cfg.abort_timeout_s and self.mode != OperationalMode.ABORTED:
            self._transition(t, OperationalMode.ABORTED)
        elif gap > cfg.inertial_timeout_s and self.mode not in (
            OperationalMode.INERTIAL_ONLY, OperationalMode.ABORTED
        ):
            self._transition(t, OperationalMode.INERTIAL_ONLY)
        elif gap > cfg.visual_timeout_s and self.mode == OperationalMode.NOMINAL:
            self._transition(t, OperationalMode.DEGRADED_VISUAL)

        return self.mode

    def _transition(self, t: float, new_mode: OperationalMode) -> None:
        self.mode_history.append((t, new_mode))
        self.mode = new_mode

    def get_guidance_modifier(self) -> dict:
        """Mode-specific guidance adjustments."""
        if self.mode == OperationalMode.DEGRADED_VISUAL:
            return {"altitude_boost": self.config.altitude_boost_m}
        if self.mode == OperationalMode.INERTIAL_ONLY:
            return {"altitude_boost": self.config.altitude_boost_m, "p_inflate": True}
        if self.mode == OperationalMode.TERMINAL_HOMING:
            return {"direct_to_target": True}
        return {}

    def get_report(self) -> dict:
        total = sum(self._time_in.values()) or 1.0
        return {
            "time_in_nominal": self._time_in.get("nominal", 0) / total,
            "time_in_degraded": self._time_in.get("degraded_visual", 0) / total,
            "time_in_inertial": self._time_in.get("inertial_only", 0) / total,
            "time_in_terminal": self._time_in.get("terminal_homing", 0) / total,
            "transitions": len(self.mode_history),
            "aborted": self.mode == OperationalMode.ABORTED,
        }

    def reset(self) -> None:
        self.mode = OperationalMode.NOMINAL
        self.last_update_time = 0.0
        self.mode_history.clear()
        self._time_in = {m.value: 0.0 for m in OperationalMode}
        self._last_t = 0.0
