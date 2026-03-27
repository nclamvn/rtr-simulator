"""Tests for landmark chain generation and cluster analysis."""

import numpy as np
import pytest

from core.physics.landmark._types import LANDMARK_TYPES
from core.physics.landmark.chain import LandmarkChainGenerator
from core.physics.landmark.cluster import ClusterAnalyzer
from core.physics.terrain.procedural import ProceduralTerrain
from core.physics.types import (
    Landmark,
    LandmarkClusterDef,
    LandmarkConfig,
    TerrainConfig,
)


@pytest.fixture
def flat_terrain() -> ProceduralTerrain:
    return ProceduralTerrain(TerrainConfig(ridge_height=0, base_elevation=0))


@pytest.fixture
def default_terrain() -> ProceduralTerrain:
    return ProceduralTerrain(TerrainConfig())


@pytest.fixture
def corridor_start() -> np.ndarray:
    return np.zeros(3)


@pytest.fixture
def corridor_end() -> np.ndarray:
    return np.array([15000.0, 0.0, 0.0])


# ── Chain Generation ──────────────────────────────────────────


class TestChainGeneration:
    def test_count(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        gen = LandmarkChainGenerator(flat_terrain, LandmarkConfig(num_landmarks=40))
        landmarks, clusters = gen.generate(corridor_start, corridor_end)
        assert len(landmarks) == 40
        assert len(clusters) == 40 // 5  # 8 clusters

    def test_deterministic(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        gen = LandmarkChainGenerator(flat_terrain, LandmarkConfig())
        l1, _ = gen.generate(corridor_start, corridor_end, seed=1)
        l2, _ = gen.generate(corridor_start, corridor_end, seed=1)
        np.testing.assert_array_equal(l1[0].position, l2[0].position)
        np.testing.assert_array_equal(l1[0].descriptor, l2[0].descriptor)

    def test_different_seeds(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        gen = LandmarkChainGenerator(flat_terrain, LandmarkConfig())
        l1, _ = gen.generate(corridor_start, corridor_end, seed=1)
        l2, _ = gen.generate(corridor_start, corridor_end, seed=99)
        assert not np.allclose(l1[0].position, l2[0].position)

    def test_landmarks_along_corridor(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        gen = LandmarkChainGenerator(flat_terrain, LandmarkConfig())
        landmarks, _ = gen.generate(corridor_start, corridor_end)
        for lm in landmarks:
            assert 0 <= lm.position[0] <= 15000, f"{lm.id} north={lm.position[0]}"
            assert -1000 <= lm.position[1] <= 1000, f"{lm.id} east={lm.position[1]}"

    def test_descriptor_shape(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        gen = LandmarkChainGenerator(flat_terrain, LandmarkConfig())
        landmarks, _ = gen.generate(corridor_start, corridor_end)
        for lm in landmarks:
            assert lm.descriptor.shape == (32,)  # 256 bits = 32 bytes
            assert lm.descriptor.dtype == np.uint8

    def test_unique_ids(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        gen = LandmarkChainGenerator(flat_terrain, LandmarkConfig())
        landmarks, _ = gen.generate(corridor_start, corridor_end)
        ids = [lm.id for lm in landmarks]
        assert len(ids) == len(set(ids))

    def test_cluster_contains_landmarks(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        gen = LandmarkChainGenerator(flat_terrain, LandmarkConfig(cluster_size=5))
        _, clusters = gen.generate(corridor_start, corridor_end)
        for cl in clusters:
            assert len(cl.landmarks) == 5


# ── Cluster Analysis ──────────────────────────────────────────


class TestClusterAnalysis:
    def test_diversity_all_same(self) -> None:
        lms = [
            Landmark(f"L{i}", np.zeros(3), np.zeros(32, dtype=np.uint8), "C0", "bridge")
            for i in range(5)
        ]
        score = ClusterAnalyzer.compute_diversity_score(lms)
        assert score == pytest.approx(0.2)  # 1/5

    def test_diversity_all_different(self) -> None:
        types = ["bridge", "junction", "lake", "building", "road_marking"]
        lms = [
            Landmark(f"L{i}", np.zeros(3), np.zeros(32, dtype=np.uint8), "C0", t)
            for i, t in enumerate(types)
        ]
        score = ClusterAnalyzer.compute_diversity_score(lms)
        assert score >= 0.9  # 5/5 + potential bonus

    def test_p_common_mode_same_type(self) -> None:
        lms = [
            Landmark(f"L{i}", np.zeros(3), np.zeros(32, dtype=np.uint8), "C0", "bridge")
            for i in range(5)
        ]
        p_cm = ClusterAnalyzer.compute_p_common_mode(lms)
        assert p_cm == 0.5  # All same type

    def test_p_common_mode_diverse(self) -> None:
        types = ["bridge", "junction", "lake", "building", "road_marking"]
        lms = [
            Landmark(f"L{i}", np.zeros(3), np.zeros(32, dtype=np.uint8), "C0", t)
            for i, t in enumerate(types)
        ]
        p_cm = ClusterAnalyzer.compute_p_common_mode(lms)
        assert p_cm < 0.5  # More diverse → lower P_cm

    def test_detection_probability_formula(self) -> None:
        """P(detect) matches đề án formula exactly."""
        p_ind = 0.7
        p_cm = 0.15
        n = 5
        lms = [
            Landmark(f"L{i}", np.zeros(3), np.zeros(32, dtype=np.uint8), "C0", "bridge")
            for i in range(n)
        ]
        cluster = LandmarkClusterDef("C0", lms, 0.5, p_cm, "S0")
        p_detect = ClusterAnalyzer.compute_detection_probability(cluster, p_ind)

        # Manual calculation
        p_all_miss = p_cm + (1 - p_cm) * (1 - p_ind) ** n
        expected = 1 - p_all_miss
        assert p_detect == pytest.approx(expected)

    def test_detection_probability_conservative(self) -> None:
        """P(detect) with correlation < independent assumption."""
        p_ind = 0.7
        p_cm = 0.15
        n = 5
        lms = [
            Landmark(f"L{i}", np.zeros(3), np.zeros(32, dtype=np.uint8), "C0", "bridge")
            for i in range(n)
        ]
        cluster = LandmarkClusterDef("C0", lms, 0.5, p_cm, "S0")
        p_detect = ClusterAnalyzer.compute_detection_probability(cluster, p_ind)
        p_independent = 1 - (1 - p_ind) ** n
        assert p_detect < p_independent
        assert p_detect > 0.8

    def test_generated_cluster_diversity(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        gen = LandmarkChainGenerator(flat_terrain, LandmarkConfig())
        _, clusters = gen.generate(corridor_start, corridor_end)
        for cl in clusters:
            assert cl.diversity_score > 0.3


# ── Visibility ────────────────────────────────────────────────


class TestVisibility:
    def test_visible_landmarks_heading(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        # Use large recognition range to ensure visibility
        cfg = LandmarkConfig(max_recognition_range=2000.0)
        gen = LandmarkChainGenerator(flat_terrain, cfg)
        gen.generate(corridor_start, corridor_end)
        visible = gen.get_visible_landmarks(
            position=np.array([5000.0, 0.0, -100.0]),
            heading=0.0,  # facing north
            terrain=flat_terrain,
        )
        for lm in visible:
            assert lm.position[0] >= 5000.0  # All ahead

    def test_visible_count_reasonable(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        # Position near cluster C02 center (~4688m) with large range
        cfg = LandmarkConfig(max_recognition_range=2000.0)
        gen = LandmarkChainGenerator(flat_terrain, cfg)
        gen.generate(corridor_start, corridor_end)
        visible = gen.get_visible_landmarks(
            position=np.array([4500.0, 0.0, -100.0]),
            heading=0.0,
            terrain=flat_terrain,
        )
        # Should see landmarks in clusters ahead within range
        assert len(visible) > 0

    def test_get_cluster(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        gen = LandmarkChainGenerator(flat_terrain, LandmarkConfig())
        gen.generate(corridor_start, corridor_end)
        cl = gen.get_cluster("C00")
        assert cl.id == "C00"
        assert len(cl.landmarks) > 0

    def test_get_cluster_not_found(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        gen = LandmarkChainGenerator(flat_terrain, LandmarkConfig())
        gen.generate(corridor_start, corridor_end)
        with pytest.raises(KeyError):
            gen.get_cluster("C99")


# ── Knowledge Graph ───────────────────────────────────────────


class TestKnowledgeGraph:
    def test_kg_structure(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        gen = LandmarkChainGenerator(
            flat_terrain, LandmarkConfig(num_landmarks=10, cluster_size=5)
        )
        gen.generate(corridor_start, corridor_end)
        kg = gen.build_knowledge_graph()
        assert "nodes" in kg
        assert "edges" in kg
        assert len(kg["nodes"]) >= 10  # landmarks + clusters + segments + failure modes

    def test_kg_has_failure_mode_nodes(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        gen = LandmarkChainGenerator(flat_terrain, LandmarkConfig())
        gen.generate(corridor_start, corridor_end)
        kg = gen.build_knowledge_graph()
        fm_nodes = [n for n in kg["nodes"] if n["type"] == "failure_mode"]
        assert len(fm_nodes) > 0

    def test_kg_edges_reference_valid_nodes(
        self, flat_terrain, corridor_start, corridor_end
    ) -> None:
        gen = LandmarkChainGenerator(
            flat_terrain, LandmarkConfig(num_landmarks=10, cluster_size=5)
        )
        gen.generate(corridor_start, corridor_end)
        kg = gen.build_knowledge_graph()
        node_ids = {n["id"] for n in kg["nodes"]}
        for edge in kg["edges"]:
            assert edge["from"] in node_ids, f"Edge from unknown node: {edge['from']}"
            assert edge["to"] in node_ids, f"Edge to unknown node: {edge['to']}"
