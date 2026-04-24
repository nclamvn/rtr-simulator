"""5-step data association pipeline per đề án 2.5.

Step 1: PREDICTION — project landmarks into image, compute search radius
Step 2: DETECTION — observations already in CameraFrame from CameraModel
Step 3: MATCHING — descriptor match + Lowe's ratio test
Step 4: GEOMETRIC VERIFY — reprojection consistency (simplified RANSAC)
Step 5: GATED EKF UPDATE — delegated to EKF.update()
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from core.physics.association.base import DataAssociator
from core.physics.config import SimConfig
from core.physics.sensors.camera import CameraModel
from core.physics.types import (
    CameraFrame,
    CameraObservation,
    Landmark,
    NominalState,
)


# ── Data Types ────────────────────────────────────────────────


@dataclass
class PredictedLandmark:
    landmark: Landmark
    uv_predicted: np.ndarray    # [2] predicted pixel coords
    search_radius: float        # pixels (3-sigma)
    H_matrix: np.ndarray        # [2×17] for EKF update


@dataclass
class RawMatch:
    observation: CameraObservation
    landmark: Landmark
    descriptor_distance: int
    confidence: float


@dataclass
class AssociationResult:
    observation: CameraObservation
    landmark: Landmark
    confidence: float
    reproj_error: float
    H_matrix: np.ndarray        # [2×17] for EKF


@dataclass
class AssociationStats:
    frames_processed: int = 0
    total_predictions: int = 0
    total_detections: int = 0
    total_raw_matches: int = 0
    ratio_test_rejects: int = 0
    ransac_rejects: int = 0
    verified_matches: int = 0


# ── Hamming Distance ──────────────────────────────────────────


def hamming_distance(d1: np.ndarray, d2: np.ndarray) -> int:
    """Hamming distance between two ORB descriptors (uint8 arrays)."""
    return int(np.unpackbits(np.bitwise_xor(d1, d2)).sum())


# ── Pipeline ──────────────────────────────────────────────────


class FiveStepPipeline(DataAssociator):
    """5-step data association: predict → detect → match → verify → (EKF update)."""

    def __init__(
        self,
        camera: CameraModel,
        config: SimConfig,
        seed: int = 42,
    ) -> None:
        self.camera = camera
        self.config = config
        self.rng = np.random.default_rng(seed)
        self.stats = AssociationStats()

    def associate(
        self,
        frame: CameraFrame,
        predicted_state: NominalState,
        covariance: np.ndarray,
        landmarks: list,
    ) -> list:
        """Run steps 1–4. Returns list of AssociationResult for EKF."""
        self.stats.frames_processed += 1

        # Step 1: Predict
        predictions = self._step1_predict(predicted_state, covariance, landmarks)
        self.stats.total_predictions += len(predictions)

        # Step 2: Detections from frame
        detections = frame.observations
        self.stats.total_detections += len(detections)

        if not detections or not predictions:
            return []

        # Step 3: Match
        matches = self._step3_match(detections, predictions)
        self.stats.total_raw_matches += len(matches)

        # Step 4: Verify
        verified = self._step4_verify(matches, predicted_state)
        self.stats.verified_matches += len(verified)

        return verified

    def _step1_predict(
        self,
        state: NominalState,
        P: np.ndarray,
        landmarks: list,
    ) -> list[PredictedLandmark]:
        """Project landmarks into image + compute search radius from covariance."""
        sigma_px = self.camera.specs.pixel_noise_std
        R = np.diag([sigma_px**2, sigma_px**2])
        predictions: list[PredictedLandmark] = []

        for lm in landmarks:
            uv = self.camera.project(lm.position, state)
            if uv is None:
                continue
            H = self.camera.get_H_matrix(state, lm)
            if H is None:
                continue

            # Innovation covariance → search radius
            S = H @ P @ H.T + R
            eigs = np.linalg.eigvalsh(S)
            search_radius = 3.0 * np.sqrt(max(eigs.max(), 1.0))

            predictions.append(PredictedLandmark(
                landmark=lm,
                uv_predicted=uv,
                search_radius=search_radius,
                H_matrix=H,
            ))

        return predictions

    def _step3_match(
        self,
        detections: list[CameraObservation],
        predictions: list[PredictedLandmark],
    ) -> list[RawMatch]:
        """Descriptor matching + Lowe's ratio test."""
        matches: list[RawMatch] = []

        for det in detections:
            # Find predictions within search radius
            candidates: list[tuple[int, PredictedLandmark]] = []
            for pred in predictions:
                pixel_dist = np.linalg.norm(det.pixel_uv - pred.uv_predicted)
                if pixel_dist <= pred.search_radius:
                    if det.descriptor is not None and pred.landmark.descriptor is not None:
                        d = hamming_distance(det.descriptor, pred.landmark.descriptor)
                    else:
                        d = 0  # No descriptor → accept by position only
                    candidates.append((d, pred))

            if not candidates:
                continue

            # Sort by descriptor distance
            candidates.sort(key=lambda x: x[0])

            # Lowe's ratio test
            if len(candidates) >= 2:
                d_best, pred_best = candidates[0]
                d_second = candidates[1][0]
                if d_second > 0 and d_best / d_second >= self.config.lowe_ratio:
                    self.stats.ratio_test_rejects += 1
                    continue

            d_best, pred_best = candidates[0]
            confidence = 1.0 - d_best / 256.0

            matches.append(RawMatch(
                observation=det,
                landmark=pred_best.landmark,
                descriptor_distance=d_best,
                confidence=confidence,
            ))

        return matches

    def _step4_verify(
        self,
        matches: list[RawMatch],
        state: NominalState,
    ) -> list[AssociationResult]:
        """Geometric verification via reprojection check (simplified RANSAC)."""
        if not matches:
            return []

        # Compute reprojection error for each match
        scored: list[tuple[float, RawMatch, np.ndarray | None]] = []
        for m in matches:
            uv_pred = self.camera.project(m.landmark.position, state)
            if uv_pred is None:
                continue
            reproj_err = float(np.linalg.norm(m.observation.pixel_uv - uv_pred))
            H = self.camera.get_H_matrix(state, m.landmark)
            scored.append((reproj_err, m, H))

        if not scored:
            return []

        threshold = self.config.ransac_reproj_threshold

        if len(scored) >= 3:
            # RANSAC: sample 3, check consistency, count inliers
            best_inliers: list[int] = []
            n_iter = min(self.config.ransac_iterations, 50)
            for _ in range(n_iter):
                sample_idx = self.rng.choice(len(scored), size=min(3, len(scored)), replace=False)
                # Check if sample is consistent
                if all(scored[i][0] < threshold for i in sample_idx):
                    inliers = [i for i in range(len(scored)) if scored[i][0] < threshold]
                    if len(inliers) > len(best_inliers):
                        best_inliers = inliers

            if not best_inliers:
                # Fallback: accept all below threshold
                best_inliers = [i for i in range(len(scored)) if scored[i][0] < threshold]
        else:
            # Too few for RANSAC — direct threshold
            best_inliers = [i for i in range(len(scored)) if scored[i][0] < threshold]

        self.stats.ransac_rejects += len(scored) - len(best_inliers)

        results: list[AssociationResult] = []
        for i in best_inliers:
            reproj_err, m, H = scored[i]
            if H is None:
                continue
            results.append(AssociationResult(
                observation=m.observation,
                landmark=m.landmark,
                confidence=m.confidence,
                reproj_error=reproj_err,
                H_matrix=H,
            ))

        return results

    def reset(self, seed: int) -> None:
        self.rng = np.random.default_rng(seed)
        self.stats = AssociationStats()
