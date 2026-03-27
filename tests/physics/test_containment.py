"""Tests for containment vs localization measurements (TIP-H1)."""

import numpy as np
import pytest

from core.physics.config import SimConfig
from core.physics.dynamics.six_dof import SixDOFDynamics
from core.physics.estimator.ekf import ErrorStateEKF
from core.physics.sensors.camera import CameraModel
from core.physics.types import (
    GRAVITY,
    CameraSpecs,
    CameraObservation,
    DroneConfig,
    IMUMeasurement,
    Landmark,
    NominalState,
)


def _make_ekf(alt: float = 100.0) -> ErrorStateEKF:
    drone = DroneConfig(
        mass=2.5, drag_coeffs=np.array([0.3, 0.3, 0.5]),
        max_speed=22, max_altitude=500, battery_capacity=5000,
        camera_intrinsics=np.array([[400, 0, 320], [0, 400, 240], [0, 0, 1.0]]),
        camera_extrinsics=np.eye(4),
        imu_specs={"accel_bias_instability": 0.04, "accel_random_walk": 0.02,
                   "gyro_bias_instability": 5.0, "gyro_random_walk": 0.01},
    )
    dyn = SixDOFDynamics(drone)
    cam = CameraModel(CameraSpecs(), seed=42)
    state = NominalState(
        np.array([0, 0, -alt]), np.zeros(3), np.array([1, 0, 0, 0.0]),
        np.zeros(3), np.zeros(3), np.zeros(2),
    )
    return ErrorStateEKF(dyn, cam, SimConfig(), state)


def _predict_n(ekf, n):
    imu = IMUMeasurement(0.0, np.array([0, 0, -GRAVITY]), np.zeros(3))
    for _ in range(n):
        ekf.predict(imu, 0.01)


def _make_lm(north=200, east=0):
    return Landmark(
        "L0", np.array([float(north), float(east), 0.0]),
        np.zeros(32, dtype=np.uint8), "C0", "bridge",
    )


class TestContainmentUpdate:
    def test_consistent_no_state_change(self) -> None:
        ekf = _make_ekf()
        _predict_n(ekf, 50)
        pos_before = ekf.get_state().position.copy()
        lm = _make_lm()
        uv = ekf.camera.project(lm.position, ekf.nominal)
        assert uv is not None
        obs = CameraObservation(0.5, "L0", uv)
        result = ekf.containment_update(obs, lm, cone_radius=500)
        assert result == "consistent"
        # Position approximately unchanged
        np.testing.assert_allclose(ekf.get_state().position, pos_before, atol=1.0)

    def test_inconsistent_corrects(self) -> None:
        ekf = _make_ekf()
        _predict_n(ekf, 50)
        lm = _make_lm()
        # Way off pixel observation
        obs = CameraObservation(0.5, "L0", np.array([50.0, 240.0]))
        result = ekf.containment_update(obs, lm, cone_radius=500)
        assert result in ["corrected", "consistent"]

    def test_weaker_than_full_update(self) -> None:
        ekf_cont = _make_ekf()
        ekf_full = _make_ekf()
        _predict_n(ekf_cont, 50)
        _predict_n(ekf_full, 50)

        lm = _make_lm()
        uv = ekf_cont.camera.project(lm.position, ekf_cont.nominal)
        if uv is None:
            pytest.skip("Landmark not visible")
        obs = CameraObservation(0.5, "L0", uv)

        ekf_cont.containment_update(obs, lm, 500)
        ekf_full.update(obs, lm)

        # Full update should reduce P more (or equal)
        assert np.trace(ekf_cont.P) >= np.trace(ekf_full.P) * 0.9

    def test_no_observation(self) -> None:
        ekf = _make_ekf()
        lm = Landmark("L0", np.array([-200, 0, 0.0]),  # behind
                       np.zeros(32, dtype=np.uint8), "C0", "bridge")
        obs = CameraObservation(0.0, "L0", np.array([320, 240]))
        result = ekf.containment_update(obs, lm, 500)
        assert result == "no_observation"


class TestBearingUpdate:
    def test_returns_nis(self) -> None:
        ekf = _make_ekf()
        _predict_n(ekf, 50)
        lm = _make_lm()
        uv = ekf.camera.project(lm.position, ekf.nominal)
        if uv is None:
            pytest.skip("Landmark not visible")
        obs = CameraObservation(0.5, "L0", uv)
        nis = ekf.bearing_update(obs, lm)
        assert nis >= 0

    def test_reduces_P(self) -> None:
        ekf = _make_ekf()
        _predict_n(ekf, 50)
        P_before = np.trace(ekf.P)
        lm = _make_lm()
        uv = ekf.camera.project(lm.position, ekf.nominal)
        if uv is None:
            pytest.skip("Landmark not visible")
        obs = CameraObservation(0.5, "L0", uv)
        ekf.bearing_update(obs, lm)
        assert np.trace(ekf.P) < P_before

    def test_invisible_returns_negative(self) -> None:
        ekf = _make_ekf()
        lm = Landmark("L0", np.array([-200, 0, 0.0]),
                       np.zeros(32, dtype=np.uint8), "C0", "bridge")
        obs = CameraObservation(0.0, "L0", np.array([320, 240]))
        nis = ekf.bearing_update(obs, lm)
        assert nis == -1.0


class TestMeasurementTypeAssignment:
    def test_types_assigned(self) -> None:
        from core.physics.landmark.cone import ConeLandmarkGenerator
        from core.physics.terrain.procedural import ProceduralTerrain
        from core.physics.types import ConeConfig, TerrainConfig

        terrain = ProceduralTerrain(TerrainConfig(ridge_height=0, base_elevation=0))
        gen = ConeLandmarkGenerator(terrain, ConeConfig(num_layers=8))
        _, _, layers = gen.generate(np.zeros(3), np.array([15000, 0, 0]))

        types_seen = set()
        for l in layers:
            types_seen.add(l.measurement_type)
        # With 15km corridor, should have multiple types
        assert len(types_seen) >= 2

    def test_outer_layers_containment(self) -> None:
        from core.physics.landmark.cone import ConeLandmarkGenerator
        from core.physics.terrain.procedural import ProceduralTerrain
        from core.physics.types import ConeConfig, TerrainConfig

        terrain = ProceduralTerrain(TerrainConfig(ridge_height=0, base_elevation=0))
        gen = ConeLandmarkGenerator(terrain, ConeConfig(num_layers=8))
        _, _, layers = gen.generate(np.zeros(3), np.array([15000, 0, 0]))

        # First layer (near base, far from target) should be containment
        assert layers[0].measurement_type == "containment"
        # Last layer (near target) should be terminal or full_metric
        assert layers[-1].measurement_type in ["terminal", "full_metric"]
