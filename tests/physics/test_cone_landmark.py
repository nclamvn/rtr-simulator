"""Tests for cone-based landmark generator."""

import numpy as np
import pytest

from core.physics.landmark.cluster import ClusterAnalyzer
from core.physics.landmark.cone import ConeLandmarkGenerator
from core.physics.terrain.procedural import ProceduralTerrain
from core.physics.types import ConeConfig, ConeLayer, LandmarkClusterDef, TerrainConfig


@pytest.fixture
def flat_terrain() -> ProceduralTerrain:
    return ProceduralTerrain(TerrainConfig(ridge_height=0, base_elevation=0))


@pytest.fixture
def drop() -> np.ndarray:
    return np.zeros(3)


@pytest.fixture
def target() -> np.ndarray:
    return np.array([5000.0, 0.0, 0.0])


# ── Generation ────────────────────────────────────────────────


class TestConeGeneration:
    def test_creates_layers(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(num_layers=8))
        _, _, layers = gen.generate(drop, target)
        assert len(layers) == 8

    def test_total_landmarks(self, flat_terrain, drop, target) -> None:
        cfg = ConeConfig(num_layers=5, landmarks_per_layer_base=3, landmarks_per_layer_final=7)
        gen = ConeLandmarkGenerator(flat_terrain, cfg)
        lm, _, layers = gen.generate(drop, target)
        # Total should be sum of per-layer counts
        assert len(lm) == sum(l.landmark_count for l in layers)
        assert len(lm) > 0

    def test_deterministic(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig())
        l1, _, _ = gen.generate(drop, target, seed=42)
        l2, _, _ = gen.generate(drop, target, seed=42)
        np.testing.assert_array_equal(l1[0].position, l2[0].position)

    def test_different_seeds(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig())
        l1, _, _ = gen.generate(drop, target, seed=1)
        l2, _, _ = gen.generate(drop, target, seed=99)
        assert not np.allclose(l1[0].position, l2[0].position)

    def test_unique_ids(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig())
        lm, _, _ = gen.generate(drop, target)
        ids = [l.id for l in lm]
        assert len(ids) == len(set(ids))

    def test_descriptors(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig())
        lm, _, _ = gen.generate(drop, target)
        for l in lm:
            assert l.descriptor.shape == (32,)
            assert l.descriptor.dtype == np.uint8


# ── Cone Geometry ─────────────────────────────────────────────


class TestConeGeometry:
    def test_radii_shrink(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(num_layers=6))
        _, _, layers = gen.generate(drop, target)
        radii = [l.radius for l in layers]
        # Radii should decrease (or be clamped at min)
        for i in range(1, len(radii)):
            assert radii[i] <= radii[i - 1] + 0.01

    def test_layer_distances_increase(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(num_layers=6))
        _, _, layers = gen.generate(drop, target)
        dists = [l.distance_from_base for l in layers]
        for i in range(1, len(dists)):
            assert dists[i] > dists[i - 1]

    def test_first_layer_at_base(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(num_layers=5))
        _, _, layers = gen.generate(drop, target)
        assert layers[0].distance_from_base == pytest.approx(0.0)

    def test_last_layer_at_target(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(num_layers=5))
        _, _, layers = gen.generate(drop, target)
        assert layers[-1].distance_from_base == pytest.approx(5000.0, abs=1.0)

    def test_landmarks_within_layer_radius(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(num_layers=5))
        _, _, layers = gen.generate(drop, target)
        for layer in layers:
            for lm in layer.landmarks:
                # Lateral distance from layer center
                delta = lm.position[:2] - layer.center[:2]
                dist = np.linalg.norm(delta)
                assert dist <= layer.radius * 1.1  # small tolerance

    def test_more_landmarks_near_target(self, flat_terrain, drop, target) -> None:
        cfg = ConeConfig(num_layers=6, landmarks_per_layer_base=2, landmarks_per_layer_final=10)
        gen = ConeLandmarkGenerator(flat_terrain, cfg)
        _, _, layers = gen.generate(drop, target)
        assert layers[-1].landmark_count >= layers[0].landmark_count

    def test_geometric_spacing_bunches_near_target(self, flat_terrain, drop, target) -> None:
        cfg = ConeConfig(num_layers=6, layer_spacing_mode="geometric")
        gen = ConeLandmarkGenerator(flat_terrain, cfg)
        _, _, layers = gen.generate(drop, target)
        # Last two layers should be closer together than first two
        gap_start = layers[1].distance_from_base - layers[0].distance_from_base
        gap_end = layers[-1].distance_from_base - layers[-2].distance_from_base
        assert gap_end < gap_start

    def test_trumpet_flares_base(self, flat_terrain, drop, target) -> None:
        cfg_normal = ConeConfig(num_layers=3, trumpet_factor=1.0)
        cfg_flared = ConeConfig(num_layers=3, trumpet_factor=1.5)
        gen1 = ConeLandmarkGenerator(flat_terrain, cfg_normal)
        gen2 = ConeLandmarkGenerator(flat_terrain, cfg_flared)
        _, _, l1 = gen1.generate(drop, target)
        _, _, l2 = gen2.generate(drop, target)
        assert l2[0].radius > l1[0].radius


