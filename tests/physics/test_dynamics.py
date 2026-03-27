"""Tests for 6DOF dynamics model.

Includes:
- Physical behavior tests (hover, free fall, forward flight, wind)
- Quaternion normalization preservation
- F matrix shape + numerical verification
- Q matrix symmetry + PSD
"""

import numpy as np
import pytest

from core.physics.dynamics._helpers import apply_error_to_nominal, nominal_difference
from core.physics.dynamics.six_dof import SixDOFDynamics
from core.physics.types import (
    DEG2RAD,
    GRAVITY,
    DroneConfig,
    ErrorState,
    IMUMeasurement,
    NominalState,
    WindVector,
)


# ── Fixtures ──────────────────────────────────────────────────


@pytest.fixture
def zero_wind() -> WindVector:
    return WindVector(velocity=np.zeros(3), turbulence=np.zeros(3))


@pytest.fixture
def hover_imu() -> IMUMeasurement:
    """IMU reading for stationary hover: accel = [0, 0, -g] in body frame."""
    return IMUMeasurement(
        timestamp=0.0,
        accel=np.array([0.0, 0.0, -GRAVITY]),
        gyro=np.zeros(3),
    )


@pytest.fixture
def dynamics(sample_drone: DroneConfig) -> SixDOFDynamics:
    return SixDOFDynamics(sample_drone)


# ── Physical Behavior Tests ───────────────────────────────────


class TestStationaryHover:
    def test_position_drift(
        self, dynamics: SixDOFDynamics, default_state: NominalState,
        hover_imu: IMUMeasurement, zero_wind: WindVector,
    ) -> None:
        """Hovering drone: position drift < 1cm after 1 second."""
        state = default_state
        for _ in range(100):
            state = dynamics.propagate(state, hover_imu, zero_wind, 0.01)
        assert np.linalg.norm(state.position) < 0.01

    def test_velocity_near_zero(
        self, dynamics: SixDOFDynamics, default_state: NominalState,
        hover_imu: IMUMeasurement, zero_wind: WindVector,
    ) -> None:
        """Hovering drone: velocity stays near zero."""
        state = default_state
        for _ in range(100):
            state = dynamics.propagate(state, hover_imu, zero_wind, 0.01)
        assert np.linalg.norm(state.velocity) < 0.01


