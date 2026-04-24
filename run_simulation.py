#!/usr/bin/env python3
"""Run GPS-denied navigation simulation and export results for UI visualization.

Usage: python run_simulation.py [--duration 30] [--corridor 5000] [--runs 1]

Outputs: public/sim_data.json
"""

import argparse
import json
import sys
import time

import numpy as np

from core.physics.association.pipeline import FiveStepPipeline
from core.physics.config import SimConfig
from core.physics.dynamics.six_dof import SixDOFDynamics
from core.physics.estimator.ekf import ErrorStateEKF
from core.physics.landmark.chain import LandmarkChainGenerator
from core.physics.sensors.camera import CameraModel
from core.physics.sensors.imu import IMUModel
from core.physics.sim.trajectory import TrajectorySimulator
from core.physics.terrain.procedural import ProceduralTerrain
from core.physics.types import (
    CameraSpecs,
    DroneConfig,
    IMUSpecs,
    LandmarkConfig,
    MissionPackage,
    NominalState,
    TerrainConfig,
)
from core.physics.wind.dryden import DrydenWindField


def run_sim(duration: float = 30.0, corridor_km: float = 5.0, seed: int = 42, use_cone: bool = False):
    corridor = corridor_km * 1000

    drone = DroneConfig(
        mass=2.5, drag_coeffs=np.array([0.3, 0.3, 0.5]),
        max_speed=22.0, max_altitude=500.0, battery_capacity=5000.0,
        camera_intrinsics=np.array([[400, 0, 320], [0, 400, 240], [0, 0, 1.0]]),
        camera_extrinsics=np.eye(4),
        imu_specs={"accel_bias_instability": 0.04, "accel_random_walk": 0.02,
                   "gyro_bias_instability": 5.0, "gyro_random_walk": 0.01},
        name="HERA-S",
    )

    terrain = ProceduralTerrain(TerrainConfig(ridge_height=10, base_elevation=10, seed=seed))
    wind = DrydenWindField.light(direction=90, seed=seed)

    cone_cfg = None
    cone_layers = []

    if use_cone:
        from core.physics.landmark.cone import ConeLandmarkGenerator
        from core.physics.types import ConeConfig
        cone_cfg = ConeConfig(num_layers=8, base_radius=1200,
                              landmarks_per_layer_base=3, landmarks_per_layer_final=10,
                              min_layer_radius=50.0,
                              max_recognition_range=600.0)
        lm_gen = ConeLandmarkGenerator(terrain, cone_cfg)
        lm_list, clusters, cone_layers = lm_gen.generate(
            np.zeros(3), np.array([corridor, 0, 0]), seed=seed
        )
    else:
        lm_gen = LandmarkChainGenerator(
            terrain, LandmarkConfig(num_landmarks=30, cluster_size=5,
                                    segment_spacing=300, max_recognition_range=800.0),
        )
        lm_list, clusters = lm_gen.generate(np.zeros(3), np.array([corridor, 0, 0]), seed=seed)

    drop_alt = 80.0
    mission = MissionPackage(
        target=np.array([corridor, 0.0, -drop_alt]),
        landmarks=lm_list, clusters=clusters,
        corridor_grid=np.zeros((30, 128)),
        wind_estimate=np.array([5.0, 0.0]),
        camera_cal=drone.camera_intrinsics.copy(),
        terrain_profile=terrain.get_profile(np.zeros(2), np.array([corridor, 0])),
        drop_point=np.zeros(3),
        cone=cone_cfg,
        cone_layers=cone_layers,
    )

    dyn = SixDOFDynamics(drone)
    imu_sensor = IMUModel(IMUSpecs(), seed=seed)
    cam_sensor = CameraModel(CameraSpecs(landmark_size=20.0), seed=seed)

    initial_est = NominalState(
        np.array([0.0, 0.0, -drop_alt]), np.array([15.0, 0.0, 0.0]),
        np.array([1, 0, 0, 0.0]), np.zeros(3), np.zeros(3), np.array([5.0, 0.0]),
    )
    cfg = SimConfig(sim_duration_max=duration, max_no_update_seconds=duration + 10)
    ekf = ErrorStateEKF(dyn, cam_sensor, cfg, initial_est)
    associator = FiveStepPipeline(cam_sensor, cfg, seed=seed)

    sim = TrajectorySimulator(
        dyn, imu_sensor, cam_sensor, ekf,
        associator, terrain, wind, lm_gen, cfg,
    )

    print(f"Running {duration}s simulation, {corridor_km}km corridor, seed={seed}...")
    t0 = time.time()
    result = sim.run(mission, drone)
    elapsed = time.time() - t0
    print(f"Done in {elapsed:.1f}s — outcome: {result.outcome}")

    # Subsample for JSON (every 10th state for 100Hz → 10Hz output)
    step = max(1, len(result.true_states) // 500)

    true_path = []
    est_path = []
    errors = []
    for i in range(0, len(result.true_states), step):
        ts = result.true_states[i]
        es = result.estimated_states[i]
        true_path.append([float(ts.position[0]), float(ts.position[1]), float(-ts.position[2])])
        est_path.append([float(es.position[0]), float(es.position[1]), float(-es.position[2])])
        err = float(np.linalg.norm(ts.position - es.position))
        errors.append([float(result.timestamps[i]), err])

    # NIS values (non-zero only)
    nis_data = []
    for i in range(0, len(result.nis_values), step):
        if result.nis_values[i] > 0:
            nis_data.append([float(result.timestamps[i]), float(result.nis_values[i])])

    # Landmarks
    landmarks_json = []
    for lm in lm_list:
        landmarks_json.append({
            "id": lm.id,
            "position": [float(lm.position[0]), float(lm.position[1]), float(-lm.position[2])],
            "type": lm.landmark_type,
            "cluster": lm.cluster_id,
        })

    # Terrain profile
    profile = terrain.get_profile(np.zeros(2), np.array([corridor, 0]), 200)
    terrain_data = [[float(p[0]), float(p[2])] for p in profile]

    # Covariance (position sigma over time)
    sigma_data = []
    for i, P in enumerate(result.covariances):
        t_cov = float(i / max(len(result.covariances) - 1, 1) * result.timestamps[-1])
        sigma = np.sqrt(np.diag(P)[:3])
        sigma_data.append([t_cov, float(sigma[0]), float(sigma[1]), float(sigma[2])])

    output = {
        "outcome": result.outcome,
        "duration": float(result.metadata.get("total_time", 0)),
        "final_error": float(result.final_error),
        "updates": int(result.metadata.get("updates", 0)),
        "rejects": int(result.metadata.get("rejects", 0)),
        "corridor_km": corridor_km,
        "target": [float(corridor), 0.0, float(drop_alt)],
        "true_path": true_path,
        "est_path": est_path,
        "errors": errors,
        "nis": nis_data,
        "landmarks": landmarks_json,
        "terrain_profile": terrain_data,
        "sigma": sigma_data,
        "compute_time": round(elapsed, 2),
        "mode": "cone" if use_cone else "corridor",
        "cone": None,
    }

    # Add cone boundary data for UI overlay
    if use_cone and cone_layers:
        output["cone"] = {
            "layers": [
                {
                    "index": l.index,
                    "distance": float(l.distance_from_base),
                    "radius": float(l.radius),
                    "center": [float(l.center[0]), float(l.center[1])],
                    "landmark_count": l.landmark_count,
                }
                for l in cone_layers
            ],
            "base_radius": float(cone_cfg.base_radius),
            "progress": result.metadata.get("cone_progress", {}),
        }

    out_path = "public/sim_data.json"
    with open(out_path, "w") as f:
        json.dump(output, f)
    print(f"Results saved to {out_path}")
    print(f"  Updates: {output['updates']}, Final error: {output['final_error']:.0f}m")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run GPS-denied navigation simulation")
    parser.add_argument("--duration", type=float, default=30.0, help="Simulation duration (s)")
    parser.add_argument("--corridor", type=float, default=5.0, help="Corridor length (km)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--cone", action="store_true", help="Use cone navigation model")
    args = parser.parse_args()
    run_sim(args.duration, args.corridor, args.seed, args.cone)
