"""Abstract base class for wind field models."""

from abc import ABC, abstractmethod

import numpy as np

from core.physics.types import WindVector


class WindField(ABC):
    """Abstract wind field. Provides wind vector at any point in space-time."""

    @abstractmethod
    def get_wind(self, position: np.ndarray, t: float) -> WindVector:
        """Get wind vector at 3D position and time.

        Args:
            position: [3] NED coordinates
            t: time in seconds

        Returns:
            WindVector with velocity and turbulence components.
        """
        ...
