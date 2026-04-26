"""Risk-shaped cone policy per document Eq. 2.

r(d) = kσ·σ⊥(d) + kₒ·O(d)⁻¹ + kc·C(d) + km·M(d)

With trumpet extension (Eq. 4) at base for drop uncertainty.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.stats import norm


@dataclass
class ConeRiskConfig:
    """Risk coefficients for shaped cone radius."""

    k_sigma: float = 3.0          # lateral uncertainty weight (3-sigma)
    k_obs: float = 50.0           # observability inverse weight
    k_clutter: float = 20.0       # clutter/occlusion penalty
    k_margin: float = 15.0        # fixed safety margin (meters)
    min_radius: float = 10.0      # minimum cone radius

    # Trumpet (Eq. 4)
    r0: float = 100.0             # HERA position uncertainty (m)
    trumpet_lambda: float = 0.0005
    trumpet_start_distance: float = 12000.0  # from base
    corridor_length: float = 15000.0

    # P_exit target
    p_exit_max: float = 0.01

    # Adaptive widening (runtime EKF uncertainty)
    k_adapt: float = 3.0              # multiplier on EKF σ_lateral
    adapt_max_radius: float = 500.0   # cap: never wider than 500m


class RiskShapedCone:
    """Compute admissible cone radius from risk factors."""

    def __init__(self, config: ConeRiskConfig | None = None) -> None:
        self.config = config or ConeRiskConfig()

    def compute_radius(
        self,
        d: float,
        sigma_lateral: float,
        landmark_density: float,
        terrain_clutter: float,
        ekf_sigma_lateral: float | None = None,
    ) -> float:
        """Admissible radius at distance d from target.

        Args:
            d: distance from target (meters, 0 = at target)
            sigma_lateral: predicted lateral uncertainty (m)
            landmark_density: landmarks per km² at this distance
            terrain_clutter: occlusion/clutter score 0-1
            ekf_sigma_lateral: runtime EKF lateral uncertainty (m).
                If provided, radius is widened to at least
                k_adapt * ekf_sigma_lateral (adaptive floor).
        """
        c = self.config

        sigma_term = c.k_sigma * sigma_lateral
        obs_term = c.k_obs / max(landmark_density, 0.01)
        clutter_term = c.k_clutter * terrain_clutter
        margin_term = c.k_margin

        r = sigma_term + obs_term + clutter_term + margin_term
        r = max(r, c.min_radius)

        # Trumpet extension at base (far from target)
        d_from_base = c.corridor_length - d
        if d_from_base > c.trumpet_start_distance:
            r_trumpet = c.r0 * np.exp(
                -c.trumpet_lambda * (c.corridor_length - d_from_base)
            )
            r += r_trumpet

        # Adaptive floor from runtime EKF uncertainty
        if ekf_sigma_lateral is not None and ekf_sigma_lateral > 0:
            r_adaptive = c.k_adapt * ekf_sigma_lateral
            r = max(r, r_adaptive)
            r = min(r, c.adapt_max_radius)

        return float(r)

    def compute_exit_probability(
        self,
        lateral_error: float,
        sigma_lateral: float,
        radius: float,
    ) -> float:
        """P(exit) = P(||e⊥|| > r). Gaussian 1D per-axis approximation."""
        if sigma_lateral <= 0:
            return 0.0 if lateral_error < radius else 1.0
        return float(2.0 * (1.0 - norm.cdf(radius / sigma_lateral)))

    @classmethod
    def from_heuristic(
        cls, alpha_deg: float = 5.0, corridor_length: float = 15000.0
    ) -> "RiskShapedCone":
        """Phase 1 fallback: approximate r(d) = d·tan(α)."""
        tan_a = np.tan(np.radians(alpha_deg))
        # Set k_sigma such that at typical sigma, r ≈ d*tan(α) at d=5000m
        # With sigma ≈ 50m at 5km: k_sigma*50 + ... ≈ 5000*tan(5°) ≈ 437m
        # k_sigma ≈ 8
        cfg = ConeRiskConfig(
            k_sigma=8.0,
            k_obs=10.0,
            k_clutter=5.0,
            k_margin=10.0,
            corridor_length=corridor_length,
        )
        return cls(cfg)
