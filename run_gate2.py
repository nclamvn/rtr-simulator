#!/usr/bin/env python3
"""
RTR Module 18 — Gate 2: Algorithmic Consistency
Production Monte Carlo: 1000 runs, 15km corridor, cone mode, hardened code.

Usage:
  python run_gate2.py                          # Full 1000 runs
  python run_gate2.py --runs 50 --duration 120 # Quick test
  python run_gate2.py --sensitivity            # + Sensitivity analysis
  python run_gate2.py --report-only            # Regenerate report from cached results

Output: reports/gate2/ directory with:
  - plots/              (10+ PNG files)
  - summary.json        (machine-readable results)
  - narrative.txt       (AI-generated debrief)
  - acceptance.json     (TC-1 through TC-6 pass/fail)
  - gate2_report.md     (combined markdown)
"""
import argparse
import json
import time
import sys
import numpy as np
from pathlib import Path

from core.physics.types import (
    DroneConfig, TerrainConfig, LandmarkConfig,
    WindConfig, MissionPackage, ConsistencyConfig,
)
from core.physics.config import SimConfig
from core.physics.terrain.procedural import ProceduralTerrain
from core.physics.landmark.cone_policy import RiskShapedCone, ConeRiskConfig
from core.physics.sim.monte_carlo import MonteCarloHarness
from core.physics.sim.report import SimReportGenerator
from core.physics.sim.modes import ModeConfig
from core.physics.estimator.observability import ObservabilityConfig


# ═══════════════════════════════════════════════════════════════
#  CONFIGURATION — Replace with Gate 1 bench test data
# ═══════════════════════════════════════════════════════════════

def create_production_config():
    """Production configuration matching RTR_Hardened.docx Gate 2 specs.
    
    TODO after Gate 1 bench test:
    - Replace IMU specs with Allan variance measurements
    - Replace drag_coeffs with HERA/Vega wind tunnel data
    - Replace camera intrinsics with Kalibr calibration
    - Replace camera extrinsics with Kalibr T_cam_imu
    """
    
    drone = DroneConfig(
        mass=2.5,
        drag_coeffs=np.array([0.3, 0.3, 0.5]),  # REPLACE: wind tunnel
        max_speed=22.0,
        max_altitude=500.0,
        battery_capacity=5000.0,
        camera_intrinsics=np.array([          # REPLACE: Kalibr calibration
            [400, 0, 320],
            [0, 400, 240],
            [0, 0, 1],
        ], dtype=float),
        camera_extrinsics=np.eye(4),          # REPLACE: Kalibr T_cam_imu
        imu_specs={
            # REPLACE: Allan variance from Gate 1 bench test
            "accel_bias_instability": 0.04,   # mg (MPU6050 datasheet)
            "accel_random_walk": 0.02,        # m/s/sqrt(Hz)
            "gyro_bias_instability": 5.0,     # deg/hr
            "gyro_random_walk": 0.01,         # deg/sqrt(Hz)
        },
        name="HERA-SubDrone-v1",
    )
    
    sim_config = SimConfig(
        imu_rate_hz=100.0,
        camera_rate_hz=10.0,
        sim_duration_max=600.0,         # 10 minutes max (15km at ~12m/s)
        innovation_gate_chi2=9.21,      # chi2_2 at 99%
        lowe_ratio=0.75,
        ransac_iterations=100,
        ransac_reproj_threshold=3.0,
        target_radius=15.0,             # Success: within 15m of target
        divergence_threshold=1000.0,    # Abort: >1km error
        max_no_update_seconds=180.0,    # 3min gaps between clusters on 15km
        monte_carlo_runs=1000,
        random_seed=42,
    )
    
    terrain_config = TerrainConfig(
        base_elevation=20.0,
        ridge_height=40.0,
        ridge_frequency=2.0,
        noise_octaves=4,
        noise_scale=1000.0,
        seed=42,
        corridor_length=15000.0,
        corridor_width=2000.0,
    )
    
    landmark_config = LandmarkConfig(
        num_landmarks=40,
        cluster_size=5,
        segment_spacing=400.0,
        corridor_width=2000.0,
        max_recognition_range=800.0,
        p_individual_detect=0.7,
    )
    
    wind_config = WindConfig(
        mean_speed=8.0,
        mean_direction=90.0,            # From East
        turbulence_intensity=1.5,
        terrain_coupling=True,
    )
    
    cone_risk = ConeRiskConfig(
        k_sigma=3.0,
        k_obs=50.0,
        k_clutter=20.0,
        k_margin=15.0,
        r0=100.0,                       # HERA position uncertainty
        trumpet_lambda=0.0005,
        p_exit_max=0.01,
    )
    
    mode_config = ModeConfig(
        visual_timeout_s=10.0,
        inertial_timeout_s=30.0,
        abort_timeout_s=120.0,          # Document Sec 9
        terminal_distance=100.0,
    )
    
    obs_config = ObservabilityConfig(
        og_threshold=0.1,
        min_energy_margin=0.2,
    )
    
    consistency_config = ConsistencyConfig(
        window_size=20,
        cautious_threshold=4.0,
        degraded_threshold=8.0,
    )
    
    return {
        "drone": drone,
        "sim": sim_config,
        "terrain": terrain_config,
        "landmark": landmark_config,
        "wind": wind_config,
        "cone_risk": cone_risk,
        "mode": mode_config,
        "observability": obs_config,
        "consistency": consistency_config,
    }


