"""Proactive lateral drift management during cruise.

Monitors cone margin and triggers gentle bank corrections EARLY,
preventing drift accumulation that would cause cone exit at
terminal layers.

Three tiers:
  COMFORTABLE (margin > 60%): fly straight
  ATTENTIVE   (margin 30-60%): gentle 5 deg bank
  URGENT      (margin < 30%): aggressive 15 deg bank
"""

from __future__ import annotations

from collections import deque
from typing import Optional

import numpy as np

from core.physics.types import DEG2RAD, LateralBudgetConfig, LateralCorrection


class LateralBudgetManager:
    """Proactive lateral drift management."""

    def __init__(self, config: LateralBudgetConfig | None = None) -> None:
        self.config = config or LateralBudgetConfig()
        self.state = "COMFORTABLE"
        self.energy_spent: float = 0.0
        self.corrections_count: int = 0
        self.correction_history: list[dict] = []
        self.margin_history: list[dict] = []
        self._drift_samples: deque = deque(maxlen=self.config.drift_rate_samples)
        self._last_correction_t: float = -999.0

    def evaluate(
        self,
        lateral_drift: float,
        cone_radius: float,
        sigma_lateral: float,
        speed: float,
        battery_remaining: float,
        distance_to_target: float,
        t: float,
    ) -> Optional[LateralCorrection]:
        """Evaluate lateral situation and decide correction."""
        c = self.config

        # Record drift sample for rate estimation
        self._drift_samples.append((t, lateral_drift))

        # Skip if outside active range
        if distance_to_target > c.active_range_max or distance_to_target < c.active_range_min:
            self.state = "COMFORTABLE"
            return None

        # Compute margins
        if cone_radius <= 0:
            self.state = "COMFORTABLE"
            return None

        absolute_margin = cone_radius - lateral_drift
        relative_margin = absolute_margin / cone_radius

        # Record margin
        self.margin_history.append({
            "t": t, "drift": lateral_drift, "radius": cone_radius,
            "margin_pct": relative_margin * 100,
        })

        # Compute drift rate
        drift_rate = self._compute_drift_rate()

        # If drift is improving (negative rate), reduce urgency
        if drift_rate < -0.5:
            # Problem solving itself — stay comfortable
            self.state = "COMFORTABLE"
            return None

        # Determine tier
        if relative_margin > c.comfortable_margin:
            self.state = "COMFORTABLE"
            return None
        elif relative_margin > c.attentive_margin:
            self.state = "ATTENTIVE"
            bank_deg = c.gentle_bank_deg
            duration = c.gentle_duration
            priority = "low"
        else:
            self.state = "URGENT"
            bank_deg = c.aggressive_bank_deg
            duration = c.aggressive_duration
            priority = "high"

        # Check cooldown
        if t - self._last_correction_t < c.min_correction_interval:
            return None

        # Check battery reserve
        if battery_remaining < c.min_battery_reserve:
            return None

        # Estimate energy cost
        bank_rad = bank_deg * DEG2RAD
        cost = self.estimate_energy(bank_rad, duration, speed)

        # Check energy budget
        if self.energy_spent + cost > c.max_energy_budget:
            # Try downgrading to gentle
            if priority == "high":
                bank_deg = c.gentle_bank_deg
                bank_rad = bank_deg * DEG2RAD
                duration = c.gentle_duration
                cost = self.estimate_energy(bank_rad, duration, speed)
                priority = "low"
                if self.energy_spent + cost > c.max_energy_budget:
                    return None
            else:
                return None

        # Determine correction direction (toward centerline)
        direction = self.compute_correction_direction(lateral_drift, 0.0)

        self._last_correction_t = t

        return LateralCorrection(
            bank_angle=bank_rad,
            duration=duration,
            priority=priority,
            direction=direction,
            estimated_cost_mah=cost,
            trigger_margin=relative_margin,
            trigger_drift=lateral_drift,
        )

    def _compute_drift_rate(self) -> float:
        """Sliding window drift rate (m/s)."""
        if len(self._drift_samples) < 5:
            return 0.0
        samples = list(self._drift_samples)
        t0, d0 = samples[0]
        t1, d1 = samples[-1]
        dt = t1 - t0
        if dt < 0.1:
            return 0.0
        return (d1 - d0) / dt

    def estimate_energy(
        self, bank_angle: float, duration: float, speed: float
    ) -> float:
        """Estimate battery cost of a banked correction (mAh)."""
        c = self.config
        excess_force = c.drone_mass * 9.81 * (1.0 / np.cos(bank_angle) - 1.0)
        excess_power = excess_force * speed  # Watts
        energy_wh = excess_power * duration / 3600
        energy_mah = energy_wh / c.battery_voltage * 1000
        return energy_mah

    @staticmethod
    def compute_correction_direction(
        drone_pos_lateral: float, cone_center_lateral: float
    ) -> float:
        """Direction to bank: toward cone centerline."""
        offset = drone_pos_lateral - cone_center_lateral
        if abs(offset) < 0.01:
            return 1.0
        return -float(np.sign(offset))

    def get_report(self) -> dict:
        """Lateral management diagnostics."""
        c = self.config
        total_time = (
            self.margin_history[-1]["t"] - self.margin_history[0]["t"]
            if len(self.margin_history) > 1
            else 0
        )
        return {
            "total_corrections": self.corrections_count,
            "energy_spent_mah": round(self.energy_spent, 2),
            "energy_budget_used_pct": round(
                self.energy_spent / c.max_energy_budget * 100
                if c.max_energy_budget > 0
                else 0, 1
            ),
            "max_drift_during_cruise": round(
                max((m["drift"] for m in self.margin_history), default=0), 1
            ),
            "corrections": self.correction_history[-10:],  # Last 10
        }

    def reset(self) -> None:
        """Reset for new Monte Carlo run."""
        self.state = "COMFORTABLE"
        self.energy_spent = 0.0
        self.corrections_count = 0
        self.correction_history.clear()
        self.margin_history.clear()
        self._drift_samples.clear()
        self._last_correction_t = -999.0
