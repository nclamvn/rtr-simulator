"""Tests for single trajectory integration (TIP-C1).

Full end-to-end: dynamics → sensors → EKF → association → update.
"""

import numpy as np
import pytest

from core.physics.association.pipeline import FiveStepPipeline
from core.physics.config import SimConfig
from core.physics.dynamics.six_dof import SixDOFDynamics
from core.physics.estimator.ekf import ErrorStateEKF
from core.physics.landmark.chain import LandmarkChainGenerator
from core.physics.sensors.camera import CameraModel
from core.physics.sensors.imu import IMUModel
from core.physics.sim.trajectory import TrajectorySimulator
from core.physics.terrain.procedural import ProceduralTerrain
from core.physics.types import (
    CameraSpecs,
    DroneConfig,
    IMUSpecs,
    LandmarkConfig,
    MissionPackage,
    NominalState,
    TerrainConfig,
)
from core.physics.wind.dryden import DrydenWindField


# ── Factory ───────────────────────────────────────────────────


def _make_full_sim(
    duration: float = 30.0,
    corridor_length: float = 5000.0,
) -> tuple[TrajectorySimulator, MissionPackage, DroneConfig]:
    """Wire all components for integration testing."""
    drone = DroneConfig(
        mass=2.5, drag_coeffs=np.array([0.3, 0.3, 0.5]),
        max_speed=22.0, max_altitude=500.0, battery_capacity=5000.0,
        camera_intrinsics=np.array([[400, 0, 320], [0, 400, 240], [0, 0, 1.0]]),
        camera_extrinsics=np.eye(4),
        imu_specs={"accel_bias_instability": 0.04, "accel_random_walk": 0.02,
                   "gyro_bias_instability": 5.0, "gyro_random_walk": 0.01},
        name="test_drone",
    )

    terrain = ProceduralTerrain(TerrainConfig(ridge_height=10, base_elevation=10, seed=42))
    wind = DrydenWindField.light(direction=90, seed=42)

    lm_gen = LandmarkChainGenerator(
        terrain,
        LandmarkConfig(num_landmarks=20, cluster_size=5, segment_spacing=300,
                        max_recognition_range=800.0),
    )
    landmarks_list, clusters = lm_gen.generate(
        np.zeros(3), np.array([corridor_length, 0, 0]), seed=42
    )

    target = np.array([corridor_length, 0.0, -100.0])
    mission = MissionPackage(
        target=target,
        landmarks=landmarks_list,
        clusters=clusters,
        corridor_grid=np.zeros((30, 128)),
        wind_estimate=np.array([5.0, 0.0]),
        camera_cal=np.array([[400, 0, 320], [0, 400, 240], [0, 0, 1.0]]),
        terrain_profile=terrain.get_profile(np.zeros(2), np.array([corridor_length, 0])),
        drop_point=np.zeros(3),
    )

    dyn = SixDOFDynamics(drone)
    imu_sensor = IMUModel(IMUSpecs(), seed=42)
    cam_sensor = CameraModel(CameraSpecs(landmark_size=20.0), seed=42)

    initial_est = NominalState(
        np.array([0.0, 0.0, -200.0]),  # 200m altitude (well above terrain)
        np.array([15.0, 0.0, 0.0]),
        np.array([1, 0, 0, 0.0]),
        np.zeros(3), np.zeros(3),
        np.array([5.0, 0.0]),
    )
    ekf = ErrorStateEKF(dyn, cam_sensor, SimConfig(), initial_est)
    associator = FiveStepPipeline(cam_sensor, SimConfig(), seed=42)

    cfg = SimConfig()
    cfg.sim_duration_max = duration

    sim = TrajectorySimulator(
        dyn, imu_sensor, cam_sensor, ekf,
        associator, terrain, wind, lm_gen, cfg,
    )
    return sim, mission, drone


# ── Tests ─────────────────────────────────────────────────────


class TestTrajectoryBasic:
    def test_runs_without_crash(self) -> None:
        """Simulation completes without exceptions."""
        sim, mission, drone = _make_full_sim(duration=10.0)
        result = sim.run(mission, drone)
        assert result.outcome in ["success", "timeout", "diverged", "lost", "crash"]
        assert len(result.timestamps) > 0
        assert result.position_errors.shape[1] == 3

    def test_records_states(self) -> None:
        sim, mission, drone = _make_full_sim(duration=5.0)
        result = sim.run(mission, drone)
        assert len(result.true_states) == len(result.estimated_states)
        assert len(result.true_states) == len(result.timestamps)

    def test_metadata(self) -> None:
        sim, mission, drone = _make_full_sim(duration=5.0)
        result = sim.run(mission, drone)
        assert "total_time" in result.metadata
        assert "updates" in result.metadata
        assert result.final_error >= 0


class TestTrajectoryBehavior:
    def test_moves_toward_target(self) -> None:
        """Drone should get closer to target over time."""
        sim, mission, drone = _make_full_sim(duration=15.0)
        result = sim.run(mission, drone)
        initial_dist = np.linalg.norm(
            result.true_states[0].position[:2] - mission.target[:2]
        )
        final_dist = np.linalg.norm(
            result.true_states[-1].position[:2] - mission.target[:2]
        )
        assert final_dist < initial_dist

    def test_error_bounded_with_landmarks(self) -> None:
        """With landmarks, position error should stay bounded."""
        sim, mission, drone = _make_full_sim(duration=20.0)
        result = sim.run(mission, drone)
        max_error = np.max(np.linalg.norm(result.position_errors, axis=1))
        assert max_error < 500, f"Max error {max_error:.1f}m > 500m"

    def test_covariance_recorded(self) -> None:
        sim, mission, drone = _make_full_sim(duration=5.0)
        result = sim.run(mission, drone)
        assert len(result.covariances) > 0
        assert result.covariances[0].shape == (17, 17)


class TestTrajectoryDeterministic:
    def test_same_seeds_same_result(self) -> None:
        """Same seeds → same trajectory."""
        sim1, mission, drone = _make_full_sim(duration=5.0)
        r1 = sim1.run(mission, drone)

        sim2, mission2, _ = _make_full_sim(duration=5.0)
        r2 = sim2.run(mission2, drone)

        np.testing.assert_allclose(
            r1.true_states[-1].position,
            r2.true_states[-1].position, atol=1e-6,
        )
        assert r1.outcome == r2.outcome


class TestTrajectoryEdgeCases:
    def test_no_landmarks_drift(self) -> None:
        """Without landmarks, error should grow."""
        sim, mission, drone = _make_full_sim(duration=10.0)
        mission_empty = MissionPackage(
            target=mission.target, landmarks=[], clusters=[],
            corridor_grid=mission.corridor_grid,
            wind_estimate=mission.wind_estimate,
            camera_cal=mission.camera_cal,
            terrain_profile=mission.terrain_profile,
            drop_point=mission.drop_point,
        )
        result = sim.run(mission_empty, drone)
        errors = np.linalg.norm(result.position_errors, axis=1)
        # Error should grow (dead reckoning drift)
        assert errors[-1] > errors[min(100, len(errors) - 1)]

    def test_nis_values_present(self) -> None:
        sim, mission, drone = _make_full_sim(duration=10.0)
        result = sim.run(mission, drone)
        assert len(result.nis_values) > 0
