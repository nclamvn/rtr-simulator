"""Tests for Proactive Lateral Management (TIP-PLM).

Verifies tier logic, correction issuance, energy budgeting,
range limits, cooldown, and drift rate suppression.
"""

from __future__ import annotations

import numpy as np
import pytest

from core.physics.sim.lateral_budget import LateralBudgetManager
from core.physics.types import DEG2RAD, LateralBudgetConfig


class TestTierLogic:
    def test_comfortable_no_correction(self) -> None:
        """High margin -> no correction issued."""
        mgr = LateralBudgetManager(LateralBudgetConfig())
        result = mgr.evaluate(
            lateral_drift=20, cone_radius=200,
            sigma_lateral=10, speed=12, battery_remaining=80,
            distance_to_target=3000, t=100,
        )
        assert result is None
        assert mgr.state == "COMFORTABLE"

    def test_attentive_gentle_correction(self) -> None:
        """Medium margin -> gentle bank correction."""
        mgr = LateralBudgetManager(LateralBudgetConfig())
        # Build drift rate history (increasing drift)
        for i in range(60):
            mgr.evaluate(
                lateral_drift=80 + i * 0.5, cone_radius=200,
                sigma_lateral=15, speed=12, battery_remaining=70,
                distance_to_target=3000, t=100 + i * 0.1,
            )
        # margin = (200 - 110) / 200 = 45% -> ATTENTIVE
        result = mgr.evaluate(
            lateral_drift=110, cone_radius=200,
            sigma_lateral=15, speed=12, battery_remaining=70,
            distance_to_target=3000, t=120,
        )
        assert mgr.state == "ATTENTIVE"
        assert result is not None
        assert abs(np.degrees(result.bank_angle) - 5.0) < 0.1
        assert result.priority == "low"

    def test_urgent_aggressive_correction(self) -> None:
        """Low margin -> aggressive bank correction."""
        mgr = LateralBudgetManager(LateralBudgetConfig())
        for i in range(60):
            mgr.evaluate(
                lateral_drift=120 + i * 1.0, cone_radius=200,
                sigma_lateral=20, speed=12, battery_remaining=60,
                distance_to_target=2500, t=100 + i * 0.1,
            )
        # margin = (200 - 160) / 200 = 20% -> URGENT
        result = mgr.evaluate(
            lateral_drift=160, cone_radius=200,
            sigma_lateral=20, speed=12, battery_remaining=60,
            distance_to_target=2500, t=120,
        )
        assert mgr.state == "URGENT"
        assert result is not None
        assert abs(np.degrees(result.bank_angle) - 15.0) < 0.1
        assert result.priority == "high"


class TestCorrectionDirection:
    def test_east_drift_banks_left(self) -> None:
        """Drone drifted east -> bank left (toward center)."""
        mgr = LateralBudgetManager(LateralBudgetConfig())
        direction = mgr.compute_correction_direction(150, 0)
        assert direction == -1

    def test_west_drift_banks_right(self) -> None:
        """Drone drifted west -> bank right (toward center)."""
        mgr = LateralBudgetManager(LateralBudgetConfig())
        direction = mgr.compute_correction_direction(-150, 0)
        assert direction == 1


class TestEnergyBudget:
    def test_energy_scales_with_bank(self) -> None:
        """Energy cost increases with bank angle."""
        mgr = LateralBudgetManager(LateralBudgetConfig(
            drone_mass=2.5, battery_voltage=11.1,
        ))
        cost_5 = mgr.estimate_energy(5 * DEG2RAD, 3.0, 12.0)
        cost_15 = mgr.estimate_energy(15 * DEG2RAD, 5.0, 12.0)
        cost_30 = mgr.estimate_energy(30 * DEG2RAD, 5.0, 12.0)
        assert cost_5 < cost_15 < cost_30
        assert cost_5 < 5      # 5 deg 3s < 5 mAh
        assert cost_30 < 50    # 30 deg 5s < 50 mAh

    def test_budget_limits_corrections(self) -> None:
        """Corrections stop when energy budget exhausted."""
        mgr = LateralBudgetManager(LateralBudgetConfig(max_energy_budget=1.0))
        mgr.energy_spent = 0.95
        for i in range(10):
            mgr._drift_samples.append((100 + i * 0.1, 150 + i * 0.3))
        result = mgr.evaluate(
            lateral_drift=160, cone_radius=200,
            sigma_lateral=20, speed=12, battery_remaining=60,
            distance_to_target=2500, t=120,
        )
        assert result is None  # Budget exhausted

    def test_low_battery_skips(self) -> None:
        """Below min_battery_reserve -> no corrections."""
        mgr = LateralBudgetManager(LateralBudgetConfig(min_battery_reserve=15))
        for i in range(10):
            mgr._drift_samples.append((100 + i * 0.1, 150 + i * 0.3))
        result = mgr.evaluate(
            lateral_drift=160, cone_radius=200,
            sigma_lateral=20, speed=12,
            battery_remaining=10,  # Below 15%
            distance_to_target=2500, t=120,
        )
        assert result is None


