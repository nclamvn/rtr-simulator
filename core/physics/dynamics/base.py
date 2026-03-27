"""Abstract base class for dynamics models."""

from abc import ABC, abstractmethod

import numpy as np

from core.physics.types import IMUMeasurement, NominalState, WindVector


class DynamicsModel(ABC):
    """Abstract dynamics model. Propagates nominal state forward in time."""

    @abstractmethod
    def propagate(
        self,
        state: NominalState,
        imu: IMUMeasurement,
        wind: WindVector,
        dt: float,
    ) -> NominalState:
        """Propagate state forward by dt seconds using IMU + wind."""
        ...

    @abstractmethod
    def get_F_matrix(
        self,
        state: NominalState,
        imu: IMUMeasurement,
        wind: WindVector,
    ) -> np.ndarray:
        """Return 17×17 error-state transition Jacobian."""
        ...

    @abstractmethod
    def get_Q_matrix(self, dt: float) -> np.ndarray:
        """Return 17×17 process noise covariance."""
        ...
