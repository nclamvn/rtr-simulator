"""Physics engine for GPS-denied navigation simulation.

Public API — import directly:
    from core.physics import NominalState, ErrorState, SimConfig
"""

from core.physics.types import (
    GRAVITY,
    DEG2RAD,
    RAD2DEG,
    Frame,
    NominalState,
    ErrorState,
    IMUMeasurement,
    CameraObservation,
    CameraFrame,
    Landmark,
    LandmarkClusterDef,
    LandmarkConfig,
    TerrainConfig,
    TerrainQuery,
    TerrainResult,
    LOSResult,
    WindVector,
    WindConfig,
    IMUSpecs,
    CameraSpecs,
    DroneConfig,
    MissionPackage,
    SimResult,
    ConsistencyConfig,
    MonteCarloResult,
    SensitivityResult,
    ConeLayer,
    ConeConfig,
)
from core.physics.config import SimConfig

__all__ = [
    "GRAVITY", "DEG2RAD", "RAD2DEG", "Frame",
    "NominalState", "ErrorState",
    "IMUMeasurement", "CameraObservation", "CameraFrame",
    "Landmark", "LandmarkClusterDef", "LandmarkConfig",
    "TerrainConfig", "TerrainQuery", "TerrainResult", "LOSResult",
    "WindVector", "WindConfig",
    "IMUSpecs", "CameraSpecs",
    "DroneConfig", "MissionPackage", "SimResult",
    "ConsistencyConfig", "MonteCarloResult", "SensitivityResult",
    "ConeLayer", "ConeConfig",
    "SimConfig",
]
