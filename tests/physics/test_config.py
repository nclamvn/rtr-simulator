"""Tests for SimConfig."""

from core.physics.config import SimConfig


class TestSimConfig:
    def test_default_values(self) -> None:
        cfg = SimConfig()
        assert cfg.ekf_dim == 17
        assert cfg.imu_rate_hz == 100.0
        assert cfg.camera_rate_hz == 10.0
        assert cfg.monte_carlo_runs == 1000
        assert cfg.sim_duration_max == 600.0

    def test_innovation_gate(self) -> None:
        cfg = SimConfig()
        assert cfg.innovation_gate_chi2 == 9.21

    def test_n_drone_support(self) -> None:
        cfg = SimConfig(num_drones=5)
        assert cfg.num_drones == 5
        assert cfg.drone_configs == []

    def test_custom_values(self) -> None:
        cfg = SimConfig(
            imu_rate_hz=200.0,
            camera_rate_hz=30.0,
            lowe_ratio=0.8,
            target_radius=10.0,
        )
        assert cfg.imu_rate_hz == 200.0
        assert cfg.camera_rate_hz == 30.0
        assert cfg.lowe_ratio == 0.8
        assert cfg.target_radius == 10.0

    def test_random_seed(self) -> None:
        cfg = SimConfig()
        assert cfg.random_seed == 42
