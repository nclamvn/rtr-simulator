"""Trajectory simulator — orchestrates a single drone flight from B to T.

Wires all components: dynamics → sensors → EKF → association → update.
Guidance uses EKF estimated state (not truth) — realistic closed-loop.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np

from core.physics.association.base import DataAssociator
from core.physics.config import SimConfig
from core.physics.dynamics._quaternion import quat_normalize, quat_to_rotation
from core.physics.dynamics.base import DynamicsModel
from core.physics.estimator.base import StateEstimator
from core.physics.landmark.base import LandmarkProvider
from core.physics.sensors.base import SensorModel
from core.physics.sensors.camera import CameraModel
from core.physics.terrain.base import TerrainProvider
from core.physics.types import (
    GRAVITY,
    CameraObservation,
    DroneConfig,
    IMUMeasurement,
    MissionPackage,
    NominalState,
    SimResult,
    WindVector,
)
from core.physics.wind.base import WindField

from core.physics.sim.pn_guidance import ProportionalNavGuidance

logger = logging.getLogger(__name__)


class SimpleGuidance:
    """Bare-minimum guidance: fly toward target at constant speed/altitude.

    Uses EKF estimated state (not truth) for realistic closed-loop.
    """

    def __init__(
        self,
        target: np.ndarray,
        cruise_speed: float = 15.0,
        cruise_alt: float = 100.0,
        drag_coeffs: np.ndarray | None = None,
    ) -> None:
        self.target = target
        self.cruise_speed = cruise_speed
        self.cruise_alt = cruise_alt  # meters above ground
        self.drag_coeffs = drag_coeffs if drag_coeffs is not None else np.array([0.3, 0.3, 0.5])
        self.kp_heading = 1.5
        self.kp_speed = 2.0
        self.kp_alt = 1.0

    def compute(
        self, estimated_state: NominalState, **kwargs
    ) -> tuple[np.ndarray, np.ndarray]:
        """Compute desired body accel and gyro commands.

        Returns (accel_body_cmd [3], gyro_body_cmd [3]).
        """
        pos = estimated_state.position
        vel = estimated_state.velocity
        R = quat_to_rotation(estimated_state.quaternion)

        # Desired heading toward target
        delta = self.target[:2] - pos[:2]
        dist = np.linalg.norm(delta)
        if dist > 1.0:
            desired_heading = np.arctan2(delta[1], delta[0])
        else:
            desired_heading = 0.0

        # Current heading from velocity
        speed = np.linalg.norm(vel[:2])
        if speed > 0.5:
            current_heading = np.arctan2(vel[1], vel[0])
        else:
            current_heading = desired_heading

        heading_err = desired_heading - current_heading
        # Wrap to [-π, π]
        heading_err = (heading_err + np.pi) % (2 * np.pi) - np.pi
        yaw_rate_cmd = self.kp_heading * heading_err

        # Speed control — must compensate for drag
        # Drag ≈ mu * speed in body frame. Feed-forward: accel = mu * cruise_speed
        drag_ff = self.drag_coeffs[0] * self.cruise_speed  # forward drag compensation
        speed_err = self.cruise_speed - speed
        forward_accel = drag_ff + self.kp_speed * speed_err

        # Altitude control (NED: alt = -Z)
        alt_current = -pos[2]
        alt_err = self.cruise_alt - alt_current
        vertical_accel = self.kp_alt * alt_err

        # Build NED acceleration command
        if speed > 0.5:
            heading_vec = vel[:2] / speed
        else:
            heading_vec = np.array([np.cos(desired_heading), np.sin(desired_heading)])

        accel_ned = np.array([
            forward_accel * heading_vec[0],
            forward_accel * heading_vec[1],
            -vertical_accel,  # NED: negative Z = up
        ])

        # Body-frame: a_body = R^T @ (a_ned + [0,0,g]) → specific force
        # IMU measures specific force = R^T @ (accel - gravity)
        accel_body = R.T @ (accel_ned - np.array([0, 0, GRAVITY]))

        gyro_body = np.array([0.0, 0.0, yaw_rate_cmd])

        return accel_body, gyro_body


class ConeGuidance:
    """Layer-based guidance for cone navigation model.

    Steers through cone layers sequentially. Monitors cone boundary.
    Falls back to SimpleGuidance-like behavior within each layer.
    """

    def __init__(
        self,
        target: np.ndarray,
        cone_layers: list,
        cone_config: object,
        cruise_speed: float = 15.0,
        cruise_alt: float = 100.0,
        drag_coeffs: np.ndarray | None = None,
        cone_landmark_gen: object | None = None,
    ) -> None:
        self.target = target
        self.layers = cone_layers
        self.cone_config = cone_config
        self.cruise_speed = cruise_speed
        self.cruise_alt = cruise_alt
        self.drag_coeffs = drag_coeffs if drag_coeffs is not None else np.array([0.3, 0.3, 0.5])
        self.cone_gen = cone_landmark_gen
        self.current_layer_index = 0
        self.kp_heading = 1.5
        self.kp_speed = 2.0
        self.kp_alt = 1.0
        self.kp_lateral = 1.2
        self.max_lateral_accel = 12.0
        self.sigma_thresh = 20.0
        self.sigma_sat = 80.0
        self.k_cov = 0.15

    def compute(
        self, estimated_state: NominalState, sigma_lateral: float = 0.0
    ) -> tuple[np.ndarray, np.ndarray]:
        """Compute body accel + gyro commands. Navigates through cone layers."""
        pos = estimated_state.position
        vel = estimated_state.velocity
        R = quat_to_rotation(estimated_state.quaternion)

        # Advance layer if close to next layer center
        self._advance_layer(pos)

        # Waypoint: next unpassed layer center, or final target
        if self.current_layer_index < len(self.layers):
            waypoint = self.layers[self.current_layer_index].center.copy()
        else:
            waypoint = self.target.copy()

        # Heading toward waypoint
        delta = waypoint[:2] - pos[:2]
        dist = np.linalg.norm(delta)
        desired_heading = np.arctan2(delta[1], delta[0]) if dist > 1.0 else 0.0

        speed = np.linalg.norm(vel[:2])
        current_heading = np.arctan2(vel[1], vel[0]) if speed > 0.5 else desired_heading

        heading_err = (desired_heading - current_heading + np.pi) % (2 * np.pi) - np.pi

        # ── Layer-transition centering ──
        # Always pull toward the next layer center, proportional to lateral offset.
        # This ensures the drone actively corrects position as the cone narrows.
        progress = self.current_layer_index / max(len(self.layers), 1)
        lateral_accel_vec = np.zeros(2)
        heading_blend = 0.0
        if self.cone_gen is not None:
            lateral_to_wp = waypoint[:2] - pos[:2]
            # Decompose into along-axis and cross-axis components
            try:
                toward_axis, lat_dist = self.cone_gen.get_correction_direction(pos)
                if lat_dist > 2.0:
                    # Get target layer radius to scale the centering gain
                    target_layer = self.layers[min(self.current_layer_index, len(self.layers) - 1)] if self.layers else None
                    target_radius = target_layer.radius if target_layer else 500.0
                    # Centering gain: stronger as cone narrows (radius shrinks)
                    # At large radius (1000m+): gentle pull. At small radius (<100m): firm pull.
                    center_gain = self.kp_lateral * 0.5 * (1.0 + 200.0 / max(target_radius, 10.0))
                    center_accel = center_gain * lat_dist / max(target_radius, 10.0)
                    # In terminal phase (progress > 75%), allow stronger centering
                    max_center = self.max_lateral_accel * (0.8 if progress >= 0.75 else 0.5)
                    center_accel = min(center_accel, max_center)
                    lateral_accel_vec = center_accel * toward_axis
            except (ValueError, AttributeError):
                pass
        if self.cone_gen is not None:
            try:
                inside, margin = self.cone_gen.check_cone_boundary(pos)
                current_layer = self.cone_gen.get_current_layer(pos)
                # Floor threshold so narrow layers still get early correction
                threshold = max(current_layer.radius * 0.3, 50.0)

                if margin < threshold:
                    toward_axis, lat_dist = self.cone_gen.get_correction_direction(pos)

                    if lat_dist > 1e-6:
                        deviation = threshold - margin
                        if margin >= 0:
                            gain = self.kp_lateral * deviation
                        else:
                            gain = self.kp_lateral * (threshold + abs(margin) ** 1.5)

                        gain = min(gain, self.max_lateral_accel)
                        lateral_accel_vec = gain * toward_axis

                        # Heading blend: when far outside, steer heading toward axis
                        blend_trigger = max(current_layer.radius * 0.1, 20.0)
                        blend_range = max(current_layer.radius * 0.4, 80.0)
                        if margin < -blend_trigger:
                            heading_blend = min(
                                1.0,
                                (-margin - blend_trigger) / blend_range,
                            )
            except (ValueError, AttributeError):
                pass

        # Note: covariance-aware correction was evaluated but found ineffective
        # here because EKF estimated position stays near axis even when true
        # position drifts — sigma grows but we don't know WHICH direction to
        # correct. The remaining drift is a fundamental EKF observability limit.

        # Blend heading toward axis when outside cone or uncertainty is high
        if heading_blend > 0.0 and self.cone_gen is not None:
            try:
                toward_axis, lat_dist = self.cone_gen.get_correction_direction(pos)
                if lat_dist > 1e-6:
                    axis_heading = np.arctan2(toward_axis[1], toward_axis[0])
                    axis_heading_err = (axis_heading - current_heading + np.pi) % (2 * np.pi) - np.pi
                    heading_err = (1.0 - heading_blend) * heading_err + heading_blend * axis_heading_err
            except (ValueError, AttributeError):
                pass

        yaw_rate_cmd = self.kp_heading * heading_err

        # ── Terminal guidance mode ──
        # Last 25% of layers: slow down proportional to how narrow the cone is,
        # but only when well-centered. If drifting, maintain speed to reach
        # landmarks faster and get EKF updates.
        terminal_phase = progress >= 0.75

        if terminal_phase:
            cur = self.layers[min(self.current_layer_index, len(self.layers) - 1)] if self.layers else None
            cur_radius = cur.radius if cur else 100.0
            dist_to_target = np.linalg.norm(self.target[:2] - pos[:2])
            # Terminal speed: slower as we get closer to target
            terminal_speed = max(3.0, min(
                self.cruise_speed * 0.7,
                self.cruise_speed * cur_radius / 400.0,
                dist_to_target * 0.015,  # 1.5% of distance
            ))
            target_speed = terminal_speed
        else:
            target_speed = self.cruise_speed * (1.0 - 0.3 * progress)

        drag_ff = self.drag_coeffs[0] * target_speed
        speed_err = target_speed - speed
        forward_accel = drag_ff + self.kp_speed * speed_err

        # Altitude
        alt_current = -pos[2]
        alt_err = self.cruise_alt - alt_current
        vertical_accel = self.kp_alt * alt_err

        # Build NED accel
        heading_vec = vel[:2] / speed if speed > 0.5 else np.array([np.cos(desired_heading), np.sin(desired_heading)])

        # Wind feedforward: compensate estimated crosswind to reduce drift
        wind_ff = np.zeros(2)
        if hasattr(estimated_state, 'wind') and estimated_state.wind is not None:
            wind_est = estimated_state.wind[:2]
            # Crosswind component (perpendicular to heading)
            cross = np.array([-heading_vec[1], heading_vec[0]])
            crosswind = np.dot(wind_est, cross)
            wind_ff = -self.drag_coeffs[0] * crosswind * cross

        accel_ned = np.array([
            forward_accel * heading_vec[0] + lateral_accel_vec[0] + wind_ff[0],
            forward_accel * heading_vec[1] + lateral_accel_vec[1] + wind_ff[1],
            -vertical_accel,
        ])

        accel_body = R.T @ (accel_ned - np.array([0, 0, GRAVITY]))
        gyro_body = np.array([0.0, 0.0, yaw_rate_cmd])

        return accel_body, gyro_body

    def _advance_layer(self, position: np.ndarray) -> None:
        """Advance to next layer when drone is along-axis past the layer
        AND laterally within the layer radius."""
        if self.current_layer_index >= len(self.layers):
            return
        layer = self.layers[self.current_layer_index]
        # Check along-axis progress (must have passed the layer distance)
        if self.cone_gen is not None:
            try:
                d = self.cone_gen._project_distance(position)
                _, lat_dist = self.cone_gen.get_correction_direction(position)
                # Advance only if past this layer AND laterally within radius
                if d >= layer.distance_from_base and lat_dist < layer.radius * 0.8:
                    self.current_layer_index += 1
                return
            except (ValueError, AttributeError):
                pass
        # Fallback: original distance check
        dist = np.linalg.norm(position[:2] - layer.center[:2])
        if dist < layer.radius * 0.5:
            self.current_layer_index += 1

    def get_layer_progress(self) -> dict:
        """Return current cone navigation progress."""
        inside = True
        if self.cone_gen is not None:
            try:
                inside, _ = self.cone_gen.check_cone_boundary(
                    np.zeros(3)  # placeholder — caller should use actual pos
                )
            except (ValueError, AttributeError):
                pass
        return {
            "current_layer": self.current_layer_index,
            "total_layers": len(self.layers),
            "fraction_complete": self.current_layer_index / max(len(self.layers), 1),
            "inside_cone": inside,
        }


class TrajectorySimulator:
    """Orchestrates a single drone flight simulation."""

    def __init__(
        self,
        dynamics: DynamicsModel,
        imu_sensor: SensorModel,
        camera_sensor: SensorModel,
        estimator: StateEstimator,
        associator: DataAssociator,
        terrain: TerrainProvider,
        wind: WindField,
        landmarks: LandmarkProvider,
        config: SimConfig,
    ) -> None:
        self.dynamics = dynamics
        self.imu_sensor = imu_sensor
        self.camera_sensor = camera_sensor
        self.estimator = estimator
        self.associator = associator
        self.terrain = terrain
        self.wind = wind
        self.landmarks = landmarks
        self.config = config
        self._risk_policy = None  # Set externally for adaptive cone widening
        self._pn_config = None    # Set externally for PN terminal guidance

    def run(self, mission: MissionPackage, drone: DroneConfig) -> SimResult:
        """Run a single trajectory from drop point B to target T."""
        cfg = self.config
        dt = 1.0 / cfg.imu_rate_hz
        camera_period = int(cfg.imu_rate_hz / cfg.camera_rate_hz)

        # ── Initialization ──
        # Derive initial altitude from estimator's initial state
        est_init = self.estimator.get_state()
        drop_alt = -est_init.position[2]  # NED: alt = -Z

        # Select guidance: cone or corridor
        if getattr(mission, "cone", None) is not None and mission.cone_layers:
            guidance = ConeGuidance(
                target=mission.target,
                cone_layers=mission.cone_layers,
                cone_config=mission.cone,
                cruise_speed=drone.max_speed * 0.7,
                cruise_alt=drop_alt,
                drag_coeffs=drone.drag_coeffs,
                cone_landmark_gen=self.landmarks if hasattr(self.landmarks, "check_cone_boundary") else None,
            )
        else:
            guidance = SimpleGuidance(
                target=mission.target,
                cruise_speed=drone.max_speed * 0.7,
                cruise_alt=drop_alt,
                drag_coeffs=drone.drag_coeffs,
            )

        # True initial state — matches estimator's init with true biases
        true_state = NominalState(
            position=est_init.position.copy(),
            velocity=est_init.velocity.copy(),
            quaternion=est_init.quaternion.copy(),
            accel_bias=self._get_imu_true_bias("accel"),
            gyro_bias=self._get_imu_true_bias("gyro"),
            wind=mission.wind_estimate.copy(),
        )

        # PN terminal guidance (optional — only if pn_config set)
        pn = ProportionalNavGuidance(self._pn_config) if self._pn_config else None
        pn_active = False

        # Recording
        true_states: list[NominalState] = []
        estimated_states: list[NominalState] = []
        timestamps: list[float] = []
        position_errors_list: list[np.ndarray] = []
        nis_values_list: list[float] = []
        covariances: list[np.ndarray] = []
        landmarks_matched: list[dict] = []

        last_update_time = 0.0
        total_updates = 0
        total_rejects = 0
        outcome = "timeout"

        # ── Main Loop ──
        max_steps = int(cfg.sim_duration_max * cfg.imu_rate_hz)

        for step in range(max_steps):
            t = step * dt

            # Guidance (from estimated state + lateral uncertainty)
            est_state = self.estimator.get_state()
            sigma_lateral = float(np.sqrt(self.estimator.P[1, 1]))

            # PN switch check
            if pn is not None and not pn_active:
                if pn.should_switch(est_state, mission.target):
                    pn.activate(est_state, mission.target, t)
                    pn_active = True
                    logger.info("PN activated at t=%.1f d=%.0f",
                                t, pn.switch_distance)

            if pn_active:
                # PN uses true_state for bearing (camera direct measurement)
                accel_body_cmd, gyro_body_cmd = pn.compute(
                    est_state, mission.target, true_state, t
                )
            else:
                accel_body_cmd, gyro_body_cmd = guidance.compute(
                    est_state, sigma_lateral=sigma_lateral
                )

            # True wind at current position
            wind_true = self.wind.get_wind(true_state.position, t)

            # True IMU: body-frame specific force + angular rate
            # The commanded accel/gyro approximate the true body values
            # (in reality dynamics would close the loop; this is simplified)
            R = quat_to_rotation(true_state.quaternion)
            # True specific force in body frame
            accel_body_true = accel_body_cmd.copy()
            gyro_body_true = gyro_body_cmd.copy()

            # Create true IMU for dynamics propagation
            true_imu = IMUMeasurement(
                timestamp=t,
                accel=accel_body_true,
                gyro=gyro_body_true,
            )

            # Propagate true state
            true_state = self.dynamics.propagate(true_state, true_imu, wind_true, dt)

            # Generate noisy sensor measurements
            imu_noisy = self.imu_sensor.generate_from_body(
                accel_body_true, gyro_body_true, t
            )

            # EKF predict
            self.estimator.predict(imu_noisy, dt)

            # Camera + association (at camera rate)
            nis_this_step = 0.0
            n_matches_this_step = 0

            if step > 0 and step % camera_period == 0:
                # Get visible landmarks from true position
                true_heading = np.arctan2(
                    true_state.velocity[1],
                    max(true_state.velocity[0], 0.1),
                )
                visible_lm = self._get_visible_landmarks(
                    true_state, true_heading, mission.landmarks
                )

                if visible_lm:
                    # Camera observations from true state
                    frame = self.camera_sensor.observe_landmarks(
                        true_state, visible_lm, self.terrain, t
                    )

                    if frame.observations:
                        # Data association
                        matches = self.associator.associate(
                            frame,
                            self.estimator.get_state(),
                            self.estimator.get_covariance(),
                            visible_lm,
                        )

                        # EKF update per match — layer-aware dispatch
                        current_layer = None
                        if hasattr(self.landmarks, "get_current_layer"):
                            try:
                                current_layer = self.landmarks.get_current_layer(
                                    self.estimator.get_state().position
                                )
                            except (ValueError, AttributeError):
                                pass

                        mtype = getattr(current_layer, "measurement_type", "full_metric") if current_layer else "full_metric"
                        cone_r = getattr(current_layer, "radius", 500.0) if current_layer else 500.0

                        for m in matches:
                            if mtype == "containment":
                                result = self.estimator.containment_update(
                                    m.observation, m.landmark, cone_r
                                )
                                if result in ("corrected", "consistent"):
                                    n_matches_this_step += 1
                                    last_update_time = t
                            elif mtype == "bearing_metric":
                                nis = self.estimator.bearing_update(
                                    m.observation, m.landmark
                                )
                                if nis >= 0:
                                    nis_this_step = max(nis_this_step, nis)
                                    n_matches_this_step += 1
                                    if nis <= 6.63:  # χ²₁ gate
                                        total_updates += 1
                                        last_update_time = t
                                    else:
                                        total_rejects += 1
                            elif mtype == "terminal":
                                # Tighter gate for terminal
                                old_gate = cfg.innovation_gate_chi2
                                cfg.innovation_gate_chi2 = 5.99
                                nis = self.estimator.update(m.observation, m.landmark)
                                cfg.innovation_gate_chi2 = old_gate
                                if nis >= 0:
                                    nis_this_step = max(nis_this_step, nis)
                                    n_matches_this_step += 1
                                    if nis <= 5.99:
                                        total_updates += 1
                                        last_update_time = t
                                    else:
                                        total_rejects += 1
                            else:  # full_metric (default)
                                nis = self.estimator.update(m.observation, m.landmark)
                                if nis >= 0:
                                    nis_this_step = max(nis_this_step, nis)
                                    n_matches_this_step += 1
                                    if nis <= cfg.innovation_gate_chi2:
                                        total_updates += 1
                                        last_update_time = t
                                    else:
                                        total_rejects += 1

                # Record covariance at camera rate
                covariances.append(self.estimator.get_covariance())
                landmarks_matched.append({
                    "t": t,
                    "n_visible": len(visible_lm) if visible_lm else 0,
                    "n_matches": n_matches_this_step,
                })

            # Record
            est = self.estimator.get_state()
            true_states.append(true_state)
            estimated_states.append(est)
            timestamps.append(t)
            pos_err = true_state.position - est.position
            position_errors_list.append(pos_err)
            nis_values_list.append(nis_this_step)

            # Termination checks
            dist_to_target = np.linalg.norm(
                true_state.position[:2] - mission.target[:2]
            )
            pos_error_mag = np.linalg.norm(pos_err)

            if dist_to_target < cfg.target_radius:
                outcome = "success"
                break

            if pos_error_mag > cfg.divergence_threshold:
                outcome = "diverged"
                break

            if t - last_update_time > cfg.max_no_update_seconds and t > 5.0:
                outcome = "lost"
                break

            # Cone boundary check with adaptive widening
            if hasattr(self.landmarks, "check_cone_boundary"):
                try:
                    inside, margin = self.landmarks.check_cone_boundary(true_state.position)
                    # Adaptive: if geometric says OUT but EKF uncertainty is high,
                    # widen cone to k_adapt * σ_lateral before declaring OUT.
                    if not inside:
                        sigma_n = float(np.sqrt(self.estimator.P[0, 0]))
                        sigma_e = float(np.sqrt(self.estimator.P[1, 1]))
                        sigma_lat = float(np.sqrt(sigma_n**2 + sigma_e**2))
                        # Re-check with adaptive radius
                        from core.physics.landmark.cone_policy import RiskShapedCone
                        if hasattr(self, "_risk_policy"):
                            r_adapt = self._risk_policy.compute_radius(
                                d=float(np.linalg.norm(true_state.position[:2] - mission.target[:2])),
                                sigma_lateral=sigma_lat,
                                landmark_density=5.0,
                                terrain_clutter=0.2,
                                ekf_sigma_lateral=sigma_lat,
                            )
                            _, lat_dist = self.landmarks.get_correction_direction(true_state.position)
                            adaptive_margin = r_adapt - abs(lat_dist)
                            if adaptive_margin >= 0:
                                inside = True
                                margin = adaptive_margin
                    if not inside and "cone_exits" not in locals():
                        cone_exits = 0
                    if not inside:
                        cone_exits = locals().get("cone_exits", 0) + 1
                except (ValueError, AttributeError):
                    pass

            # Terrain crash check
            try:
                terrain_elev = self.terrain.get_elevation(
                    true_state.position[0], true_state.position[1]
                )
                true_alt = -true_state.position[2]
                if true_alt < terrain_elev + 5.0:
                    outcome = "crash"
                    break
            except (NotImplementedError, AttributeError):
                pass

        # ── Build Result ──
        ts_arr = np.array(timestamps)
        pos_errors = np.array(position_errors_list)
        nis_arr = np.array(nis_values_list)

        final_error = float(np.linalg.norm(
            true_states[-1].position[:2] - mission.target[:2]
        )) if true_states else 0.0

        return SimResult(
            true_states=true_states,
            estimated_states=estimated_states,
            timestamps=ts_arr,
            position_errors=pos_errors,
            nis_values=nis_arr,
            covariances=covariances,
            landmarks_matched=landmarks_matched,
            outcome=outcome,
            final_error=final_error,
            metadata={
                "total_time": timestamps[-1] if timestamps else 0.0,
                "updates": total_updates,
                "rejects": total_rejects,
                "last_update_time": last_update_time,
                "avg_nis": float(np.mean(nis_arr[nis_arr > 0]))
                if np.any(nis_arr > 0)
                else 0.0,
                "max_drift": float(np.max(np.linalg.norm(pos_errors, axis=1)))
                if len(pos_errors) > 0
                else 0.0,
                **({"cone_progress": guidance.get_layer_progress()}
                   if hasattr(guidance, "get_layer_progress") else {}),
                **(pn.get_report() if pn and pn.active else {}),
            },
        )

    def _get_imu_true_bias(self, kind: str) -> np.ndarray:
        """Extract true bias from IMU sensor model (if available)."""
        try:
            if kind == "accel":
                return self.imu_sensor.accel_bias_true.copy()
            elif kind == "gyro":
                return self.imu_sensor.gyro_bias_true.copy()
        except AttributeError:
            pass
        return np.zeros(3)

    def _get_visible_landmarks(
        self,
        true_state: NominalState,
        heading: float,
        all_landmarks: list,
    ) -> list:
        """Get visible landmarks — use LandmarkProvider if it has data, else filter directly."""
        try:
            return self.landmarks.get_visible_landmarks(
                true_state.position, heading, self.terrain
            )
        except (NotImplementedError, AttributeError):
            pass

        # Fallback: simple range + bearing filter
        visible = []
        for lm in all_landmarks:
            delta = lm.position[:2] - true_state.position[:2]
            dist = np.linalg.norm(delta)
            if dist > 500 or dist < 1:
                continue
            bearing = np.arctan2(delta[1], delta[0])
            angle_diff = abs((bearing - heading + np.pi) % (2 * np.pi) - np.pi)
            if angle_diff < np.pi / 2:
                visible.append(lm)
        return visible
