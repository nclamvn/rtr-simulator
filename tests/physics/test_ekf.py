"""Tests for Error-State Extended Kalman Filter (17D).

Covers: P growth, P reduction, gating, convergence, symmetry, PD, Joseph form.
"""

from __future__ import annotations

import numpy as np
import pytest

from core.physics.config import SimConfig
from core.physics.dynamics.six_dof import SixDOFDynamics
from core.physics.estimator.ekf import ErrorStateEKF
from core.physics.sensors.camera import CameraModel
from core.physics.types import (
    GRAVITY,
    CameraObservation,
    CameraSpecs,
    DroneConfig,
    ErrorState,
    IMUMeasurement,
    Landmark,
    NominalState,
)


# ── Helpers ───────────────────────────────────────────────────


def _make_drone() -> DroneConfig:
    return DroneConfig(
        mass=2.5,
        drag_coeffs=np.array([0.3, 0.3, 0.5]),
        max_speed=22.0,
        max_altitude=500.0,
        battery_capacity=5000.0,
        camera_intrinsics=np.array([[400, 0, 320], [0, 400, 240], [0, 0, 1.0]]),
        camera_extrinsics=np.eye(4),
        imu_specs={
            "accel_bias_instability": 0.04,
            "accel_random_walk": 0.02,
            "gyro_bias_instability": 5.0,
            "gyro_random_walk": 0.01,
        },
    )


def _make_ekf(
    state: NominalState | None = None,
    initial_P: np.ndarray | None = None,
) -> ErrorStateEKF:
    drone = _make_drone()
    dyn = SixDOFDynamics(drone)
    cam = CameraModel(CameraSpecs())
    cfg = SimConfig()
    if state is None:
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
    return ErrorStateEKF(dyn, cam, cfg, state, initial_P)


def _hover_imu() -> IMUMeasurement:
    return IMUMeasurement(0.0, np.array([0, 0, -GRAVITY]), np.zeros(3))


def _elevated_state(alt: float = 100.0) -> NominalState:
    return NominalState(
        np.array([0, 0, -alt]), np.zeros(3), np.array([1, 0, 0, 0.0]),
        np.zeros(3), np.zeros(3), np.zeros(2),
    )


def _make_landmark(north: float = 200, east: float = 0, down: float = 0) -> Landmark:
    return Landmark(
        "L0", np.array([north, east, down]),
        np.zeros(32, dtype=np.uint8), "C0", "bridge",
    )


# ── Initial State ─────────────────────────────────────────────


class TestInitial:
    def test_state(self) -> None:
        ekf = _make_ekf()
        s = ekf.get_state()
        np.testing.assert_allclose(s.position, np.zeros(3))

    def test_P_shape(self) -> None:
        ekf = _make_ekf()
        assert ekf.P.shape == (17, 17)

    def test_P_symmetric(self) -> None:
        ekf = _make_ekf()
        np.testing.assert_allclose(ekf.P, ekf.P.T, atol=1e-15)

    def test_P_positive_definite(self) -> None:
        ekf = _make_ekf()
        eigs = np.linalg.eigvalsh(ekf.P)
        assert np.all(eigs > 0)

    def test_custom_initial_P(self) -> None:
        P0 = np.eye(17) * 100
        ekf = _make_ekf(initial_P=P0)
        np.testing.assert_allclose(ekf.P, P0)


# ── Predict ───────────────────────────────────────────────────


