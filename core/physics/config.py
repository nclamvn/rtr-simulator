"""Master configuration for physics simulation."""

from dataclasses import dataclass, field


@dataclass
class SimConfig:
    """Master configuration for physics simulation.

    Default values match đề án specifications.
    """

    # Timing
    imu_rate_hz: float = 100.0       # IMU sampling rate
    camera_rate_hz: float = 10.0     # Camera frame rate
    sim_duration_max: float = 600.0  # Max 10 minutes

    # EKF
    ekf_dim: int = 17               # Error state dimension
    innovation_gate_chi2: float = 9.21  # Chi-squared threshold (2 DOF, 99%)

    # Data association
    lowe_ratio: float = 0.75        # Lowe's ratio test threshold
    ransac_iterations: int = 100
    ransac_reproj_threshold: float = 3.0  # pixels

    # Landmark
    min_landmark_pixels: int = 20    # Minimum ORB feature size
    cluster_size: int = 5            # Landmarks per cluster

    # Termination
    target_radius: float = 15.0      # Success if within 15m of target
    divergence_threshold: float = 1000.0  # Abort if error > 1km
    max_no_update_seconds: float = 30.0   # Abort if no landmark match for 30s

    # Monte Carlo
    monte_carlo_runs: int = 1000
    random_seed: int = 42

    # N-drone support
    num_drones: int = 1              # Designed for N from start
    drone_configs: list = field(default_factory=list)
