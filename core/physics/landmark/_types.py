"""Landmark type definitions and failure mode correlations.

Per đề án Section 2.4 — landmark classification and failure modes.
"""

LANDMARK_TYPES: dict[str, dict] = {
    "bridge": {
        "stability": 0.95,
        "failure_modes": ["low_altitude_occlusion", "shadow_under"],
        "min_detection_range": 200,
        "distinctiveness": 0.85,
    },
    "junction": {
        "stability": 0.90,
        "failure_modes": ["shadow_sensitivity", "weather_degradation"],
        "min_detection_range": 150,
        "distinctiveness": 0.75,
    },
    "lake": {
        "stability": 0.80,
        "failure_modes": ["glare", "seasonal_change"],
        "min_detection_range": 300,
        "distinctiveness": 0.90,
    },
    "building": {
        "stability": 0.92,
        "failure_modes": ["shadow_sensitivity", "angle_dependency"],
        "min_detection_range": 180,
        "distinctiveness": 0.80,
    },
    "tree_cluster": {
        "stability": 0.40,
        "failure_modes": ["seasonal_change", "wind_movement", "shadow_sensitivity"],
        "min_detection_range": 100,
        "distinctiveness": 0.50,
    },
    "road_marking": {
        "stability": 0.70,
        "failure_modes": ["weather_degradation", "altitude_dependency"],
        "min_detection_range": 80,
        "distinctiveness": 0.60,
    },
}

# Failure mode correlation matrix — which modes tend to trigger together
FAILURE_CORRELATIONS: dict[tuple[str, str], float] = {
    ("shadow_sensitivity", "shadow_under"): 0.8,
    ("seasonal_change", "wind_movement"): 0.6,
    ("weather_degradation", "glare"): 0.4,
    # All other pairs default to 0.0 (independent)
}

# All known types as a list for convenience
LANDMARK_TYPE_NAMES: list[str] = list(LANDMARK_TYPES.keys())
