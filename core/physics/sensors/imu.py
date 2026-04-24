"""IMU sensor model — generates noisy accel + gyro from true state.

Noise model per đề án 2.2.3 (A-SENSOR):
- Bias: constant offset (drawn at init, random per Monte Carlo run)
- Random walk: white noise
- Quantization: discretize to ADC resolution
- Saturation: clip to sensor range
- Vibration: additional noise from propeller
"""

from __future__ import annotations

import numpy as np

from core.physics.sensors.base import SensorModel
from core.physics.types import (
    GRAVITY,
    DEG2RAD,
    IMUMeasurement,
    IMUSpecs,
    NominalState,
)


class IMUModel(SensorModel):
    """IMU model with bias, random walk, quantization, saturation, vibration."""

    def __init__(self, specs: IMUSpecs | None = None, seed: int = 42) -> None:
        self.specs = specs or IMUSpecs()
        self.rng = np.random.default_rng(seed)

        s = self.specs
        # Draw initial biases (fixed per flight, random per Monte Carlo run)
        # accel_bias_instability in mg → m/s²
        sigma_ba = s.accel_bias_instability * GRAVITY / 1000.0
        self.accel_bias_true = self.rng.normal(0.0, sigma_ba, 3)

        # gyro_bias_instability in deg/hr → rad/s
        sigma_bg = s.gyro_bias_instability * DEG2RAD / 3600.0
        self.gyro_bias_true = self.rng.normal(0.0, sigma_bg, 3)

        # Precompute LSB for quantization
        self._accel_lsb = 2.0 * s.accel_range * GRAVITY / (2**s.adc_bits)
        self._gyro_lsb = 2.0 * s.gyro_range * DEG2RAD / (2**s.adc_bits)

        # Precompute noise standard deviations per sample
        dt = 1.0 / s.sample_rate
        self._sigma_accel_noise = s.accel_random_walk / np.sqrt(dt)
        self._sigma_gyro_noise = s.gyro_random_walk * DEG2RAD / np.sqrt(dt)

    def generate(self, true_state: NominalState, t: float) -> IMUMeasurement:
        """Generate noisy IMU from true state.

        For full simulation use generate_from_body() which accepts
        the true body-frame accel/gyro directly.
        """
        # Simplified: compute body accel as R^T * (gravity) for hover-like
        # Full usage: TrajectorySimulator calls generate_from_body()
        from core.physics.dynamics._quaternion import quat_to_rotation

        R = quat_to_rotation(true_state.quaternion)
        # In hover, body-frame specific force = R^T * (-gravity)
        # This is approximate — generate_from_body() is the correct interface
        accel_body_true = R.T @ (-self._gravity_ned())
        gyro_body_true = np.zeros(3)
        return self.generate_from_body(accel_body_true, gyro_body_true, t)

    def generate_from_body(
        self,
        accel_body_true: np.ndarray,
        gyro_body_true: np.ndarray,
        t: float,
    ) -> IMUMeasurement:
        """Generate noisy IMU measurement from true body-frame values.

        Primary interface for TrajectorySimulator.

        a_measured = accel_body_true + bias + noise + vibration
        ω_measured = gyro_body_true + bias + noise
        Then quantize, then saturate.
        """
        s = self.specs

        # Accel: true + bias + random walk noise + vibration
        n_accel = self.rng.normal(0.0, self._sigma_accel_noise, 3)
        n_vib = self.rng.normal(0.0, s.vibration_psd, 3)
        accel_raw = accel_body_true + self.accel_bias_true + n_accel + n_vib

        # Gyro: true + bias + random walk noise
        n_gyro = self.rng.normal(0.0, self._sigma_gyro_noise, 3)
        gyro_raw = gyro_body_true + self.gyro_bias_true + n_gyro

        # Quantize
        accel_q = np.round(accel_raw / self._accel_lsb) * self._accel_lsb
        gyro_q = np.round(gyro_raw / self._gyro_lsb) * self._gyro_lsb

        # Saturate
        accel_max = s.accel_range * GRAVITY
        gyro_max = s.gyro_range * DEG2RAD
        accel_sat = np.clip(accel_q, -accel_max, accel_max)
        gyro_sat = np.clip(gyro_q, -gyro_max, gyro_max)

        return IMUMeasurement(
            timestamp=t,
            accel=accel_sat,
            gyro=gyro_sat,
        )

    def reset(self, seed: int) -> None:
        """Reset RNG and redraw biases for new Monte Carlo run."""
        self.rng = np.random.default_rng(seed)
        s = self.specs
        sigma_ba = s.accel_bias_instability * GRAVITY / 1000.0
        self.accel_bias_true = self.rng.normal(0.0, sigma_ba, 3)
        sigma_bg = s.gyro_bias_instability * DEG2RAD / 3600.0
        self.gyro_bias_true = self.rng.normal(0.0, sigma_bg, 3)

    @staticmethod
    def _gravity_ned() -> np.ndarray:
        return np.array([0.0, 0.0, GRAVITY])
