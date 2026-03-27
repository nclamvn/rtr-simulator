"""Tests for core.physics.types data structures."""

import numpy as np
import pytest

from core.physics.types import (
    CameraFrame,
    CameraObservation,
    ErrorState,
    IMUMeasurement,
    NominalState,
    SimResult,
)


class TestNominalState:
    def test_creation(self, default_state: NominalState) -> None:
        assert default_state.position.shape == (3,)
        assert default_state.velocity.shape == (3,)
        assert default_state.quaternion.shape == (4,)
        assert default_state.accel_bias.shape == (3,)
        assert default_state.gyro_bias.shape == (3,)
        assert default_state.wind.shape == (2,)

    def test_quaternion_unit(self, default_state: NominalState) -> None:
        assert np.linalg.norm(default_state.quaternion) == pytest.approx(1.0)

    def test_invalid_position_shape(self) -> None:
        with pytest.raises(AssertionError):
            NominalState(
                position=np.zeros(2),  # Wrong shape
                velocity=np.zeros(3),
                quaternion=np.array([1.0, 0, 0, 0]),
                accel_bias=np.zeros(3),
                gyro_bias=np.zeros(3),
                wind=np.zeros(2),
            )

    def test_invalid_quaternion_shape(self) -> None:
        with pytest.raises(AssertionError):
            NominalState(
                position=np.zeros(3),
                velocity=np.zeros(3),
                quaternion=np.array([1.0, 0, 0]),  # Wrong shape
                accel_bias=np.zeros(3),
                gyro_bias=np.zeros(3),
                wind=np.zeros(2),
            )

    def test_invalid_wind_shape(self) -> None:
        with pytest.raises(AssertionError):
            NominalState(
                position=np.zeros(3),
                velocity=np.zeros(3),
                quaternion=np.array([1.0, 0, 0, 0]),
                accel_bias=np.zeros(3),
                gyro_bias=np.zeros(3),
                wind=np.zeros(3),  # Wrong shape — should be (2,)
            )


class TestErrorState:
    def test_roundtrip(self) -> None:
        v = np.random.randn(17)
        es = ErrorState.from_vector(v)
        assert np.allclose(es.to_vector(), v)

    def test_zeros(self) -> None:
        es = ErrorState.zeros()
        assert np.allclose(es.to_vector(), np.zeros(17))

    def test_dim(self) -> None:
        assert ErrorState.DIM == 17

    def test_from_vector_wrong_size(self) -> None:
        with pytest.raises(AssertionError):
            ErrorState.from_vector(np.zeros(16))

    def test_subvector_shapes(self) -> None:
        es = ErrorState.zeros()
        assert es.delta_p.shape == (3,)
        assert es.delta_v.shape == (3,)
        assert es.delta_theta.shape == (3,)
        assert es.delta_ba.shape == (3,)
        assert es.delta_bg.shape == (3,)
        assert es.delta_w.shape == (2,)


class TestIMUMeasurement:
    def test_creation(self) -> None:
        imu = IMUMeasurement(
            timestamp=0.01,
            accel=np.array([0, 0, -9.81]),
            gyro=np.zeros(3),
        )
        assert imu.accel[2] == pytest.approx(-9.81)
        assert imu.timestamp == pytest.approx(0.01)

    def test_gyro_zeros(self) -> None:
        imu = IMUMeasurement(timestamp=0.0, accel=np.zeros(3), gyro=np.zeros(3))
        assert np.allclose(imu.gyro, np.zeros(3))


class TestCameraTypes:
    def test_camera_observation(self) -> None:
        obs = CameraObservation(
            timestamp=1.0,
            landmark_id="L001",
            pixel_uv=np.array([320.0, 240.0]),
        )
        assert obs.landmark_id == "L001"
        assert obs.descriptor is None

    def test_camera_frame(self) -> None:
        obs = CameraObservation(
            timestamp=1.0, landmark_id="L001", pixel_uv=np.array([320.0, 240.0])
        )
        frame = CameraFrame(timestamp=1.0, observations=[obs])
        assert len(frame.observations) == 1
        assert frame.image is None


class TestDroneConfig:
    def test_creation(self, sample_drone) -> None:
        assert sample_drone.mass > 0
        assert sample_drone.drag_coeffs.shape == (3,)
        assert sample_drone.camera_intrinsics.shape == (3, 3)
        assert sample_drone.camera_extrinsics.shape == (4, 4)
        assert sample_drone.name == "HERA-S-test"

    def test_imu_specs(self, sample_drone) -> None:
        assert "accel_bias_instability" in sample_drone.imu_specs
        assert "gyro_random_walk" in sample_drone.imu_specs


class TestMissionPackage:
    def test_creation(self, sample_mission) -> None:
        assert sample_mission.target[0] == pytest.approx(15000.0)
        assert len(sample_mission.landmarks) >= 1
        assert sample_mission.drop_point.shape == (3,)

    def test_corridor_grid(self, sample_mission) -> None:
        assert sample_mission.corridor_grid.ndim == 2


class TestSimResult:
    def test_creation(self) -> None:
        result = SimResult(
            true_states=[],
            estimated_states=[],
            timestamps=np.array([0.0]),
            position_errors=np.zeros((1, 3)),
            nis_values=np.zeros(1),
            covariances=[np.eye(17)],
            landmarks_matched=[],
            outcome="success",
            final_error=5.2,
        )
        assert result.outcome == "success"
        assert result.final_error < 15.0
        assert result.metadata == {}

    def test_metadata_default(self) -> None:
        result = SimResult(
            true_states=[], estimated_states=[],
            timestamps=np.array([]), position_errors=np.zeros((0, 3)),
            nis_values=np.array([]), covariances=[],
            landmarks_matched=[], outcome="aborted", final_error=999.0,
        )
        assert isinstance(result.metadata, dict)
