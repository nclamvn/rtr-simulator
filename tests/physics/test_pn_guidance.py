"""Tests for Proportional Navigation terminal guidance (TIP-PN).

Verifies PN switch logic, bearing computation, guidance law,
miss prediction, and terminal dive behavior.
"""

from __future__ import annotations

import numpy as np
import pytest

from core.physics.sim.pn_guidance import ProportionalNavGuidance
from core.physics.types import DEG2RAD, NominalState, PNConfig


def _state(n: float, e: float, vn: float = 12.0, ve: float = 0.0,
           alt: float = 100.0) -> NominalState:
    """Helper to create a NominalState at given NED position."""
    return NominalState(
        position=np.array([n, e, -alt]),
        velocity=np.array([vn, ve, 0.0]),
        quaternion=np.array([1.0, 0.0, 0.0, 0.0]),  # heading north
        accel_bias=np.zeros(3),
        gyro_bias=np.zeros(3),
        wind=np.zeros(2),
    )


class TestPNSwitch:
    def test_switch_within_distance(self) -> None:
        """PN activates when distance < switch_distance."""
        pn = ProportionalNavGuidance(PNConfig(switch_distance=500))
        state = _state(14600, 0)
        target = np.array([15000.0, 0.0, -100.0])
        assert pn.should_switch(state, target) is True

    def test_no_switch_far(self) -> None:
        """PN does not activate when far from target."""
        pn = ProportionalNavGuidance(PNConfig(switch_distance=500))
        state = _state(5000, 0)
        target = np.array([15000.0, 0.0, -100.0])
        assert pn.should_switch(state, target) is False

    def test_no_switch_off_boresight(self) -> None:
        """PN does not activate if target outside FOV."""
        pn = ProportionalNavGuidance(
            PNConfig(switch_distance=500, max_off_boresight=45 * DEG2RAD)
        )
        # Drone heading north (quat=[1,0,0,0]), target due east
        state = _state(14600, -400)
        target = np.array([14600.0, 100.0, -100.0])
        # Target ~90 degrees off boresight
        assert pn.should_switch(state, target) is False

    def test_no_switch_stalled(self) -> None:
        """PN does not activate if speed too low."""
        pn = ProportionalNavGuidance(PNConfig(switch_distance=500, min_speed=3.0))
        state = _state(14600, 0, vn=1.0)  # Very slow
        target = np.array([15000.0, 0.0, -100.0])
        assert pn.should_switch(state, target) is False

    def test_once_active_stays_active(self) -> None:
        """PN does not switch back once activated."""
        pn = ProportionalNavGuidance(PNConfig(switch_distance=500))
        state_near = _state(14600, 0)
        target = np.array([15000.0, 0.0, -100.0])
        pn.activate(state_near, target, 100.0)
        # Even at far distance, stays active
        state_far = _state(14000, 200)
        assert pn.should_switch(state_far, target) is True


class TestPNLaw:
    def test_bearing_rate_zero_collision(self) -> None:
        """Constant bearing = collision course -> near-zero heading rate."""
        pn = ProportionalNavGuidance(
            PNConfig(nav_constant=3, bearing_noise_rad=0)
        )
        state = _state(0, 0)
        target = np.array([500.0, 0.0, -100.0])
        pn.activate(state, target, 0.0)

        # After 1s flying straight north toward target at north
        state2 = _state(12, 0)
        _, gyro = pn.compute(state2, target, state2, 1.0)
        assert abs(gyro[2]) < 0.1  # Near zero yaw rate

    def test_corrects_lateral_offset(self) -> None:
        """Drone offset laterally -> PN steers toward target."""
        pn = ProportionalNavGuidance(
            PNConfig(nav_constant=3, bearing_noise_rad=0)
        )
        state = _state(0, 100)  # 100m east of target axis
        target = np.array([500.0, 0.0, -100.0])
        pn.activate(state, target, 0.0)

        state2 = _state(12, 100)  # Moved north, still offset
        _, gyro = pn.compute(state2, target, state2, 1.0)
        # Should command negative yaw (turn west toward target)
        assert gyro[2] < 0

    def test_clamps_turn_rate(self) -> None:
        """Turn rate clamped at max_turn_rate."""
        pn = ProportionalNavGuidance(
            PNConfig(nav_constant=5, max_turn_rate=30 * DEG2RAD,
                     bearing_noise_rad=0)
        )
        state = _state(0, 300)  # Large offset
        target = np.array([200.0, 0.0, -100.0])
        pn.activate(state, target, 0.0)

        state2 = _state(12, 300)
        _, gyro = pn.compute(state2, target, state2, 1.0)
        assert abs(gyro[2]) <= 30 * DEG2RAD + 0.01


