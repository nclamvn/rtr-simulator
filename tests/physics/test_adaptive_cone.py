"""Tests for Adaptive Cone Widening (TIP-ACW).

Verifies that cone radius adapts to EKF uncertainty at runtime,
preventing false OUT status when the drone's position uncertainty
exceeds the geometric cone radius.
"""

import numpy as np
import pytest

from core.physics.landmark.cone_policy import ConeRiskConfig, RiskShapedCone


class TestAdaptiveRadius:
    def test_adaptive_wider_than_geometric(self) -> None:
        """When EKF sigma is large, adaptive radius > geometric."""
        policy = RiskShapedCone(ConeRiskConfig(k_adapt=3.0))
        r_geo = policy.compute_radius(
            d=100, sigma_lateral=5, landmark_density=10, terrain_clutter=0.1,
        )
        r_adapt = policy.compute_radius(
            d=100, sigma_lateral=5, landmark_density=10, terrain_clutter=0.1,
            ekf_sigma_lateral=80,
        )
        assert r_adapt >= 3.0 * 80  # At least 3-sigma
        assert r_adapt > r_geo

    def test_geometric_when_ekf_tight(self) -> None:
        """When EKF sigma is small, geometric radius used (no widening)."""
        policy = RiskShapedCone(ConeRiskConfig(k_adapt=3.0))
        r_geo = policy.compute_radius(
            d=5000, sigma_lateral=50, landmark_density=2, terrain_clutter=0.2,
        )
        r_adapt = policy.compute_radius(
            d=5000, sigma_lateral=50, landmark_density=2, terrain_clutter=0.2,
            ekf_sigma_lateral=5,
        )
        # 3*5=15 < r_geo, so geometric wins
        assert r_adapt == r_geo

    def test_adaptive_capped(self) -> None:
        """Adaptive radius capped at adapt_max_radius."""
        policy = RiskShapedCone(ConeRiskConfig(k_adapt=3.0, adapt_max_radius=500))
        r = policy.compute_radius(
            d=50, sigma_lateral=5, landmark_density=10, terrain_clutter=0.1,
            ekf_sigma_lateral=200,
        )
        assert r <= 500  # Capped at max

    def test_backward_compatible_no_ekf_sigma(self) -> None:
        """Without ekf_sigma_lateral, behaves exactly as before."""
        policy = RiskShapedCone(ConeRiskConfig())
        r1 = policy.compute_radius(
            d=1000, sigma_lateral=30, landmark_density=5, terrain_clutter=0.2,
        )
        r2 = policy.compute_radius(
            d=1000, sigma_lateral=30, landmark_density=5, terrain_clutter=0.2,
            ekf_sigma_lateral=None,
        )
        assert r1 == r2

    def test_backward_compatible_zero_sigma(self) -> None:
        """ekf_sigma_lateral=0 has no effect (same as None)."""
        policy = RiskShapedCone(ConeRiskConfig())
        r1 = policy.compute_radius(
            d=1000, sigma_lateral=30, landmark_density=5, terrain_clutter=0.2,
        )
        r2 = policy.compute_radius(
            d=1000, sigma_lateral=30, landmark_density=5, terrain_clutter=0.2,
            ekf_sigma_lateral=0,
        )
        assert r1 == r2

    def test_drone_stays_in_with_adaptation(self) -> None:
        """Drone with 202m drift stays IN with adaptive cone (screenshot scenario)."""
        policy = RiskShapedCone(ConeRiskConfig(k_adapt=3.0))
        # sigma_lateral = sqrt(65.4² + 51.8²) ≈ 83.4
        sigma_lateral = np.sqrt(65.4**2 + 51.8**2)
        r = policy.compute_radius(
            d=200, sigma_lateral=5, landmark_density=10, terrain_clutter=0.1,
            ekf_sigma_lateral=sigma_lateral,
        )
        lateral_error = 202
        margin = r - lateral_error
        assert r >= 3 * sigma_lateral  # At least 3-sigma ≈ 250m
        assert margin > 0  # Drone is INSIDE adapted cone

    def test_k_adapt_configurable(self) -> None:
        """Different k_adapt values produce different radii."""
        cfg_2 = ConeRiskConfig(k_adapt=2.0)
        cfg_4 = ConeRiskConfig(k_adapt=4.0)
        p2 = RiskShapedCone(cfg_2)
        p4 = RiskShapedCone(cfg_4)
        r2 = p2.compute_radius(d=100, sigma_lateral=1, landmark_density=10,
                               terrain_clutter=0.1, ekf_sigma_lateral=80)
        r4 = p4.compute_radius(d=100, sigma_lateral=1, landmark_density=10,
                               terrain_clutter=0.1, ekf_sigma_lateral=80)
        assert r4 > r2
        assert r2 >= 2.0 * 80
        assert r4 >= 4.0 * 80

    def test_min_radius_still_enforced(self) -> None:
        """min_radius still applies even without adaptation."""
        policy = RiskShapedCone(ConeRiskConfig(min_radius=20, k_adapt=3.0))
        r = policy.compute_radius(
            d=100, sigma_lateral=0.01, landmark_density=1000, terrain_clutter=0,
            ekf_sigma_lateral=1,  # 3*1=3 < min_radius=20
        )
        assert r >= 20

    def test_exit_probability_unchanged(self) -> None:
        """compute_exit_probability still works correctly."""
        policy = RiskShapedCone(ConeRiskConfig())
        p = policy.compute_exit_probability(10, 50, 200)
        assert 0 <= p <= 1
        assert p < 0.05