# ═══════════════════════════════════════════════════════════════
#  MONTE CARLO CAMPAIGN
# ═══════════════════════════════════════════════════════════════

def run_production_mc(cfg, args):
    """Run production Monte Carlo campaign."""
    terrain = ProceduralTerrain(cfg["terrain"])
    
    print(f"\n{'='*60}")
    print(f"  RTR Module 18 — Gate 2: Algorithmic Consistency")
    print(f"  Runs: {args.runs} | Duration: {cfg['sim'].sim_duration_max}s")
    print(f"  Corridor: 15km | Mode: Convergent Cone (hardened)")
    print(f"  Measurements: Containment (L1-2) → Bearing (L3-4)")
    print(f"                → Full metric (L5-6) → Terminal (L7)")
    print(f"  Modes: Nominal → Degraded → Inertial → Abort (120s)")
    print(f"{'='*60}\n")
    
    mc = MonteCarloHarness(
        cfg["sim"], cfg["drone"], terrain, cfg["landmark"], cfg["wind"],
        corridor_start=np.zeros(3),
        corridor_end=np.array([15000, 0, 0]),
    )
    
    t0 = time.time()
    completed = [0]
    
    def progress(i, result):
        completed[0] = i + 1
        elapsed = time.time() - t0
        rate = completed[0] / elapsed if elapsed > 0 else 0
        eta = (args.runs - completed[0]) / rate if rate > 0 else 0
        bar_len = 30
        filled = int(bar_len * completed[0] / args.runs)
        bar = "█" * filled + "░" * (bar_len - filled)
        
        sys.stdout.write(
            f"\r  [{bar}] {completed[0]}/{args.runs} "
            f"| {result.outcome:8s} err={result.final_error:6.1f}m "
            f"| {rate:.1f}/s ETA {eta:.0f}s"
        )
        sys.stdout.flush()
        
        if completed[0] % 100 == 0:
            print()  # Newline every 100
    
    mc_result = mc.run(
        num_runs=args.runs,
        num_drones=args.drones,
        callback=progress,
    )
    
    total_time = time.time() - t0
    print(f"\n\nCompleted {args.runs} runs in {total_time:.1f}s "
          f"({args.runs/total_time:.1f} runs/s)")
    print(mc_result.summary())
    
    return mc_result


# ═══════════════════════════════════════════════════════════════
#  SENSITIVITY ANALYSIS
# ═══════════════════════════════════════════════════════════════

def run_sensitivity(cfg, args):
    """Run sensitivity analysis on key parameters."""
    terrain = ProceduralTerrain(cfg["terrain"])
    mc = MonteCarloHarness(
        cfg["sim"], cfg["drone"], terrain, cfg["landmark"], cfg["wind"],
        corridor_start=np.zeros(3),
        corridor_end=np.array([15000, 0, 0]),
    )
    
    runs_per = args.sensitivity_runs
    results = {}
    
    print(f"\n{'='*60}")
    print(f"  Sensitivity Analysis ({runs_per} runs per value)")
    print(f"{'='*60}")
    
    analyses = [
        ("wind_speed",      [2, 5, 8, 12, 15, 20, 25],        "m/s"),
        ("imu_accel_noise", [0.005, 0.01, 0.02, 0.05, 0.1],   "m/s/sqrt(Hz)"),
        ("imu_gyro_noise",  [0.002, 0.005, 0.01, 0.02, 0.05], "deg/sqrt(Hz)"),
        ("landmark_count",  [10, 20, 30, 40, 50, 60],          "landmarks"),
        ("cluster_size",    [3, 4, 5, 6, 8],                   "per cluster"),
    ]
    
    for i, (param, values, unit) in enumerate(analyses, 1):
        print(f"\n  [{i}/{len(analyses)}] {param} ({unit})...")
        results[param] = mc.run_sensitivity(param, values, runs_per_value=runs_per)
        
        # Print inline results
        for j, v in enumerate(values):
            sr = results[param].success_rates[j] * 100
            cep = results[param].mean_ceps[j]
            print(f"    {param}={v}: success={sr:.0f}%, CEP50={cep:.1f}m")
    
    return results


