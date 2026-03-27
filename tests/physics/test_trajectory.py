"""Tests for TrajectorySimulator orchestrator (basic structure)."""

from unittest.mock import MagicMock

from core.physics.config import SimConfig
from core.physics.sim.trajectory import TrajectorySimulator


class TestTrajectorySimulator:
    def test_constructor_accepts_all_dependencies(self) -> None:
        sim = TrajectorySimulator(
            dynamics=MagicMock(),
            imu_sensor=MagicMock(),
            camera_sensor=MagicMock(),
            estimator=MagicMock(),
            associator=MagicMock(),
            terrain=MagicMock(),
            wind=MagicMock(),
            landmarks=MagicMock(),
            config=SimConfig(),
        )
        assert sim.dynamics is not None
        assert sim.imu_sensor is not None
        assert sim.camera_sensor is not None
        assert sim.estimator is not None
        assert sim.associator is not None
        assert sim.terrain is not None
        assert sim.wind is not None
        assert sim.landmarks is not None
        assert isinstance(sim.config, SimConfig)

    def test_config_accessible(self) -> None:
        cfg = SimConfig(imu_rate_hz=200.0)
        sim = TrajectorySimulator(
            dynamics=MagicMock(), imu_sensor=MagicMock(),
            camera_sensor=MagicMock(), estimator=MagicMock(),
            associator=MagicMock(), terrain=MagicMock(),
            wind=MagicMock(), landmarks=MagicMock(),
            config=cfg,
        )
        assert sim.config.imu_rate_hz == 200.0