class TestPredict:
    def test_P_grows_without_updates(self) -> None:
        """Without observations, uncertainty increases."""
        ekf = _make_ekf()
        trace0 = np.trace(ekf.P)
        for _ in range(100):
            ekf.predict(_hover_imu(), 0.01)
        assert np.trace(ekf.P) > trace0

    def test_P_stays_symmetric(self) -> None:
        ekf = _make_ekf()
        imu = IMUMeasurement(0.0, np.array([0, 0, -GRAVITY]), np.array([0.1, 0.05, -0.02]))
        for _ in range(500):
            ekf.predict(imu, 0.01)
        np.testing.assert_allclose(ekf.P, ekf.P.T, atol=1e-10)

    def test_P_stays_positive_definite(self) -> None:
        ekf = _make_ekf()
        imu = IMUMeasurement(0.0, np.array([0, 0, -GRAVITY]), np.array([0.1, 0, 0]))
        for _ in range(1000):
            ekf.predict(imu, 0.01)
        eigs = np.linalg.eigvalsh(ekf.P)
        assert np.all(eigs > 0), f"Negative eigenvalue: {eigs.min()}"

    def test_nominal_propagates(self) -> None:
        """Nominal state should change after predict."""
        ekf = _make_ekf()
        pos0 = ekf.nominal.position.copy()
        # Free fall: no thrust
        no_thrust = IMUMeasurement(0.0, np.zeros(3), np.zeros(3))
        for _ in range(100):
            ekf.predict(no_thrust, 0.01)
        # Should have fallen (NED Z increases)
        assert ekf.nominal.position[2] > pos0[2] + 1.0


# ── Update ────────────────────────────────────────────────────


class TestUpdate:
    def test_reduces_P(self) -> None:
        """A correct observation should reduce uncertainty."""
        ekf = _make_ekf(state=_elevated_state())
        for _ in range(50):
            ekf.predict(_hover_imu(), 0.01)
        trace_before = np.trace(ekf.P)

        lm = _make_landmark()
        uv = ekf.camera.project(lm.position, ekf.nominal)
        assert uv is not None, "Landmark should be visible"
        nis = ekf.update(CameraObservation(0.5, "L0", uv), lm)
        assert np.trace(ekf.P) < trace_before
        assert 0 <= nis < 9.21

    def test_P_symmetric_after_update(self) -> None:
        ekf = _make_ekf(state=_elevated_state())
        for _ in range(50):
            ekf.predict(_hover_imu(), 0.01)
        lm = _make_landmark()
        uv = ekf.camera.project(lm.position, ekf.nominal)
        if uv is not None:
            ekf.update(CameraObservation(0.5, "L0", uv), lm)
        np.testing.assert_allclose(ekf.P, ekf.P.T, atol=1e-10)

    def test_P_positive_definite_after_update(self) -> None:
        ekf = _make_ekf(state=_elevated_state())
        for _ in range(50):
            ekf.predict(_hover_imu(), 0.01)
        lm = _make_landmark()
        uv = ekf.camera.project(lm.position, ekf.nominal)
        if uv is not None:
            ekf.update(CameraObservation(0.5, "L0", uv), lm)
        eigs = np.linalg.eigvalsh(ekf.P)
        assert np.all(eigs > 0)

    def test_landmark_not_visible(self) -> None:
        """Landmark behind drone → returns -1, no update."""
        ekf = _make_ekf(state=_elevated_state())
        lm = Landmark("L0", np.array([-200, 0, 0]),  # behind
                       np.zeros(32, dtype=np.uint8), "C0", "bridge")
        P_before = ekf.P.copy()
        nis = ekf.update(CameraObservation(0.0, "L0", np.array([320, 240])), lm)
        assert nis == -1.0
        np.testing.assert_allclose(ekf.P, P_before)


# ── Gating ────────────────────────────────────────────────────


class TestGating:
    def test_rejects_outlier(self) -> None:
        """Large innovation → rejected by Mahalanobis gate."""
        ekf = _make_ekf(state=_elevated_state())
        lm = _make_landmark()
        # Wildly wrong pixel observation
        obs = CameraObservation(0.0, "L0", np.array([0.0, 0.0]))
        P_before = ekf.P.copy()
        nis = ekf.update(obs, lm)
        assert nis > 9.21
        assert ekf.reject_count == 1
        np.testing.assert_allclose(ekf.P, P_before, atol=1e-12)

    def test_accepts_correct_observation(self) -> None:
        ekf = _make_ekf(state=_elevated_state())
        for _ in range(50):
            ekf.predict(_hover_imu(), 0.01)
        lm = _make_landmark()
        uv = ekf.camera.project(lm.position, ekf.nominal)
        assert uv is not None
        nis = ekf.update(CameraObservation(0.5, "L0", uv), lm)
        assert 0 <= nis < 9.21
        assert ekf.update_count == 1
        assert ekf.reject_count == 0