class TestPNPredictions:
    def test_miss_prediction(self) -> None:
        """Miss prediction follows sigma * R / N formula."""
        pn = ProportionalNavGuidance(
            PNConfig(nav_constant=3, bearing_noise_rad=0.5 * DEG2RAD)
        )
        state = _state(14500, 0)
        target = np.array([15000.0, 0.0, -100.0])

        miss = pn.get_miss_prediction(state, target)
        expected = 0.5 * DEG2RAD * 500 / 3
        assert abs(miss - expected) < 0.1

    def test_time_to_impact(self) -> None:
        """Time-to-go estimate R / v_closing."""
        pn = ProportionalNavGuidance(PNConfig())
        state = _state(14880, 0)
        target = np.array([15000.0, 0.0, -100.0])
        # R = 120m, speed = 12 m/s, straight ahead
        t_go = pn.get_time_to_impact(state, target)
        assert abs(t_go - 10.0) < 1.0

    def test_time_to_impact_stalled(self) -> None:
        """Stalled drone -> inf time-to-go."""
        pn = ProportionalNavGuidance(PNConfig())
        state = _state(14880, 0, vn=0.0)
        target = np.array([15000.0, 0.0, -100.0])
        assert pn.get_time_to_impact(state, target) == float("inf")


class TestPNTerminal:
    def test_terminal_dive(self) -> None:
        """Within terminal_dive_distance, descent command issued."""
        pn = ProportionalNavGuidance(
            PNConfig(terminal_dive_distance=50, descent_rate=2.0,
                     bearing_noise_rad=0)
        )
        state = _state(14970, 0)
        target = np.array([15000.0, 0.0, -100.0])
        pn.activate(state, target, 0.0)

        state2 = _state(14982, 0)  # 18m from target
        accel, _ = pn.compute(state2, target, state2, 1.0)
        # accel[2] should be positive (downward in NED) for descent
        assert accel[2] >= 0  # At least no climb


class TestPNDeterministic:
    def test_deterministic_no_noise(self) -> None:
        """Same inputs -> same output when noise=0."""
        pn1 = ProportionalNavGuidance(PNConfig(bearing_noise_rad=0))
        pn2 = ProportionalNavGuidance(PNConfig(bearing_noise_rad=0))
        state = _state(14600, 50)
        target = np.array([15000.0, 0.0, -100.0])

        pn1.activate(state, target, 0.0)
        pn2.activate(state, target, 0.0)

        state2 = _state(14612, 50)
        _, g1 = pn1.compute(state2, target, state2, 1.0)
        _, g2 = pn2.compute(state2, target, state2, 1.0)
        np.testing.assert_array_equal(g1, g2)


class TestPNReport:
    def test_report_before_activation(self) -> None:
        """Report works before activation."""
        pn = ProportionalNavGuidance(PNConfig())
        r = pn.get_report()
        assert r["active"] is False
        assert r["switch_time"] is None

    def test_report_after_activation(self) -> None:
        """Report contains correct data after activation."""
        pn = ProportionalNavGuidance(PNConfig(bearing_noise_rad=0))
        state = _state(14600, 0)
        target = np.array([15000.0, 0.0, -100.0])
        pn.activate(state, target, 100.0)

        state2 = _state(14612, 0)
        pn.compute(state2, target, state2, 101.0)

        r = pn.get_report()
        assert r["active"] is True
        assert r["switch_time"] == 100.0
        assert r["bearing_measurements"] == 1
        assert r["switch_distance"] == pytest.approx(400.0, abs=1.0)
