"""Camera sensor model — pinhole projection, observation, H matrix.

Per đề án 2.6 — camera observation model for landmark-based navigation.
"""

import logging
from typing import Optional

import numpy as np

from core.physics.dynamics._quaternion import quat_to_rotation, skew
from core.physics.sensors.base import SensorModel
from core.physics.terrain.base import TerrainProvider
from core.physics.types import (
    CameraFrame,
    CameraObservation,
    CameraSpecs,
    Landmark,
    NominalState,
)

logger = logging.getLogger(__name__)


class CameraModel(SensorModel):
    """Camera model with pinhole projection, probabilistic detection, H matrix."""

    def __init__(self, specs: CameraSpecs | None = None, seed: int = 42) -> None:
        self.specs = specs or CameraSpecs()
        self.K = self.specs.intrinsics.copy()
        self.T_cam_imu = self.specs.extrinsics.copy()
        self.R_cam_imu = self.T_cam_imu[:3, :3]
        self.t_cam_imu = self.T_cam_imu[:3, 3]
        self.width, self.height = self.specs.resolution
        self.rng = np.random.default_rng(seed)

    def project(
        self, landmark_world: np.ndarray, drone_state: NominalState
    ) -> Optional[np.ndarray]:
        """Project world landmark to pixel coordinates.

        Per đề án 2.6.1:
        h(x, L) = π(R_cam_imu · R_body_ned^T · (L - p))

        Returns [u, v] or None if behind camera or out of frame.
        """
        R_body_ned = quat_to_rotation(drone_state.quaternion)

        # Landmark in body frame
        delta_ned = landmark_world - drone_state.position
        delta_body = R_body_ned.T @ delta_ned

        # Body to camera frame
        p_cam = self.R_cam_imu @ delta_body + self.t_cam_imu

        # Behind camera check
        if p_cam[2] <= 0:
            return None

        # Pinhole projection
        uv_h = self.K @ (p_cam / p_cam[2])
        u, v = uv_h[0], uv_h[1]

        # Frame bounds check
        if u < 0 or u >= self.width or v < 0 or v >= self.height:
            return None

        return np.array([u, v])

    def generate(self, true_state: NominalState, t: float) -> CameraFrame:
        """Not used directly — use observe_landmarks()."""
        return CameraFrame(timestamp=t, observations=[])

    def observe_landmarks(
        self,
        true_state: NominalState,
        landmarks: list,
        terrain: TerrainProvider,
        t: float,
    ) -> CameraFrame:
        """Generate camera observations of visible landmarks.

        For each landmark:
        1. Project to pixel
        2. Check LOS via terrain
        3. Compute P_useful = P_detectable * P_matchable
        4. Roll dice: skip if miss
        5. Add pixel noise + descriptor noise
        """
        observations: list[CameraObservation] = []
        specs = self.specs

        for lm in landmarks:
            # 1. Project
            uv_true = self.project(lm.position, true_state)
            if uv_true is None:
                continue

            # 2. LOS check
            los = terrain.check_los(true_state.position, lm.position)
            if not los.visible:
                continue

            # 3. P_useful = P_detectable * P_matchable
            dist = np.linalg.norm(lm.position - true_state.position)

            # P_detectable: based on apparent size in pixels
            if dist > 0:
                n_pixels = (specs.landmark_size / dist) * self.K[0, 0]
            else:
                n_pixels = 1000.0
            p_detectable = _sigmoid(n_pixels - 20.0, k=0.5)

            # P_matchable: based on viewing angle (simplified — assume good angle)
            # Full implementation would compare current vs reference viewing angle
            p_matchable = 0.9

            p_useful = p_detectable * p_matchable

            # 4. Roll dice
            if self.rng.random() > p_useful:
                continue

            # 5. Add pixel noise
            noise_uv = self.rng.normal(0.0, specs.pixel_noise_std, 2)
            uv_noisy = uv_true + noise_uv
            # Clip to frame
            uv_noisy[0] = np.clip(uv_noisy[0], 0, self.width - 1)
            uv_noisy[1] = np.clip(uv_noisy[1], 0, self.height - 1)

            # Descriptor noise: flip random bits
            desc = lm.descriptor.copy()
            if desc.size > 0:
                n_flip = self.rng.poisson(5)  # ~5 bits flipped out of 256
                n_flip = min(n_flip, desc.size * 8)
                for _ in range(n_flip):
                    byte_idx = self.rng.integers(0, desc.size)
                    bit_idx = self.rng.integers(0, 8)
                    desc[byte_idx] ^= 1 << bit_idx

            observations.append(
                CameraObservation(
                    timestamp=t,
                    landmark_id=lm.id,
                    pixel_uv=uv_noisy,
                    descriptor=desc,
                )
            )

        return CameraFrame(timestamp=t, observations=observations)

    def get_H_matrix(
        self, state: NominalState, landmark: Landmark
    ) -> Optional[np.ndarray]:
        """Measurement Jacobian H (2×17) for EKF update.

        H = ∂h/∂δx = J_proj · J_state

        J_proj = ∂π/∂p_cam (2×3)
        J_state = ∂p_cam/∂δx (3×17)

        Returns (2, 17) or None if landmark not in view.
        """
        R_body_ned = quat_to_rotation(state.quaternion)

        # Landmark in body frame
        delta_ned = landmark.position - state.position
        delta_body = R_body_ned.T @ delta_ned

        # Body to camera
        p_cam = self.R_cam_imu @ delta_body + self.t_cam_imu

        if p_cam[2] <= 0:
            return None

        X, Y, Z = p_cam
        fx = self.K[0, 0]
        fy = self.K[1, 1]

        # J_proj: ∂π/∂p_cam (2×3) — pinhole projection Jacobian
        J_proj = np.array([
            [fx / Z, 0.0, -fx * X / Z**2],
            [0.0, fy / Z, -fy * Y / Z**2],
        ])

        # J_state: ∂p_cam/∂δx (3×17)
        # p_cam = R_ci · R_bn^T · (L - p) + t_ci
        # ∂p_cam/∂δp = -R_ci · R_bn^T                         (3×3)
        # ∂p_cam/∂δv = 0                                       (3×3)
        # ∂p_cam/∂δθ = R_ci · [R_bn^T · (L - p)]×             (3×3)
        #   (skew of the body-frame vector)
        # ∂p_cam/∂δba = 0, ∂p_cam/∂δbg = 0, ∂p_cam/∂δw = 0

        J_state = np.zeros((3, 17))

        # Position block: ∂p_cam/∂δp = -R_ci · R_bn^T
        J_state[:, 0:3] = -self.R_cam_imu @ R_body_ned.T

        # Velocity block: 0
        # J_state[:, 3:6] = 0  (already zeros)

        # Attitude block: ∂p_cam/∂δθ = R_ci · [delta_body]×
        J_state[:, 6:9] = self.R_cam_imu @ skew(delta_body)

        # H = J_proj · J_state  (2×3) · (3×17) = (2×17)
        H = J_proj @ J_state

        return H

    def reset(self, seed: int) -> None:
        """Reset RNG for new Monte Carlo run."""
        self.rng = np.random.default_rng(seed)


def _sigmoid(x: float, k: float = 1.0) -> float:
    """Sigmoid function clamped to [0, 1]."""
    return 1.0 / (1.0 + np.exp(-k * x))
