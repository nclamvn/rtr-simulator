"""Tests for sensor models — IMU and Camera.

Includes H matrix numerical verification (MANDATORY).
"""

import numpy as np
import pytest

from core.physics.dynamics._helpers import apply_error_to_nominal
from core.physics.sensors.camera import CameraModel
from core.physics.sensors.imu import IMUModel
from core.physics.terrain.procedural import ProceduralTerrain
from core.physics.types import (
    GRAVITY,
    CameraSpecs,
    ErrorState,
    IMUSpecs,
    Landmark,
    NominalState,
    TerrainConfig,
)


# ── IMU Tests ─────────────────────────────────────────────────


class TestIMUModel:
    def test_hover_mean(self) -> None:
        """Average of many readings at hover ≈ true + bias."""
        specs = IMUSpecs()
        imu = IMUModel(specs, seed=42)
        accels = []
        for i in range(1000):
            m = imu.generate_from_body(
                np.array([0.0, 0.0, -GRAVITY]),
                np.zeros(3),
                t=i * 0.01,
            )
            accels.append(m.accel)
        mean = np.mean(accels, axis=0)
        # Mean should be close to true + bias
        expected_z = -GRAVITY + imu.accel_bias_true[2]
        assert abs(mean[2] - expected_z) < 0.5

    def test_noise_nonzero(self) -> None:
        """Consecutive readings should differ due to noise."""
        imu = IMUModel(IMUSpecs(), seed=42)
        m1 = imu.generate_from_body(np.array([0, 0, -GRAVITY]), np.zeros(3), 0.0)
        m2 = imu.generate_from_body(np.array([0, 0, -GRAVITY]), np.zeros(3), 0.01)
        assert not np.allclose(m1.accel, m2.accel)

    def test_saturation(self) -> None:
        """Extreme input should be clipped to sensor range."""
        specs = IMUSpecs(accel_range=16.0)
        imu = IMUModel(specs, seed=42)
        m = imu.generate_from_body(np.array([0, 0, -200.0]), np.zeros(3), 0.0)
        assert abs(m.accel[2]) <= 16.0 * GRAVITY + 0.01

    def test_gyro_saturation(self) -> None:
        specs = IMUSpecs(gyro_range=2000.0)
        imu = IMUModel(specs, seed=42)
        huge_gyro = np.array([100.0, 100.0, 100.0])  # rad/s
        m = imu.generate_from_body(np.zeros(3), huge_gyro, 0.0)
        from core.physics.types import DEG2RAD

        gyro_max = 2000.0 * DEG2RAD
        assert np.all(np.abs(m.gyro) <= gyro_max + 0.01)

    def test_deterministic(self) -> None:
        """Same seed → same output."""
        specs = IMUSpecs()
        imu1 = IMUModel(specs, seed=99)
        imu2 = IMUModel(specs, seed=99)
        m1 = imu1.generate_from_body(np.zeros(3), np.zeros(3), 0.0)
        m2 = imu2.generate_from_body(np.zeros(3), np.zeros(3), 0.0)
        np.testing.assert_array_equal(m1.accel, m2.accel)
        np.testing.assert_array_equal(m1.gyro, m2.gyro)

    def test_reset_new_biases(self) -> None:
        """Reset should give new biases."""
        imu = IMUModel(IMUSpecs(), seed=42)
        bias1 = imu.accel_bias_true.copy()
        imu.reset(seed=99)
        bias2 = imu.accel_bias_true.copy()
        assert not np.allclose(bias1, bias2)

    def test_reset_deterministic(self) -> None:
        """Reset with same seed → same biases."""
        imu1 = IMUModel(IMUSpecs(), seed=1)
        imu2 = IMUModel(IMUSpecs(), seed=1)
        imu1.reset(seed=50)
        imu2.reset(seed=50)
        np.testing.assert_array_equal(imu1.accel_bias_true, imu2.accel_bias_true)

    def test_timestamp(self) -> None:
        imu = IMUModel(IMUSpecs(), seed=42)
        m = imu.generate_from_body(np.zeros(3), np.zeros(3), 1.5)
        assert m.timestamp == 1.5


# ── Camera Projection Tests ──────────────────────────────────


