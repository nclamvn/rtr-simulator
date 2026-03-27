"""Abstract base class for terrain providers."""

from abc import ABC, abstractmethod

import numpy as np

from core.physics.types import LOSResult


class TerrainProvider(ABC):
    """Abstract terrain provider. Provides elevation and LOS queries."""

    @abstractmethod
    def get_elevation(self, north: float, east: float) -> float:
        """Get terrain elevation at (north, east) coordinates.

        Returns elevation in meters (positive up).
        """
        ...

    @abstractmethod
    def check_los(
        self, from_pos: np.ndarray, to_pos: np.ndarray
    ) -> LOSResult:
        """Check line-of-sight between two 3D positions.

        Args:
            from_pos: [3] NED position of observer
            to_pos: [3] NED position of target

        Returns:
            LOSResult with visibility, distance, and occlusion point if blocked.
        """
        ...
