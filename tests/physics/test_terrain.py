"""Tests for terrain system — ProceduralTerrain + DEMTerrain."""

import numpy as np
import pytest

from core.physics.terrain.procedural import ProceduralTerrain
from core.physics.types import TerrainConfig


class TestProceduralElevation:
    def test_deterministic(self) -> None:
        """Same seed → same elevation."""
        cfg = TerrainConfig(seed=42)
        t1 = ProceduralTerrain(cfg)
        t2 = ProceduralTerrain(cfg)
        assert t1.get_elevation(1000, 500) == t2.get_elevation(1000, 500)

    def test_different_seeds(self) -> None:
        """Different seeds → different elevation."""
        t1 = ProceduralTerrain(TerrainConfig(seed=42))
        t2 = ProceduralTerrain(TerrainConfig(seed=99))
        # Very unlikely to be equal at arbitrary point
        assert t1.get_elevation(1000, 500) != t2.get_elevation(1000, 500)

    def test_elevation_non_negative(self) -> None:
        """All elevations must be >= 0."""
        t = ProceduralTerrain(TerrainConfig())
        for n in range(0, 15000, 1000):
            for e in range(-1000, 1000, 500):
                elev = t.get_elevation(float(n), float(e))
                assert elev >= 0, f"Negative elevation at ({n}, {e}): {elev}"

    def test_elevation_in_range(self) -> None:
        """Elevation should be reasonable: base(50) + ridge(200) + noise."""
        t = ProceduralTerrain(TerrainConfig())
        for n in range(0, 15000, 500):
            elev = t.get_elevation(float(n), 0.0)
            assert elev <= 500, f"Elevation too high at ({n}, 0): {elev}"

    def test_default_config(self) -> None:
        """Works with default config."""
        t = ProceduralTerrain()
        elev = t.get_elevation(0, 0)
        assert isinstance(elev, float)
        assert elev >= 0


class TestProceduralLOS:
    def test_los_clear_high_altitude(self) -> None:
        """High altitude observer should see distant point."""
        t = ProceduralTerrain(TerrainConfig())
        # NED: Z down, so -500 = 500m altitude
        from_pos = np.array([0.0, 0.0, -500.0])
        to_pos = np.array([1000.0, 0.0, -500.0])
        result = t.check_los(from_pos, to_pos)
        assert result.visible is True

    def test_los_underground_blocked(self) -> None:
        """Observer underground should be blocked."""
        cfg = TerrainConfig(base_elevation=100.0, ridge_height=0.0)
        t = ProceduralTerrain(cfg)
        # Both at 10m altitude, terrain at 100m → blocked
        from_pos = np.array([0.0, 0.0, -10.0])
        to_pos = np.array([1000.0, 0.0, -10.0])
        result = t.check_los(from_pos, to_pos)
        assert result.visible is False
        assert result.occlusion_point is not None

    def test_los_returns_correct_types(self) -> None:
        t = ProceduralTerrain(TerrainConfig())
        from_pos = np.array([0.0, 0.0, -10.0])
        to_pos = np.array([5000.0, 0.0, -10.0])
        result = t.check_los(from_pos, to_pos)
        assert isinstance(result.visible, bool)
        assert isinstance(result.distance, float)

    def test_los_zero_distance(self) -> None:
        t = ProceduralTerrain(TerrainConfig())
        pos = np.array([100.0, 100.0, -500.0])
        result = t.check_los(pos, pos)
        assert result.visible is True
        assert result.distance == 0.0


class TestProceduralProfile:
    def test_profile_shape(self) -> None:
        t = ProceduralTerrain(TerrainConfig())
        profile = t.get_profile(np.array([0.0, 0.0]), np.array([15000.0, 0.0]), 100)
        assert profile.shape == (100, 3)

    def test_profile_endpoints(self) -> None:
        t = ProceduralTerrain(TerrainConfig())
        profile = t.get_profile(np.array([0.0, 0.0]), np.array([15000.0, 0.0]), 100)
        assert profile[0, 0] == pytest.approx(0.0)
        assert profile[-1, 0] == pytest.approx(15000.0)

    def test_profile_elevations_match(self) -> None:
        """Profile elevations should match direct queries."""
        t = ProceduralTerrain(TerrainConfig())
        profile = t.get_profile(np.array([0.0, 0.0]), np.array([5000.0, 0.0]), 10)
        for i in range(10):
            n, e, elev = profile[i]
            assert elev == pytest.approx(t.get_elevation(n, e))


class TestProceduralNormal:
    def test_normal_shape(self) -> None:
        t = ProceduralTerrain(TerrainConfig())
        n = t.get_normal(1000.0, 500.0)
        assert n.shape == (3,)

    def test_normal_unit(self) -> None:
        t = ProceduralTerrain(TerrainConfig())
        n = t.get_normal(1000.0, 500.0)
        assert np.linalg.norm(n) == pytest.approx(1.0, abs=1e-6)

    def test_flat_terrain_normal_points_up(self) -> None:
        """Flat terrain: normal should be close to [0, 0, -1] (NED up)."""
        cfg = TerrainConfig(ridge_height=0.0, base_elevation=100.0)
        t = ProceduralTerrain(cfg)
        n = t.get_normal(5000.0, 0.0)
        # Z component should be dominant and negative (pointing up in NED)
        assert n[2] < -0.9


class TestProceduralRoughness:
    def test_roughness_range(self) -> None:
        t = ProceduralTerrain(TerrainConfig())
        r = t.get_roughness(1000.0, 500.0)
        assert 0.0 <= r <= 1.0

    def test_flat_terrain_low_roughness(self) -> None:
        cfg = TerrainConfig(ridge_height=0.0, noise_octaves=0)
        t = ProceduralTerrain(cfg)
        r = t.get_roughness(1000.0, 500.0)
        assert r < 0.1


class TestDEMTerrain:
    def test_import_error_without_rasterio(self) -> None:
        """DEMTerrain should raise ImportError if rasterio missing."""
        # This test only works if rasterio is NOT installed
        try:
            import rasterio  # noqa: F401

            pytest.skip("rasterio is installed — cannot test ImportError")
        except ImportError:
            from core.physics.terrain.dem import DEMTerrain

            with pytest.raises(ImportError, match="rasterio"):
                DEMTerrain("nonexistent.tif", (10.0, 106.0))

    def test_from_srtm_not_implemented(self) -> None:
        from core.physics.terrain.dem import DEMTerrain

        with pytest.raises(NotImplementedError, match="SRTM"):
            DEMTerrain.from_srtm(10.0, 106.0)