class TestFreeFall:
    def test_vertical_velocity(
        self, zero_wind: WindVector, sample_drone: DroneConfig,
    ) -> None:
        """No thrust: v_z approaches g (drag slows it below ideal)."""
        # Use zero drag for clean test
        no_drag_drone = DroneConfig(
            mass=sample_drone.mass, drag_coeffs=np.zeros(3),
            max_speed=sample_drone.max_speed, max_altitude=sample_drone.max_altitude,
            battery_capacity=sample_drone.battery_capacity,
            camera_intrinsics=sample_drone.camera_intrinsics,
            camera_extrinsics=sample_drone.camera_extrinsics,
            imu_specs=sample_drone.imu_specs, name="no-drag",
        )
        dyn = SixDOFDynamics(no_drag_drone)
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        no_thrust = IMUMeasurement(0.0, np.zeros(3), np.zeros(3))
        for _ in range(100):
            state = dyn.propagate(state, no_thrust, zero_wind, 0.01)
        # After 1s free fall without drag: v_z ≈ 9.81 m/s
        assert state.velocity[2] == pytest.approx(GRAVITY, abs=0.01)

    def test_vertical_position(
        self, zero_wind: WindVector, sample_drone: DroneConfig,
    ) -> None:
        """No thrust, no drag: z ≈ ½gt² after 1 second."""
        no_drag_drone = DroneConfig(
            mass=sample_drone.mass, drag_coeffs=np.zeros(3),
            max_speed=sample_drone.max_speed, max_altitude=sample_drone.max_altitude,
            battery_capacity=sample_drone.battery_capacity,
            camera_intrinsics=sample_drone.camera_intrinsics,
            camera_extrinsics=sample_drone.camera_extrinsics,
            imu_specs=sample_drone.imu_specs, name="no-drag",
        )
        dyn = SixDOFDynamics(no_drag_drone)
        state = NominalState(
            np.zeros(3), np.zeros(3), np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        no_thrust = IMUMeasurement(0.0, np.zeros(3), np.zeros(3))
        for _ in range(100):
            state = dyn.propagate(state, no_thrust, zero_wind, 0.01)
        assert state.position[2] == pytest.approx(0.5 * GRAVITY, abs=0.01)

    def test_with_drag_falls_slower(
        self, dynamics: SixDOFDynamics, default_state: NominalState, zero_wind: WindVector,
    ) -> None:
        """With drag, free fall velocity should be less than g*t."""
        no_thrust = IMUMeasurement(0.0, np.zeros(3), np.zeros(3))
        state = default_state
        for _ in range(100):
            state = dynamics.propagate(state, no_thrust, zero_wind, 0.01)
        # Drag slows the fall: v_z < g
        assert 0 < state.velocity[2] < GRAVITY


class TestForwardFlight:
    def test_pitched_drone_moves_north(
        self, dynamics: SixDOFDynamics, zero_wind: WindVector,
    ) -> None:
        """Nose-down pitch: drone accelerates north.

        Positive pitch about Y = nose UP → accelerates south.
        Negative pitch about Y = nose DOWN → accelerates north.
        For forward flight: q = [cos(θ/2), 0, -sin(θ/2), 0].
        """
        pitch_rad = 10 * DEG2RAD
        # Negative pitch = nose down → forward flight
        q = np.array([np.cos(pitch_rad / 2), 0, -np.sin(pitch_rad / 2), 0])
        state = NominalState(
            np.zeros(3), np.zeros(3), q,
            np.zeros(3), np.zeros(3), np.zeros(2),
        )
        imu = IMUMeasurement(0.0, np.array([0, 0, -GRAVITY]), np.zeros(3))

        for _ in range(100):
            state = dynamics.propagate(state, imu, zero_wind, 0.01)

        assert state.position[0] > 0.5  # moved north
        assert abs(state.velocity[2]) < 2.0  # mostly level


class TestWindEffect:
    def test_headwind_decelerates(
        self, dynamics: SixDOFDynamics,
    ) -> None:
        """Headwind should decelerate drone more than no wind.

        Propagation uses state.wind for drag computation.
        state.wind = [-5, 0] means headwind from north at 5 m/s.
        v_air = v - w = [10,0,0] - [-5,0,0] = [15,0,0] → more drag.
        """
        # No wind case
        state_no_wind = NominalState(
            np.zeros(3),
            np.array([10.0, 0.0, 0.0]),
            np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3),
            np.zeros(2),  # no wind
        )
        # Headwind case: state.wind = [-5, 0] (headwind from north)
        state_headwind = NominalState(
            np.zeros(3),
            np.array([10.0, 0.0, 0.0]),
            np.array([1, 0, 0, 0.0]),
            np.zeros(3), np.zeros(3),
            np.array([-5.0, 0.0]),  # headwind in state
        )
        imu = IMUMeasurement(0.0, np.array([0, 0, -GRAVITY]), np.zeros(3))
        wind = WindVector(np.zeros(3), np.zeros(3))

        after_no_wind = dynamics.propagate(state_no_wind, imu, wind, 0.1)
        after_headwind = dynamics.propagate(state_headwind, imu, wind, 0.1)

        # Both should decelerate, but headwind case more
        assert after_headwind.velocity[0] < after_no_wind.velocity[0]
        assert after_headwind.velocity[0] < 10.0


class TestQuaternionNormalization:
    def test_after_many_steps(
        self, dynamics: SixDOFDynamics, default_state: NominalState, zero_wind: WindVector,
    ) -> None:
        """Quaternion stays unit after 1000 steps with rotation."""
        imu = IMUMeasurement(
            0.0,
            np.array([0, 0, -GRAVITY]),
            np.array([0.1, 0.05, -0.02]),
        )
        state = default_state
        for _ in range(1000):
            state = dynamics.propagate(state, imu, zero_wind, 0.01)
        assert np.linalg.norm(state.quaternion) == pytest.approx(1.0, abs=1e-10)


# ── F Matrix Tests ────────────────────────────────────────────