class TestCameraProjection:
    def test_project_in_front(self) -> None:
        """Landmark ahead → valid pixel coordinates."""
        cam = CameraModel(CameraSpecs(), seed=42)
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        # 100m north — with identity quaternion and identity extrinsics,
        # "north" in NED is body X, which is camera Z for identity T_cam_imu
        uv = cam.project(np.array([100.0, 0.0, 0.0]), state)
        assert uv is not None
        assert 0 <= uv[0] < 640
        assert 0 <= uv[1] < 480

    def test_project_behind(self) -> None:
        """Landmark behind drone → None."""
        cam = CameraModel(CameraSpecs(), seed=42)
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        uv = cam.project(np.array([-100.0, 0.0, 0.0]), state)
        assert uv is None

    def test_project_out_of_frame(self) -> None:
        """Landmark far to the side → None (out of frame)."""
        cam = CameraModel(CameraSpecs(), seed=42)
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        # Very far east, close north → out of frame
        uv = cam.project(np.array([10.0, 1000.0, 0.0]), state)
        assert uv is None

    def test_project_at_center(self) -> None:
        """Landmark directly ahead → near image center."""
        cam = CameraModel(CameraSpecs(), seed=42)
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        uv = cam.project(np.array([100.0, 0.0, 0.0]), state)
        assert uv is not None
        # Should be near principal point (320, 240)
        assert abs(uv[0] - 320) < 5
        assert abs(uv[1] - 240) < 5


# ── Camera Observation Tests ──────────────────────────────────


