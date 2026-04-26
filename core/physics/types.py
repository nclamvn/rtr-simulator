"""Data types and constants for the physics engine.

Conventions:
- Quaternion: [w, x, y, z] scalar-first (Hamilton), compatible with scipy.spatial.transform.Rotation
- Frame: NED (North-East-Down) — aviation standard
- Error state: 17D [δp(3), δv(3), δθ(3), δb_a(3), δb_g(3), δw(2)]
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import numpy as np

# ── Constants ──────────────────────────────────────────────────

GRAVITY = 9.80665  # m/s² (standard gravity)
DEG2RAD = np.pi / 180.0
RAD2DEG = 180.0 / np.pi

# ── Enums ──────────────────────────────────────────────────────


class Frame(Enum):
    NED = "ned"        # North-East-Down (navigation frame)
    BODY = "body"      # Body frame (drone-fixed)
    CAMERA = "camera"  # Camera frame


# ── State Types ────────────────────────────────────────────────


@dataclass
class NominalState:
    """Full nominal state (18D) — propagated by nonlinear equations.

    Fields:
        position:   [3] NED meters from drop point B
        velocity:   [3] NED m/s
        quaternion: [4] [w, x, y, z] unit quaternion (scalar-first)
        accel_bias: [3] accelerometer bias (m/s²)
        gyro_bias:  [3] gyroscope bias (rad/s)
        wind:       [2] horizontal wind [w_north, w_east] (m/s)
    """

    position: np.ndarray
    velocity: np.ndarray
    quaternion: np.ndarray
    accel_bias: np.ndarray
    gyro_bias: np.ndarray
    wind: np.ndarray

    def __post_init__(self) -> None:
        assert self.position.shape == (3,), f"position shape must be (3,), got {self.position.shape}"
        assert self.velocity.shape == (3,), f"velocity shape must be (3,), got {self.velocity.shape}"
        assert self.quaternion.shape == (4,), f"quaternion shape must be (4,), got {self.quaternion.shape}"
        assert self.accel_bias.shape == (3,), f"accel_bias shape must be (3,), got {self.accel_bias.shape}"
        assert self.gyro_bias.shape == (3,), f"gyro_bias shape must be (3,), got {self.gyro_bias.shape}"
        assert self.wind.shape == (2,), f"wind shape must be (2,), got {self.wind.shape}"


@dataclass
class ErrorState:
    """Error state (17D) — estimated by ES-EKF.

    Layout: [δp(3), δv(3), δθ(3), δb_a(3), δb_g(3), δw(2)]
    """

    delta_p: np.ndarray       # [3] position error
    delta_v: np.ndarray       # [3] velocity error
    delta_theta: np.ndarray   # [3] attitude error (Rodrigues)
    delta_ba: np.ndarray      # [3] accel bias error
    delta_bg: np.ndarray      # [3] gyro bias error
    delta_w: np.ndarray       # [2] wind error

    DIM: int = 17  # Total dimensions (class variable)

    def to_vector(self) -> np.ndarray:
        """Flatten to 17D vector."""
        return np.concatenate([
            self.delta_p, self.delta_v, self.delta_theta,
            self.delta_ba, self.delta_bg, self.delta_w,
        ])

    @classmethod
    def from_vector(cls, v: np.ndarray) -> "ErrorState":
        """Construct from 17D vector."""
        assert v.shape == (17,), f"Expected shape (17,), got {v.shape}"
        return cls(
            delta_p=v[0:3],
            delta_v=v[3:6],
            delta_theta=v[6:9],
            delta_ba=v[9:12],
            delta_bg=v[12:15],
            delta_w=v[15:17],
        )

    @classmethod
    def zeros(cls) -> "ErrorState":
        """Zero error state."""
        return cls.from_vector(np.zeros(17))


# ── Sensor Types ───────────────────────────────────────────────


@dataclass
class IMUMeasurement:
    """Raw IMU reading at a single timestep."""

    timestamp: float          # seconds
    accel: np.ndarray         # [3] body-frame accelerometer (m/s²)
    gyro: np.ndarray          # [3] body-frame gyroscope (rad/s)


@dataclass
class CameraObservation:
    """Single landmark observation from camera."""

    timestamp: float
    landmark_id: str
    pixel_uv: np.ndarray      # [2] pixel coordinates [u, v]
    descriptor: Optional[np.ndarray] = None


@dataclass
class CameraFrame:
    """Full camera frame with all observations."""

    timestamp: float
    observations: list  # List[CameraObservation]
    image: Optional[np.ndarray] = None


# ── Landmark Types ─────────────────────────────────────────────


@dataclass
class Landmark:
    """Single landmark in world frame."""

    id: str
    position: np.ndarray       # [3] NED world coordinates
    descriptor: np.ndarray     # [N] feature descriptor (e.g. 256-bit ORB)
    cluster_id: str
    landmark_type: str         # "bridge", "junction", "lake", "building"
    image_pyramid: Optional[list] = None  # [64, 128, 256] px patches


@dataclass
class LandmarkClusterDef:
    """Cluster of landmarks — shared failure mode analysis."""

    id: str
    landmarks: list            # List[Landmark]
    diversity_score: float     # 0–1, higher = more diverse failure modes
    p_common_mode: float       # P_cm: probability of common-mode failure
    segment_id: str


@dataclass
class LandmarkConfig:
    """Configuration for landmark chain generation."""

    num_landmarks: int = 40           # Total landmarks in chain
    cluster_size: int = 5             # Landmarks per cluster
    segment_spacing: float = 400.0    # meters between cluster centers
    corridor_width: float = 2000.0    # meters
    max_recognition_range: float = 500.0  # meters
    min_altitude_check: float = 50.0  # check visibility from this alt
    max_altitude_check: float = 200.0
    p_individual_detect: float = 0.7  # p_ind per đề án
    descriptor_dim: int = 256         # ORB descriptor bits (= 32 bytes)
    score_weights: tuple = (0.4, 0.3, 0.3)  # α, β, γ for Score(L_i)


# ── Terrain Types ──────────────────────────────────────────────


@dataclass
class TerrainConfig:
    """Configuration for procedural terrain generation."""

    base_elevation: float = 50.0       # meters
    ridge_height: float = 200.0        # max ridge height (meters)
    ridge_frequency: float = 2.0       # ridges per km
    noise_octaves: int = 4
    noise_scale: float = 1000.0        # horizontal noise scale (meters)
    seed: int = 42
    corridor_length: float = 15000.0   # B→T distance (meters)
    corridor_width: float = 2000.0     # corridor width (meters)


@dataclass
class TerrainQuery:
    """Query terrain at a position."""

    position_ne: np.ndarray    # [2] North-East coordinates


@dataclass
class TerrainResult:
    """Terrain query result."""

    elevation: float           # meters (positive up)
    normal: np.ndarray         # [3] surface normal
    roughness: float           # terrain roughness factor


@dataclass
class LOSResult:
    """Line-of-sight query result."""

    visible: bool
    distance: float            # meters
    occlusion_point: Optional[np.ndarray] = None


# ── Wind Types ─────────────────────────────────────────────────


@dataclass
class WindVector:
    """Wind at a specific point in space-time."""

    velocity: np.ndarray       # [3] NED wind velocity (m/s)
    turbulence: np.ndarray     # [3] turbulence component (m/s)


@dataclass
class WindConfig:
    """Configuration for Dryden wind field model."""

    mean_speed: float = 8.0            # m/s
    mean_direction: float = 90.0       # degrees from North, clockwise (meteorological)
    # Dryden turbulence
    turbulence_intensity: float = 1.5  # σ at reference altitude (m/s)
    reference_altitude: float = 20.0   # meters
    shear_exponent: float = 0.143      # wind shear power law
    # Vertical
    vertical_turbulence: float = 0.5   # σ_w multiplier
    # Terrain coupling
    terrain_coupling: bool = True
    # Time correlation
    update_rate: float = 100.0         # Hz (match IMU rate)


# ── Sensor Specs ──────────────────────────────────────────────


@dataclass
class IMUSpecs:
    """IMU noise parameters — from Allan variance test or datasheet.

    Defaults: MPU6050 typical values.
    TO BE UPDATED from bench test Allan variance when available.
    """

    # Accelerometer
    accel_bias_instability: float = 0.04   # mg
    accel_random_walk: float = 0.02        # m/s/√Hz
    accel_range: float = 16.0              # ±g
    # Gyroscope
    gyro_bias_instability: float = 5.0     # deg/hr
    gyro_random_walk: float = 0.01         # deg/√Hz
    gyro_range: float = 2000.0             # ±deg/s
    # Hardware
    adc_bits: int = 16
    sample_rate: float = 100.0             # Hz
    # Vibration
    vibration_psd: float = 0.5             # m/s² (propeller noise amplitude)


@dataclass
class CameraSpecs:
    """Camera parameters — from calibration or datasheet."""

    intrinsics: np.ndarray = field(
        default_factory=lambda: np.array([
            [400, 0, 320],
            [0, 400, 240],
            [0, 0, 1],
        ], dtype=float),
    )  # 3×3 K matrix (VGA 640×480, ~60° FOV)

    extrinsics: np.ndarray = field(
        default_factory=lambda: np.array([
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [1, 0, 0, 0],
            [0, 0, 0, 1],
        ], dtype=float),
    )  # 4×4 T_cam_body: body X→cam Z, body Y→cam X, body Z→cam Y

    resolution: tuple = (640, 480)

    distortion_coeffs: Optional[np.ndarray] = None  # [k1, k2, p1, p2, k3]

    rolling_shutter_ms: float = 0.0  # 0 = global shutter

    pixel_noise_std: float = 1.0     # pixel localization noise (σ)

    landmark_size: float = 5.0       # meters (typical landmark physical size)


# ── Simulation Types ──────────────────────────────────────────


@dataclass
class DroneConfig:
    """Physical configuration of a drone."""

    mass: float                # kg
    drag_coeffs: np.ndarray    # [3] body-frame [mu_x, mu_y, mu_z]
    max_speed: float           # m/s
    max_altitude: float        # meters
    battery_capacity: float    # mAh
    camera_intrinsics: np.ndarray  # [3×3] K matrix
    camera_extrinsics: np.ndarray  # [4×4] T_cam_imu
    imu_specs: dict            # Allan variance params from bench test
    name: str = "drone"


@dataclass
class MissionPackage:
    """Data package from Hera to drone con before drop."""

    target: np.ndarray         # [3] target position relative to drop point B
    landmarks: list            # List[Landmark]
    clusters: list             # List[LandmarkClusterDef]
    corridor_grid: np.ndarray  # [N×M] coarse localization grid
    wind_estimate: np.ndarray  # [2] initial wind at drop time
    camera_cal: np.ndarray     # [3×3] K matrix
    terrain_profile: np.ndarray  # [N×3] elevation along corridor
    drop_point: np.ndarray     # [3] absolute position of drop point B
    # Cone navigation (optional — None = corridor mode)
    cone: Optional[object] = None          # ConeConfig if cone mode
    cone_layers: list = field(default_factory=list)  # List[ConeLayer]


@dataclass
class SimResult:
    """Result from a single trajectory simulation."""

    true_states: list          # List[NominalState]
    estimated_states: list     # List[NominalState]
    timestamps: np.ndarray
    position_errors: np.ndarray   # [N×3]
    nis_values: np.ndarray        # [N]
    covariances: list             # List[np.ndarray] each 17×17
    landmarks_matched: list       # List[dict]
    outcome: str                  # "success", "diverged", "lost", "aborted"
    final_error: float            # CEP at target (meters)
    metadata: dict = field(default_factory=dict)


@dataclass
class ConsistencyConfig:
    """Configuration for NIS/NEES consistency monitoring."""

    window_size: int = 20              # NIS sliding window
    nominal_range: tuple = (0.5, 4.0)  # Expected NIS range
    cautious_threshold: float = 4.0    # Mean NIS → inflate
    degraded_threshold: float = 8.0    # Mean NIS → reset
    spike_threshold: float = 20.0      # Single NIS → log
    inflation_alpha: float = 0.1       # Inflation multiplier


@dataclass
class MonteCarloResult:
    """Aggregated results from Monte Carlo campaign."""

    num_runs: int
    num_drones: int
    outcomes: list                     # per run: str
    final_errors: np.ndarray           # [N]
    success_rate: float
    cep50: float                       # 50th percentile error (m)
    cep95: float                       # 95th percentile
    mean_error: float
    mean_nis_per_run: np.ndarray       # [N]
    consistent_fraction: float
    mean_flight_time: float
    total_compute_time: float
    run_results: list                  # List[SimResult] or []
    failure_breakdown: dict
    cone_metrics: dict = field(default_factory=dict)  # Optional cone-specific metrics

    def summary(self) -> str:
        return (
            f"\nMONTE CARLO RESULTS ({self.num_runs} runs, {self.num_drones} drones/run)\n"
            f"{'=' * 50}\n"
            f"Success rate:     {self.success_rate * 100:.1f}%\n"
            f"CEP50:            {self.cep50:.1f}m\n"
            f"CEP95:            {self.cep95:.1f}m\n"
            f"Mean error:       {self.mean_error:.1f}m\n"
            f"NIS consistent:   {self.consistent_fraction * 100:.1f}%\n"
            f"Mean flight time: {self.mean_flight_time:.0f}s\n"
            f"Compute time:     {self.total_compute_time:.1f}s\n"
            f"\nFailure breakdown: {self.failure_breakdown}\n"
        )


@dataclass
class SensitivityResult:
    """Result from sensitivity analysis."""

    param_name: str
    param_values: list
    success_rates: np.ndarray          # [V]
    mean_ceps: np.ndarray              # [V]
    mean_nis: np.ndarray               # [V]
    runs_per_value: int


# ── Cone Navigation Types ─────────────────────────────────────


class MeasurementType(Enum):
    """Measurement processing mode per cone layer (Sec 3.5)."""

    CONTAINMENT = "containment"        # Outer layers: set-membership check
    BEARING_METRIC = "bearing_metric"  # Middle layers: bearing + partial metric
    FULL_METRIC = "full_metric"        # Inner layers: full EKF update
    TERMINAL = "terminal"              # Final approach: tight gating


@dataclass
class ConeLayer:
    """Single cross-section of the navigation cone."""

    index: int                      # 0 = near drop (base), N-1 = near target (apex)
    distance_from_base: float       # meters along B→T axis
    radius: float                   # meters, cone radius at this layer
    center: np.ndarray              # [3] NED position of layer center
    landmark_count: int = 0
    landmarks: list = field(default_factory=list)
    measurement_type: str = "full_metric"  # MeasurementType value


@dataclass
class ConeConfig:
    """Configuration for cone-based landmark distribution.

    Cone geometry: base at drop point B (large radius), apex at target T (small radius).
    Divided into layers (cross-sections) with increasing landmark density toward target.
    """

    base_radius: float = 1500.0           # meters, radius at drop point B
    num_layers: int = 8                    # number of cross-section layers
    layer_spacing_mode: str = "linear"     # "linear" or "geometric" (bunched near target)
    min_layer_radius: float = 10.0         # meters, clamp radius near apex
    trumpet_factor: float = 1.0            # >1 flares the base outward
    landmarks_per_layer_base: int = 3      # landmarks in first layer (fewest)
    landmarks_per_layer_final: int = 10    # landmarks in last layer (most)
    cluster_size: int = 5                  # landmarks per cluster within layer
    max_recognition_range: float = 500.0   # meters
    descriptor_dim: int = 256              # ORB descriptor bits
    p_individual_detect: float = 0.7


@dataclass
class PNConfig:
    """Proportional Navigation terminal guidance configuration.

    PN law: heading_rate = N * bearing_rate
    Optimal for stationary target with bearing-only measurement.
    """

    # Switch criteria
    switch_distance: float = 500.0              # meters — PN activates below this
    max_off_boresight: float = 45.0 * DEG2RAD   # target must be within +/-45 deg FOV
    min_speed: float = 3.0                      # m/s — don't switch if stalled

    # PN law
    nav_constant: float = 3.0                   # N — pure PN optimal
    bearing_noise_rad: float = 0.5 * DEG2RAD    # camera bearing noise
    rate_filter_alpha: float = 0.3              # low-pass on bearing rate

    # Limits
    max_turn_rate: float = 30.0 * DEG2RAD       # rad/s max yaw rate
    max_bank: float = 30.0 * DEG2RAD            # rad max bank

    # Terminal dive
    terminal_dive_distance: float = 50.0        # meters — begin descent
    descent_rate: float = 2.0                   # m/s downward

    # Speed
    cruise_speed: float = 12.0                  # m/s maintain during PN


@dataclass
class LateralCorrection:
    """A commanded lateral correction maneuver."""

    bank_angle: float          # radians (absolute)
    duration: float            # seconds
    priority: str              # "low" or "high"
    direction: float           # +1 = right, -1 = left
    estimated_cost_mah: float  # energy cost
    trigger_margin: float      # relative margin that triggered this
    trigger_drift: float       # drift at trigger time


@dataclass
class LateralBudgetConfig:
    """Configuration for proactive lateral drift management."""

    # Tier thresholds (fraction of cone radius)
    comfortable_margin: float = 0.6
    attentive_margin: float = 0.3

    # Correction parameters
    gentle_bank_deg: float = 5.0
    gentle_duration: float = 3.0
    aggressive_bank_deg: float = 15.0
    aggressive_duration: float = 5.0

    # Energy budget
    max_energy_budget: float = 200.0    # mAh total for corrections
    min_battery_reserve: float = 15.0   # % — don't correct below this
    drone_mass: float = 2.5             # kg
    battery_voltage: float = 11.1       # V (3S LiPo)
    battery_capacity: float = 5000.0    # mAh

    # Active range (distance to target)
    active_range_max: float = 5000.0    # meters
    active_range_min: float = 500.0     # meters (PN takes over)

    # Drift rate estimation
    drift_window_s: float = 5.0
    drift_rate_samples: int = 50

    # Cooldown
    min_correction_interval: float = 10.0  # seconds
