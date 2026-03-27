"""Magnetometer sensor model — optional heading aiding per document Section 10.

NOT a trusted heading source. Vulnerable to motor EMI.
Updates rejectable by innovation gating. System works without it.
"""

from dataclasses import dataclass, field

import numpy as np

from core.physics.dynamics._quaternion import quat_to_rotation
from core.physics.sensors.base import SensorModel
from core.physics.types import NominalState


@dataclass
class MagSpecs:
    """Magnetometer parameters."""

    earth_field: np.ndarray = field(
        default_factory=lambda: np.array([25.0, 0.0, -40.0])
    )  # μT (typical mid-latitude)
    noise_std_deg: float = 3.0
    hard_iron_std: float = 5.0        # μT
    soft_iron_std: float = 0.02
    motor_emi_amplitude: float = 10.0  # μT
    motor_emi_probability: float = 0.1


@dataclass
class MagMeasurement:
    timestamp: float
    heading: float       # radians
    raw_field: np.ndarray  # [3] body frame μT
    quality: float       # 0-1, low when EMI


class MagnetometerModel(SensorModel):
    """3-axis magnetometer with hard/soft iron distortion and motor EMI."""

    def __init__(self, specs: MagSpecs | None = None, seed: int = 42) -> None:
        self.specs = specs or MagSpecs()
        self.rng = np.random.default_rng(seed)
        # Hard/soft iron (fixed per flight)
        self.hard_iron = self.rng.normal(0, self.specs.hard_iron_std, 3)
        self.soft_iron = np.eye(3) + self.rng.normal(0, self.specs.soft_iron_std, (3, 3))

    def generate(self, true_state: NominalState, t: float) -> MagMeasurement:
        """Generate noisy magnetometer reading."""
        R = quat_to_rotation(true_state.quaternion)

        # Earth field in body frame
        mag_true = R.T @ self.specs.earth_field

        # Apply distortion
        mag_dist = self.soft_iron @ mag_true + self.hard_iron

        # Add base noise
        noise_rad = np.radians(self.specs.noise_std_deg)
        noise = self.rng.normal(0, noise_rad * np.linalg.norm(mag_dist) / 50, 3)
        mag_meas = mag_dist + noise

        # Motor EMI (probabilistic)
        quality = 1.0
        if self.rng.random() < self.specs.motor_emi_probability:
            emi = self.rng.normal(0, self.specs.motor_emi_amplitude, 3)
            mag_meas += emi
            quality = 0.3

        # Extract heading from horizontal components
        heading = float(np.arctan2(mag_meas[1], mag_meas[0]))

        return MagMeasurement(
            timestamp=t,
            heading=heading,
            raw_field=mag_meas,
            quality=quality,
        )

    def get_heading_H_matrix(self, state: NominalState) -> np.ndarray:
        """H matrix for heading measurement (1×17).

        Heading primarily sensitive to yaw (δθ[2] = index 8).
        """
        H = np.zeros((1, 17))
        H[0, 8] = 1.0  # ∂heading/∂yaw ≈ 1
        return H

    def reset(self, seed: int) -> None:
        self.rng = np.random.default_rng(seed)
        self.hard_iron = self.rng.normal(0, self.specs.hard_iron_std, 3)
        self.soft_iron = np.eye(3) + self.rng.normal(0, self.specs.soft_iron_std, (3, 3))
