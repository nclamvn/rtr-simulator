"""Cone-based landmark generator — landmarks distributed in shrinking layers.

Cone geometry: base at drop point B (large radius), apex at target T (small/min radius).
Each layer is a cross-section with its own set of landmarks.
Density increases toward target — more landmarks where precision matters.
"""

import logging
from typing import Optional

import numpy as np

from core.physics.landmark._types import LANDMARK_TYPE_NAMES, LANDMARK_TYPES
from core.physics.landmark.base import LandmarkProvider
from core.physics.landmark.cluster import ClusterAnalyzer
from core.physics.terrain.base import TerrainProvider
from core.physics.types import (
    ConeConfig,
    ConeLayer,
    Landmark,
    LandmarkClusterDef,
)

logger = logging.getLogger(__name__)


class ConeLandmarkGenerator(LandmarkProvider):
    """Generates landmarks in cone layers from drop point B to target T."""

    def __init__(
        self,
        terrain: TerrainProvider,
        config: ConeConfig | None = None,
    ) -> None:
        self.terrain = terrain
        self.config = config or ConeConfig()
        self.landmarks: list[Landmark] = []
        self.clusters: list[LandmarkClusterDef] = []
        self.layers: list[ConeLayer] = []
        # Axis info (set after generate)
        self._axis_origin = np.zeros(3)
        self._axis_dir = np.array([1.0, 0.0, 0.0])
        self._axis_length = 1.0

    def generate(
        self,
        drop_point: np.ndarray,
        target: np.ndarray,
        seed: int = 42,
    ) -> tuple[list[Landmark], list[LandmarkClusterDef], list[ConeLayer]]:
        """Generate cone landmark layers from drop_point (base) to target (apex)."""
        rng = np.random.default_rng(seed)
        cfg = self.config

        # Cone axis
        axis_vec = target[:2] - drop_point[:2]
        D = np.linalg.norm(axis_vec)
        if D < 1.0:
            D = 1.0
        axis_dir = axis_vec / D
        perp_dir = np.array([-axis_dir[1], axis_dir[0]])

        self._axis_origin = drop_point.copy()
        self._axis_dir_2d = axis_dir
        self._axis_length = D

        N = cfg.num_layers
        num_types = len(LANDMARK_TYPE_NAMES)
        all_landmarks: list[Landmark] = []
        all_clusters: list[LandmarkClusterDef] = []
        all_layers: list[ConeLayer] = []
        lm_idx = 0

        for li in range(N):
            # Layer distance along axis
            frac = li / max(N - 1, 1)
            if cfg.layer_spacing_mode == "geometric":
                # Bunched near target: d increases faster near end
                d_i = D * (1.0 - (1.0 - frac) ** 2)
            else:
                d_i = D * frac

            # Cone radius at this layer (shrinks from base to apex)
            r_i = cfg.base_radius * cfg.trumpet_factor * (1.0 - d_i / D)
            r_i = max(r_i, cfg.min_layer_radius)

            # Layer center in NED
            center_ne = drop_point[:2] + d_i * axis_dir
            # Elevation from terrain at center
            try:
                elev = self.terrain.get_elevation(center_ne[0], center_ne[1])
            except (NotImplementedError, AttributeError):
                elev = 0.0
            center_3d = np.array([center_ne[0], center_ne[1], -elev])

            # Landmark count: interpolate base → final
            n_lm = int(round(
                cfg.landmarks_per_layer_base
                + (cfg.landmarks_per_layer_final - cfg.landmarks_per_layer_base) * frac
            ))
            n_lm = max(n_lm, 1)

            layer_landmarks: list[Landmark] = []
            type_pool = list(LANDMARK_TYPE_NAMES)
            rng.shuffle(type_pool)

            for j in range(n_lm):
                # Place in circular ring around layer center
                angle = 2 * np.pi * j / n_lm + rng.uniform(-0.3, 0.3)
                radial_dist = r_i * rng.uniform(0.3, 1.0)

                pos_ne = center_ne + radial_dist * np.array([
                    np.cos(angle), np.sin(angle)
                ])

                try:
                    lm_elev = self.terrain.get_elevation(pos_ne[0], pos_ne[1])
                except (NotImplementedError, AttributeError):
                    lm_elev = 0.0
                pos_3d = np.array([pos_ne[0], pos_ne[1], -lm_elev])

                lm_type = type_pool[j % num_types]

                desc_rng = np.random.default_rng(seed * 10000 + lm_idx)
                descriptor = desc_rng.integers(
                    0, 256, size=cfg.descriptor_dim // 8, dtype=np.uint8
                )

                lm = Landmark(
                    id=f"CL{li:02d}_L{j:02d}",
                    position=pos_3d,
                    descriptor=descriptor,
                    cluster_id=f"CK{li:02d}",
                    landmark_type=lm_type,
                )
                layer_landmarks.append(lm)
                lm_idx += 1

            # Cluster analysis
            diversity = ClusterAnalyzer.compute_diversity_score(layer_landmarks)
            p_cm = ClusterAnalyzer.compute_p_common_mode(layer_landmarks)

            cluster = LandmarkClusterDef(
                id=f"CK{li:02d}",
                landmarks=layer_landmarks,
                diversity_score=diversity,
                p_common_mode=p_cm,
                segment_id=f"Layer{li:02d}",
            )
            all_clusters.append(cluster)

            layer = ConeLayer(
                index=li,
                distance_from_base=d_i,
                radius=r_i,
                center=center_3d,
                landmark_count=n_lm,
                landmarks=layer_landmarks,
            )
            all_layers.append(layer)
            all_landmarks.extend(layer_landmarks)

            p_detect = ClusterAnalyzer.compute_detection_probability(
                cluster, cfg.p_individual_detect
            )
            if p_detect < 0.8:
                logger.warning(
                    "Layer %d has low detection probability: %.2f", li, p_detect
                )

        # Assign measurement types based on distance to target
        self._assign_measurement_types(all_layers, D)

        self.landmarks = all_landmarks
        self.clusters = all_clusters
        self.layers = all_layers
        return all_landmarks, all_clusters, all_layers

    def get_current_layer(self, position: np.ndarray) -> ConeLayer:
        """Determine which layer the drone is in by projecting onto cone axis."""
        if not self.layers:
            raise ValueError("No layers generated — call generate() first")
        d = self._project_distance(position)
        # Find nearest layer
        best_layer = self.layers[0]
        best_dist = abs(d - best_layer.distance_from_base)
        for layer in self.layers[1:]:
            dist = abs(d - layer.distance_from_base)
            if dist < best_dist:
                best_dist = dist
                best_layer = layer
        return best_layer

    def check_cone_boundary(
        self, position: np.ndarray
    ) -> tuple[bool, float]:
        """Check if position is inside cone. Returns (inside, margin).

        margin > 0 means inside (distance to boundary), margin < 0 means outside.
        """
        d = self._project_distance(position)
        D = self._axis_length

        # Cone radius at this distance
        if d < 0:
            r_cone = self.config.base_radius * self.config.trumpet_factor
        elif d > D:
            r_cone = self.config.min_layer_radius
        else:
            r_cone = self.config.base_radius * self.config.trumpet_factor * (1.0 - d / D)
            r_cone = max(r_cone, self.config.min_layer_radius)

        # Lateral distance from axis
        lateral = self._lateral_distance(position)
        margin = r_cone - lateral
        return bool(margin >= 0), float(margin)

    def get_visible_landmarks(
        self,
        position: np.ndarray,
        heading: float,
        terrain: TerrainProvider,
    ) -> list:
        """Get landmarks visible from current + next layer only."""
        if not self.layers:
            return []

        current = self.get_current_layer(position)
        idx = current.index

        # Collect landmarks from current + next layer
        candidate_landmarks = list(current.landmarks)
        if idx + 1 < len(self.layers):
            candidate_landmarks.extend(self.layers[idx + 1].landmarks)
        # Also include previous layer if drone is near boundary
        if idx > 0:
            d = self._project_distance(position)
            prev_d = self.layers[idx - 1].distance_from_base
            if abs(d - prev_d) < abs(d - current.distance_from_base) * 0.5:
                candidate_landmarks.extend(self.layers[idx - 1].landmarks)

        # Filter by range + heading + LOS
        cfg = self.config
        visible = []
        for lm in candidate_landmarks:
            delta = lm.position[:2] - position[:2]
            dist = np.linalg.norm(delta)
            if dist > cfg.max_recognition_range or dist < 1.0:
                continue
            bearing = np.arctan2(delta[1], delta[0])
            angle_diff = abs((bearing - heading + np.pi) % (2 * np.pi) - np.pi)
            if angle_diff > np.pi / 2:
                continue
            result = terrain.check_los(position, lm.position)
            if result.visible:
                visible.append(lm)

        visible.sort(key=lambda lm: np.linalg.norm(lm.position[:2] - position[:2]))
        return visible

    def get_cluster(self, cluster_id: str) -> LandmarkClusterDef:
        for c in self.clusters:
            if c.id == cluster_id:
                return c
        raise KeyError(f"Cluster {cluster_id} not found")

    def build_knowledge_graph(self) -> dict:
        """Build KG dict with layers instead of segments."""
        nodes: list[dict] = []
        edges: list[dict] = []

        for layer in self.layers:
            nodes.append({
                "id": f"Layer{layer.index:02d}",
                "type": "layer",
                "distance_from_base": layer.distance_from_base,
                "radius": layer.radius,
                "landmark_count": layer.landmark_count,
            })

        for cl in self.clusters:
            p_detect = ClusterAnalyzer.compute_detection_probability(
                cl, self.config.p_individual_detect
            )
            nodes.append({
                "id": cl.id, "type": "cluster",
                "diversity_score": cl.diversity_score,
                "p_detect": round(p_detect, 4),
            })
            edges.append({"from": cl.id, "to": cl.segment_id, "relation": "in_layer"})

        fm_nodes: set[str] = set()
        for lm in self.landmarks:
            nodes.append({
                "id": lm.id, "type": "landmark",
                "landmark_type": lm.landmark_type,
                "cluster_id": lm.cluster_id,
            })
            edges.append({"from": lm.id, "to": lm.cluster_id, "relation": "belongs_to"})
            info = LANDMARK_TYPES.get(lm.landmark_type, {})
            for mode in info.get("failure_modes", []):
                fm_nodes.add(mode)
                edges.append({"from": lm.id, "to": f"FM:{mode}", "relation": "failure_mode"})

        for fm in sorted(fm_nodes):
            nodes.append({"id": f"FM:{fm}", "type": "failure_mode", "name": fm})

        return {"nodes": nodes, "edges": edges}

    # ── Internal helpers ──

    def _assign_measurement_types(self, layers: list, total_distance: float) -> None:
        """Assign measurement type based on distance to target (Sec 3.5).

        Distance to target = total_distance - distance_from_base.
        >5km: CONTAINMENT, 1.5-5km: BEARING_METRIC, 0.1-1.5km: FULL_METRIC, <100m: TERMINAL.
        """
        for layer in layers:
            dist_to_target = total_distance - layer.distance_from_base
            if dist_to_target > 5000:
                layer.measurement_type = "containment"
            elif dist_to_target > 1500:
                layer.measurement_type = "bearing_metric"
            elif dist_to_target > 100:
                layer.measurement_type = "full_metric"
            else:
                layer.measurement_type = "terminal"

    def _project_distance(self, position: np.ndarray) -> float:
        """Project position onto cone axis → distance from base."""
        delta = position[:2] - self._axis_origin[:2]
        return float(np.dot(delta, self._axis_dir_2d))

    def _lateral_distance(self, position: np.ndarray) -> float:
        """Lateral distance from cone axis."""
        delta = position[:2] - self._axis_origin[:2]
        along = np.dot(delta, self._axis_dir_2d)
        proj = along * self._axis_dir_2d
        lateral_vec = delta - proj
        return float(np.linalg.norm(lateral_vec))