# ── Boundary Check ────────────────────────────────────────────


class TestConeBoundary:
    def test_center_is_inside(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(base_radius=1000))
        gen.generate(drop, target)
        inside, margin = gen.check_cone_boundary(np.array([2500, 0, -100]))
        assert inside is True
        assert margin > 0

    def test_outside_is_outside(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(base_radius=500))
        gen.generate(drop, target)
        # Far to the side at midpoint: radius is 250m, position 400m east
        inside, margin = gen.check_cone_boundary(np.array([2500, 400, -100]))
        assert inside is False
        assert margin < 0

    def test_at_base(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(base_radius=1000))
        gen.generate(drop, target)
        inside, _ = gen.check_cone_boundary(np.array([0, 500, -100]))
        assert inside is True  # 500 < 1000

    def test_at_apex(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(base_radius=1000, min_layer_radius=20))
        gen.generate(drop, target)
        inside, _ = gen.check_cone_boundary(np.array([5000, 15, -100]))
        assert inside is True  # 15 < 20 (min radius)


# ── Correction Direction ─────────────────────────────────────


class TestCorrectionDirection:
    def test_points_toward_axis_from_east(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(base_radius=1000))
        gen.generate(drop, target)
        # Drone is 200m east of axis at midpoint
        toward, dist = gen.get_correction_direction(np.array([2500, 200, -80]))
        assert dist == pytest.approx(200.0, abs=1.0)
        # Should point west (negative east)
        assert toward[1] < -0.9

    def test_points_toward_axis_from_west(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(base_radius=1000))
        gen.generate(drop, target)
        toward, dist = gen.get_correction_direction(np.array([2500, -300, -80]))
        assert dist == pytest.approx(300.0, abs=1.0)
        # Should point east (positive east)
        assert toward[1] > 0.9

    def test_on_axis_returns_zero(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(base_radius=1000))
        gen.generate(drop, target)
        toward, dist = gen.get_correction_direction(np.array([2500, 0, -80]))
        assert dist < 1e-3
        np.testing.assert_allclose(toward, [0, 0], atol=1e-6)


# ── Layer Filtering ───────────────────────────────────────────


class TestLayerFiltering:
    def test_get_current_layer(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(num_layers=5))
        gen.generate(drop, target)
        layer = gen.get_current_layer(np.array([2500, 0, -100]))
        # Should be near middle layer
        assert 1 <= layer.index <= 3

    def test_visible_only_nearby_layers(self, flat_terrain, drop, target) -> None:
        cfg = ConeConfig(num_layers=6, max_recognition_range=2000)
        gen = ConeLandmarkGenerator(flat_terrain, cfg)
        gen.generate(drop, target)
        # Drone at layer 2 area
        pos = np.array([2000, 0, -80])
        visible = gen.get_visible_landmarks(pos, 0.0, flat_terrain)
        current = gen.get_current_layer(pos)
        # All visible should be from nearby layers
        nearby_ids = set()
        for l in gen.layers:
            if abs(l.index - current.index) <= 1:
                for lm in l.landmarks:
                    nearby_ids.add(lm.id)
        for lm in visible:
            assert lm.id in nearby_ids or np.linalg.norm(lm.position[:2] - pos[:2]) < cfg.max_recognition_range


# ── Cluster Analysis ──────────────────────────────────────────


class TestConeCluster:
    def test_clusters_created(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(num_layers=4))
        _, clusters, _ = gen.generate(drop, target)
        assert len(clusters) == 4

    def test_cluster_diversity(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(num_layers=4))
        _, clusters, _ = gen.generate(drop, target)
        for cl in clusters:
            assert cl.diversity_score > 0

    def test_get_cluster(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(num_layers=4))
        gen.generate(drop, target)
        cl = gen.get_cluster("CK00")
        assert cl.id == "CK00"

    def test_get_cluster_not_found(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig())
        gen.generate(drop, target)
        with pytest.raises(KeyError):
            gen.get_cluster("NOPE")


class TestKnowledgeGraph:
    def test_kg_structure(self, flat_terrain, drop, target) -> None:
        gen = ConeLandmarkGenerator(flat_terrain, ConeConfig(num_layers=3))
        gen.generate(drop, target)
        kg = gen.build_knowledge_graph()
        assert "nodes" in kg
        assert "edges" in kg
        layer_nodes = [n for n in kg["nodes"] if n["type"] == "layer"]
        assert len(layer_nodes) == 3
