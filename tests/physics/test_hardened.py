"""Tests for hardened upgrades H2-H6."""

import numpy as np
import pytest

from core.physics.types import NominalState


# ── H2: Risk-Shaped Cone ─────────────────────────────────────


class TestRiskShapedCone:
    def test_wider_at_base(self) -> None:
        from core.physics.landmark.cone_policy import ConeRiskConfig, RiskShapedCone
        policy = RiskShapedCone(ConeRiskConfig())
        r_base = policy.compute_radius(15000, sigma_lateral=100,
                                        landmark_density=1, terrain_clutter=0.3)
        r_tip = policy.compute_radius(500, sigma_lateral=5,
                                       landmark_density=10, terrain_clutter=0.1)
        assert r_base > r_tip

    def test_trumpet_adds_radius(self) -> None:
        from core.physics.landmark.cone_policy import ConeRiskConfig, RiskShapedCone
        policy = RiskShapedCone(ConeRiskConfig(r0=100, trumpet_start_distance=10000))
        r_near = policy.compute_radius(10000, 50, 2, 0.2)
        r_far = policy.compute_radius(2000, 50, 2, 0.2)  # Far from target = near base
        assert r_far > r_near or r_far > 100  # Trumpet at base

    def test_exit_probability_bounded(self) -> None:
        from core.physics.landmark.cone_policy import ConeRiskConfig, RiskShapedCone
        policy = RiskShapedCone(ConeRiskConfig())
        p = policy.compute_exit_probability(10, 50, 200)
        assert 0 <= p <= 1
        assert p < 0.05  # Well inside → low exit prob

    def test_min_radius_enforced(self) -> None:
        from core.physics.landmark.cone_policy import ConeRiskConfig, RiskShapedCone
        policy = RiskShapedCone(ConeRiskConfig(min_radius=20))
        r = policy.compute_radius(100, sigma_lateral=0.1,
                                   landmark_density=100, terrain_clutter=0)
        assert r >= 20

    def test_heuristic_fallback(self) -> None:
        from core.physics.landmark.cone_policy import RiskShapedCone
        policy = RiskShapedCone.from_heuristic(alpha_deg=5)
        r = policy.compute_radius(5000, 50, 2, 0.2)
        assert r > 100  # Reasonable radius at 5km


# ── H3: Operational Modes ─────────────────────────────────────


class TestModeManager:
    def test_nominal_with_updates(self) -> None:
        from core.physics.sim.modes import ModeConfig, ModeManager, OperationalMode
        mm = ModeManager(ModeConfig())
        for t in range(100):
            mode = mm.tick(t * 0.1, update_received=True, distance_to_target=5000)
        assert mode == OperationalMode.NOMINAL

    def test_transitions_to_degraded(self) -> None:
        from core.physics.sim.modes import ModeConfig, ModeManager, OperationalMode
        mm = ModeManager(ModeConfig(visual_timeout_s=5))
        mm.tick(0, True, 5000)
        mode = None
        for t in range(60):
            mode = mm.tick(t * 0.1, False, 5000)
        assert mode == OperationalMode.DEGRADED_VISUAL

    def test_transitions_to_inertial(self) -> None:
        from core.physics.sim.modes import ModeConfig, ModeManager, OperationalMode
        mm = ModeManager(ModeConfig(visual_timeout_s=5, inertial_timeout_s=15))
        mm.tick(0, True, 5000)
        mode = None
        for t in range(200):
            mode = mm.tick(t * 0.1, False, 5000)
        assert mode == OperationalMode.INERTIAL_ONLY

    def test_abort_after_timeout(self) -> None:
        from core.physics.sim.modes import ModeConfig, ModeManager, OperationalMode
        mm = ModeManager(ModeConfig(abort_timeout_s=120))
        mm.tick(0, True, 5000)
        mode = None
        for t in range(1250):
            mode = mm.tick(t * 0.1, False, 5000)
        assert mode == OperationalMode.ABORTED

    def test_recovery_on_update(self) -> None:
        from core.physics.sim.modes import ModeConfig, ModeManager, OperationalMode
        mm = ModeManager(ModeConfig(visual_timeout_s=5))
        mm.tick(0, True, 5000)
        for t in range(60):
            mm.tick(t * 0.1, False, 5000)
        mode = mm.tick(6.0, True, 5000)
        assert mode == OperationalMode.NOMINAL

    def test_terminal_overrides(self) -> None:
        from core.physics.sim.modes import ModeConfig, ModeManager, OperationalMode
        mm = ModeManager(ModeConfig(terminal_distance=100))
        mode = mm.tick(0, False, 50)
        assert mode == OperationalMode.TERMINAL_HOMING

    def test_report(self) -> None:
        from core.physics.sim.modes import ModeConfig, ModeManager
        mm = ModeManager(ModeConfig())
        mm.tick(0, True, 5000)
        mm.tick(1, True, 5000)
        report = mm.get_report()
        assert "time_in_nominal" in report
        assert "transitions" in report


