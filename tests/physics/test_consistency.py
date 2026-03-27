"""Tests for NIS/NEES consistency monitor."""

import numpy as np
import pytest

from core.physics.estimator.consistency import NISMonitor
from core.physics.types import ConsistencyConfig


class TestNominal:
    def test_no_action(self) -> None:
        mon = NISMonitor(ConsistencyConfig())
        for i in range(30):
            action = mon.record(2.0, i * 0.1)
        assert action is None
        assert mon.state == "NOMINAL"

    def test_initial_state(self) -> None:
        mon = NISMonitor()
        assert mon.state == "NOMINAL"
        assert mon.inflation_count == 0


class TestCautious:
    def test_high_nis_triggers_cautious(self) -> None:
        mon = NISMonitor(ConsistencyConfig(window_size=10))
        action = None
        for i in range(15):
            action = mon.record(6.0, i * 0.1)
        assert mon.state == "CAUTIOUS"
        assert action == "inflate"

    def test_inflation_increases_P(self) -> None:
        mon = NISMonitor(ConsistencyConfig())
        P = np.eye(17) * 10
        P_inflated = mon.apply_inflation(P)
        assert np.trace(P_inflated) > np.trace(P)
        # Bias blocks unchanged
        np.testing.assert_allclose(P_inflated[9:15, 9:15], P[9:15, 9:15])


class TestDegraded:
    def test_very_high_nis_triggers_degraded(self) -> None:
        mon = NISMonitor(ConsistencyConfig(window_size=10))
        for i in range(15):
            mon.record(12.0, i * 0.1)
        assert mon.state == "DEGRADED"

    def test_reset_enlarges_position_block(self) -> None:
        mon = NISMonitor(ConsistencyConfig())
        P = np.eye(17) * 0.1
        P_reset = mon.apply_reset(P)
        assert P_reset[0, 0] == 100.0
        assert P_reset[3, 3] == 25.0
        assert P_reset[9, 9] == pytest.approx(0.1)  # Bias unchanged


class TestSpike:
    def test_spike_returns_reject(self) -> None:
        mon = NISMonitor(ConsistencyConfig())
        for i in range(10):
            mon.record(2.0, i * 0.1)
        action = mon.record(25.0, 1.0)
        assert action == "reject"
        assert mon.state == "NOMINAL"  # Single spike doesn't change state


class TestRecovery:
    def test_returns_to_nominal(self) -> None:
        mon = NISMonitor(ConsistencyConfig(window_size=10))
        for i in range(15):
            mon.record(6.0, i * 0.1)
        assert mon.state == "CAUTIOUS"
        for i in range(20):
            mon.record(1.5, (15 + i) * 0.1)
        assert mon.state == "NOMINAL"


class TestHealthReport:
    def test_report_fields(self) -> None:
        mon = NISMonitor(ConsistencyConfig())
        for i in range(50):
            mon.record(2.0 + 0.5 * np.sin(i), i * 0.1)
        report = mon.get_health_report()
        assert "mean_nis" in report
        assert "is_consistent" in report
        assert report["total_observations"] == 50

    def test_empty_report(self) -> None:
        mon = NISMonitor()
        report = mon.get_health_report()
        assert report["total_observations"] == 0
        assert report["is_consistent"] is True


class TestReset:
    def test_clears_state(self) -> None:
        mon = NISMonitor()
        for i in range(20):
            mon.record(6.0, i * 0.1)
        mon.reset()
        assert mon.state == "NOMINAL"
        assert len(mon.nis_history) == 0
        assert mon.inflation_count == 0