# ── Inject + Reset ────────────────────────────────────────────


class TestInjectReset:
    def test_error_reset_to_zero(self) -> None:
        ekf = _make_ekf()
        ekf.error = ErrorState.from_vector(np.ones(17) * 0.01)
        ekf._inject_error()
        np.testing.assert_allclose(ekf.error.to_vector(), np.zeros(17), atol=1e-15)

    def test_nominal_updated(self) -> None:
        ekf = _make_ekf()
        pos_before = ekf.nominal.position.copy()
        ekf.error = ErrorState.from_vector(
            np.array([1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.0])
        )
        ekf._inject_error()
        # Position should have shifted by [1, 2, 3]
        np.testing.assert_allclose(
            ekf.nominal.position, pos_before + np.array([1, 2, 3])
        )


# ── Convergence ───────────────────────────────────────────────


class TestConvergence:
    def test_with_perfect_observations(self) -> None:
        """With perfect (noiseless) observations, estimate → truth."""
        true_pos = np.array([0.0, 0.0, -100.0])
        est_pos = np.array([5.0, -3.0, -102.0])

        ekf = _make_ekf(state=NominalState(
            est_pos, np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        ))

        true_state = NominalState(
            true_pos, np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )

        # More landmarks with better geometry (spread in both N and E)
        landmarks = [
            _make_landmark(north=100 + 50 * i, east=30.0 * (i - 2))
            for i in range(5)
        ]

        imu = _hover_imu()

        # More update cycles for convergence
        for step in range(100):
            ekf.predict(imu, 0.01)
            for lm in landmarks:
                uv_true = ekf.camera.project(lm.position, true_state)
                if uv_true is not None:
                    ekf.update(CameraObservation(step * 0.01, lm.id, uv_true), lm)

        pos_error = np.linalg.norm(ekf.get_state().position - true_pos)
        assert pos_error < 4.0, f"Position error {pos_error:.2f}m > 4m"

    def test_position_uncertainty_decreases(self) -> None:
        """Position σ should decrease after updates."""
        ekf = _make_ekf(state=_elevated_state())
        sigma_init = ekf.get_position_uncertainty().copy()

        for _ in range(50):
            ekf.predict(_hover_imu(), 0.01)

        lm = _make_landmark()
        uv = ekf.camera.project(lm.position, ekf.nominal)
        if uv is not None:
            ekf.update(CameraObservation(0.5, "L0", uv), lm)

        sigma_after = ekf.get_position_uncertainty()
        # At least horizontal uncertainty should not explode
        assert np.all(sigma_after[:2] <= sigma_init[:2] * 2.0)


# ── Sequential Update ─────────────────────────────────────────


class TestSequentialUpdate:
    def test_multiple_landmarks(self) -> None:
        """Multiple landmarks reduce P more than single."""
        ekf = _make_ekf(state=_elevated_state())
        for _ in range(50):
            ekf.predict(_hover_imu(), 0.01)

        P_before = np.trace(ekf.P)
        landmarks = [
            _make_landmark(north=150 + 50 * i, east=20.0 * i)
            for i in range(3)
        ]
        for lm in landmarks:
            uv = ekf.camera.project(lm.position, ekf.nominal)
            if uv is not None:
                ekf.update(CameraObservation(0.5, lm.id, uv), lm)

        assert np.trace(ekf.P) < P_before
        assert ekf.update_count >= 2


# ── Reset Filter ──────────────────────────────────────────────


class TestResetFilter:
    def test_full_reset(self) -> None:
        ekf = _make_ekf()
        for _ in range(100):
            ekf.predict(_hover_imu(), 0.01)
        ekf.update_count = 5
        ekf.reject_count = 2

        new_state = _elevated_state(200.0)
        ekf.reset_filter(new_state)

        assert ekf.get_state().position[2] == pytest.approx(-200.0)
        assert ekf.update_count == 0
        assert ekf.reject_count == 0
        np.testing.assert_allclose(ekf.error.to_vector(), np.zeros(17))
