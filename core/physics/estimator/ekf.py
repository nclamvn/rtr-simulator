"""Error-State Extended Kalman Filter — 17D.

Core navigation algorithm from đề án Sections 2.3–2.6.

Maintains:
- x̄: nominal state (18D, propagated by nonlinear dynamics)
- δx: error state (17D, estimated by EKF — reset to zero after inject)
- P: covariance (17×17)

Convention: inject + reset after EVERY update (sequential per landmark).
"""

import logging
from typing import Optional

import numpy as np

from core.physics.config import SimConfig
from core.physics.dynamics._helpers import apply_error_to_nominal
from core.physics.dynamics._quaternion import skew
from core.physics.dynamics.base import DynamicsModel
from core.physics.estimator.base import StateEstimator
from core.physics.sensors.camera import CameraModel
from core.physics.types import (
    DEG2RAD,
    GRAVITY,
    RAD2DEG,
    CameraObservation,
    ErrorState,
    IMUMeasurement,
    Landmark,
    NominalState,
    WindVector,
)

logger = logging.getLogger(__name__)


class ErrorStateEKF(StateEstimator):
    """17D Error-State EKF with Joseph form update and Mahalanobis gating."""

    def __init__(
        self,
        dynamics: DynamicsModel,
        camera: CameraModel,
        config: SimConfig,
        initial_state: NominalState,
        initial_P: Optional[np.ndarray] = None,
    ) -> None:
        self.dynamics = dynamics
        self.camera = camera
        self.config = config

        # Nominal state — propagated by nonlinear equations
        self.nominal = NominalState(
            position=initial_state.position.copy(),
            velocity=initial_state.velocity.copy(),
            quaternion=initial_state.quaternion.copy(),
            accel_bias=initial_state.accel_bias.copy(),
            gyro_bias=initial_state.gyro_bias.copy(),
            wind=initial_state.wind.copy(),
        )

        # Error state — always near zero (reset after inject)
        self.error = ErrorState.zeros()

        # Covariance
        if initial_P is not None:
            assert initial_P.shape == (17, 17)
            self.P = initial_P.copy()
        else:
            self.P = self._default_initial_P()

        # Diagnostics
        self.last_nis: float = 0.0
        self.update_count: int = 0
        self.reject_count: int = 0

    @staticmethod
    def _default_initial_P() -> np.ndarray:
        """Default initial covariance — reflects uncertainty at drop point.

        Position:  ±5m        → σ² = 25
        Velocity:  ±2m/s      → σ² = 4
        Attitude:  ±3°        → σ² = (3·DEG2RAD)²
        Accel bias: ±0.04mg   → σ² = (0.04·g/1000)²
        Gyro bias:  ±5deg/hr  → σ² = (5·DEG2RAD/3600)²
        Wind:      ±3m/s      → σ² = 9
        """
        sigmas = np.array([
            5.0, 5.0, 5.0,                                         # position (m)
            2.0, 2.0, 2.0,                                         # velocity (m/s)
            3.0 * DEG2RAD, 3.0 * DEG2RAD, 3.0 * DEG2RAD,          # attitude (rad)
            0.04 * GRAVITY / 1000, 0.04 * GRAVITY / 1000, 0.04 * GRAVITY / 1000,
            5.0 * DEG2RAD / 3600, 5.0 * DEG2RAD / 3600, 5.0 * DEG2RAD / 3600,
            3.0, 3.0,                                               # wind (m/s)
        ])
        return np.diag(sigmas**2)

    def predict(self, imu: IMUMeasurement, dt: float) -> None:
        """EKF predict step — called every IMU sample (100Hz).

        1. Propagate nominal state
        2. Compute discrete Φ = I + F·dt
        3. Propagate covariance: P = Φ·P·Φᵀ + Q
        4. Enforce symmetry
        """
        # Wind vector from state estimate (EKF's own wind estimate)
        wind = WindVector(
            velocity=np.array([self.nominal.wind[0], self.nominal.wind[1], 0.0]),
            turbulence=np.zeros(3),
        )

        # 1. Propagate nominal
        self.nominal = self.dynamics.propagate(self.nominal, imu, wind, dt)

        # 2. F matrix (continuous) → discrete Φ
        F = self.dynamics.get_F_matrix(self.nominal, imu, wind)
        Phi = np.eye(17) + F * dt

        # 3. Process noise
        Q = self.dynamics.get_Q_matrix(dt)

        # 4. Covariance propagation
        self.P = Phi @ self.P @ Phi.T + Q

        # 5. Enforce symmetry
        self.P = 0.5 * (self.P + self.P.T)

    def update(
        self, observation: CameraObservation, landmark: Landmark
    ) -> float:
        """EKF update step — called per matched landmark.

        Sequential update: one landmark at a time, inject after each.
        Returns NIS value (negative if landmark not visible).
        """
        # 1. Predicted measurement
        z_pred = self.camera.project(landmark.position, self.nominal)
        if z_pred is None:
            return -1.0  # Landmark not in view

        # 2. Innovation
        y = observation.pixel_uv - z_pred

        # 3. Measurement Jacobian H (2×17)
        H = self.camera.get_H_matrix(self.nominal, landmark)
        if H is None:
            return -1.0

        # 4. Innovation covariance
        sigma_px = self.camera.specs.pixel_noise_std
        R = np.diag([sigma_px**2, sigma_px**2])
        S = H @ self.P @ H.T + R  # (2×2)

        # 5. Mahalanobis gating
        S_inv = np.linalg.inv(S)
        nis = float(y @ S_inv @ y)

        if nis > self.config.innovation_gate_chi2:
            self.reject_count += 1
            self.last_nis = nis
            return nis  # Reject — P unchanged

        # 6. Kalman gain K = P·Hᵀ·S⁻¹  (17×2)
        K = self.P @ H.T @ S_inv

        # 7. Error state update
        dx = K @ y  # (17,)
        self.error = ErrorState.from_vector(
            self.error.to_vector() + dx
        )

        # 8. Covariance update — Joseph form for numerical stability
        # P = (I - K·H)·P·(I - K·H)ᵀ + K·R·Kᵀ
        IKH = np.eye(17) - K @ H
        self.P = IKH @ self.P @ IKH.T + K @ R @ K.T

        # Enforce symmetry
        self.P = 0.5 * (self.P + self.P.T)

        # 9. Inject error into nominal + reset
        self._inject_error()

        # 10. Diagnostics
        self.last_nis = nis
        self.update_count += 1

        return nis

    def _inject_error(self) -> None:
        """Inject accumulated error state into nominal + reset.

        p ← p + δp, v ← v + δv, q ← q ⊗ δq(δθ),
        b_a ← b_a + δb_a, b_g ← b_g + δb_g, w ← w + δw

        Then reset δx ← 0, P ← G·P·Gᵀ.
        G[6:9, 6:9] = I - [½δθ]×  (attitude reset Jacobian).
        """
        err = self.error

        # Apply error to nominal
        self.nominal = apply_error_to_nominal(self.nominal, err)

        # Covariance reset with attitude Jacobian
        G = np.eye(17)
        G[6:9, 6:9] = np.eye(3) - skew(0.5 * err.delta_theta)
        self.P = G @ self.P @ G.T

        # Enforce symmetry
        self.P = 0.5 * (self.P + self.P.T)

        # Reset error to zero
        self.error = ErrorState.zeros()

    def containment_update(
        self, observation: CameraObservation, landmark: Landmark,
        cone_radius: float,
    ) -> str:
        """Containment measurement for outer cone layers (Sec 3.5).

        Does NOT fully collapse P. Checks bearing consistency only.
        Returns "consistent", "corrected", or "no_observation".
        """
        z_pred = self.camera.project(landmark.position, self.nominal)
        if z_pred is None:
            return "no_observation"

        H = self.camera.get_H_matrix(self.nominal, landmark)
        if H is None:
            return "no_observation"

        y = observation.pixel_uv - z_pred
        bearing_err = abs(y[0])  # horizontal pixel = bearing

        sigma_px = self.camera.specs.pixel_noise_std
        R = np.diag([sigma_px**2, sigma_px**2])
        S = H @ self.P @ H.T + R
        threshold = 3.0 * np.sqrt(S[0, 0])  # 3-sigma bearing

        if bearing_err < threshold:
            # Consistent — gentle P stabilization (prevent unbounded growth)
            self.P *= 0.995
            self.P = 0.5 * (self.P + self.P.T)
            return "consistent"
        else:
            # Inconsistent — apply capped correction (50% of full Kalman gain)
            S_inv = np.linalg.inv(S)
            K_full = self.P @ H.T @ S_inv
            K_capped = 0.5 * K_full

            dx = K_capped @ y
            self.error = ErrorState.from_vector(self.error.to_vector() + dx)

            # Mild P inflation (uncertainty grew, don't collapse)
            inflate = np.zeros(17)
            inflate[0:3] = 1.0  # position
            inflate[3:6] = 0.5  # velocity
            self.P += 0.2 * np.diag(inflate)
            self.P = 0.5 * (self.P + self.P.T)

            self._inject_error()
            return "corrected"

    def bearing_update(
        self, observation: CameraObservation, landmark: Landmark
    ) -> float:
        """1D bearing update for middle cone layers (Sec 3.5).

        Uses only horizontal pixel (bearing), not vertical (elevation).
        Returns NIS (1D).
        """
        z_pred = self.camera.project(landmark.position, self.nominal)
        if z_pred is None:
            return -1.0

        H_full = self.camera.get_H_matrix(self.nominal, landmark)
        if H_full is None:
            return -1.0

        # 1D: bearing only (horizontal pixel)
        H_1d = H_full[0:1, :]  # (1, 17)
        y_1d = observation.pixel_uv[0] - z_pred[0]  # scalar

        sigma_px = self.camera.specs.pixel_noise_std
        R_1d = np.array([[sigma_px**2]])
        S_1d = H_1d @ self.P @ H_1d.T + R_1d  # (1, 1)

        # NIS (1D)
        nis = float(y_1d**2 / S_1d[0, 0])

        # Gate: χ²₁ at 99% = 6.63
        if nis > 6.63:
            self.reject_count += 1
            self.last_nis = nis
            return nis

        # Kalman gain (17, 1)
        K = self.P @ H_1d.T / S_1d[0, 0]

        # Update
        dx = (K * y_1d).flatten()
        self.error = ErrorState.from_vector(self.error.to_vector() + dx)

        # Joseph form 1D
        IKH = np.eye(17) - K @ H_1d
        self.P = IKH @ self.P @ IKH.T + K @ R_1d @ K.T
        self.P = 0.5 * (self.P + self.P.T)

        self._inject_error()
        self.last_nis = nis
        self.update_count += 1
        return nis

    def heading_update(self, mag_heading: float, sigma_heading: float = 0.05) -> float:
        """1D heading update from magnetometer (optional, Sec 10).

        Returns NIS. Gate: χ²₁ = 6.63 at 99%.
        """
        # Predicted heading from state quaternion
        from core.physics.dynamics._quaternion import quat_to_rotation
        R = quat_to_rotation(self.nominal.quaternion)
        pred_heading = float(np.arctan2(R[1, 0], R[0, 0]))

        y = mag_heading - pred_heading
        # Wrap to [-π, π]
        y = (y + np.pi) % (2 * np.pi) - np.pi

        H = np.zeros((1, 17))
        H[0, 8] = 1.0  # yaw

        R_mag = np.array([[sigma_heading**2]])
        S = H @ self.P @ H.T + R_mag
        nis = float(y**2 / S[0, 0])

        if nis > 6.63:
            self.reject_count += 1
            return nis

        K = self.P @ H.T / S[0, 0]
        dx = (K * y).flatten()
        self.error = ErrorState.from_vector(self.error.to_vector() + dx)

        IKH = np.eye(17) - K @ H
        self.P = IKH @ self.P @ IKH.T + K @ R_mag @ K.T
        self.P = 0.5 * (self.P + self.P.T)

        self._inject_error()
        self.last_nis = nis
        self.update_count += 1
        return nis

    def get_state(self) -> NominalState:
        """Current best estimate (error always injected → nominal is best)."""
        return self.nominal

    def get_covariance(self) -> np.ndarray:
        """Current 17×17 covariance."""
        return self.P.copy()

    def get_position_uncertainty(self) -> np.ndarray:
        """Position standard deviations [σ_N, σ_E, σ_D] in meters."""
        return np.sqrt(np.diag(self.P)[:3])

    def get_attitude_uncertainty(self) -> np.ndarray:
        """Attitude standard deviations [σ_roll, σ_pitch, σ_yaw] in degrees."""
        return np.sqrt(np.diag(self.P)[6:9]) * RAD2DEG

    def reset_filter(
        self, state: NominalState, P: Optional[np.ndarray] = None
    ) -> None:
        """Full reset — new flight."""
        self.nominal = NominalState(
            position=state.position.copy(),
            velocity=state.velocity.copy(),
            quaternion=state.quaternion.copy(),
            accel_bias=state.accel_bias.copy(),
            gyro_bias=state.gyro_bias.copy(),
            wind=state.wind.copy(),
        )
        self.error = ErrorState.zeros()
        self.P = P.copy() if P is not None else self._default_initial_P()
        self.last_nis = 0.0
        self.update_count = 0
        self.reject_count = 0
