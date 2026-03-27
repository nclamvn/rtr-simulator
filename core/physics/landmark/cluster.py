"""Landmark cluster analysis — diversity scoring and detection probability.

Per đề án Section 2.4.3 — cluster-level failure analysis.
"""

from core.physics.landmark._types import FAILURE_CORRELATIONS, LANDMARK_TYPES
from core.physics.types import Landmark, LandmarkClusterDef


class ClusterAnalyzer:
    """Analyzes landmark cluster diversity and common-mode failure probability."""

    @staticmethod
    def compute_p_common_mode(landmarks: list) -> float:
        """P_cm from shared failure modes within cluster.

        1. Collect all failure modes for each landmark type.
        2. Find shared modes (appear in 2+ landmarks).
        3. P_cm = max correlation among shared mode pairs.
           - If no shared modes: P_cm = 0.05 (baseline).
           - If all same type: P_cm = 0.5 (high correlation).
        """
        if not landmarks:
            return 0.0

        types = [lm.landmark_type for lm in landmarks]

        # All same type → high common mode
        if len(set(types)) == 1:
            return 0.5

        # Collect failure modes per landmark
        all_modes: list[set[str]] = []
        for lm in landmarks:
            info = LANDMARK_TYPES.get(lm.landmark_type, {})
            modes = set(info.get("failure_modes", []))
            all_modes.append(modes)

        # Find modes that appear in 2+ landmarks
        from collections import Counter

        mode_counts: Counter[str] = Counter()
        for modes in all_modes:
            for m in modes:
                mode_counts[m] += 1
        shared_modes = [m for m, c in mode_counts.items() if c >= 2]

        if not shared_modes:
            return 0.05  # Baseline — no shared modes

        # Max correlation among shared mode pairs
        max_corr = 0.0
        for i, m1 in enumerate(shared_modes):
            for m2 in shared_modes[i + 1 :]:
                pair = (m1, m2)
                pair_rev = (m2, m1)
                corr = FAILURE_CORRELATIONS.get(
                    pair, FAILURE_CORRELATIONS.get(pair_rev, 0.0)
                )
                max_corr = max(max_corr, corr)

        # Shared modes alone contribute base P_cm
        n_shared = len(shared_modes)
        base_pcm = min(0.1 + 0.05 * n_shared, 0.4)

        return max(base_pcm, max_corr)

    @staticmethod
    def compute_detection_probability(
        cluster: LandmarkClusterDef, p_ind: float = 0.7
    ) -> float:
        """P(detect at least 1 landmark in cluster).

        Per đề án 2.4.3:
        P(all miss) = P_cm + (1 - P_cm) · (1 - p_ind)^N
        P(detect) = 1 - P(all miss)
        """
        n = len(cluster.landmarks)
        if n == 0:
            return 0.0
        p_cm = cluster.p_common_mode
        p_all_miss = p_cm + (1 - p_cm) * (1 - p_ind) ** n
        return 1.0 - p_all_miss

    @staticmethod
    def compute_diversity_score(landmarks: list) -> float:
        """Type diversity within cluster.

        diversity = unique_types / total_landmarks
        Bonus +0.1 if no two landmarks share the same primary failure mode.
        Capped at 1.0.
        """
        if not landmarks:
            return 0.0

        types = [lm.landmark_type for lm in landmarks]
        unique_ratio = len(set(types)) / len(types)

        # Check failure mode overlap
        primary_modes = []
        for lm in landmarks:
            info = LANDMARK_TYPES.get(lm.landmark_type, {})
            modes = info.get("failure_modes", [])
            if modes:
                primary_modes.append(modes[0])

        no_overlap = len(set(primary_modes)) == len(primary_modes)
        bonus = 0.1 if no_overlap else 0.0

        return min(1.0, unique_ratio + bonus)