class TestFMatrix:
    def test_shape(
        self, dynamics: SixDOFDynamics, default_state: NominalState, zero_wind: WindVector,
    ) -> None:
        imu = IMUMeasurement(0.0, np.array([0, 0, -GRAVITY]), np.zeros(3))
        F = dynamics.get_F_matrix(default_state, imu, zero_wind)
        assert F.shape == (17, 17)

    def test_dp_row_is_velocity(
        self, dynamics: SixDOFDynamics, default_state: NominalState, zero_wind: WindVector,
    ) -> None:
        """δṗ = δv → F[0:3, 3:6] = I, rest of row = 0."""
        imu = IMUMeasurement(0.0, np.array([0, 0, -GRAVITY]), np.zeros(3))
        F = dynamics.get_F_matrix(default_state, imu, zero_wind)
        np.testing.assert_allclose(F[0:3, 3:6], np.eye(3), atol=1e-12)
        np.testing.assert_allclose(F[0:3, 0:3], np.zeros((3, 3)), atol=1e-12)
        np.testing.assert_allclose(F[0:3, 6:17], np.zeros((3, 11)), atol=1e-12)

    def test_bias_rows_zero(
        self, dynamics: SixDOFDynamics, default_state: NominalState, zero_wind: WindVector,
    ) -> None:
        """Bias and wind rows should be all zero (random walk, no dynamics)."""
        imu = IMUMeasurement(0.0, np.array([0, 0, -GRAVITY]), np.array([0.1, 0, 0]))
        F = dynamics.get_F_matrix(default_state, imu, zero_wind)
        np.testing.assert_allclose(F[9:17, :], np.zeros((8, 17)), atol=1e-12)

    def test_gyro_bias_coupling(
        self, dynamics: SixDOFDynamics, default_state: NominalState, zero_wind: WindVector,
    ) -> None:
        """δθ̇ has -I for gyro bias: F[6:9, 12:15] = -I."""
        imu = IMUMeasurement(0.0, np.array([0, 0, -GRAVITY]), np.zeros(3))
        F = dynamics.get_F_matrix(default_state, imu, zero_wind)
        np.testing.assert_allclose(F[6:9, 12:15], -np.eye(3), atol=1e-12)

    def test_accel_bias_coupling(
        self, dynamics: SixDOFDynamics, default_state: NominalState, zero_wind: WindVector,
    ) -> None:
        """δv̇ has -R for accel bias: F[3:6, 9:12] = -R."""
        imu = IMUMeasurement(0.0, np.array([0, 0, -GRAVITY]), np.zeros(3))
        F = dynamics.get_F_matrix(default_state, imu, zero_wind)
        # At identity quaternion, R = I, so F[3:6, 9:12] = -I
        np.testing.assert_allclose(F[3:6, 9:12], -np.eye(3), atol=1e-12)

    def test_numerical_verification(
        self, dynamics: SixDOFDynamics, zero_wind: WindVector,
    ) -> None:
        """CRITICAL: F_analytical ≈ F_numerical (finite differences).

        This test catches sign errors in the Jacobian.

        Method: compute discrete Φ numerically via finite differences,
        then F_numerical = (Φ - I) / dt. Compare with F_analytical.
        """
        pitch_rad = 5 * DEG2RAD
        state = NominalState(
            position=np.array([100.0, 50.0, -200.0]),
            velocity=np.array([8.0, 2.0, -0.5]),
            quaternion=np.array([np.cos(pitch_rad / 2), 0, np.sin(pitch_rad / 2), 0]),
            accel_bias=np.array([0.01, -0.02, 0.005]),
            gyro_bias=np.array([0.001, -0.001, 0.0005]),
            wind=np.array([3.0, 1.5]),
        )
        imu = IMUMeasurement(
            0.0,
            np.array([0.5, -0.2, -GRAVITY + 0.1]),
            np.array([0.1, -0.05, 0.02]),
        )
        wind_with_vel = WindVector(
            velocity=np.array([state.wind[0], state.wind[1], 0.0]),
            turbulence=np.zeros(3),
        )

        F_analytical = dynamics.get_F_matrix(state, imu, wind_with_vel)

        # Compute Φ (discrete state transition) numerically
        eps = 1e-6
        dt_small = 1e-4
        Phi_numerical = np.zeros((17, 17))

        for j in range(17):
            dv_plus = np.zeros(17)
            dv_plus[j] = eps
            state_plus = apply_error_to_nominal(
                state, ErrorState.from_vector(dv_plus)
            )

            dv_minus = np.zeros(17)
            dv_minus[j] = -eps
            state_minus = apply_error_to_nominal(
                state, ErrorState.from_vector(dv_minus)
            )

            s_plus = dynamics.propagate(state_plus, imu, wind_with_vel, dt_small)
            s_minus = dynamics.propagate(state_minus, imu, wind_with_vel, dt_small)

            # Φ[:, j] = (x(t+dt, x0+ε) - x(t+dt, x0-ε)) / (2ε)
            diff = nominal_difference(s_plus, s_minus)
            Phi_numerical[:, j] = diff / (2 * eps)

        # F ≈ (Φ - I) / dt
        F_numerical = (Phi_numerical - np.eye(17)) / dt_small

        # Compare — allow tolerance due to RK4 discretization
        np.testing.assert_allclose(
            F_analytical, F_numerical, atol=1.0, rtol=0.15,
            err_msg="F matrix analytical vs numerical mismatch",
        )


