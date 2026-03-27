"""Shared fixtures for physics engine tests."""

import numpy as np
import pytest

from core.physics.types import (
    DroneConfig,
    Landmark,
    MissionPackage,
    NominalState,
)


@pytest.fixture
def default_state() -> NominalState:
    """Create a nominal state at origin, hovering."""
    return NominalState(
        position=np.zeros(3),
        velocity=np.zeros(3),
        quaternion=np.array([1.0, 0.0, 0.0, 0.0]),  # Identity
        accel_bias=np.zeros(3),
        gyro_bias=np.zeros(3),
        wind=np.zeros(2),
    )


@pytest.fixture
def sample_drone() -> DroneConfig:
    """Create a drone config with HERA-S-like specs."""
    return DroneConfig(
        mass=2.5,
        drag_coeffs=np.array([0.3, 0.3, 0.5]),
        max_speed=22.0,
        max_altitude=500.0,
        battery_capacity=5000.0,
        camera_intrinsics=np.array([
            [400, 0, 320],
            [0, 400, 240],
            [0, 0, 1],
        ], dtype=float),
        camera_extrinsics=np.eye(4),
        imu_specs={
            "accel_bias_instability": 0.04,  # mg
            "accel_random_walk": 0.02,       # m/s/sqrt(Hz)
            "gyro_bias_instability": 5.0,    # deg/hr
            "gyro_random_walk": 0.01,        # deg/sqrt(Hz)
        },
        name="HERA-S-test",
    )


@pytest.fixture
def sample_landmark() -> Landmark:
    return Landmark(
        id="L001",
        position=np.array([1000.0, 500.0, -50.0]),
        descriptor=np.random.randint(0, 256, 32, dtype=np.uint8),
        cluster_id="C01",
        landmark_type="bridge",
    )


@pytest.fixture
def sample_mission(sample_landmark: Landmark) -> MissionPackage:
    return MissionPackage(
        target=np.array([15000.0, 0.0, -100.0]),
        landmarks=[sample_landmark],
        clusters=[],
        corridor_grid=np.zeros((60, 128)),
        wind_estimate=np.array([5.0, 2.0]),
        camera_cal=np.eye(3),
        terrain_profile=np.zeros((100, 3)),
        drop_point=np.zeros(3),
    )