# ═══════════════════════════════════════════════════════════════
#  REPORT GENERATION
# ═══════════════════════════════════════════════════════════════

def generate_report(mc_result, sensitivity_results, cfg, output_dir):
    """Generate full Gate 2 report package."""
    gen = SimReportGenerator(output_dir)
    
    mission = MissionPackage(
        target=np.array([15000, 0, -100]),
        landmarks=[], clusters=[],
        corridor_grid=np.zeros((60, 128)),
        wind_estimate=np.array([8.0, 0.0]),
        camera_cal=cfg["drone"].camera_intrinsics,
        terrain_profile=np.zeros((100, 3)),
        drop_point=np.zeros(3),
    )
    
    # Single trajectory report (first run if available)
    if hasattr(mc_result, 'run_results') and mc_result.run_results:
        print("  Generating single trajectory plots...")
        gen.generate_single_report(mc_result.run_results[0], mission)
    
    # Monte Carlo report
    print("  Generating Monte Carlo plots...")
    gen.generate_monte_carlo_report(mc_result)
    
    # Sensitivity reports
    for name, sens in sensitivity_results.items():
        print(f"  Generating sensitivity: {name}...")
        gen.generate_sensitivity_report(sens)
    
    # Narrative
    print("  Generating narrative...")
    narrative = gen.generate_narrative(mc_result, mission)
    
    # Acceptance criteria (TC-1 through TC-6)
    print("  Checking acceptance criteria...")
    criteria = gen.check_acceptance_criteria(mc_result)
    
    # Export everything
    report_path = gen.export_full_report(mc_result, mission)
    
    # Save criteria separately
    criteria_path = Path(output_dir) / "acceptance.json"
    with open(criteria_path, "w") as f:
        json.dump(criteria, f, indent=2, default=str)
    
    # Print acceptance summary
    print(f"\n{'='*60}")
    print(f"  GATE 2 ACCEPTANCE CRITERIA")
    print(f"{'='*60}")
    
    all_pass = True
    for tc, result in criteria.items():
        status = "PASS" if result["pass"] else "FAIL"
        marker = " ✓" if result["pass"] else " ✗"
        all_pass = all_pass and result["pass"]
        print(f"  {tc}: {result.get('actual', 'N/A')} vs {result.get('target', 'N/A')} — {status}{marker}")
    
    print(f"\n  Overall: {'GATE 2 PASSED' if all_pass else 'GATE 2 NOT PASSED'}")
    print(f"  Report: {report_path}")
    print(f"{'='*60}\n")
    
    return report_path, criteria, all_pass


# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="RTR Module 18 — Gate 2: Algorithmic Consistency",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_gate2.py                         # Full production run (1000 x 600s)
  python run_gate2.py --runs 50 --quick       # Quick validation (50 x 120s)  
  python run_gate2.py --sensitivity           # Include sensitivity analysis
  python run_gate2.py --runs 100 --drones 3   # Multi-drone (100 x 3 drones)
        """
    )
    parser.add_argument("--runs", type=int, default=1000,
                        help="Monte Carlo runs (default: 1000)")
    parser.add_argument("--drones", type=int, default=1,
                        help="Drones per run (default: 1)")
    parser.add_argument("--quick", action="store_true",
                        help="Quick mode: 120s duration instead of 600s")
    parser.add_argument("--sensitivity", action="store_true",
                        help="Run sensitivity analysis after MC")
    parser.add_argument("--sensitivity-runs", type=int, default=100,
                        help="Runs per sensitivity value (default: 100)")
    parser.add_argument("--output", type=str, default="reports/gate2",
                        help="Output directory (default: reports/gate2)")
    args = parser.parse_args()
    
    # Build config
    cfg = create_production_config()
    
    # Override for quick mode
    if args.quick:
        cfg["sim"].sim_duration_max = 120.0
    
    cfg["sim"].monte_carlo_runs = args.runs
    
    output_dir = args.output
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    # Banner
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║     RTR Module 18 — GPS-Denied Navigation Engine            ║
║     Gate 2: Algorithmic Consistency                          ║
║                                                              ║
║     Convergent Cone Framework (Hardened)                     ║
║     ES-EKF 17D | 5-Stage Visual Pipeline | 4-Mode FSM       ║
║     Document: RTR_Hardened.docx                              ║
╚══════════════════════════════════════════════════════════════╝
    """)
    
    # Run Monte Carlo
    mc_result = run_production_mc(cfg, args)
    
    # Sensitivity (optional)
    sensitivity_results = {}
    if args.sensitivity:
        sensitivity_results = run_sensitivity(cfg, args)
    
    # Generate report
    report_path, criteria, passed = generate_report(
        mc_result, sensitivity_results, cfg, output_dir)
    
    # Exit code
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
