"""Tests for 5-step data association pipeline."""

import numpy as np
import pytest

from core.physics.association.pipeline import (
    AssociationResult,
    FiveStepPipeline,
    hamming_distance,
)
from core.physics.config import SimConfig
from core.physics.dynamics.six_dof import SixDOFDynamics
from core.physics.estimator.ekf import ErrorStateEKF
from core.physics.sensors.camera import CameraModel
from core.physics.terrain.procedural import ProceduralTerrain
from core.physics.types import (
    GRAVITY,
    CameraFrame,
    CameraObservation,
    CameraSpecs,
    DroneConfig,
    IMUMeasurement,
    Landmark,
    NominalState,
    TerrainConfig,
)


# ── Helpers ───────────────────────────────────────────────────


def _make_drone() -> DroneConfig:
    return DroneConfig(
        mass=2.5, drag_coeffs=np.array([0.3, 0.3, 0.5]),
        max_speed=22.0, max_altitude=500.0, battery_capacity=5000.0,
        camera_intrinsics=np.array([[400, 0, 320], [0, 400, 240], [0, 0, 1.0]]),
        camera_extrinsics=np.eye(4),
        imu_specs={"accel_bias_instability": 0.04, "accel_random_walk": 0.02,
                   "gyro_bias_instability": 5.0, "gyro_random_walk": 0.01},
    )


def _make_scenario():
    """Create EKF + camera + landmarks for testing."""
    drone = _make_drone()
    state = NominalState(
        np.array([0.0, 0.0, -100.0]),
        np.array([15.0, 0.0, 0.0]),
        np.array([1, 0, 0, 0.0]),
        np.zeros(3), np.zeros(3), np.zeros(2),
    )
    dyn = SixDOFDynamics(drone)
    cam = CameraModel(CameraSpecs(landmark_size=20.0), seed=42)
    ekf = ErrorStateEKF(dyn, cam, SimConfig(), state)
    terrain = ProceduralTerrain(TerrainConfig(ridge_height=0, base_elevation=0))

    landmarks = []
    for i in range(10):
        pos = np.array([100.0 + 50.0 * i, -20.0 + 10.0 * i, 0.0])
        rng = np.random.RandomState(i)
        desc = rng.randint(0, 256, 32).astype(np.uint8)
        landmarks.append(Landmark(f"L{i}", pos, desc, "C0", "bridge"))

    return ekf, cam, terrain, landmarks, state


# ── Hamming Distance ──────────────────────────────────────────


class TestHammingDistance:
    def test_identical(self) -> None:
        d = np.array([0xFF, 0x00, 0xAA] * 10 + [0xFF, 0x00], dtype=np.uint8)
        assert hamming_distance(d, d) == 0

    def test_opposite(self) -> None:
        d1 = np.zeros(32, dtype=np.uint8)
        d2 = np.full(32, 0xFF, dtype=np.uint8)
        assert hamming_distance(d1, d2) == 256

    def test_one_bit(self) -> None:
        d1 = np.zeros(32, dtype=np.uint8)
        d2 = np.zeros(32, dtype=np.uint8)
        d2[0] = 1  # 1 bit different
        assert hamming_distance(d1, d2) == 1


# ── Pipeline Steps ────────────────────────────────────────────


class TestPrediction:
    def test_returns_predictions(self) -> None:
        ekf, cam, _, landmarks, state = _make_scenario()
        pipe = FiveStepPipeline(cam, SimConfig(), seed=42)
        preds = pipe._step1_predict(state, ekf.P, landmarks)
        assert len(preds) > 0
        for p in preds:
            assert p.uv_predicted.shape == (2,)
            assert p.H_matrix.shape == (2, 17)
            assert p.search_radius > 0


class TestPipeline:
    def test_returns_matches(self) -> None:
        ekf, cam, terrain, landmarks, state = _make_scenario()
        pipe = FiveStepPipeline(cam, SimConfig(), seed=42)
        frame = cam.observe_landmarks(state, landmarks, terrain, 0.0)
        if frame.observations:
            results = pipe.associate(frame, state, ekf.P, landmarks)
            assert isinstance(results, list)
            for r in results:
                assert isinstance(r, AssociationResult)

    def test_empty_frame(self) -> None:
        ekf, cam, _, landmarks, state = _make_scenario()
        pipe = FiveStepPipeline(cam, SimConfig(), seed=42)
        results = pipe.associate(CameraFrame(0.0, []), state, ekf.P, landmarks)
        assert results == []

    def test_no_landmarks(self) -> None:
        ekf, cam, terrain, _, state = _make_scenario()
        pipe = FiveStepPipeline(cam, SimConfig(), seed=42)
        frame = cam.observe_landmarks(state, [], terrain, 0.0)
        results = pipe.associate(frame, state, ekf.P, [])
        assert results == []

    def test_stats_tracking(self) -> None:
        ekf, cam, terrain, landmarks, state = _make_scenario()
        pipe = FiveStepPipeline(cam, SimConfig(), seed=42)
        frame = cam.observe_landmarks(state, landmarks, terrain, 0.0)
        pipe.associate(frame, state, ekf.P, landmarks)
        assert pipe.stats.frames_processed == 1
        assert pipe.stats.total_predictions >= 0

    def test_deterministic(self) -> None:
        ekf, cam, terrain, landmarks, state = _make_scenario()
        p1 = FiveStepPipeline(cam, SimConfig(), seed=42)
        p2 = FiveStepPipeline(cam, SimConfig(), seed=42)
        cam2 = CameraModel(CameraSpecs(landmark_size=20.0), seed=42)
        f1 = cam.observe_landmarks(state, landmarks, terrain, 0.0)
        f2 = cam2.observe_landmarks(state, landmarks, terrain, 0.0)
        r1 = p1.associate(f1, state, ekf.P, landmarks)
        r2 = p2.associate(f2, state, ekf.P, landmarks)
        assert len(r1) == len(r2)


# ── Pipeline → EKF Integration ───────────────────────────────


class TestPipelineEKFIntegration:
    def test_pipeline_to_ekf_update(self) -> None:
        """End-to-end: pipeline matches → EKF update → P reduces."""
        ekf, cam, terrain, landmarks, state = _make_scenario()
        pipe = FiveStepPipeline(cam, SimConfig(), seed=42)

        imu = IMUMeasurement(0.0, np.array([0, 0, -GRAVITY]), np.zeros(3))
        for _ in range(50):
            ekf.predict(imu, 0.01)
        P_before = np.trace(ekf.P)

        frame = cam.observe_landmarks(
            ekf.get_state(), landmarks, terrain, 0.5
        )
        matches = pipe.associate(
            frame, ekf.get_state(), ekf.get_covariance(), landmarks
        )

        for m in matches:
            ekf.update(m.observation, m.landmark)

        if len(matches) > 0:
            assert np.trace(ekf.P) < P_before
