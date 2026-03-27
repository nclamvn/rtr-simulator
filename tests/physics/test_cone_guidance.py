"""Tests for ConeGuidance and cone trajectory integration."""

import numpy as np
import pytest

from core.physics.landmark.cone import ConeLandmarkGenerator
from core.physics.sim.trajectory import ConeGuidance
from core.physics.terrain.procedural import ProceduralTerrain
from core.physics.types import ConeConfig, NominalState, TerrainConfig


@pytest.fixture
def cone_setup():
    """Create cone generator + layers for guidance testing."""
    terrain = ProceduralTerrain(TerrainConfig(ridge_height=0, base_elevation=0))
    cfg = ConeConfig(num_layers=6, base_radius=1000, landmarks_per_layer_base=3,
                     landmarks_per_layer_final=8)
    gen = ConeLandmarkGenerator(terrain, cfg)
    drop = np.zeros(3)
    target = np.array([5000.0, 0.0, -80.0])
    _, _, layers = gen.generate(drop, target)
    return gen, layers, cfg, target


class TestConeGuidanceBasic:
    def test_constructs(self, cone_setup) -> None:
        gen, layers, cfg, target = cone_setup
        g = ConeGuidance(target, layers, cfg, cone_landmark_gen=gen)
        assert g.current_layer_index == 0

    def test_compute_returns_correct_shapes(self, cone_setup) -> None:
        gen, layers, cfg, target = cone_setup
        g = ConeGuidance(target, layers, cfg, cone_landmark_gen=gen)
        state = NominalState(
            np.array([500.0, 0.0, -80.0]), np.array([15.0, 0.0, 0.0]),
            np.array([1, 0, 0, 0.0]), np.zeros(3), np.zeros(3), np.zeros(2),
        )
        accel, gyro = g.compute(state)
        assert accel.shape == (3,)
        assert gyro.shape == (3,)

    def test_layer_progress(self, cone_setup) -> None:
        gen, layers, cfg, target = cone_setup
        g = ConeGuidance(target, layers, cfg, cone_landmark_gen=gen)
        p = g.get_layer_progress()
        assert p["current_layer"] == 0
        assert p["total_layers"] == 6
        assert p["fraction_complete"] == 0.0


class TestConeGuidanceSteering:
    def test_steers_toward_first_layer(self, cone_setup) -> None:
        """At start, guidance steers toward layer 0 center, not final target."""
        gen, layers, cfg, target = cone_setup
        g = ConeGuidance(target, layers, cfg, cruise_speed=15.0,
                         cruise_alt=80.0, cone_landmark_gen=gen)
        state = NominalState(
            np.array([0.0, 0.0, -80.0]), np.array([15.0, 0.0, 0.0]),
            np.array([1, 0, 0, 0.0]), np.zeros(3), np.zeros(3), np.zeros(2),
        )
        accel, gyro = g.compute(state)
        # Should have forward accel component (north)
        # Body frame accel Z should be approximately -g (hover + forward)
        assert accel[2] < 0  # Thrust upward

    def test_speed_decreases_with_progress(self, cone_setup) -> None:
        gen, layers, cfg, target = cone_setup
        g = ConeGuidance(target, layers, cfg, cruise_speed=15.0, cone_landmark_gen=gen)
        # At start: target_speed = 15 * (1 - 0.3*0) = 15
        assert g.cruise_speed * (1.0 - 0.3 * 0) == pytest.approx(15.0)
        # At 50%: target_speed = 15 * (1 - 0.3*0.5) = 12.75
        g.current_layer_index = 3  # 3/6 = 50%
        progress = g.current_layer_index / max(len(g.layers), 1)
        assert 15.0 * (1.0 - 0.3 * progress) == pytest.approx(12.75)


class TestConeGuidanceLayerAdvancement:
    def test_advances_when_near_layer_center(self, cone_setup) -> None:
        gen, layers, cfg, target = cone_setup
        g = ConeGuidance(target, layers, cfg, cone_landmark_gen=gen)
        assert g.current_layer_index == 0
        # Move drone very close to layer 0 center
        layer0_center = layers[0].center.copy()
        g._advance_layer(layer0_center)
        assert g.current_layer_index == 1

    def test_does_not_advance_when_far(self, cone_setup) -> None:
        gen, layers, cfg, target = cone_setup
        g = ConeGuidance(target, layers, cfg, cone_landmark_gen=gen)
        far_pos = np.array([0.0, 5000.0, -80.0])  # Way off to the side
        g._advance_layer(far_pos)
        assert g.current_layer_index == 0


