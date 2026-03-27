"""Abstract base class for data association."""

from abc import ABC, abstractmethod

import numpy as np

from core.physics.types import CameraFrame, Landmark, NominalState


class DataAssociator(ABC):
    """Abstract data association pipeline.

    Matches camera observations to known landmarks.
    """

    @abstractmethod
    def associate(
        self,
        frame: CameraFrame,
        predicted_state: NominalState,
        covariance: np.ndarray,
        landmarks: list,  # List[Landmark]
    ) -> list:  # List[tuple[CameraObservation, Landmark, float]]
        """Match observations to landmarks.

        Returns list of (observation, landmark, confidence) tuples.
        """
        ...
