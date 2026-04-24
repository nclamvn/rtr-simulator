"""NIS/NEES consistency monitoring for EKF health.

Per đề án Section 2.8 — monitors filter consistency and triggers
fallback modes (covariance inflation, position reset) when NIS anomalous.
"""

from __future__ import annotations

from collections import deque
from typing import Optional

import numpy as np

from core.physics.types import ConsistencyConfig


class NISMonitor:
    """Monitor EKF consistency via Normalized Innovation Squared.

    State machine: NOMINAL → CAUTIOUS → DEGRADED → NOMINAL (recovery).
    """

    def __init__(self, config: ConsistencyConfig | None = None) -> None:
        self.config = config or ConsistencyConfig()
        self.nis_history: list[float] = []
        self._window: deque[float] = deque(maxlen=self.config.window_size)
        self.state: str = "NOMINAL"
        self.inflation_count: int = 0
        self.reset_count: int = 0
        self.fallback_events: list[dict] = []

    def record(self, nis: float, t: float) -> Optional[str]:
        """Record NIS value and evaluate consistency.

        Returns action string if intervention needed, None otherwise.
        """
        self.nis_history.append(nis)
        self._window.append(nis)
        cfg = self.config

        # Spike detection (single observation)
        if nis > cfg.spike_threshold:
            self.fallback_events.append({"t": t, "type": "spike", "nis": nis})
            return "reject"

        # Need enough samples for mean
        if len(self._window) < 3:
            return None

        mean_nis = float(np.mean(list(self._window)))

        # State transitions
        if mean_nis > cfg.degraded_threshold:
            if self.state != "DEGRADED":
                self.state = "DEGRADED"
                self.reset_count += 1
                self.fallback_events.append({"t": t, "type": "reset", "mean_nis": mean_nis})
            return "reset"

        elif mean_nis > cfg.cautious_threshold:
            if self.state != "CAUTIOUS":
                self.state = "CAUTIOUS"
                self.fallback_events.append({"t": t, "type": "inflate", "mean_nis": mean_nis})
            self.inflation_count += 1
            return "inflate"

        else:
            # Nominal range or underconfident — both OK
            if self.state != "NOMINAL":
                self.fallback_events.append({"t": t, "type": "recovery", "mean_nis": mean_nis})
            self.state = "NOMINAL"
            return None

    def get_health_report(self) -> dict:
        """Summary statistics for SimReport."""
        if not self.nis_history:
            return {
                "total_observations": 0,
                "mean_nis": 0.0,
                "std_nis": 0.0,
                "time_in_nominal": 1.0,
                "time_in_cautious": 0.0,
                "time_in_degraded": 0.0,
                "inflation_count": 0,
                "reset_count": 0,
                "is_consistent": True,
            }

        arr = np.array(self.nis_history)
        lo, hi = self.config.nominal_range
        in_range = np.sum((arr >= lo) & (arr <= hi))
        consistent_frac = in_range / len(arr) if len(arr) > 0 else 1.0

        return {
            "total_observations": len(self.nis_history),
            "mean_nis": float(np.mean(arr)),
            "std_nis": float(np.std(arr)),
            "time_in_nominal": consistent_frac,
            "time_in_cautious": self.inflation_count / max(len(arr), 1),
            "time_in_degraded": self.reset_count / max(len(arr), 1),
            "inflation_count": self.inflation_count,
            "reset_count": self.reset_count,
            "is_consistent": consistent_frac >= 0.95,
        }

    def apply_inflation(self, P: np.ndarray) -> np.ndarray:
        """Apply mild covariance inflation (CAUTIOUS state).

        Inflate position + velocity + wind. NOT biases.
        """
        alpha = self.config.inflation_alpha
        inflate = np.array([
            1.0, 1.0, 1.0,         # position (1 m²)
            0.5, 0.5, 0.5,         # velocity (0.25 m²/s²)
            0.01, 0.01, 0.01,      # attitude (small)
            0.0, 0.0, 0.0,         # accel bias — don't inflate
            0.0, 0.0, 0.0,         # gyro bias — don't inflate
            0.1, 0.1,              # wind (small)
        ])
        return P + alpha * np.diag(inflate)

    def apply_reset(self, P: np.ndarray) -> np.ndarray:
        """Reset position/velocity blocks of P (DEGRADED state).

        Preserves bias + wind learning. Zeroes cross-correlations.
        """
        P_new = P.copy()
        # Reset position block
        P_new[0:3, :] = 0.0
        P_new[:, 0:3] = 0.0
        P_new[0:3, 0:3] = np.diag([100.0, 100.0, 100.0])

        # Reset velocity block
        P_new[3:6, :] = 0.0
        P_new[:, 3:6] = 0.0
        P_new[3:6, 3:6] = np.diag([25.0, 25.0, 25.0])

        # Re-symmetrize
        P_new = 0.5 * (P_new + P_new.T)
        return P_new

    def reset(self) -> None:
        """Clear history for new flight."""
        self.nis_history.clear()
        self._window.clear()
        self.state = "NOMINAL"
        self.inflation_count = 0
        self.reset_count = 0
        self.fallback_events.clear()