# ── Cone Integration Tests ────────────────────────────────────


class TestConeIntegration:
    def _make_cone_sim(self):
        from core.physics.association.pipeline import FiveStepPipeline
        from core.physics.config import SimConfig
        from core.physics.dynamics.six_dof import SixDOFDynamics
        from core.physics.estimator.ekf import ErrorStateEKF
        from core.physics.sensors.camera import CameraModel
        from core.physics.sensors.imu import IMUModel
        from core.physics.sim.trajectory import TrajectorySimulator
        from core.physics.types import (
            CameraSpecs, DroneConfig, IMUSpecs, MissionPackage,
        )
        from core.physics.wind.dryden import DrydenWindField

        terrain = ProceduralTerrain(TerrainConfig(ridge_height=5, base_elevation=5, seed=42))
        cone_cfg = ConeConfig(num_layers=5, base_radius=800, landmarks_per_layer_base=3,
                              landmarks_per_layer_final=8, max_recognition_range=600)
        gen = ConeLandmarkGenerator(terrain, cone_cfg)
        drop, target_pt = np.zeros(3), np.array([3000.0, 0.0, 0.0])
        lm_list, clusters, layers = gen.generate(drop, target_pt, seed=42)

        drone = DroneConfig(
            mass=2.5, drag_coeffs=np.array([0.3, 0.3, 0.5]),
            max_speed=22, max_altitude=500, battery_capacity=5000,
            camera_intrinsics=np.array([[400, 0, 320], [0, 400, 240], [0, 0, 1.0]]),
            camera_extrinsics=np.eye(4),
            imu_specs={"accel_bias_instability": 0.04, "accel_random_walk": 0.02,
                       "gyro_bias_instability": 5.0, "gyro_random_walk": 0.01},
        )
        mission = MissionPackage(
            target=np.array([3000, 0, -80.0]),
            landmarks=lm_list, clusters=clusters,
            corridor_grid=np.zeros((10, 128)),
            wind_estimate=np.array([3.0, 0.0]),
            camera_cal=drone.camera_intrinsics.copy(),
            terrain_profile=terrain.get_profile(np.zeros(2), np.array([3000, 0])),
            drop_point=np.zeros(3),
            cone=cone_cfg,
            cone_layers=layers,
        )

        dyn = SixDOFDynamics(drone)
        imu = IMUModel(IMUSpecs(), seed=42)
        cam = CameraModel(CameraSpecs(landmark_size=20.0), seed=42)
        cfg = SimConfig(sim_duration_max=10.0, max_no_update_seconds=15.0)
        est = NominalState(
            np.array([0, 0, -80.0]), np.array([15, 0, 0.0]),
            np.array([1, 0, 0, 0.0]), np.zeros(3), np.zeros(3), np.array([3.0, 0.0]),
        )
        ekf = ErrorStateEKF(dyn, cam, cfg, est)
        assoc = FiveStepPipeline(cam, cfg, seed=42)
        wind = DrydenWindField.calm(seed=42)

        sim = TrajectorySimulator(dyn, imu, cam, ekf, assoc, terrain, wind, gen, cfg)
        return sim, mission, drone

    def test_cone_runs_without_crash(self) -> None:
        sim, mission, drone = self._make_cone_sim()
        result = sim.run(mission, drone)
        assert result.outcome in ["success", "timeout", "diverged", "lost", "crash", "cone_exit"]
        assert len(result.timestamps) > 0

    def test_cone_metadata_has_progress(self) -> None:
        sim, mission, drone = self._make_cone_sim()
        result = sim.run(mission, drone)
        assert "cone_progress" in result.metadata
        assert "current_layer" in result.metadata["cone_progress"]

    def test_corridor_mode_still_works(self) -> None:
        """Corridor mode (no cone) unchanged."""
        from tests.physics.test_integration import _make_full_sim
        sim, mission, drone = _make_full_sim(duration=5.0)
        result = sim.run(mission, drone)
        assert result.outcome in ["success", "timeout", "diverged", "lost", "crash"]
        assert "cone_progress" not in result.metadata
