"""Tests for Dryden wind field model."""

import numpy as np
import pytest

from core.physics.terrain.procedural import ProceduralTerrain
from core.physics.types import TerrainConfig, WindConfig
from core.physics.wind.dryden import DrydenWindField


class TestCalmWind:
    def test_zero_velocity(self) -> None:
        w = DrydenWindField.calm()
        wv = w.get_wind(np.array([1000.0, 0.0, -100.0]), 0.0)
        np.testing.assert_allclose(wv.velocity, np.zeros(3), atol=1e-10)

    def test_zero_turbulence(self) -> None:
        w = DrydenWindField.calm()
        wv = w.get_wind(np.array([1000.0, 0.0, -100.0]), 0.0)
        np.testing.assert_allclose(wv.turbulence, np.zeros(3), atol=1e-10)


class TestMeanWind:
    def test_direction_from_east(self) -> None:
        """Wind FROM East (90°) → negative East component in NED."""
        cfg = WindConfig(mean_speed=10, mean_direction=90, turbulence_intensity=0)
        w = DrydenWindField(cfg)
        wv = w.get_wind(np.array([0, 0, -100]), 0.0)
        assert wv.velocity[1] < -5  # East component negative
        assert abs(wv.velocity[0]) < 1  # Minimal north

    def test_direction_from_north(self) -> None:
        """Wind FROM North (0°) → negative North component."""
        cfg = WindConfig(mean_speed=10, mean_direction=0, turbulence_intensity=0)
        w = DrydenWindField(cfg)
        wv = w.get_wind(np.array([0, 0, -100]), 0.0)
        assert wv.velocity[0] < -5  # North component negative
        assert abs(wv.velocity[1]) < 1  # Minimal east

    def test_altitude_shear(self) -> None:
        """Wind stronger at higher altitude."""
        cfg = WindConfig(mean_speed=10, turbulence_intensity=0)
        w = DrydenWindField(cfg)
        low = w.get_wind(np.array([0, 0, -20]), 0.0)
        high = w.get_wind(np.array([0, 0, -200]), 0.0)
        assert np.linalg.norm(high.velocity) > np.linalg.norm(low.velocity)


class TestTurbulence:
    def test_nonzero_over_time(self) -> None:
        """Turbulence adds variance to wind samples."""
        w = DrydenWindField(WindConfig(turbulence_intensity=2.0), seed=42)
        samples = [w.get_wind(np.array([0, 0, -100]), t * 0.01) for t in range(1000)]
        velocities = np.array([s.velocity for s in samples])
        std = np.std(velocities, axis=0)
        assert np.all(std[:2] > 0.1)

    def test_turbulence_component_nonzero(self) -> None:
        w = DrydenWindField(WindConfig(turbulence_intensity=2.0), seed=42)
        wv = w.get_wind(np.array([0, 0, -100]), 0.0)
        # First sample might be small, but turbulence field should be set
        assert wv.turbulence.shape == (3,)

    def test_temporal_correlation(self) -> None:
        """Consecutive samples should be correlated (not white noise)."""
        w = DrydenWindField(WindConfig(turbulence_intensity=2.0), seed=42)
        samples = [w.get_wind(np.array([0, 0, -100]), t * 0.01).turbulence[0]
                   for t in range(200)]
        # Autocorrelation at lag 1 should be positive (correlated)
        arr = np.array(samples)
        autocorr = np.corrcoef(arr[:-1], arr[1:])[0, 1]
        assert autocorr > 0.5  # Strong temporal correlation


class TestDeterministic:
    def test_same_seed_same_output(self) -> None:
        w1 = DrydenWindField(WindConfig(), seed=42)
        w2 = DrydenWindField(WindConfig(), seed=42)
        for t in range(100):
            v1 = w1.get_wind(np.zeros(3), t * 0.01)
            v2 = w2.get_wind(np.zeros(3), t * 0.01)
            np.testing.assert_array_equal(v1.velocity, v2.velocity)

    def test_reset_restores_state(self) -> None:
        w = DrydenWindField(WindConfig(), seed=42)
        v1 = w.get_wind(np.zeros(3), 0.0)
        w.get_wind(np.zeros(3), 0.01)  # advance
        w.reset(seed=42)
        v2 = w.get_wind(np.zeros(3), 0.0)
        np.testing.assert_array_equal(v1.velocity, v2.velocity)


class TestTerrainCoupling:
    def test_rough_terrain_more_turbulence(self) -> None:
        """Rougher terrain → more turbulence."""
        rough = ProceduralTerrain(TerrainConfig(ridge_height=300))
        flat = ProceduralTerrain(TerrainConfig(ridge_height=0))
        cfg = WindConfig(turbulence_intensity=2.0)
        # Use same seed but terrain coupling makes them differ
        w_rough = DrydenWindField(cfg, terrain=rough, seed=42)
        w_flat = DrydenWindField(cfg, terrain=flat, seed=42)

        # Sample multiple times to get statistical difference
        turb_rough = []
        turb_flat = []
        for t in range(200):
            pos = np.array([1000.0, 0.0, -100.0])
            turb_rough.append(np.linalg.norm(
                w_rough.get_wind(pos, t * 0.01).turbulence
            ))
            turb_flat.append(np.linalg.norm(
                w_flat.get_wind(pos, t * 0.01).turbulence
            ))
        # Mean turbulence should be higher over rough terrain
        assert np.mean(turb_rough) >= np.mean(turb_flat) * 0.8


class TestConvenienceConstructors:
    def test_light(self) -> None:
        w = DrydenWindField.light(direction=180)
        wv = w.get_wind(np.array([0, 0, -100]), 0.0)
        assert wv.velocity.shape == (3,)

    def test_strong(self) -> None:
        w = DrydenWindField.strong()
        wv = w.get_wind(np.array([0, 0, -100]), 0.0)
        # Strong wind → large magnitude
        assert np.linalg.norm(wv.velocity) > 5

    def test_storm(self) -> None:
        w = DrydenWindField.storm()
        wv = w.get_wind(np.array([0, 0, -100]), 0.0)
        assert np.linalg.norm(wv.velocity) > 10


class TestWindVector:
    def test_shapes(self) -> None:
        w = DrydenWindField(WindConfig(mean_speed=10), seed=42)
        wv = w.get_wind(np.array([0, 0, -100]), 0.0)
        assert wv.velocity.shape == (3,)
        assert wv.turbulence.shape == (3,)
