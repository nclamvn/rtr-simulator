"""Abstract base class for state estimators."""

from abc import ABC, abstractmethod

import numpy as np

from core.physics.types import (
    CameraObservation,
    IMUMeasurement,
    Landmark,
    NominalState,
)


class StateEstimator(ABC):
    """Abstract state estimator (ES-EKF interface)."""

    @abstractmethod
    def predict(self, imu: IMUMeasurement, dt: float) -> None:
        """EKF predict step using IMU measurement."""
        ...

    @abstractmethod
    def update(
        self, observation: CameraObservation, landmark: Landmark
    ) -> float:
        """EKF update step with a single landmark observation.

        Returns NIS (Normalized Innovation Squared) value.
        """
        ...

    @abstractmethod
    def get_state(self) -> NominalState:
        """Current estimated nominal state."""
        ...

    @abstractmethod
    def get_covariance(self) -> np.ndarray:
        """Current 17×17 error-state covariance matrix."""
        ...