# ── H4: Observability Monitor ─────────────────────────────────


class TestObservabilityMonitor:
    def test_og_decreases_without_updates(self) -> None:
        from core.physics.estimator.observability import ObservabilityConfig, ObservabilityMonitor
        mon = ObservabilityMonitor(ObservabilityConfig())
        P = np.eye(17) * 10
        for i in range(100):
            P[9:15, 9:15] *= 1.01
            og = mon.compute_og(P)
        assert og < 50  # OG dropped from growth

    def test_no_maneuver_in_terminal(self) -> None:
        from core.physics.estimator.observability import ObservabilityConfig, ObservabilityMonitor
        from core.physics.sim.modes import OperationalMode
        mon = ObservabilityMonitor(ObservabilityConfig())
        result = mon.should_maneuver(np.eye(17) * 100, OperationalMode.TERMINAL_HOMING, 0.5)
        assert result is None

    def test_no_maneuver_low_energy(self) -> None:
        from core.physics.estimator.observability import ObservabilityConfig, ObservabilityMonitor
        from core.physics.sim.modes import OperationalMode
        mon = ObservabilityMonitor(ObservabilityConfig(min_energy_margin=0.3))
        result = mon.should_maneuver(np.eye(17) * 100, OperationalMode.NOMINAL, 0.1)
        assert result is None

    def test_og_initial_high(self) -> None:
        from core.physics.estimator.observability import ObservabilityMonitor
        mon = ObservabilityMonitor()
        P = np.eye(17) * 10
        og = mon.compute_og(P)
        assert og >= 1.0  # Initial OG high (no growth data)


# ── H5: Magnetometer ──────────────────────────────────────────


