#!/usr/bin/env python3
"""Run simulation and export FULL diagnostic data for algorithm evaluation.

Outputs:
  exports/sim_YYYYMMDD_HHMMSS/
  ├── config.json          — All algorithm parameters (reproducible)
  ├── timeline.csv         — Per-timestep: true state, est state, errors, NIS
  ├── covariance.csv       — Per-camera-frame: full P diagonal + off-diag norms
  ├── landmarks.csv        — Landmark chain with cluster analysis
  ├── associations.csv     — Per-frame: which landmarks matched, confidence, reproj error
  ├── ekf_diagnostics.csv  — Per-update: innovation, NIS, Kalman gain norm, P trace
  ├── terrain_profile.csv  — Elevation along corridor
  ├── wind_profile.csv     — Wind samples along trajectory
  ├── summary.json         — Human-readable summary + acceptance criteria
  └── README.txt           — File format documentation

Usage:
  python export_simulation.py
  python export_simulation.py --duration 60 --corridor 10 --seed 99
  python export_simulation.py --output exports/experiment_1
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import time
from datetime import datetime

import numpy as np

from core.physics.association.pipeline import FiveStepPipeline
from core.physics.config import SimConfig
from core.physics.dynamics._quaternion import quat_to_rotation
from core.physics.dynamics.six_dof import SixDOFDynamics
from core.physics.estimator.ekf import ErrorStateEKF
from core.physics.landmark.chain import LandmarkChainGenerator
from core.physics.landmark.cluster import ClusterAnalyzer
from core.physics.sensors.camera import CameraModel
from core.physics.sensors.imu import IMUModel
from core.physics.sim.trajectory import TrajectorySimulator
from core.physics.terrain.procedural import ProceduralTerrain
from core.physics.types import *
from core.physics.wind.dryden import DrydenWindField


def run_and_export(
    duration: float = 30.0,
    corridor_km: float = 5.0,
    seed: int = 42,
    output_dir: str | None = None,
):
    corridor = corridor_km * 1000
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if output_dir is None:
        output_dir = f"exports/sim_{timestamp}"
    os.makedirs(output_dir, exist_ok=True)

    # ── Build all components ──
    terrain_cfg = TerrainConfig(ridge_height=10, base_elevation=10, seed=seed)
    wind_cfg = WindConfig(mean_speed=5.0, mean_direction=90.0, turbulence_intensity=1.0)
    imu_specs = IMUSpecs()
    cam_specs = CameraSpecs(landmark_size=20.0)
    lm_cfg = LandmarkConfig(
        num_landmarks=30, cluster_size=5, segment_spacing=300,
        max_recognition_range=800.0,
    )
    sim_cfg = SimConfig(sim_duration_max=duration)

    drone = DroneConfig(
        mass=2.5, drag_coeffs=np.array([0.3, 0.3, 0.5]),
        max_speed=22.0, max_altitude=500.0, battery_capacity=5000.0,
        camera_intrinsics=np.array([[400, 0, 320], [0, 400, 240], [0, 0, 1.0]]),
        camera_extrinsics=np.eye(4),
        imu_specs={
            "accel_bias_instability": imu_specs.accel_bias_instability,
            "accel_random_walk": imu_specs.accel_random_walk,
            "gyro_bias_instability": imu_specs.gyro_bias_instability,
            "gyro_random_walk": imu_specs.gyro_random_walk,
        },
        name="HERA-S",
    )

    terrain = ProceduralTerrain(terrain_cfg)
    wind = DrydenWindField(wind_cfg, terrain, seed=seed)
    lm_gen = LandmarkChainGenerator(terrain, lm_cfg)
    lm_list, clusters = lm_gen.generate(np.zeros(3), np.array([corridor, 0, 0]), seed=seed)

    drop_alt = 80.0
    mission = MissionPackage(
        target=np.array([corridor, 0.0, -drop_alt]),
        landmarks=lm_list, clusters=clusters,
        corridor_grid=np.zeros((30, 128)),
        wind_estimate=np.array([wind_cfg.mean_speed, 0.0]),
        camera_cal=drone.camera_intrinsics.copy(),
        terrain_profile=terrain.get_profile(np.zeros(2), np.array([corridor, 0])),
        drop_point=np.zeros(3),
    )

    dyn = SixDOFDynamics(drone)
    imu_sensor = IMUModel(imu_specs, seed=seed)
    cam_sensor = CameraModel(cam_specs, seed=seed)

    initial_est = NominalState(
        np.array([0.0, 0.0, -drop_alt]), np.array([15.0, 0.0, 0.0]),
        np.array([1, 0, 0, 0.0]), np.zeros(3), np.zeros(3),
        np.array([wind_cfg.mean_speed, 0.0]),
    )
    ekf = ErrorStateEKF(dyn, cam_sensor, sim_cfg, initial_est)
    associator = FiveStepPipeline(cam_sensor, sim_cfg, seed=seed)

    sim = TrajectorySimulator(
        dyn, imu_sensor, cam_sensor, ekf,
        associator, terrain, wind, lm_gen, sim_cfg,
    )

    # ── 1. Export config.json ──
    config_data = {
        "simulation": {
            "duration_s": duration,
            "corridor_km": corridor_km,
            "seed": seed,
            "imu_rate_hz": sim_cfg.imu_rate_hz,
            "camera_rate_hz": sim_cfg.camera_rate_hz,
            "innovation_gate_chi2": sim_cfg.innovation_gate_chi2,
            "lowe_ratio": sim_cfg.lowe_ratio,
            "ransac_iterations": sim_cfg.ransac_iterations,
            "ransac_reproj_threshold": sim_cfg.ransac_reproj_threshold,
            "target_radius_m": sim_cfg.target_radius,
            "divergence_threshold_m": sim_cfg.divergence_threshold,
            "max_no_update_s": sim_cfg.max_no_update_seconds,
        },
        "drone": {
            "mass_kg": drone.mass,
            "drag_coeffs": drone.drag_coeffs.tolist(),
            "max_speed_ms": drone.max_speed,
        },
        "imu": {
            "accel_bias_instability_mg": imu_specs.accel_bias_instability,
            "accel_random_walk_m_s_sqrtHz": imu_specs.accel_random_walk,
            "gyro_bias_instability_deg_hr": imu_specs.gyro_bias_instability,
            "gyro_random_walk_deg_sqrtHz": imu_specs.gyro_random_walk,
            "accel_range_g": imu_specs.accel_range,
            "gyro_range_deg_s": imu_specs.gyro_range,
            "adc_bits": imu_specs.adc_bits,
            "vibration_psd_m_s2": imu_specs.vibration_psd,
            "sample_rate_hz": imu_specs.sample_rate,
            "true_accel_bias_m_s2": imu_sensor.accel_bias_true.tolist(),
            "true_gyro_bias_rad_s": imu_sensor.gyro_bias_true.tolist(),
        },
        "camera": {
            "focal_xy_px": [cam_specs.intrinsics[0, 0], cam_specs.intrinsics[1, 1]],
            "principal_xy_px": [cam_specs.intrinsics[0, 2], cam_specs.intrinsics[1, 2]],
            "resolution": list(cam_specs.resolution),
            "pixel_noise_std_px": cam_specs.pixel_noise_std,
            "landmark_size_m": cam_specs.landmark_size,
        },
        "terrain": {
            "base_elevation_m": terrain_cfg.base_elevation,
            "ridge_height_m": terrain_cfg.ridge_height,
            "ridge_frequency_per_km": terrain_cfg.ridge_frequency,
            "noise_octaves": terrain_cfg.noise_octaves,
        },
        "wind": {
            "mean_speed_m_s": wind_cfg.mean_speed,
            "mean_direction_deg": wind_cfg.mean_direction,
            "turbulence_intensity_m_s": wind_cfg.turbulence_intensity,
            "shear_exponent": wind_cfg.shear_exponent,
        },
        "landmarks": {
            "total_count": lm_cfg.num_landmarks,
            "cluster_size": lm_cfg.cluster_size,
            "segment_spacing_m": lm_cfg.segment_spacing,
            "max_recognition_range_m": lm_cfg.max_recognition_range,
            "p_individual_detect": lm_cfg.p_individual_detect,
        },
        "ekf": {
            "state_dim": 17,
            "initial_P_diag": np.diag(ekf.P).tolist(),
            "discretization": "first_order_Phi_I_plus_Fdt",
            "update_form": "joseph_form",
            "gating": "mahalanobis_chi2_2dof",
            "inject_reset": "after_every_update",
            "quaternion_convention": "wxyz_scalar_first_hamilton",
            "frame": "NED_north_east_down",
        },
    }
    with open(os.path.join(output_dir, "config.json"), "w") as f:
        json.dump(config_data, f, indent=2)

    # ── 2. Run simulation ──
    print(f"Running {duration}s simulation, {corridor_km}km corridor, seed={seed}...")
    t0 = time.time()
    result = sim.run(mission, drone)
    compute_time = time.time() - t0
    print(f"Done in {compute_time:.1f}s — outcome: {result.outcome}")

    # ── 3. Export timeline.csv ──
    print("Exporting timeline.csv...")
    with open(os.path.join(output_dir, "timeline.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "time_s",
            # True state (18 values)
            "true_pos_N_m", "true_pos_E_m", "true_pos_D_m",
            "true_vel_N_ms", "true_vel_E_ms", "true_vel_D_ms",
            "true_quat_w", "true_quat_x", "true_quat_y", "true_quat_z",
            "true_bias_ax", "true_bias_ay", "true_bias_az",
            "true_bias_gx", "true_bias_gy", "true_bias_gz",
            "true_wind_N", "true_wind_E",
            # Estimated state (18 values)
            "est_pos_N_m", "est_pos_E_m", "est_pos_D_m",
            "est_vel_N_ms", "est_vel_E_ms", "est_vel_D_ms",
            "est_quat_w", "est_quat_x", "est_quat_y", "est_quat_z",
            "est_bias_ax", "est_bias_ay", "est_bias_az",
            "est_bias_gx", "est_bias_gy", "est_bias_gz",
            "est_wind_N", "est_wind_E",
            # Errors
            "err_pos_N_m", "err_pos_E_m", "err_pos_D_m", "err_pos_total_m",
            # NIS
            "nis",
        ])
        for i in range(len(result.true_states)):
            ts = result.true_states[i]
            es = result.estimated_states[i]
            pe = result.position_errors[i]
            nis = result.nis_values[i] if i < len(result.nis_values) else 0.0
            row = [
                f"{result.timestamps[i]:.4f}",
                *[f"{v:.6f}" for v in ts.position],
                *[f"{v:.6f}" for v in ts.velocity],
                *[f"{v:.8f}" for v in ts.quaternion],
                *[f"{v:.8f}" for v in ts.accel_bias],
                *[f"{v:.8f}" for v in ts.gyro_bias],
                *[f"{v:.6f}" for v in ts.wind],
                *[f"{v:.6f}" for v in es.position],
                *[f"{v:.6f}" for v in es.velocity],
                *[f"{v:.8f}" for v in es.quaternion],
                *[f"{v:.8f}" for v in es.accel_bias],
                *[f"{v:.8f}" for v in es.gyro_bias],
                *[f"{v:.6f}" for v in es.wind],
                *[f"{v:.6f}" for v in pe],
                f"{np.linalg.norm(pe):.6f}",
                f"{nis:.6f}",
            ]
            w.writerow(row)

    # ── 4. Export covariance.csv ──
    print("Exporting covariance.csv...")
    with open(os.path.join(output_dir, "covariance.csv"), "w", newline="") as f:
        w = csv.writer(f)
        header = ["time_s"]
        state_labels = [
            "sigma_pos_N", "sigma_pos_E", "sigma_pos_D",
            "sigma_vel_N", "sigma_vel_E", "sigma_vel_D",
            "sigma_att_roll", "sigma_att_pitch", "sigma_att_yaw",
            "sigma_ba_x", "sigma_ba_y", "sigma_ba_z",
            "sigma_bg_x", "sigma_bg_y", "sigma_bg_z",
            "sigma_wind_N", "sigma_wind_E",
        ]
        header.extend(state_labels)
        header.extend(["P_trace", "P_pos_trace", "P_vel_trace", "P_att_trace",
                        "P_pos_vel_corr_norm", "P_pos_att_corr_norm",
                        "P_min_eigenvalue", "P_max_eigenvalue"])
        w.writerow(header)

        for i, P in enumerate(result.covariances):
            t_cov = i / max(len(result.covariances) - 1, 1) * result.timestamps[-1]
            diag = np.sqrt(np.maximum(np.diag(P), 0))
            eigs = np.linalg.eigvalsh(P)
            row = [
                f"{t_cov:.4f}",
                *[f"{v:.8f}" for v in diag],
                f"{np.trace(P):.6f}",
                f"{np.trace(P[0:3, 0:3]):.6f}",
                f"{np.trace(P[3:6, 3:6]):.6f}",
                f"{np.trace(P[6:9, 6:9]):.6f}",
                f"{np.linalg.norm(P[0:3, 3:6]):.8f}",
                f"{np.linalg.norm(P[0:3, 6:9]):.8f}",
                f"{eigs[0]:.2e}",
                f"{eigs[-1]:.2e}",
            ]
            w.writerow(row)

    # ── 5. Export landmarks.csv ──
    print("Exporting landmarks.csv...")
    with open(os.path.join(output_dir, "landmarks.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "landmark_id", "cluster_id", "segment_id", "type",
            "pos_N_m", "pos_E_m", "pos_D_m",
            "stability", "distinctiveness",
            "cluster_diversity", "cluster_p_cm", "cluster_p_detect",
        ])
        for cl in clusters:
            p_det = ClusterAnalyzer.compute_detection_probability(cl, lm_cfg.p_individual_detect)
            for lm in cl.landmarks:
                from core.physics.landmark._types import LANDMARK_TYPES
                info = LANDMARK_TYPES.get(lm.landmark_type, {})
                w.writerow([
                    lm.id, cl.id, cl.segment_id, lm.landmark_type,
                    f"{lm.position[0]:.2f}", f"{lm.position[1]:.2f}", f"{lm.position[2]:.2f}",
                    f"{info.get('stability', 0):.2f}",
                    f"{info.get('distinctiveness', 0):.2f}",
                    f"{cl.diversity_score:.3f}",
                    f"{cl.p_common_mode:.3f}",
                    f"{p_det:.3f}",
                ])

    # ── 6. Export associations.csv ──
    print("Exporting associations.csv...")
    with open(os.path.join(output_dir, "associations.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "frame_time_s", "n_visible", "n_detected", "n_matched",
            "pipeline_predictions", "pipeline_detections",
            "pipeline_raw_matches", "ratio_test_rejects",
            "ransac_rejects", "verified_matches",
        ])
        stats = associator.stats
        for lm_info in result.landmarks_matched:
            w.writerow([
                f"{lm_info.get('t', 0):.4f}",
                lm_info.get("n_visible", 0),
                lm_info.get("n_detected", 0),
                lm_info.get("n_matches", 0),
                stats.total_predictions,
                stats.total_detections,
                stats.total_raw_matches,
                stats.ratio_test_rejects,
                stats.ransac_rejects,
                stats.verified_matches,
            ])

    # ── 7. Export terrain_profile.csv ──
    profile = terrain.get_profile(np.zeros(2), np.array([corridor, 0]), 200)
    with open(os.path.join(output_dir, "terrain_profile.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["north_m", "east_m", "elevation_m", "roughness"])
        for p in profile:
            roughness = terrain.get_roughness(p[0], p[1])
            w.writerow([f"{p[0]:.1f}", f"{p[1]:.1f}", f"{p[2]:.2f}", f"{roughness:.4f}"])

    # ── 8. Export wind_profile.csv ──
    wind_export = DrydenWindField(wind_cfg, terrain, seed=seed)
    with open(os.path.join(output_dir, "wind_profile.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["time_s", "pos_N_m", "altitude_m",
                     "wind_N_ms", "wind_E_ms", "wind_D_ms",
                     "turb_N_ms", "turb_E_ms", "turb_D_ms"])
        for i in range(min(len(result.true_states), 500)):
            idx = i * max(1, len(result.true_states) // 500)
            if idx >= len(result.true_states):
                break
            ts = result.true_states[idx]
            t = result.timestamps[idx]
            wv = wind_export.get_wind(ts.position, t)
            w.writerow([
                f"{t:.4f}",
                f"{ts.position[0]:.2f}",
                f"{-ts.position[2]:.2f}",
                *[f"{v:.4f}" for v in wv.velocity],
                *[f"{v:.4f}" for v in wv.turbulence],
            ])

    # ── 9. Export summary.json ──
    errors = np.linalg.norm(result.position_errors, axis=1)
    valid_nis = result.nis_values[result.nis_values > 0]

    summary = {
        "outcome": result.outcome,
        "duration_s": float(result.metadata.get("total_time", 0)),
        "compute_time_s": round(compute_time, 2),
        "final_error_m": float(result.final_error),
        "distance_to_target_m": float(np.linalg.norm(
            result.true_states[-1].position[:2] - mission.target[:2]
        )),
        "distance_flown_m": float(sum(
            np.linalg.norm(result.true_states[i].position[:2] - result.true_states[i - 1].position[:2])
            for i in range(1, len(result.true_states))
        )),
        "ekf": {
            "total_updates": int(result.metadata.get("updates", 0)),
            "total_rejects": int(result.metadata.get("rejects", 0)),
            "last_update_time_s": float(result.metadata.get("last_update_time", 0)),
        },
        "position_error": {
            "mean_m": float(np.mean(errors)),
            "max_m": float(np.max(errors)),
            "final_m": float(errors[-1]),
            "std_m": float(np.std(errors)),
            "p50_m": float(np.percentile(errors, 50)),
            "p95_m": float(np.percentile(errors, 95)),
        },
        "nis": {
            "count": int(len(valid_nis)),
            "mean": float(np.mean(valid_nis)) if len(valid_nis) > 0 else 0,
            "std": float(np.std(valid_nis)) if len(valid_nis) > 0 else 0,
            "max": float(np.max(valid_nis)) if len(valid_nis) > 0 else 0,
            "expected": 2.0,
            "gate_threshold": sim_cfg.innovation_gate_chi2,
        },
        "association": {
            "total_predictions": associator.stats.total_predictions,
            "total_detections": associator.stats.total_detections,
            "total_raw_matches": associator.stats.total_raw_matches,
            "ratio_test_rejects": associator.stats.ratio_test_rejects,
            "ransac_rejects": associator.stats.ransac_rejects,
            "verified_matches": associator.stats.verified_matches,
            "frames_processed": associator.stats.frames_processed,
        },
        "covariance_final": {
            "sigma_pos_N_m": float(np.sqrt(max(result.covariances[-1][0, 0], 0))) if result.covariances else 0,
            "sigma_pos_E_m": float(np.sqrt(max(result.covariances[-1][1, 1], 0))) if result.covariances else 0,
            "sigma_pos_D_m": float(np.sqrt(max(result.covariances[-1][2, 2], 0))) if result.covariances else 0,
            "P_trace": float(np.trace(result.covariances[-1])) if result.covariances else 0,
            "P_min_eig": float(np.linalg.eigvalsh(result.covariances[-1])[0]) if result.covariances else 0,
        },
        "algorithm_notes": {
            "dynamics": "6DOF_RK4_quaternion_exp",
            "ekf": "error_state_17D_joseph_form",
            "association": "5step_hamming_lowe_ransac",
            "guidance": "simple_PD_heading_speed_altitude",
            "wind_model": "dryden_MIL_HDBK_1797_terrain_coupled",
        },
        "files": [
            "config.json — All parameters (change values here to re-run)",
            "timeline.csv — Per-timestep true/est state + errors + NIS",
            "covariance.csv — Per-frame P diagonal + eigenvalues",
            "landmarks.csv — Landmark chain with cluster analysis",
            "associations.csv — Per-frame matching pipeline stats",
            "terrain_profile.csv — Elevation + roughness along corridor",
            "wind_profile.csv — Wind + turbulence along trajectory",
            "summary.json — This file",
        ],
    }
    with open(os.path.join(output_dir, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)

    # ── 10. README.txt ──
    readme = f"""GPS-DENIED NAVIGATION SIMULATION EXPORT
{'=' * 50}
Generated: {datetime.now().isoformat()}
Outcome: {result.outcome}
Duration: {summary['duration_s']:.1f}s | Corridor: {corridor_km}km | Seed: {seed}

