"""6DOF dynamics model for drone con.

Implements equations from đề án Section 2.3:
- Nominal propagation (nonlinear, 100Hz from IMU)
- Error-state Jacobian F (17×17)
- Process noise Q (17×17)
- Aerodynamic drag model (body-frame coefficients)
"""

import numpy as np

from core.physics.dynamics._quaternion import (
    quat_integrate,
    quat_normalize,
    quat_to_rotation,
    skew,
)
from core.physics.dynamics.base import DynamicsModel
from core.physics.types import (
    GRAVITY,
    DEG2RAD,
    DroneConfig,
    IMUMeasurement,
    NominalState,
    WindVector,
)


class SixDOFDynamics(DynamicsModel):
    """Full 6DOF propagation with HERA/Vega specs.

    State layout (17D error state):
    [δp(3), δv(3), δθ(3), δb_a(3), δb_g(3), δw(2)]
    """

    def __init__(self, drone: DroneConfig) -> None:
        self.mass = drone.mass
        self.drag = drone.drag_coeffs  # [mu_x, mu_y, mu_z] body frame
        self.gravity = np.array([0.0, 0.0, GRAVITY])  # NED: +Z = down
        self._imu_specs = drone.imu_specs

    def _state_derivative(
        self,
        pos: np.ndarray,
        vel: np.ndarray,
        quat: np.ndarray,
        accel_bias: np.ndarray,
        gyro_bias: np.ndarray,
        wind: np.ndarray,
        accel_meas: np.ndarray,
        gyro_meas: np.ndarray,
        wind_vel: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Compute state derivatives (p_dot, v_dot, omega_body).

        Returns (p_dot, v_dot, omega_body) — quaternion integrated separately.
        """
        R = quat_to_rotation(quat)

        # Corrected IMU measurements
        accel_body = accel_meas - accel_bias
        omega_body = gyro_meas - gyro_bias

        # Specific force in NED frame
        accel_ned = R @ accel_body + self.gravity

        # Aerodynamic drag in NED frame
        w_3d = wind_vel.copy()  # Full 3D wind from WindVector
        v_air = vel - w_3d
        # Drag in body frame, then rotate to NED
        v_air_body = R.T @ v_air
        drag_body = -np.diag(self.drag) @ v_air_body
        drag_ned = R @ drag_body

        p_dot = vel
        v_dot = accel_ned + drag_ned

        return p_dot, v_dot, omega_body

    def propagate(
        self,
        state: NominalState,
        imu: IMUMeasurement,
        wind: WindVector,
        dt: float,
    ) -> NominalState:
        """Propagate nominal state forward by dt using RK4.

        RK4 for position + velocity. Quaternion exponential for attitude.
        Biases and wind estimate are constant (zero derivative).

        Wind for drag uses state.wind (the estimated wind in the state vector),
        consistent with the EKF model and F matrix. The external WindVector is
        available for future true-state propagation but the state's wind estimate
        drives the drag model to keep F matrix consistent.
        """
        # Use state.wind (2D estimate) expanded to 3D for drag
        # This keeps propagation consistent with F matrix wind coupling
        wind_3d = np.array([state.wind[0], state.wind[1], 0.0])

        pos = state.position.copy()
        vel = state.velocity.copy()
        quat = state.quaternion.copy()
        ba = state.accel_bias.copy()
        bg = state.gyro_bias.copy()
        w = state.wind.copy()

        a_m = imu.accel
        g_m = imu.gyro

        # RK4 for position and velocity
        k1_p, k1_v, omega1 = self._state_derivative(
            pos, vel, quat, ba, bg, w, a_m, g_m, wind_3d
        )

        pos2 = pos + 0.5 * dt * k1_p
        vel2 = vel + 0.5 * dt * k1_v
        quat2 = quat_integrate(quat, omega1, 0.5 * dt)
        k2_p, k2_v, omega2 = self._state_derivative(
            pos2, vel2, quat2, ba, bg, w, a_m, g_m, wind_3d
        )

        pos3 = pos + 0.5 * dt * k2_p
        vel3 = vel + 0.5 * dt * k2_v
        quat3 = quat_integrate(quat, omega2, 0.5 * dt)
        k3_p, k3_v, omega3 = self._state_derivative(
            pos3, vel3, quat3, ba, bg, w, a_m, g_m, wind_3d
        )

        pos4 = pos + dt * k3_p
        vel4 = vel + dt * k3_v
        quat4 = quat_integrate(quat, omega3, dt)
        k4_p, k4_v, omega4 = self._state_derivative(
            pos4, vel4, quat4, ba, bg, w, a_m, g_m, wind_3d
        )

        # RK4 combination
        new_pos = pos + (dt / 6.0) * (k1_p + 2 * k2_p + 2 * k3_p + k4_p)
        new_vel = vel + (dt / 6.0) * (k1_v + 2 * k2_v + 2 * k3_v + k4_v)

        # Average angular velocity for quaternion integration
        omega_avg = (omega1 + 2 * omega2 + 2 * omega3 + omega4) / 6.0
        new_quat = quat_normalize(quat_integrate(quat, omega_avg, dt))

        return NominalState(
            position=new_pos,
            velocity=new_vel,
            quaternion=new_quat,
            accel_bias=ba.copy(),
            gyro_bias=bg.copy(),
            wind=w.copy(),
        )

    def get_F_matrix(
        self,
        state: NominalState,
        imu: IMUMeasurement,
        wind: WindVector,
    ) -> np.ndarray:
        """17×17 continuous-time error-state transition Jacobian.

        Layout: [δp(3), δv(3), δθ(3), δb_a(3), δb_g(3), δw(2)]

        F = ∂(δẋ)/∂(δx)
        """
        R = quat_to_rotation(state.quaternion)

        # Corrected measurements
        accel_body = imu.accel - state.accel_bias
        omega_body = imu.gyro - state.gyro_bias

        # Specific force in NED (without gravity and drag)
        a_ned = R @ accel_body  # R * (a_m - b_a)

        F = np.zeros((17, 17))

        # ── Row 1: δṗ = δv ──
        F[0:3, 3:6] = np.eye(3)

        # ── Row 2: δv̇ ──
        # δv̇ = -[R(a_m - b_a)]× · δθ  - R · δb_a  + D_v · δv  + D_w · δw
        # where [a]× is skew-symmetric of a_ned

        # Drag Jacobian w.r.t. velocity: D_v = -R · diag(μ) · Rᵀ
        drag_diag = np.diag(self.drag)
        D_v = -R @ drag_diag @ R.T
        F[3:6, 3:6] = D_v

        # Attitude coupling: -[a_ned]× (skew of specific force in NED)
        F[3:6, 6:9] = -skew(a_ned)

        # Accel bias: -R
        F[3:6, 9:12] = -R

        # Wind coupling: D_w = R · diag(μ) · Rᵀ · [I₂; 0] (3×2)
        # Wind state is [w_north, w_east], wind velocity in NED is [w_n, w_e, 0]
        # ∂(drag)/∂(w) = +R · diag(μ) · Rᵀ · [[1,0],[0,1],[0,0]]
        I2_pad = np.array([[1, 0], [0, 1], [0, 0]], dtype=float)
        D_w = R @ drag_diag @ R.T @ I2_pad
        F[3:6, 15:17] = D_w

        # ── Row 3: δθ̇ = -[ω]× · δθ - δb_g ──
        F[6:9, 6:9] = -skew(omega_body)
        F[6:9, 12:15] = -np.eye(3)

        # Rows 4-6 (δb_a, δb_g, δw): all zero derivatives (random walk driven by noise)

        return F

    def get_Q_matrix(self, dt: float) -> np.ndarray:
        """17×17 discrete-time process noise covariance.

        Q = G · Q_c · Gᵀ · dt

        where G maps 12 noise sources to 17 error-state dimensions.
        """
        specs = self._imu_specs

        # Noise spectral densities
        sigma_na = specs.get("accel_random_walk", 0.02)  # m/s/√Hz
        sigma_ng = specs.get("gyro_random_walk", 0.01) * DEG2RAD  # convert deg/√Hz → rad/√Hz
        sigma_nba = specs.get("accel_bias_instability", 0.04) * GRAVITY / 1000.0  # mg → m/s²
        sigma_nbg = specs.get("gyro_bias_instability", 5.0) * DEG2RAD / 3600.0  # deg/hr → rad/s

        # Continuous-time noise covariance Q_c (12×12 diagonal)
        Q_c = np.diag([
            sigma_na**2, sigma_na**2, sigma_na**2,     # accel noise
            sigma_ng**2, sigma_ng**2, sigma_ng**2,     # gyro noise
            sigma_nba**2, sigma_nba**2, sigma_nba**2,  # accel bias walk
            sigma_nbg**2, sigma_nbg**2, sigma_nbg**2,  # gyro bias walk
        ])

        # Noise input matrix G (17×12)
        # For simplicity, use identity rotation (R≈I) in G.
        # The exact G depends on current R, but for noise covariance
        # the approximation G with R=I is standard and sufficient.
        G = np.zeros((17, 12))
        # δv row: -R · n_a ≈ -I · n_a (accel noise → velocity)
        G[3:6, 0:3] = -np.eye(3)
        # δθ row: -I · n_g (gyro noise → attitude)
        G[6:9, 3:6] = -np.eye(3)
        # δb_a row: I · n_ba (accel bias walk)
        G[9:12, 6:9] = np.eye(3)
        # δb_g row: I · n_bg (gyro bias walk)
        G[12:15, 9:12] = np.eye(3)

        # Discrete-time: Q = G · Q_c · Gᵀ · dt
        Q = G @ Q_c @ G.T * dt

        return Q
