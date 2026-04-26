"""Proportional Navigation terminal guidance.

Switches from ConeGuidance when distance < switch_distance.
Uses bearing-only measurement to target — no EKF position needed.

Law: heading_rate = N * bearing_rate

Pure PN (N=3) achieves zero-miss against stationary target in the
absence of noise. With noise, miss ~ sigma_bearing * R / N.
"""

from __future__ import annotations

from typing import Tuple

import numpy as np

from core.physics.types import NominalState, PNConfig


class ProportionalNavGuidance:
    """Proportional Navigation terminal guidance."""

    def __init__(self, config: PNConfig | None = None, seed: int = 42) -> None:
        self.config = config or PNConfig()
        self.active = False
        self.bearing_prev: float | None = None
        self.rate_prev: float = 0.0
        self.t_prev: float | None = None
        self.switch_time: float | None = None
        self.switch_distance: float | None = None
        self.bearing_history: list[dict] = []
        self._rng = np.random.default_rng(seed)

    def should_switch(
        self, estimated_state: NominalState, target: np.ndarray
    ) -> bool:
        """Check if PN should take over from ConeGuidance."""
        if self.active:
            return True

        d = float(np.linalg.norm(estimated_state.position[:2] - target[:2]))
        if d > self.config.switch_distance:
            return False

        # Check bearing within FOV
        bearing = np.arctan2(
            target[1] - estimated_state.position[1],
            target[0] - estimated_state.position[0],
        )
        heading = self._heading_from_quaternion(estimated_state.quaternion)
        off_boresight = abs(self._angle_diff(bearing, heading))
        if off_boresight > self.config.max_off_boresight:
            return False

        speed = float(np.linalg.norm(estimated_state.velocity[:2]))
        if speed < self.config.min_speed:
            return False

        return True

    def activate(
        self, estimated_state: NominalState, target: np.ndarray, t: float
    ) -> None:
        """Switch to PN mode. Record initial bearing."""
        self.active = True
        self.switch_time = t
        self.switch_distance = float(
            np.linalg.norm(estimated_state.position[:2] - target[:2])
        )
        self.bearing_prev = float(
            np.arctan2(
                target[1] - estimated_state.position[1],
                target[0] - estimated_state.position[0],
            )
        )
        self.t_prev = t
        self.rate_prev = 0.0

    def compute(
        self,
        estimated_state: NominalState,
        target: np.ndarray,
        true_state: NominalState,
        t: float,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Compute PN guidance commands.

        Returns (accel_body_cmd, gyro_body_cmd) — same interface
        as SimpleGuidance / ConeGuidance.

        Bearing measured from TRUE state (simulates camera direct
        measurement — the fundamental advantage of PN over EKF-only).
        """
        c = self.config
        dt = t - self.t_prev if self.t_prev is not None else 0.1
        dt = max(dt, 1e-4)

        # 1. Bearing from true state (camera measurement)
        bearing = float(
            np.arctan2(
                target[1] - true_state.position[1],
                target[0] - true_state.position[0],
            )
        )

        # 2. Add bearing noise
        if c.bearing_noise_rad > 0:
            bearing += float(self._rng.normal(0, c.bearing_noise_rad))

        # 3. Bearing rate + low-pass filter
        if self.bearing_prev is not None:
            raw_rate = self._angle_diff(bearing, self.bearing_prev) / dt
            filtered_rate = (
                c.rate_filter_alpha * raw_rate
                + (1 - c.rate_filter_alpha) * self.rate_prev
            )
        else:
            filtered_rate = 0.0

        # 4. PN law: heading_rate = N * bearing_rate
        heading_rate_cmd = c.nav_constant * filtered_rate

        # 5. Clamp turn rate
        heading_rate_cmd = float(
            np.clip(heading_rate_cmd, -c.max_turn_rate, c.max_turn_rate)
        )

        # 6. Speed control (PD on speed error)
        speed = float(np.linalg.norm(estimated_state.velocity[:2]))
        speed_error = c.cruise_speed - speed
        forward_accel = 2.0 * speed_error  # simple P controller

        # 7. Heading vector from estimated state
        heading = self._heading_from_quaternion(estimated_state.quaternion)
        cos_h, sin_h = np.cos(heading), np.sin(heading)

        # 8. Terminal dive
        R_go = float(np.linalg.norm(true_state.position[:2] - target[:2]))
        alt_accel = 0.0
        if R_go < c.terminal_dive_distance:
            # Descend toward target altitude
            true_alt = -true_state.position[2]
            target_alt = -target[2] if len(target) > 2 else true_alt
            alt_error = true_alt - target_alt
            if alt_error > 1.0:
                alt_accel = c.descent_rate  # positive = downward in NED

        # 9. Build body commands
        accel_cmd = np.array([
            forward_accel * cos_h,
            forward_accel * sin_h,
            alt_accel,
        ])
        gyro_cmd = np.array([0.0, 0.0, heading_rate_cmd])

        # 10. Record state
        self.bearing_prev = bearing
        self.rate_prev = filtered_rate
        self.t_prev = t
        self.bearing_history.append({
            "t": t,
            "bearing": bearing,
            "rate": filtered_rate,
            "cmd": heading_rate_cmd,
            "R_go": R_go,
        })

        return accel_cmd, gyro_cmd

    def get_miss_prediction(
        self, estimated_state: NominalState, target: np.ndarray
    ) -> float:
        """Predict terminal miss: sigma * R_go / N."""
        R_go = float(np.linalg.norm(estimated_state.position[:2] - target[:2]))
        return self.config.bearing_noise_rad * R_go / self.config.nav_constant

    def get_time_to_impact(
        self, estimated_state: NominalState, target: np.ndarray
    ) -> float:
        """Estimated time to reach target: R_go / closing_speed."""
        R_go = float(np.linalg.norm(estimated_state.position[:2] - target[:2]))
        speed = float(np.linalg.norm(estimated_state.velocity[:2]))
        if speed < 0.1:
            return float("inf")

        heading = self._heading_from_quaternion(estimated_state.quaternion)
        bearing = np.arctan2(
            target[1] - estimated_state.position[1],
            target[0] - estimated_state.position[0],
        )
        closing = speed * np.cos(bearing - heading)
        if closing < 0.1:
            return float("inf")
        return R_go / closing

    def get_report(self) -> dict:
        """PN phase diagnostics."""
        return {
            "active": self.active,
            "switch_time": self.switch_time,
            "switch_distance": self.switch_distance,
            "bearing_measurements": len(self.bearing_history),
            "total_pn_time": (
                self.bearing_history[-1]["t"] - self.switch_time
                if self.bearing_history and self.switch_time is not None
                else 0
            ),
        }

    @staticmethod
    def _heading_from_quaternion(q: np.ndarray) -> float:
        """Extract yaw heading from quaternion [w,x,y,z]."""
        w, x, y, z = q
        return float(np.arctan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))

    @staticmethod
    def _angle_diff(a: float, b: float) -> float:
        """Signed angle difference, wrapped to [-pi, pi]."""
        d = a - b
        return float((d + np.pi) % (2 * np.pi) - np.pi)
