"""Simulation report generator — plots, narrative, acceptance criteria, export.

Generates analysis from single trajectory and Monte Carlo results.
Uses matplotlib for plots (optional dependency).
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

import numpy as np

from core.physics.types import (
    MissionPackage,
    MonteCarloResult,
    SensitivityResult,
    SimResult,
)

logger = logging.getLogger(__name__)

COLORS = {
    "true": "#1D9E75",
    "estimated": "#E24B4A",
    "error": "#534AB7",
    "north": "#185FA5",
    "east": "#D85A30",
    "down": "#639922",
    "success": "#1D9E75",
    "diverged": "#E24B4A",
    "timeout": "#888780",
    "lost": "#BA7517",
    "cep50": "#534AB7",
    "cep95": "#D85A30",
    "envelope": "#B5D4F4",
}


class SimReportGenerator:
    """Generate analysis report from simulation results."""

    def __init__(self, output_dir: str = "./reports") -> None:
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)

    def generate_single_report(
        self, result: SimResult, mission: MissionPackage
    ) -> dict:
        """Report for a single trajectory — 4 plots + summary."""
        plots: dict[str, str] = {}

        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            # 1. Trajectory map (top-down NE)
            fig, ax = plt.subplots(figsize=(10, 6))
            true_n = [s.position[0] for s in result.true_states]
            true_e = [s.position[1] for s in result.true_states]
            est_n = [s.position[0] for s in result.estimated_states]
            est_e = [s.position[1] for s in result.estimated_states]
            ax.plot(true_e, true_n, color=COLORS["true"], label="True", linewidth=1.5)
            ax.plot(est_e, est_n, "--", color=COLORS["estimated"], label="Estimated", linewidth=1)
            ax.plot(mission.target[1], mission.target[0], "*", color=COLORS["success"], markersize=15, label="Target")
            ax.plot(0, 0, "o", color=COLORS["error"], markersize=8, label="Drop")
            for lm in mission.landmarks[:30]:
                ax.plot(lm.position[1], lm.position[0], ".", color="#999", markersize=3)
            ax.set_xlabel("East (m)")
            ax.set_ylabel("North (m)")
            ax.set_title("Trajectory Map")
            ax.legend()
            ax.grid(True, alpha=0.3)
            ax.set_aspect("equal")
            path = os.path.join(self.output_dir, "trajectory_map.png")
            fig.savefig(path, dpi=150, bbox_inches="tight")
            plt.close(fig)
            plots["trajectory_map"] = path

            # 2. Position error vs time
            fig, ax = plt.subplots(figsize=(10, 5))
            t = result.timestamps
            ax.plot(t, result.position_errors[:, 0], color=COLORS["north"], label="North", alpha=0.8)
            ax.plot(t, result.position_errors[:, 1], color=COLORS["east"], label="East", alpha=0.8)
            ax.plot(t, result.position_errors[:, 2], color=COLORS["down"], label="Down", alpha=0.8)
            total = np.linalg.norm(result.position_errors, axis=1)
            ax.plot(t, total, color="k", linewidth=2, label="Total (RSS)")
            ax.set_xlabel("Time (s)")
            ax.set_ylabel("Position Error (m)")
            ax.set_title("Position Error vs Time")
            ax.legend()
            ax.grid(True, alpha=0.3)
            path = os.path.join(self.output_dir, "position_error.png")
            fig.savefig(path, dpi=150, bbox_inches="tight")
            plt.close(fig)
            plots["position_error"] = path

            # 3. Covariance envelope
            if result.covariances:
                fig, axes = plt.subplots(3, 1, figsize=(10, 8), sharex=True)
                n_cov = len(result.covariances)
                t_cov = np.linspace(0, result.timestamps[-1], n_cov)
                sigmas = np.array([np.sqrt(np.diag(P)[:3]) for P in result.covariances])
                # Subsample errors to match covariance rate
                step = max(1, len(result.position_errors) // n_cov)
                err_sub = result.position_errors[::step][:n_cov]
                labels = ["North", "East", "Down"]
                colors = [COLORS["north"], COLORS["east"], COLORS["down"]]
                for i, (ax, lbl, clr) in enumerate(zip(axes, labels, colors)):
                    ax.fill_between(t_cov, -3 * sigmas[:, i], 3 * sigmas[:, i],
                                    color=COLORS["envelope"], alpha=0.5, label="3\u03c3")
                    ax.plot(t_cov[:len(err_sub)], err_sub[:, i], color=clr, linewidth=1, label=lbl)
                    ax.set_ylabel(f"{lbl} (m)")
                    ax.legend(loc="upper right")
                    ax.grid(True, alpha=0.3)
                axes[-1].set_xlabel("Time (s)")
                axes[0].set_title("Covariance Envelope (3\u03c3)")
                path = os.path.join(self.output_dir, "covariance_envelope.png")
                fig.savefig(path, dpi=150, bbox_inches="tight")
                plt.close(fig)
                plots["covariance_envelope"] = path

            # 4. NIS timeline
            valid_mask = result.nis_values > 0
            if np.any(valid_mask):
                fig, ax = plt.subplots(figsize=(10, 4))
                t_nis = result.timestamps[valid_mask]
                nis_v = result.nis_values[valid_mask]
                ax.scatter(t_nis, nis_v, s=10, c=COLORS["true"], alpha=0.6)
                ax.axhline(2.0, color="gray", linestyle="--", label="Expected (2.0)")
                ax.axhline(9.21, color=COLORS["diverged"], linestyle="--", label="Gate (9.21)")
                ax.set_xlabel("Time (s)")
                ax.set_ylabel("NIS")
                ax.set_title("Normalized Innovation Squared")
                ax.legend()
                ax.grid(True, alpha=0.3)
                path = os.path.join(self.output_dir, "nis_timeline.png")
                fig.savefig(path, dpi=150, bbox_inches="tight")
                plt.close(fig)
                plots["nis_timeline"] = path

        except ImportError:
            logger.warning("matplotlib not available — skipping plots")

        return plots

    def generate_monte_carlo_report(self, mc_result: MonteCarloResult) -> dict:
        """Report for Monte Carlo campaign — 4 plots."""
        plots: dict[str, str] = {}

        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            # 5. CEP scatter
            fig, ax = plt.subplots(figsize=(8, 8))
            for i, (err, outcome) in enumerate(
                zip(mc_result.final_errors, mc_result.outcomes)
            ):
                clr = COLORS.get(outcome, "#888")
                ax.plot(0, err, "o", color=clr, markersize=3, alpha=0.5)
            ax.axhline(mc_result.cep50, color=COLORS["cep50"], linestyle="--",
                       label=f"CEP50={mc_result.cep50:.1f}m")
            ax.axhline(mc_result.cep95, color=COLORS["cep95"], linestyle=":",
                       label=f"CEP95={mc_result.cep95:.1f}m")
            ax.set_ylabel("Final Error (m)")
            ax.set_title("Monte Carlo — Final Error Distribution")
            ax.legend()
            ax.grid(True, alpha=0.3)
            path = os.path.join(self.output_dir, "cep_scatter.png")
            fig.savefig(path, dpi=150, bbox_inches="tight")
            plt.close(fig)
            plots["cep_scatter"] = path

            # 6. CEP histogram
            fig, ax = plt.subplots(figsize=(10, 5))
            ax.hist(mc_result.final_errors, bins=30, color=COLORS["true"], alpha=0.7, edgecolor="white")
            ax.axvline(mc_result.cep50, color=COLORS["cep50"], linewidth=2, label=f"CEP50={mc_result.cep50:.1f}m")
            ax.axvline(mc_result.cep95, color=COLORS["cep95"], linewidth=2, linestyle="--", label=f"CEP95={mc_result.cep95:.1f}m")
            ax.set_xlabel("Final Error (m)")
            ax.set_ylabel("Count")
            ax.set_title("Error Distribution")
            ax.legend()
            ax.grid(True, alpha=0.3)
            path = os.path.join(self.output_dir, "cep_histogram.png")
            fig.savefig(path, dpi=150, bbox_inches="tight")
            plt.close(fig)
            plots["cep_histogram"] = path

            # 7. Success rate bar
            fig, ax = plt.subplots(figsize=(8, 5))
            bd = mc_result.failure_breakdown
            labels = list(bd.keys())
            counts = list(bd.values())
            bar_colors = [COLORS.get(l, "#888") for l in labels]
            ax.bar(labels, counts, color=bar_colors, edgecolor="white")
            ax.set_ylabel("Count")
            ax.set_title("Outcome Breakdown")
            ax.grid(True, alpha=0.3, axis="y")
            path = os.path.join(self.output_dir, "success_rate_bar.png")
            fig.savefig(path, dpi=150, bbox_inches="tight")
            plt.close(fig)
            plots["success_rate_bar"] = path

            # 8. NIS consistency histogram
            fig, ax = plt.subplots(figsize=(10, 5))
            valid_nis = mc_result.mean_nis_per_run[mc_result.mean_nis_per_run > 0]
            if len(valid_nis) > 0:
                ax.hist(valid_nis, bins=20, color=COLORS["true"], alpha=0.7, edgecolor="white")
                ax.axvspan(0.5, 4.0, alpha=0.15, color=COLORS["success"], label="Consistent [0.5, 4.0]")
            ax.set_xlabel("Mean NIS per run")
            ax.set_ylabel("Count")
            ax.set_title("NIS Consistency")
            ax.legend()
            ax.grid(True, alpha=0.3)
            path = os.path.join(self.output_dir, "nis_consistency.png")
            fig.savefig(path, dpi=150, bbox_inches="tight")
            plt.close(fig)
            plots["nis_consistency"] = path

        except ImportError:
            logger.warning("matplotlib not available — skipping plots")

        return plots

    def generate_sensitivity_report(self, sens: SensitivityResult) -> dict:
        """Report for sensitivity analysis — 2 plots."""
        plots: dict[str, str] = {}

        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
            ax1.plot(sens.param_values, sens.success_rates * 100, "o-", color=COLORS["success"])
            ax1.set_xlabel(sens.param_name)
            ax1.set_ylabel("Success Rate (%)")
            ax1.set_title(f"Success Rate vs {sens.param_name}")
            ax1.grid(True, alpha=0.3)

            ax2.plot(sens.param_values, sens.mean_ceps, "s-", color=COLORS["cep50"])
            ax2.set_xlabel(sens.param_name)
            ax2.set_ylabel("CEP50 (m)")
            ax2.set_title(f"CEP50 vs {sens.param_name}")
            ax2.grid(True, alpha=0.3)

            path = os.path.join(self.output_dir, "sensitivity.png")
            fig.savefig(path, dpi=150, bbox_inches="tight")
            plt.close(fig)
            plots["sensitivity"] = path

        except ImportError:
            logger.warning("matplotlib not available — skipping plots")

        return plots

    def generate_narrative(
        self,
        mc_result: MonteCarloResult,
        mission: MissionPackage,
        zep_client: object | None = None,
    ) -> str:
        """Generate analysis narrative from statistics."""
        criteria = self.check_acceptance_criteria(mc_result)
        tc_lines = []
        for tc_id, tc in criteria.items():
            status = "PASS" if tc["pass"] else "FAIL"
            tc_lines.append(f"  {tc_id}: {tc['actual']} vs target {tc['target']} — {status}")

        corridor_km = np.linalg.norm(mission.target[:2]) / 1000

        return (
            f"MONTE CARLO ANALYSIS — GPS-DENIED NAVIGATION\n"
            f"{'=' * 50}\n\n"
            f"EXECUTIVE SUMMARY:\n"
            f"  {mc_result.num_runs} trajectories simulated over {corridor_km:.1f}km corridor.\n"
            f"  Success rate: {mc_result.success_rate * 100:.1f}%\n"
            f"  Median arrival error (CEP50): {mc_result.cep50:.1f}m\n"
            f"  95th percentile (CEP95): {mc_result.cep95:.1f}m\n\n"
            f"FILTER CONSISTENCY:\n"
            f"  {mc_result.consistent_fraction * 100:.1f}% of runs maintained consistent NIS.\n"
            f"  Mean flight time: {mc_result.mean_flight_time:.0f}s\n"
            f"  Total compute time: {mc_result.total_compute_time:.1f}s\n\n"
            f"FAILURE BREAKDOWN:\n"
            f"  {mc_result.failure_breakdown}\n\n"
            f"ACCEPTANCE CRITERIA:\n"
            + "\n".join(tc_lines)
            + "\n"
        )

    def check_acceptance_criteria(self, mc_result: MonteCarloResult) -> dict:
        """Check đề án acceptance criteria TC-1 through TC-4."""
        criteria = {
            "TC-1": {
                "target": ">=80%",
                "actual": f"{mc_result.success_rate * 100:.1f}%",
                "pass": mc_result.success_rate >= 0.80,
            },
            "TC-2": {
                "target": "<10m",
                "actual": f"{mc_result.cep50:.1f}m",
                "pass": mc_result.cep50 < 10.0,
            },
            "TC-3": {
                "target": "95% consistent",
                "actual": f"{mc_result.consistent_fraction * 100:.1f}%",
                "pass": mc_result.consistent_fraction >= 0.95,
            },
        }
        # TC-4: Cone compliance (if cone metrics present)
        if mc_result.cone_metrics and "cone_compliance" in mc_result.cone_metrics:
            compliance = mc_result.cone_metrics["cone_compliance"]
            criteria["TC-4"] = {
                "target": ">=90% inside cone",
                "actual": f"{compliance * 100:.1f}%",
                "pass": compliance >= 0.90,
            }
        return criteria

    def export_full_report(
        self,
        mc_result: MonteCarloResult,
        mission: MissionPackage,
        single_result: Optional[SimResult] = None,
        sensitivity: Optional[SensitivityResult] = None,
        zep_client: object | None = None,
    ) -> str:
        """Generate complete report package in output_dir."""
        plots_dir = os.path.join(self.output_dir, "plots")
        os.makedirs(plots_dir, exist_ok=True)

        # Generate plots
        sub_gen = SimReportGenerator(plots_dir)
        if single_result:
            sub_gen.generate_single_report(single_result, mission)
        sub_gen.generate_monte_carlo_report(mc_result)
        if sensitivity:
            sub_gen.generate_sensitivity_report(sensitivity)

        # Narrative
        narrative = self.generate_narrative(mc_result, mission, zep_client)
        narrative_path = os.path.join(self.output_dir, "narrative.txt")
        with open(narrative_path, "w") as f:
            f.write(narrative)

        # Summary JSON
        criteria = self.check_acceptance_criteria(mc_result)
        summary = {
            "num_runs": mc_result.num_runs,
            "num_drones": mc_result.num_drones,
            "success_rate": mc_result.success_rate,
            "cep50": mc_result.cep50,
            "cep95": mc_result.cep95,
            "mean_error": mc_result.mean_error,
            "consistent_fraction": mc_result.consistent_fraction,
            "mean_flight_time": mc_result.mean_flight_time,
            "total_compute_time": mc_result.total_compute_time,
            "failure_breakdown": mc_result.failure_breakdown,
            "acceptance_criteria": criteria,
        }
        summary_path = os.path.join(self.output_dir, "summary.json")
        with open(summary_path, "w") as f:
            json.dump(summary, f, indent=2)

        return self.output_dir
