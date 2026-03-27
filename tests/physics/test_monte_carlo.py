"""Tests for Monte Carlo simulation harness."""

import numpy as np
import pytest

from core.physics.config import SimConfig
from core.physics.sim.monte_carlo import MonteCarloHarness
from core.physics.terrain.procedural import ProceduralTerrain
from core.physics.types import (
    DroneConfig,
    LandmarkConfig,
    TerrainConfig,
    WindConfig,
)


def _make_harness(
    duration: float = 10.0,
    corridor_length: float = 3000.0,
) -> MonteCarloHarness:
    """Create harness with short corridor for fast tests."""
    terrain = ProceduralTerrain(TerrainConfig(ridge_height=10, base_elevation=10, seed=42))
    drone = DroneConfig(
        mass=2.5, drag_coeffs=np.array([0.3, 0.3, 0.5]),
        max_speed=22.0, max_altitude=500.0, battery_capacity=5000.0,
        camera_intrinsics=np.array([[400, 0, 320], [0, 400, 240], [0, 0, 1.0]]),
        camera_extrinsics=np.eye(4),
        imu_specs={"accel_bias_instability": 0.04, "accel_random_walk": 0.02,
                   "gyro_bias_instability": 5.0, "gyro_random_walk": 0.01},
        name="mc_drone",
    )
    config = SimConfig(sim_duration_max=duration)
    lm_config = LandmarkConfig(
        num_landmarks=15, cluster_size=5, segment_spacing=250,
        max_recognition_range=800.0,
    )
    wind_config = WindConfig(mean_speed=5.0, turbulence_intensity=1.0)
    return MonteCarloHarness(
        config, drone, terrain, lm_config, wind_config,
        np.zeros(3), np.array([corridor_length, 0.0, 0.0]),
    )


class TestMonteCarloBasic:
    def test_runs_complete(self) -> None:
        mc = _make_harness(duration=5.0)
        result = mc.run(num_runs=3)
        assert result.num_runs == 3
        assert len(result.outcomes) == 3
        assert result.success_rate >= 0.0

    def test_deterministic(self) -> None:
        mc1 = _make_harness(duration=5.0)
        r1 = mc1.run(num_runs=2)
        mc2 = _make_harness(duration=5.0)
        r2 = mc2.run(num_runs=2)
        np.testing.assert_allclose(r1.final_errors, r2.final_errors, atol=1e-6)

    def test_different_noise_per_run(self) -> None:
        mc = _make_harness(duration=5.0)
        result = mc.run(num_runs=3)
        # Different IMU biases → different errors
        assert not np.allclose(result.final_errors[0], result.final_errors[1])


class TestMonteCarloStatistics:
    def test_statistics_computed(self) -> None:
        mc = _make_harness(duration=5.0)
        result = mc.run(num_runs=3)
        assert result.cep50 >= 0
        assert result.cep95 >= result.cep50
        assert 0 <= result.success_rate <= 1.0
        assert result.total_compute_time > 0

    def test_failure_breakdown(self) -> None:
        mc = _make_harness(duration=5.0)
        result = mc.run(num_runs=3)
        total = sum(result.failure_breakdown.values())
        assert total == 3

    def test_summary_string(self) -> None:
        mc = _make_harness(duration=5.0)
        result = mc.run(num_runs=2)
        s = result.summary()
        assert "Success rate" in s
        assert "CEP50" in s


class TestMonteCarloCallback:
    def test_callback_called(self) -> None:
        mc = _make_harness(duration=5.0)
        progress: list[int] = []
        mc.run(num_runs=3, callback=lambda i, r: progress.append(i))
        assert len(progress) == 3


class TestMonteCarloMultiDrone:
    def test_multi_drone(self) -> None:
        mc = _make_harness(duration=5.0)
        result = mc.run(num_runs=2, num_drones=2)
        assert result.num_drones == 2
        assert len(result.outcomes) == 4  # 2 runs × 2 drones


class TestSensitivity:
    def test_sensitivity_runs(self) -> None:
        mc = _make_harness(duration=5.0)
        sens = mc.run_sensitivity("wind_speed", [2.0, 10.0], runs_per_value=2)
        assert sens.param_name == "wind_speed"
        assert len(sens.param_values) == 2
        assert sens.success_rates.shape == (2,)
        assert sens.runs_per_value == 2
