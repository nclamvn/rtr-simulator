"""Observability monitor per document Section 7.

Tracks covariance growth rate of bias/disturbance states.
Triggers maneuver when observability drops and exit risk rises.
"""

from collections import deque
from dataclasses import dataclass
from typing import Optional

import numpy as np


@dataclass
class ObservabilityConfig:
    window_size: int = 50
    og_threshold: float = 0.1
    min_energy_margin: float = 0.2
    yaw_amplitude_deg: float = 5.0
    bank_angle_deg: float = 15.0
    bank_duration_s: float = 3.0


class ObservabilityMonitor:
    """Monitor estimator observability via P growth rate of bias states."""

    def __init__(self, config: ObservabilityConfig | None = None) -> None:
        self.config = config or ObservabilityConfig()
        self._P_diag_history: deque[np.ndarray] = deque(maxlen=self.config.window_size)
        self.og_values: list[float] = []

    def compute_og(self, P: np.ndarray) -> float:
        """Observability support metric from P diagonal growth rate.

        OG = 1 / max(growth_rates of bias states).
        High OG → well observed. Low OG → need maneuver.
        """
        diag = np.diag(P).copy()
        self._P_diag_history.append(diag)

        if len(self._P_diag_history) < 3:
            og = 1.0
            self.og_values.append(og)
            return og

        oldest = self._P_diag_history[0]
        newest = self._P_diag_history[-1]
        window_dt = len(self._P_diag_history)

        # Growth rate of bias states (indices 9-14: accel+gyro bias)
        bias_growth = (newest[9:15] - oldest[9:15]) / max(window_dt, 1)
        max_growth = float(np.max(np.abs(bias_growth)))

        og = 1.0 / (max_growth + 1e-10)
        og = min(og, 100.0)  # cap
        self.og_values.append(og)
        return og

    def should_maneuver(
        self,
        P: np.ndarray,
        mode: object,  # OperationalMode
        energy_margin: float,
    ) -> Optional[str]:
        """Decide if maneuver needed.

        Trigger only if: OG low, exit risk rising, sufficient energy,
        not in terminal/aborted.
        """
        cfg = self.config
        mode_val = getattr(mode, "value", str(mode))

        if mode_val in ("terminal_homing", "aborted"):
            return None

        if energy_margin < cfg.min_energy_margin:
            return None

        og = self.compute_og(P)
        if og > cfg.og_threshold:
            return None

        # Check position P growth (exit risk)
        if len(self._P_diag_history) >= 3:
            pos_growth = np.diag(P)[:3] - self._P_diag_history[-3][:3]
            if np.any(pos_growth > 1.0):  # Position uncertainty growing
                return "yaw_oscillation"

        return None

    def reset(self) -> None:
        self._P_diag_history.clear()
        self.og_values.clear()
