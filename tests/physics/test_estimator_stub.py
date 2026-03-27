"""Tests for estimator abstract base class."""

import pytest

from core.physics.estimator.base import StateEstimator
from core.physics.estimator.consistency import NISMonitor
from core.physics.estimator.ekf import ErrorStateEKF


class TestEstimatorBase:
    def test_cannot_instantiate_abc(self) -> None:
        with pytest.raises(TypeError):
            StateEstimator()  # type: ignore[abstract]


class TestEKFIsEstimator:
    def test_is_subclass(self) -> None:
        assert issubclass(ErrorStateEKF, StateEstimator)


class TestNISMonitorImplementation:
    def test_creation(self) -> None:
        monitor = NISMonitor()
        assert monitor.state == "NOMINAL"

    def test_record_returns_action(self) -> None:
        monitor = NISMonitor()
        action = monitor.record(2.0, 0.0)
        assert action is None  # Single nominal NIS