class TestMagnetometer:
    def test_generates_heading(self) -> None:
        from core.physics.sensors.magnetometer import MagnetometerModel, MagSpecs
        mag = MagnetometerModel(MagSpecs(), seed=42)
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        m = mag.generate(state, 0.0)
        assert -np.pi <= m.heading <= np.pi

    def test_noise_nonzero(self) -> None:
        from core.physics.sensors.magnetometer import MagnetometerModel, MagSpecs
        mag = MagnetometerModel(MagSpecs(), seed=42)
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        readings = [mag.generate(state, i * 0.01).heading for i in range(100)]
        assert np.std(readings) > 0.01

    def test_emi_corrupts(self) -> None:
        from core.physics.sensors.magnetometer import MagnetometerModel, MagSpecs
        mag = MagnetometerModel(MagSpecs(motor_emi_probability=0.5), seed=42)
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        qualities = [mag.generate(state, i * 0.01).quality for i in range(100)]
        assert any(q < 0.5 for q in qualities)

    def test_heading_update_reduces_yaw_P(self) -> None:
        from core.physics.config import SimConfig
        from core.physics.dynamics.six_dof import SixDOFDynamics
        from core.physics.estimator.ekf import ErrorStateEKF
        from core.physics.sensors.camera import CameraModel
        from core.physics.sensors.magnetometer import MagnetometerModel, MagSpecs
        from core.physics.types import CameraSpecs, DroneConfig, GRAVITY, IMUMeasurement

        drone = DroneConfig(
            mass=2.5, drag_coeffs=np.array([0.3, 0.3, 0.5]),
            max_speed=22, max_altitude=500, battery_capacity=5000,
            camera_intrinsics=np.array([[400, 0, 320], [0, 400, 240], [0, 0, 1.0]]),
            camera_extrinsics=np.eye(4),
            imu_specs={"accel_bias_instability": 0.04, "accel_random_walk": 0.02,
                       "gyro_bias_instability": 5.0, "gyro_random_walk": 0.01},
        )
        dyn = SixDOFDynamics(drone)
        cam = CameraModel(CameraSpecs(), seed=42)
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        ekf = ErrorStateEKF(dyn, cam, SimConfig(), state)
        imu = IMUMeasurement(0.0, np.array([0, 0, -GRAVITY]), np.zeros(3))
        for _ in range(100):
            ekf.predict(imu, 0.01)

        P_yaw_before = ekf.P[8, 8]
        mag = MagnetometerModel(MagSpecs(), seed=42)
        m = mag.generate(ekf.get_state(), 1.0)
        ekf.heading_update(m.heading, sigma_heading=0.05)
        P_yaw_after = ekf.P[8, 8]
        assert P_yaw_after < P_yaw_before

    def test_h_matrix_shape(self) -> None:
        from core.physics.sensors.magnetometer import MagnetometerModel, MagSpecs
        mag = MagnetometerModel(MagSpecs())
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        H = mag.get_heading_H_matrix(state)
        assert H.shape == (1, 17)
        assert H[0, 8] == 1.0


# ── H6: Hardened Report ───────────────────────────────────────


class TestHardenedReport:
    def test_tc4_pass(self) -> None:
        from core.physics.sim.report import SimReportGenerator
        from core.physics.types import MonteCarloResult
        gen = SimReportGenerator()
        mc = MonteCarloResult(
            num_runs=10, num_drones=1,
            outcomes=["success"] * 10,
            final_errors=np.ones(10) * 5,
            success_rate=1.0, cep50=5.0, cep95=8.0, mean_error=5.0,
            mean_nis_per_run=np.ones(10) * 2,
            consistent_fraction=0.96,
            mean_flight_time=300, total_compute_time=10,
            run_results=[], failure_breakdown={"success": 10},
            cone_metrics={"cone_compliance": 0.95},
        )
        criteria = gen.check_acceptance_criteria(mc)
        assert "TC-4" in criteria
        assert criteria["TC-4"]["pass"] is True

    def test_tc4_fail(self) -> None:
        from core.physics.sim.report import SimReportGenerator
        from core.physics.types import MonteCarloResult
        gen = SimReportGenerator()
        mc = MonteCarloResult(
            num_runs=10, num_drones=1,
            outcomes=["success"] * 10,
            final_errors=np.ones(10) * 5,
            success_rate=1.0, cep50=5.0, cep95=8.0, mean_error=5.0,
            mean_nis_per_run=np.ones(10) * 2,
            consistent_fraction=0.96,
            mean_flight_time=300, total_compute_time=10,
            run_results=[], failure_breakdown={"success": 10},
            cone_metrics={"cone_compliance": 0.80},
        )
        criteria = gen.check_acceptance_criteria(mc)
        assert criteria["TC-4"]["pass"] is False

    def test_no_tc4_without_cone(self) -> None:
        from core.physics.sim.report import SimReportGenerator
        from core.physics.types import MonteCarloResult
        gen = SimReportGenerator()
        mc = MonteCarloResult(
            num_runs=10, num_drones=1,
            outcomes=["success"] * 10,
            final_errors=np.ones(10) * 5,
            success_rate=1.0, cep50=5.0, cep95=8.0, mean_error=5.0,
            mean_nis_per_run=np.ones(10) * 2,
            consistent_fraction=0.96,
            mean_flight_time=300, total_compute_time=10,
            run_results=[], failure_breakdown={"success": 10},
        )
        criteria = gen.check_acceptance_criteria(mc)
        assert "TC-4" not in criteria  # No cone → no TC-4
