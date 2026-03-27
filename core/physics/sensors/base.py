"""Abstract base class for sensor models."""

from abc import ABC, abstractmethod
from typing import Any

from core.physics.types import NominalState


class SensorModel(ABC):
    """Abstract sensor model. Generates noisy measurements from true state."""

    @abstractmethod
    def generate(self, true_state: NominalState, t: float) -> Any:
        """Generate noisy measurement from true state at time t."""
        ...