class TestCameraObservation:
    @pytest.fixture
    def flat_terrain(self) -> ProceduralTerrain:
        return ProceduralTerrain(TerrainConfig(ridge_height=0, base_elevation=0))

    def test_observe_some_landmarks(self, flat_terrain) -> None:
        """Should detect some but potentially miss some."""
        # Use larger landmark_size so P_detectable is reasonable at range
        specs = CameraSpecs(landmark_size=20.0)  # 20m landmarks (e.g. buildings)
        cam = CameraModel(specs, seed=42)
        # Low altitude so forward-looking landmarks are within vertical FOV
        state = NominalState(
            np.array([5000.0, 0.0, -30.0]),  # 30m altitude
            np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        landmarks = []
        for i in range(20):
            # Landmarks at ground level, 50-300m ahead (close enough to detect)
            landmarks.append(Landmark(
                f"L{i}",
                np.array([5000.0 + 50.0 * (i + 1), 0.0, 0.0]),
                np.random.RandomState(i).randint(0, 256, 32).astype(np.uint8),
                "C0", "bridge",
            ))
        frame = cam.observe_landmarks(state, landmarks, flat_terrain, 0.0)
        # Should detect some landmarks within FOV
        assert len(frame.observations) > 0

    def test_pixel_noise_variance(self, flat_terrain) -> None:
        """Observed pixels should have variance from noise."""
        specs = CameraSpecs(pixel_noise_std=2.0)
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        lm = Landmark(
            "L0", np.array([100.0, 0.0, 0.0]),
            np.zeros(32, dtype=np.uint8), "C0", "bridge",
        )
        pixels = []
        for i in range(200):
            cam_i = CameraModel(specs, seed=i)
            frame = cam_i.observe_landmarks(state, [lm], flat_terrain, 0.0)
            if frame.observations:
                pixels.append(frame.observations[0].pixel_uv)
        assert len(pixels) > 50, "Too many misses — detection should be high at 100m"
        std = np.std(pixels, axis=0)
        assert np.all(std > 0.5)  # Non-trivial variance

    def test_observation_deterministic(self, flat_terrain) -> None:
        """Same seed → same observations."""
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        lm = Landmark(
            "L0", np.array([100.0, 0.0, 0.0]),
            np.zeros(32, dtype=np.uint8), "C0", "bridge",
        )
        cam1 = CameraModel(CameraSpecs(), seed=42)
        cam2 = CameraModel(CameraSpecs(), seed=42)
        f1 = cam1.observe_landmarks(state, [lm], flat_terrain, 0.0)
        f2 = cam2.observe_landmarks(state, [lm], flat_terrain, 0.0)
        assert len(f1.observations) == len(f2.observations)
        if f1.observations:
            np.testing.assert_array_equal(
                f1.observations[0].pixel_uv, f2.observations[0].pixel_uv
            )


# ── H Matrix Tests ────────────────────────────────────────────


class TestHMatrix:
    def test_shape(self) -> None:
        cam = CameraModel(CameraSpecs(), seed=42)
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        lm = Landmark(
            "L0", np.array([100.0, 0.0, 0.0]),
            np.zeros(32, dtype=np.uint8), "C0", "bridge",
        )
        H = cam.get_H_matrix(state, lm)
        assert H is not None
        assert H.shape == (2, 17)

    def test_behind_returns_none(self) -> None:
        cam = CameraModel(CameraSpecs(), seed=42)
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        lm = Landmark(
            "L0", np.array([-100.0, 0.0, 0.0]),
            np.zeros(32, dtype=np.uint8), "C0", "bridge",
        )
        H = cam.get_H_matrix(state, lm)
        assert H is None

    def test_position_columns_nonzero(self) -> None:
        """H[:, 0:3] (position) should be non-zero for visible landmark."""
        cam = CameraModel(CameraSpecs(), seed=42)
        state = NominalState(
            np.array([0.0, 0.0, -100.0]),
            np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        lm = Landmark(
            "L0", np.array([200.0, 50.0, 0.0]),
            np.zeros(32, dtype=np.uint8), "C0", "bridge",
        )
        H = cam.get_H_matrix(state, lm)
        assert H is not None
        assert np.any(np.abs(H[:, 0:3]) > 1e-6)

    def test_velocity_columns_zero(self) -> None:
        """H[:, 3:6] (velocity) should be zero — projection doesn't depend on velocity."""
        cam = CameraModel(CameraSpecs(), seed=42)
        state = NominalState(
            np.array([0.0, 0.0, -100.0]),
            np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        lm = Landmark(
            "L0", np.array([200.0, 50.0, 0.0]),
            np.zeros(32, dtype=np.uint8), "C0", "bridge",
        )
        H = cam.get_H_matrix(state, lm)
        assert H is not None
        np.testing.assert_allclose(H[:, 3:6], 0.0, atol=1e-15)

    def test_bias_columns_zero(self) -> None:
        """H[:, 9:17] (biases, wind) should be zero."""
        cam = CameraModel(CameraSpecs(), seed=42)
        state = NominalState(
            np.array([0.0, 0.0, -100.0]),
            np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        lm = Landmark(
            "L0", np.array([200.0, 50.0, 0.0]),
            np.zeros(32, dtype=np.uint8), "C0", "bridge",
        )
        H = cam.get_H_matrix(state, lm)
        assert H is not None
        np.testing.assert_allclose(H[:, 9:17], 0.0, atol=1e-15)

    def test_numerical_verification(self) -> None:
        """CRITICAL: H_analytical ≈ H_numerical (finite differences).

        Method: perturb each error-state dimension, project, compute
        H_numerical[:, j] = (h(x+ε) - h(x-ε)) / (2ε)
        """
        cam = CameraModel(CameraSpecs(), seed=42)
        state = NominalState(
            np.array([0.0, 0.0, -100.0]),
            np.array([5.0, 1.0, -0.5]),
            np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        lm = Landmark(
            "L0", np.array([200.0, 50.0, -10.0]),
            np.zeros(32, dtype=np.uint8), "C0", "bridge",
        )

        H_analytical = cam.get_H_matrix(state, lm)
        assert H_analytical is not None

        eps = 1e-7
        H_numerical = np.zeros((2, 17))

        for j in range(17):
            dx = np.zeros(17)
            dx[j] = eps
            state_plus = apply_error_to_nominal(state, ErrorState.from_vector(dx))
            state_minus = apply_error_to_nominal(state, ErrorState.from_vector(-dx))

            uv_plus = cam.project(lm.position, state_plus)
            uv_minus = cam.project(lm.position, state_minus)

            if uv_plus is not None and uv_minus is not None:
                H_numerical[:, j] = (uv_plus - uv_minus) / (2 * eps)

        # Compare non-zero columns (position, attitude)
        for j in range(17):
            if np.any(np.abs(H_analytical[:, j]) > 1e-6) or np.any(
                np.abs(H_numerical[:, j]) > 1e-6
            ):
                np.testing.assert_allclose(
                    H_analytical[:, j],
                    H_numerical[:, j],
                    atol=0.1,
                    rtol=0.05,
                    err_msg=f"H matrix mismatch at column {j}",
                )

    def test_numerical_tilted_state(self) -> None:
        """H numerical check with non-trivial attitude."""
        from core.physics.types import DEG2RAD

        pitch = 10 * DEG2RAD
        cam = CameraModel(CameraSpecs(), seed=42)
        state = NominalState(
            np.array([100.0, 50.0, -150.0]),
            np.zeros(3),
            np.array([np.cos(pitch / 2), 0, -np.sin(pitch / 2), 0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        lm = Landmark(
            "L0", np.array([300.0, 80.0, -5.0]),
            np.zeros(32, dtype=np.uint8), "C0", "bridge",
        )

        H_analytical = cam.get_H_matrix(state, lm)
        if H_analytical is None:
            pytest.skip("Landmark not visible from this state")

        eps = 1e-7
        H_numerical = np.zeros((2, 17))
        for j in range(17):
            dx = np.zeros(17)
            dx[j] = eps
            sp = apply_error_to_nominal(state, ErrorState.from_vector(dx))
            sm = apply_error_to_nominal(state, ErrorState.from_vector(-dx))
            uv_p = cam.project(lm.position, sp)
            uv_m = cam.project(lm.position, sm)
            if uv_p is not None and uv_m is not None:
                H_numerical[:, j] = (uv_p - uv_m) / (2 * eps)

        # Check active columns
        active = np.any(np.abs(H_analytical) > 1e-6, axis=0) | np.any(
            np.abs(H_numerical) > 1e-6, axis=0
        )
        if np.any(active):
            np.testing.assert_allclose(
                H_analytical[:, active],
                H_numerical[:, active],
                atol=0.5,
                rtol=0.1,
                err_msg="H matrix tilted state mismatch",
            )
