"""Tests for simulation report generator."""

import os

import numpy as np
import pytest

from core.physics.sim.report import SimReportGenerator
from core.physics.types import (
    MissionPackage,
    MonteCarloResult,
    NominalState,
    SensitivityResult,
    SimResult,
)


def _mock_sim_result(n: int = 50) -> SimResult:
    rng = np.random.RandomState(42)
    return SimResult(
        true_states=[
            NominalState(
                np.array([i * 10.0, 0.0, -100.0]),
                np.array([15.0, 0.0, 0.0]),
                np.array([1, 0, 0, 0.0]),
                np.zeros(3), np.zeros(3), np.zeros(2),
            )
            for i in range(n)
        ],
        estimated_states=[
            NominalState(
                np.array([i * 10.0 + rng.randn() * 2, rng.randn() * 2, -100 + rng.randn()]),
                np.array([15.0, 0.0, 0.0]),
                np.array([1, 0, 0, 0.0]),
                np.zeros(3), np.zeros(3), np.zeros(2),
            )
            for i in range(n)
        ],
        timestamps=np.arange(n) * 0.1,
        position_errors=np.random.RandomState(42).randn(n, 3) * 5,
        nis_values=np.abs(np.random.RandomState(42).randn(n) * 1.5 + 2.0),
        covariances=[np.eye(17) * (10 + i * 0.1) for i in range(n)],
        landmarks_matched=[{"count": 1} for _ in range(n)],
        outcome="success",
        final_error=8.5,
        metadata={"total_time": 5.0, "updates": 15, "rejects": 2},
    )


def _mock_mc_result(n: int = 20) -> MonteCarloResult:
    rng = np.random.RandomState(42)
    errors = np.abs(rng.randn(n) * 8 + 5)
    outcomes = ["success" if e < 15 else "timeout" for e in errors]
    return MonteCarloResult(
        num_runs=n,
        num_drones=1,
        outcomes=outcomes,
        final_errors=errors,
        success_rate=sum(1 for o in outcomes if o == "success") / n,
        cep50=float(np.median(errors)),
        cep95=float(np.percentile(errors, 95)),
        mean_error=float(np.mean(errors)),
        mean_nis_per_run=np.abs(rng.randn(n) * 0.5 + 2.0),
        consistent_fraction=0.85,
        mean_flight_time=300.0,
        total_compute_time=45.0,
        run_results=[],
        failure_breakdown={
            "success": sum(1 for o in outcomes if o == "success"),
            "timeout": sum(1 for o in outcomes if o == "timeout"),
        },
    )


def _mock_mission() -> MissionPackage:
    return MissionPackage(
        target=np.array([5000.0, 0.0, -100.0]),
        landmarks=[],
        clusters=[],
        corridor_grid=np.zeros((10, 10)),
        wind_estimate=np.zeros(2),
        camera_cal=np.eye(3),
        terrain_profile=np.zeros((10, 3)),
        drop_point=np.zeros(3),
    )


class TestSingleReport:
    def test_generates_plots(self, tmp_path) -> None:
        gen = SimReportGenerator(str(tmp_path))
        report = gen.generate_single_report(_mock_sim_result(), _mock_mission())
        assert "trajectory_map" in report
        assert os.path.exists(report["trajectory_map"])

    def test_position_error_plot(self, tmp_path) -> None:
        gen = SimReportGenerator(str(tmp_path))
        report = gen.generate_single_report(_mock_sim_result(), _mock_mission())
        assert "position_error" in report


class TestMCReport:
    def test_generates_plots(self, tmp_path) -> None:
        gen = SimReportGenerator(str(tmp_path))
        report = gen.generate_monte_carlo_report(_mock_mc_result())
        assert "cep_scatter" in report
        assert "success_rate_bar" in report

    def test_cep_histogram(self, tmp_path) -> None:
        gen = SimReportGenerator(str(tmp_path))
        report = gen.generate_monte_carlo_report(_mock_mc_result())
        assert "cep_histogram" in report


class TestNarrative:
    def test_generation(self, tmp_path) -> None:
        gen = SimReportGenerator(str(tmp_path))
        narrative = gen.generate_narrative(_mock_mc_result(), _mock_mission())
        assert "CEP50" in narrative
        assert "success" in narrative.lower()


class TestAcceptanceCriteria:
    def test_pass(self) -> None:
        gen = SimReportGenerator()
        mc = _mock_mc_result()
        mc.success_rate = 0.85
        mc.cep50 = 8.0
        mc.consistent_fraction = 0.96
        criteria = gen.check_acceptance_criteria(mc)
        assert criteria["TC-1"]["pass"] is True
        assert criteria["TC-2"]["pass"] is True
        assert criteria["TC-3"]["pass"] is True

    def test_fail(self) -> None:
        gen = SimReportGenerator()
        mc = _mock_mc_result()
        mc.success_rate = 0.60
        mc.cep50 = 25.0
        mc.consistent_fraction = 0.80
        criteria = gen.check_acceptance_criteria(mc)
        assert criteria["TC-1"]["pass"] is False
        assert criteria["TC-2"]["pass"] is False
        assert criteria["TC-3"]["pass"] is False


class TestExport:
    def test_full_export(self, tmp_path) -> None:
        gen = SimReportGenerator(str(tmp_path))
        output = gen.export_full_report(_mock_mc_result(), _mock_mission())
        assert os.path.isdir(output)
        assert os.path.exists(os.path.join(output, "summary.json"))
        assert os.path.exists(os.path.join(output, "narrative.txt"))

    def test_export_with_single_result(self, tmp_path) -> None:
        gen = SimReportGenerator(str(tmp_path))
        output = gen.export_full_report(
            _mock_mc_result(), _mock_mission(),
            single_result=_mock_sim_result(),
        )
        plots_dir = os.path.join(output, "plots")
        assert os.path.isdir(plots_dir)
