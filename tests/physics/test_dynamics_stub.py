"""Tests for dynamics abstract base class."""

import pytest

from core.physics.dynamics.base import DynamicsModel
from core.physics.dynamics.six_dof import SixDOFDynamics
from core.physics.types import DroneConfig


class TestDynamicsBase:
    def test_cannot_instantiate_abc(self) -> None:
        with pytest.raises(TypeError):
            DynamicsModel()  # type: ignore[abstract]

    def test_implementation_exists(self, sample_drone: DroneConfig) -> None:
        """SixDOFDynamics is a concrete implementation of DynamicsModel."""
        dyn = SixDOFDynamics(sample_drone)
        assert isinstance(dyn, DynamicsModel)

    def test_stores_mass(self, sample_drone: DroneConfig) -> None:
        dyn = SixDOFDynamics(sample_drone)
        assert dyn.mass == 2.5
