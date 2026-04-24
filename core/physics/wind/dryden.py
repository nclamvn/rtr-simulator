"""Dryden turbulence model (MIL-HDBK-1797).

Wind = mean_wind (with altitude shear) + Dryden turbulence (filtered white noise).
Optional terrain coupling: rougher terrain → more turbulence.
"""

from __future__ import annotations

from typing import Optional

import numpy as np

from core.physics.terrain.base import TerrainProvider
from core.physics.types import WindConfig, WindVector
from core.physics.wind.base import WindField


class DrydenWindField(WindField):
    """Dryden continuous turbulence model with altitude shear and terrain coupling."""

    def __init__(
        self,
        config: WindConfig | None = None,
        terrain: Optional[TerrainProvider] = None,
        seed: int = 42,
    ) -> None:
        self.config = config or WindConfig()
        self.terrain = terrain
        self.rng = np.random.default_rng(seed)
        # Dryden filter state: [u, u_dot, v, v_dot, w, w_dot]
        self._filter_state = np.zeros(6)
        self._last_t = -1.0

    def get_wind(self, position: np.ndarray, t: float) -> WindVector:
        """Wind at position (NED) and time t.

        Returns WindVector with mean + turbulence split.
        """
        cfg = self.config
        altitude = max(-position[2], 1.0)  # NED: alt = -Z, min 1m

        # ── Mean wind with altitude shear ──
        wind_at_alt = cfg.mean_speed * (altitude / cfg.reference_altitude) ** cfg.shear_exponent

        # Meteorological convention: direction = "from" direction
        # Wind from East (90°) → air moves West → negative East in NED
        dir_rad = np.radians(cfg.mean_direction)
        mean_north = -wind_at_alt * np.cos(dir_rad)
        mean_east = -wind_at_alt * np.sin(dir_rad)
        mean_velocity = np.array([mean_north, mean_east, 0.0])

        # ── Dryden turbulence ──
        if cfg.turbulence_intensity <= 0:
            return WindVector(
                velocity=mean_velocity,
                turbulence=np.zeros(3),
            )

        # Turbulence intensity scaled by altitude
        sigma_base = cfg.turbulence_intensity
        # Below 300m: intensity increases near ground (MIL-HDBK-1797)
        if altitude < 300:
            sigma_h = sigma_base * (0.177 + 0.000823 * altitude) ** (-0.4)
        else:
            sigma_h = sigma_base

        sigma_w = sigma_h * cfg.vertical_turbulence

        # Terrain coupling: rougher terrain → more turbulence
        roughness_factor = 1.0
        if cfg.terrain_coupling and self.terrain is not None:
            try:
                roughness = self.terrain.get_roughness(position[0], position[1])
                roughness_factor = 1.0 + roughness
            except (AttributeError, NotImplementedError):
                pass  # Terrain doesn't support roughness

        sigma_h *= roughness_factor
        sigma_w *= roughness_factor

        # Scale lengths (MIL-HDBK-1797, below 300m)
        if altitude < 300:
            L_u = altitude / (0.177 + 0.000823 * altitude) ** 1.2
        else:
            L_u = 533.0  # constant above 300m
        L_v = L_u / 2.0
        L_w = max(altitude / 2.0, 1.0)

        # ── Discrete Dryden filter ──
        dt = 1.0 / cfg.update_rate
        V = max(wind_at_alt, 1.0)  # Airspeed for filter (use mean wind as proxy)

        # First-order shaping filter for each axis:
        # H(s) = σ * sqrt(2V/πL) / (s + V/L)
        # Discrete: x(k+1) = a * x(k) + b * w(k), y = x
        turb = np.zeros(3)

        # u-axis (longitudinal)
        a_u = np.exp(-V * dt / L_u)
        b_u = sigma_h * np.sqrt(1 - a_u**2)
        self._filter_state[0] = a_u * self._filter_state[0] + b_u * self.rng.standard_normal()
        turb[0] = self._filter_state[0]

        # v-axis (lateral)
        a_v = np.exp(-V * dt / L_v)
        b_v = sigma_h * np.sqrt(1 - a_v**2)
        self._filter_state[2] = a_v * self._filter_state[2] + b_v * self.rng.standard_normal()
        turb[1] = self._filter_state[2]

        # w-axis (vertical)
        a_w = np.exp(-V * dt / L_w)
        b_w = sigma_w * np.sqrt(1 - a_w**2)
        self._filter_state[4] = a_w * self._filter_state[4] + b_w * self.rng.standard_normal()
        turb[2] = self._filter_state[4]

        self._last_t = t

        total_velocity = mean_velocity + turb
        return WindVector(velocity=total_velocity, turbulence=turb)

    def reset(self, seed: int) -> None:
        """Reset RNG + filter state for new Monte Carlo run."""
        self.rng = np.random.default_rng(seed)
        self._filter_state = np.zeros(6)
        self._last_t = -1.0

    # ── Convenience constructors ──

    @classmethod
    def calm(cls, seed: int = 42) -> "DrydenWindField":
        """No wind, no turbulence."""
        return cls(WindConfig(mean_speed=0, turbulence_intensity=0), seed=seed)

    @classmethod
    def light(cls, direction: float = 90, seed: int = 42) -> "DrydenWindField":
        """Light wind 5 m/s, low turbulence."""
        return cls(
            WindConfig(mean_speed=5, mean_direction=direction, turbulence_intensity=0.8),
            seed=seed,
        )

    @classmethod
    def strong(cls, direction: float = 90, seed: int = 42) -> "DrydenWindField":
        """Strong wind 15 m/s, high turbulence."""
        return cls(
            WindConfig(mean_speed=15, mean_direction=direction, turbulence_intensity=3.0),
            seed=seed,
        )

    @classmethod
    def storm(cls, direction: float = 90, seed: int = 42) -> "DrydenWindField":
        """Storm 25 m/s (đề án worst case), extreme turbulence."""
        return cls(
            WindConfig(mean_speed=25, mean_direction=direction, turbulence_intensity=5.0),
            seed=seed,
        )
