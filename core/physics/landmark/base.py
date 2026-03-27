"""Abstract base class for landmark providers."""

from abc import ABC, abstractmethod

import numpy as np

from core.physics.terrain.base import TerrainProvider
from core.physics.types import Landmark, LandmarkClusterDef


class LandmarkProvider(ABC):
    """Abstract landmark provider. Manages landmark chain and visibility."""

    @abstractmethod
    def get_visible_landmarks(
        self,
        position: np.ndarray,
        heading: float,
        terrain: TerrainProvider,
    ) -> list:  # List[Landmark]
        """Get landmarks visible from drone position + heading.

        Uses terrain LOS check to filter occluded landmarks.
        """
        ...

    @abstractmethod
    def get_cluster(self, cluster_id: str) -> LandmarkClusterDef:
        """Get landmark cluster by ID."""
        ...