# ── Q Matrix Tests ────────────────────────────────────────────


class TestQMatrix:
    def test_shape(self, dynamics: SixDOFDynamics) -> None:
        Q = dynamics.get_Q_matrix(0.01)
        assert Q.shape == (17, 17)

    def test_symmetric(self, dynamics: SixDOFDynamics) -> None:
        Q = dynamics.get_Q_matrix(0.01)
        np.testing.assert_allclose(Q, Q.T, atol=1e-15)

    def test_positive_semidefinite(self, dynamics: SixDOFDynamics) -> None:
        Q = dynamics.get_Q_matrix(0.01)
        eigenvalues = np.linalg.eigvalsh(Q)
        assert np.all(eigenvalues >= -1e-12), f"Negative eigenvalue: {eigenvalues.min()}"

    def test_scales_with_dt(self, dynamics: SixDOFDynamics) -> None:
        """Q should scale linearly with dt."""
        Q1 = dynamics.get_Q_matrix(0.01)
        Q2 = dynamics.get_Q_matrix(0.02)
        np.testing.assert_allclose(Q2, 2 * Q1, atol=1e-20)

    def test_position_block_zero(self, dynamics: SixDOFDynamics) -> None:
        """Position block of Q should be zero (no direct noise on position)."""
        Q = dynamics.get_Q_matrix(0.01)
        np.testing.assert_allclose(Q[0:3, 0:3], np.zeros((3, 3)), atol=1e-20)

    def test_velocity_block_nonzero(self, dynamics: SixDOFDynamics) -> None:
        """Velocity block should have non-zero entries (accel noise)."""
        Q = dynamics.get_Q_matrix(0.01)
        assert np.any(Q[3:6, 3:6] > 0)

    def test_wind_block_zero(self, dynamics: SixDOFDynamics) -> None:
        """Wind block should be zero (no wind process noise in Q)."""
        Q = dynamics.get_Q_matrix(0.01)
        np.testing.assert_allclose(Q[15:17, 15:17], np.zeros((2, 2)), atol=1e-20)


# ── Helper Tests ──────────────────────────────────────────────


class TestHelpers:
    def test_apply_zero_error(self, default_state: NominalState) -> None:
        """Applying zero error should return same state."""
        result = apply_error_to_nominal(default_state, ErrorState.zeros())
        np.testing.assert_allclose(result.position, default_state.position)
        np.testing.assert_allclose(result.velocity, default_state.velocity)
        np.testing.assert_allclose(result.quaternion, default_state.quaternion, atol=1e-12)

    def test_roundtrip(self, default_state: NominalState) -> None:
        """apply_error then nominal_difference should recover the error."""
        error_vec = np.array([1, 2, 3, 0.1, 0.2, 0.3, 0.01, 0.02, 0.03,
                              0.001, -0.001, 0.002, 0.0001, -0.0001, 0.00005,
                              0.5, -0.3])
        error = ErrorState.from_vector(error_vec)
        perturbed = apply_error_to_nominal(default_state, error)
        recovered = nominal_difference(perturbed, default_state)
        # Quaternion small-angle approximation limits precision for δθ
        np.testing.assert_allclose(recovered, error_vec, atol=1e-4)