class TestRangeLimits:
    def test_skip_outer_layers(self) -> None:
        """No corrections at d > active_range_max."""
        mgr = LateralBudgetManager(LateralBudgetConfig(active_range_max=5000))
        result = mgr.evaluate(
            lateral_drift=300, cone_radius=1000,
            sigma_lateral=50, speed=12, battery_remaining=80,
            distance_to_target=8000, t=50,
        )
        assert result is None

    def test_skip_terminal(self) -> None:
        """No corrections at d < active_range_min (PN territory)."""
        mgr = LateralBudgetManager(LateralBudgetConfig(active_range_min=500))
        result = mgr.evaluate(
            lateral_drift=100, cone_radius=150,
            sigma_lateral=30, speed=12, battery_remaining=50,
            distance_to_target=300, t=500,
        )
        assert result is None


class TestCooldown:
    def test_cooldown_blocks_rapid_corrections(self) -> None:
        """Min interval between corrections enforced."""
        mgr = LateralBudgetManager(LateralBudgetConfig(min_correction_interval=10))
        # Build drift history
        for i in range(60):
            mgr._drift_samples.append((100 + i * 0.1, 140 + i * 0.3))
        # First correction
        r1 = mgr.evaluate(
            lateral_drift=155, cone_radius=200,
            sigma_lateral=20, speed=12, battery_remaining=70,
            distance_to_target=2500, t=106,
        )
        assert r1 is not None  # First one allowed

        # Try again 2s later (need 10s cooldown)
        r2 = mgr.evaluate(
            lateral_drift=158, cone_radius=200,
            sigma_lateral=20, speed=12, battery_remaining=70,
            distance_to_target=2400, t=108,
        )
        assert r2 is None  # Blocked by cooldown


class TestDriftRate:
    def test_improving_drift_suppresses_correction(self) -> None:
        """Negative drift rate (improving) -> no correction."""
        mgr = LateralBudgetManager(LateralBudgetConfig())
        # Build history with DECREASING drift
        for i in range(60):
            mgr.evaluate(
                lateral_drift=150 - i * 1.0, cone_radius=200,
                sigma_lateral=15, speed=12, battery_remaining=70,
                distance_to_target=3000, t=100 + i * 0.1,
            )
        # Drift=90, margin=55% -> nominally ATTENTIVE
        # But drift rate negative -> COMFORTABLE
        result = mgr.evaluate(
            lateral_drift=90, cone_radius=200,
            sigma_lateral=15, speed=12, battery_remaining=70,
            distance_to_target=3000, t=120,
        )
        assert result is None
        assert mgr.state == "COMFORTABLE"

    def test_drift_rate_computation(self) -> None:
        """Drift rate computed from sliding window."""
        mgr = LateralBudgetManager(LateralBudgetConfig())
        for i in range(20):
            mgr._drift_samples.append((i * 0.5, 50 + i * 2.0))
        rate = mgr._compute_drift_rate()
        # 2.0m per 0.5s = 4.0 m/s
        assert abs(rate - 4.0) < 0.5


class TestReport:
    def test_report_complete(self) -> None:
        """Report contains all diagnostic fields."""
        mgr = LateralBudgetManager(LateralBudgetConfig())
        mgr.corrections_count = 3
        mgr.energy_spent = 15.5
        mgr.margin_history.append({"t": 0, "drift": 50, "radius": 200, "margin_pct": 75})
        report = mgr.get_report()
        assert report["total_corrections"] == 3
        assert report["energy_spent_mah"] == 15.5
        assert "energy_budget_used_pct" in report
        assert "max_drift_during_cruise" in report

    def test_reset(self) -> None:
        """Reset clears all state."""
        mgr = LateralBudgetManager(LateralBudgetConfig())
        mgr.corrections_count = 5
        mgr.energy_spent = 100
        mgr.state = "URGENT"
        mgr.reset()
        assert mgr.corrections_count == 0
        assert mgr.energy_spent == 0
        assert mgr.state == "COMFORTABLE"