HOW TO USE THESE FILES FOR ALGORITHM EVALUATION:
─────────────────────────────────────────────────

1. config.json
   All algorithm parameters in one place.
   To tune: change values here, re-run with same seed.
   Key tuning parameters:
   - imu.accel_random_walk → affects dead-reckoning drift rate
   - imu.gyro_random_walk → affects attitude drift
   - simulation.innovation_gate_chi2 → EKF outlier rejection threshold
   - simulation.lowe_ratio → descriptor matching strictness (lower = stricter)
   - simulation.ransac_reproj_threshold → geometric verification tolerance

2. timeline.csv
   Full state history at {sim_cfg.imu_rate_hz}Hz. Columns:
   - true_pos/vel/quat/bias/wind — ground truth
   - est_pos/vel/quat/bias/wind — EKF estimate
   - err_pos_* — position error (true - estimated)
   - nis — Normalized Innovation Squared (0 = no update that step)

   EVALUATION: Plot err_pos_total vs time. Should stay bounded.
   If growing unbounded → drift issue (check IMU noise params).
   If sudden jump → false association (check lowe_ratio, ransac threshold).

3. covariance.csv
   EKF uncertainty at camera rate ({sim_cfg.camera_rate_hz}Hz). Key columns:
   - sigma_pos_N/E/D — position 1-sigma uncertainty (meters)
   - P_min_eigenvalue — must stay > 0 (filter health)
   - P_pos_vel_corr_norm — cross-correlation strength

   EVALUATION: sigma should decrease after landmark updates.
   If sigma grows continuously → not enough updates.
   If P_min_eigenvalue < 0 → numerical instability.

