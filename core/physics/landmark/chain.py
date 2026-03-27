"""Landmark chain generator — generates landmarks along corridor B→T.

Per đề án Section 2.4 — Hera at 500m scans corridor, AI selects landmarks.
This module replicates that process via procedural generation.
"""

import logging
from typing import Optional

import numpy as np

from core.physics.landmark._types import LANDMARK_TYPE_NAMES, LANDMARK_TYPES
from core.physics.landmark.base import LandmarkProvider
from core.physics.landmark.cluster import ClusterAnalyzer
from core.physics.terrain.base import TerrainProvider
from core.physics.types import (
    Landmark,
    LandmarkClusterDef,
    LandmarkConfig,
)

logger = logging.getLogger(__name__)


class LandmarkChainGenerator(LandmarkProvider):
    """Generates a chain of 30-50 landmarks along corridor B→T."""

    def __init__(
        self,
        terrain: TerrainProvider,
        config: LandmarkConfig | None = None,
    ) -> None:
        self.terrain = terrain
        self.config = config or LandmarkConfig()
        self.landmarks: list[Landmark] = []
        self.clusters: list[LandmarkClusterDef] = []

    def generate(
        self,
        corridor_start: np.ndarray,
        corridor_end: np.ndarray,
        seed: int = 42,
    ) -> tuple[list[Landmark], list[LandmarkClusterDef]]:
        """Generate landmark chain along corridor.

        Returns (landmarks, clusters).
        """
        rng = np.random.default_rng(seed)
        cfg = self.config

        corridor_vec = corridor_end[:2] - corridor_start[:2]
        corridor_length = np.linalg.norm(corridor_vec)
        corridor_dir = corridor_vec / max(corridor_length, 1e-6)
        # Perpendicular direction
        perp_dir = np.array([-corridor_dir[1], corridor_dir[0]])

        num_clusters = cfg.num_landmarks // cfg.cluster_size
        num_types = len(LANDMARK_TYPE_NAMES)

        all_landmarks: list[Landmark] = []
        all_clusters: list[LandmarkClusterDef] = []

        for ci in range(num_clusters):
            # Segment center along corridor
            t_frac = (ci + 0.5) / num_clusters
            center_ne = corridor_start[:2] + t_frac * corridor_vec
            segment_id = f"S{ci:02d}"

            cluster_landmarks: list[Landmark] = []

            # Ensure type diversity: assign types round-robin + shuffle
            type_pool = list(LANDMARK_TYPE_NAMES)
            rng.shuffle(type_pool)

            for li in range(cfg.cluster_size):
                lm_idx = ci * cfg.cluster_size + li

                # Position: random within segment bounds
                along_offset = rng.uniform(
                    -cfg.segment_spacing / 2, cfg.segment_spacing / 2
                )
                cross_offset = rng.uniform(
                    -cfg.corridor_width / 2, cfg.corridor_width / 2
                )
                pos_ne = (
                    center_ne
                    + along_offset * corridor_dir
                    + cross_offset * perp_dir
                )

                # Clamp to corridor bounds
                pos_ne[0] = np.clip(pos_ne[0], corridor_start[0], corridor_end[0])

                # Elevation from terrain
                elev = self.terrain.get_elevation(pos_ne[0], pos_ne[1])
                # NED: landmark position at ground level, Z = -elevation
                pos_3d = np.array([pos_ne[0], pos_ne[1], -elev])

                # Assign type with diversity enforcement
                lm_type = type_pool[li % num_types]

                # Generate deterministic descriptor (256 bits = 32 bytes)
                desc_rng = np.random.default_rng(seed * 10000 + lm_idx)
                descriptor = desc_rng.integers(
                    0, 256, size=cfg.descriptor_dim // 8, dtype=np.uint8
                )

                lm_id = f"L{lm_idx:03d}"

                landmark = Landmark(
                    id=lm_id,
                    position=pos_3d,
                    descriptor=descriptor,
                    cluster_id=f"C{ci:02d}",
                    landmark_type=lm_type,
                )
                cluster_landmarks.append(landmark)

            # Compute cluster metrics
            diversity = ClusterAnalyzer.compute_diversity_score(cluster_landmarks)
            p_cm = ClusterAnalyzer.compute_p_common_mode(cluster_landmarks)

            cluster = LandmarkClusterDef(
                id=f"C{ci:02d}",
                landmarks=cluster_landmarks,
                diversity_score=diversity,
                p_common_mode=p_cm,
                segment_id=segment_id,
            )
            all_clusters.append(cluster)
            all_landmarks.extend(cluster_landmarks)

            # Log detection probability
            p_detect = ClusterAnalyzer.compute_detection_probability(
                cluster, cfg.p_individual_detect
            )
            if p_detect < 0.8:
                logger.warning(
                    "Cluster %s has low detection probability: %.2f",
                    cluster.id,
                    p_detect,
                )

        # Validate: LOS check from flight altitudes
        self._validate_los(all_landmarks, rng)

        self.landmarks = all_landmarks
        self.clusters = all_clusters
        return all_landmarks, all_clusters

    def _validate_los(
        self, landmarks: list[Landmark], rng: np.random.Generator
    ) -> None:
        """Check each landmark is visible from at least one altitude."""
        cfg = self.config
        altitudes = [cfg.min_altitude_check, cfg.max_altitude_check,
                     (cfg.min_altitude_check + cfg.max_altitude_check) / 2]

        for lm in landmarks:
            visible = False
            for alt in altitudes:
                # Observer directly above landmark at altitude
                obs_pos = np.array([lm.position[0], lm.position[1], -alt])
                result = self.terrain.check_los(obs_pos, lm.position)
                if result.visible:
                    visible = True
                    break
            if not visible:
                logger.warning(
                    "Landmark %s not visible from any check altitude", lm.id
                )

    def get_visible_landmarks(
        self,
        position: np.ndarray,
        heading: float,
        terrain: TerrainProvider,
    ) -> list:
        """Get landmarks visible from drone position + heading.

        Filters:
        1. In front of drone (within ±90° of heading)
        2. Within max recognition range
        3. LOS clear via terrain
        """
        cfg = self.config
        visible = []

        for lm in self.landmarks:
            # Vector from drone to landmark
            delta = lm.position[:2] - position[:2]
            dist = np.linalg.norm(delta)

            # Range check
            if dist > cfg.max_recognition_range or dist < 1.0:
                continue

            # Heading check: landmark must be within ±90° of heading
            bearing = np.arctan2(delta[1], delta[0])
            angle_diff = abs(_wrap_angle(bearing - heading))
            if angle_diff > np.pi / 2:
                continue

            # LOS check
            result = terrain.check_los(position, lm.position)
            if result.visible:
                visible.append(lm)

        # Sort by distance
        visible.sort(
            key=lambda lm: np.linalg.norm(lm.position[:2] - position[:2])
        )
        return visible

    def get_cluster(self, cluster_id: str) -> LandmarkClusterDef:
        """Get cluster by ID."""
        for c in self.clusters:
            if c.id == cluster_id:
                return c
        raise KeyError(f"Cluster {cluster_id} not found")

    def build_knowledge_graph(self, zep_client: Optional[object] = None) -> dict:
        """Build terrain knowledge graph as dict (or push to Zep if available).

        Per đề án 4.4 — nodes and edges for failure mode correlation.
        """
        nodes: list[dict] = []
        edges: list[dict] = []

        # Segment nodes
        segment_ids = set()
        for cl in self.clusters:
            segment_ids.add(cl.segment_id)
        for seg_id in sorted(segment_ids):
            # Count landmarks in this segment
            seg_landmarks = [
                lm
                for cl in self.clusters
                if cl.segment_id == seg_id
                for lm in cl.landmarks
            ]
            nodes.append({
                "id": seg_id,
                "type": "segment",
                "landmark_count": len(seg_landmarks),
            })

        # Cluster nodes
        for cl in self.clusters:
            p_detect = ClusterAnalyzer.compute_detection_probability(
                cl, self.config.p_individual_detect
            )
            nodes.append({
                "id": cl.id,
                "type": "cluster",
                "diversity_score": cl.diversity_score,
                "p_detect": round(p_detect, 4),
                "p_common_mode": round(cl.p_common_mode, 4),
            })
            edges.append({
                "from": cl.id,
                "to": cl.segment_id,
                "relation": "in_segment",
            })

        # Landmark nodes + edges
        failure_mode_nodes: set[str] = set()
        for lm in self.landmarks:
            nodes.append({
                "id": lm.id,
                "type": "landmark",
                "landmark_type": lm.landmark_type,
                "position": lm.position.tolist(),
                "cluster_id": lm.cluster_id,
            })
            edges.append({
                "from": lm.id,
                "to": lm.cluster_id,
                "relation": "belongs_to",
            })

            # Failure mode edges
            info = LANDMARK_TYPES.get(lm.landmark_type, {})
            for mode in info.get("failure_modes", []):
                failure_mode_nodes.add(mode)
                edges.append({
                    "from": lm.id,
                    "to": f"FM:{mode}",
                    "relation": "failure_mode",
                })

        # Failure mode nodes
        for fm in sorted(failure_mode_nodes):
            nodes.append({"id": f"FM:{fm}", "type": "failure_mode", "name": fm})

        kg = {"nodes": nodes, "edges": edges}

        if zep_client is not None:
            logger.info("Zep KG push: %d nodes, %d edges", len(nodes), len(edges))
            # zep_client integration deferred — would push nodes/edges here

        return kg

    def to_mission_package_data(self) -> dict:
        """Serialize landmarks + clusters for MissionPackage."""
        return {
            "landmarks": self.landmarks,
            "clusters": self.clusters,
        }


def _wrap_angle(angle: float) -> float:
    """Wrap angle to [-π, π]."""
    while angle > np.pi:
        angle -= 2 * np.pi
    while angle < -np.pi:
        angle += 2 * np.pi
    return angle
