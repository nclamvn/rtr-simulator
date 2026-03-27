"""Tests for sensor abstract base classes."""

import pytest

from core.physics.sensors.base import SensorModel
from core.physics.sensors.camera import CameraModel
from core.physics.sensors.imu import IMUModel
from core.physics.types import CameraSpecs, IMUSpecs


class TestSensorBase:
    def test_cannot_instantiate_abc(self) -> None:
        with pytest.raises(TypeError):
            SensorModel()  # type: ignore[abstract]


class TestIMUImplementation:
    def test_is_sensor_model(self) -> None:
        imu = IMUModel(IMUSpecs(), seed=42)
        assert isinstance(imu, SensorModel)

    def test_has_specs(self) -> None:
        imu = IMUModel(IMUSpecs(), seed=42)
        assert imu.specs.sample_rate == 100.0


class TestCameraImplementation:
    def test_is_sensor_model(self) -> None:
        cam = CameraModel(CameraSpecs(), seed=42)
        assert isinstance(cam, SensorModel)

    def test_has_specs(self) -> None:
        cam = CameraModel(CameraSpecs(), seed=42)
        assert cam.specs.pixel_noise_std == 1.0