4. landmarks.csv
   Landmark chain with failure mode analysis. Key columns:
   - cluster_p_detect — P(detect at least 1 in cluster)
   - cluster_p_cm — common mode failure probability
   - cluster_diversity — type diversity score

   EVALUATION: clusters with p_detect < 0.8 are weak links.
   Increase cluster_size or improve diversity.

5. associations.csv
   Data association pipeline per camera frame:
   - ratio_test_rejects — ambiguous matches rejected
   - ransac_rejects — geometrically inconsistent matches
   - verified_matches — fed to EKF update

   EVALUATION: If verified_matches consistently 0 → landmarks too far
   or camera FOV too narrow. Check max_recognition_range.

6. terrain_profile.csv / wind_profile.csv
   Environmental conditions. Use for correlating errors with terrain/wind.

REPRODUCING THIS RUN:
  python export_simulation.py --duration {duration} --corridor {corridor_km} --seed {seed}

CHANGING ALGORITHM PARAMETERS:
  Edit config.json values, then modify the corresponding parameter in
  export_simulation.py or core/physics/types.py and re-run.
"""
    with open(os.path.join(output_dir, "README.txt"), "w") as f:
        f.write(readme)

    # ── Also update UI data ──
    try:
        from run_simulation import run_sim
        run_sim(duration, corridor_km, seed)
    except Exception:
        pass

    print(f"\nExport complete: {output_dir}/")
    print(f"  {len(os.listdir(output_dir))} files")
    for fname in sorted(os.listdir(output_dir)):
        size = os.path.getsize(os.path.join(output_dir, fname))
        print(f"  {fname:30s} {size:>10,} bytes")

    return output_dir


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export GPS-denied navigation simulation")
    parser.add_argument("--duration", type=float, default=30.0)
    parser.add_argument("--corridor", type=float, default=5.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", type=str, default=None)
    args = parser.parse_args()
    run_and_export(args.duration, args.corridor, args.seed, args.output)
