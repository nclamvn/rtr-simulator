"""Monte Carlo simulation harness — run N trajectories, collect statistics.

Per đề án Section 5.2 — validation via Monte Carlo with varied conditions.
"""

import logging
import time
from typing import Callable, Optional

import numpy as np

from core.physics.association.pipeline import FiveStepPipeline
from core.physics.config import SimConfig
from core.physics.dynamics.six_dof import SixDOFDynamics
from core.physics.estimator.ekf import ErrorStateEKF
from core.physics.landmark.chain import LandmarkChainGenerator
from core.physics.sensors.camera import CameraModel
from core.physics.sensors.imu import IMUModel
from core.physics.sim.trajectory import TrajectorySimulator
from core.physics.terrain.base import TerrainProvider
from core.physics.types import (
    CameraSpecs,
    DroneConfig,
    IMUSpecs,
    LandmarkConfig,
    MissionPackage,
    MonteCarloResult,
    NominalState,
    SensitivityResult,
    SimResult,
    WindConfig,
)
from core.physics.wind.dryden import DrydenWindField

logger = logging.getLogger(__name__)


class MonteCarloHarness:
    """Run N trajectory simulations with varied conditions."""

    def __init__(
        self,
        base_config: SimConfig,
        drone: DroneConfig,
        terrain: TerrainProvider,
        landmark_config: LandmarkConfig,
        wind_config: WindConfig,
        corridor_start: np.ndarray,
        corridor_end: np.ndarray,
        cone_config: Optional["ConeConfig"] = None,
    ) -> None:
        self.base_config = base_config
        self.drone = drone
        self.terrain = terrain
        self.landmark_config = landmark_config
        self.wind_config = wind_config
        self.corridor_start = corridor_start
        self.corridor_end = corridor_end
        self.cone_config = cone_config

    def run(
        self,
        num_runs: int = 1000,
        num_drones: int = 1,
        callback: Optional[Callable] = None,
    ) -> MonteCarloResult:
        """Execute Monte Carlo campaign."""
        t_start = time.time()
        base_seed = self.base_config.random_seed

        # Generate landmarks once (terrain is fixed)
        cone_layers = []
        if self.cone_config is not None:
            from core.physics.landmark.cone import ConeLandmarkGenerator
            lm_gen = ConeLandmarkGenerator(self.terrain, self.cone_config)
            lm_list, clusters, cone_layers = lm_gen.generate(
                self.corridor_start, self.corridor_end, seed=base_seed
            )
        else:
            lm_gen = LandmarkChainGenerator(self.terrain, self.landmark_config)
            lm_list, clusters = lm_gen.generate(
                self.corridor_start, self.corridor_end, seed=base_seed
            )

        corridor_end = self.corridor_end
        # Compute safe altitude: max terrain + 50m margin
        try:
            profile = self.terrain.get_profile(
                self.corridor_start[:2] if self.corridor_start.size >= 2 else np.zeros(2),
                corridor_end[:2] if corridor_end.size >= 2 else np.zeros(2),
                50,
            )
            max_elev = float(np.max(profile[:, 2]))
            drop_alt = max(max_elev + 50.0, 80.0)
        except Exception:
            drop_alt = 200.0
        mission = MissionPackage(
            target=np.array([corridor_end[0], corridor_end[1], -drop_alt]),
            landmarks=lm_list,
            clusters=clusters,
            corridor_grid=np.zeros((30, 128)),
            wind_estimate=np.array([self.wind_config.mean_speed, 0.0]),
            camera_cal=self.drone.camera_intrinsics.copy(),
            terrain_profile=self.terrain.get_profile(
                self.corridor_start[:2] if self.corridor_start.size >= 2 else np.zeros(2),
                corridor_end[:2] if corridor_end.size >= 2 else np.zeros(2),
            ),
            drop_point=self.corridor_start.copy(),
            cone=self.cone_config,
            cone_layers=cone_layers,
        )

        all_results: list[SimResult] = []
        all_outcomes: list[str] = []
        all_errors: list[float] = []
        all_mean_nis: list[float] = []

        for run_idx in range(num_runs):
            for drone_idx in range(num_drones):
                seed = base_seed + run_idx * 100 + drone_idx
                result = self._run_single(mission, lm_gen, seed)
                all_results.append(result)
                all_outcomes.append(result.outcome)
                all_errors.append(result.final_error)
                nis_valid = result.nis_values[result.nis_values > 0]
                all_mean_nis.append(
                    float(np.mean(nis_valid)) if len(nis_valid) > 0 else 0.0
                )

            if callback:
                callback(run_idx, all_results[-1])

        t_elapsed = time.time() - t_start
        errors = np.array(all_errors)
        mean_nis_arr = np.array(all_mean_nis)

        n_total = len(all_outcomes)
        n_success = sum(1 for o in all_outcomes if o == "success")

        # Failure breakdown
        breakdown: dict[str, int] = {}
        for o in all_outcomes:
            breakdown[o] = breakdown.get(o, 0) + 1

        # NIS consistency
        consistent = sum(1 for m in all_mean_nis if 0.5 <= m <= 4.0)
        # Also count runs with no observations as consistent (no data to judge)
        no_obs = sum(1 for m in all_mean_nis if m == 0.0)
        consistent_frac = (consistent + no_obs) / max(n_total, 1)

        flight_times = [r.metadata.get("total_time", 0) for r in all_results]

        return MonteCarloResult(
            num_runs=num_runs,
            num_drones=num_drones,
            outcomes=all_outcomes,
            final_errors=errors,
            success_rate=n_success / max(n_total, 1),
            cep50=float(np.median(errors)),
            cep95=float(np.percentile(errors, 95)),
            mean_error=float(np.mean(errors)),
            mean_nis_per_run=mean_nis_arr,
            consistent_fraction=consistent_frac,
            mean_flight_time=float(np.mean(flight_times)),
            total_compute_time=t_elapsed,
            run_results=all_results,
            failure_breakdown=breakdown,
        )

    def run_sensitivity(
        self,
        param_name: str,
        param_values: list,
        runs_per_value: int = 100,
    ) -> SensitivityResult:
        """Vary one parameter, measure impact on success/CEP/NIS."""
        success_rates = []
        mean_ceps = []
        mean_nis_list = []

        for val in param_values:
            # Create modified config
            wc = WindConfig(
                mean_speed=self.wind_config.mean_speed,
                mean_direction=self.wind_config.mean_direction,
                turbulence_intensity=self.wind_config.turbulence_intensity,
            )
            lc = LandmarkConfig(
                num_landmarks=self.landmark_config.num_landmarks,
                cluster_size=self.landmark_config.cluster_size,
                segment_spacing=self.landmark_config.segment_spacing,
                max_recognition_range=self.landmark_config.max_recognition_range,
            )

            if param_name == "wind_speed":
                wc.mean_speed = val
            elif param_name == "turbulence":
                wc.turbulence_intensity = val
            elif param_name == "cluster_size":
                lc.cluster_size = int(val)
            elif param_name == "landmark_count":
                lc.num_landmarks = int(val)
            elif param_name == "landmark_spacing":
                lc.segment_spacing = val

            # Temporarily swap configs
            orig_wc, orig_lc = self.wind_config, self.landmark_config
            self.wind_config = wc
            self.landmark_config = lc

            result = self.run(num_runs=runs_per_value)

            self.wind_config = orig_wc
            self.landmark_config = orig_lc

            success_rates.append(result.success_rate)
            mean_ceps.append(result.cep50)
            mean_nis_list.append(float(np.mean(result.mean_nis_per_run)))

        return SensitivityResult(
            param_name=param_name,
            param_values=list(param_values),
            success_rates=np.array(success_rates),
            mean_ceps=np.array(mean_ceps),
            mean_nis=np.array(mean_nis_list),
            runs_per_value=runs_per_value,
        )

    def _run_single(
        self,
        mission: MissionPackage,
        lm_gen: LandmarkChainGenerator,
        seed: int,
    ) -> SimResult:
        """Run a single trajectory with given seed."""
        dyn = SixDOFDynamics(self.drone)
        imu_sensor = IMUModel(IMUSpecs(), seed=seed)
        cam_sensor = CameraModel(CameraSpecs(landmark_size=20.0), seed=seed)
        wind = DrydenWindField(self.wind_config, self.terrain, seed=seed)

        drop_alt = -mission.target[2] if mission.target[2] < 0 else 200.0
        initial_est = NominalState(
            position=np.array([0.0, 0.0, -drop_alt]),
            velocity=np.array([15.0, 0.0, 0.0]),
            quaternion=np.array([1.0, 0.0, 0.0, 0.0]),
            accel_bias=np.zeros(3),
            gyro_bias=np.zeros(3),
            wind=mission.wind_estimate.copy(),
        )
        ekf = ErrorStateEKF(dyn, cam_sensor, self.base_config, initial_est)
        associator = FiveStepPipeline(cam_sensor, self.base_config, seed=seed)

        sim = TrajectorySimulator(
            dyn, imu_sensor, cam_sensor, ekf,
            associator, self.terrain, wind, lm_gen, self.base_config,
        )
        return sim.run(mission, self.drone)
