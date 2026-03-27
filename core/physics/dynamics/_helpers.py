"""Helper functions for dynamics — error state application and differencing."""

import numpy as np

from core.physics.dynamics._quaternion import (
    quat_conjugate,
    quat_exp,
    quat_multiply,
    quat_normalize,
)
from core.physics.types import ErrorState, NominalState


def apply_error_to_nominal(
    nominal: NominalState, error: ErrorState
) -> NominalState:
    """Apply error-state perturbation to nominal state.

    p_true = p + δp
    v_true = v + δv
    q_true = q ⊗ δq(δθ)  where δq = quat_exp(δθ)
    b_a_true = b_a + δb_a
    b_g_true = b_g + δb_g
    w_true = w + δw
    """
    dq = quat_exp(error.delta_theta)
    q_new = quat_normalize(quat_multiply(nominal.quaternion, dq))

    return NominalState(
        position=nominal.position + error.delta_p,
        velocity=nominal.velocity + error.delta_v,
        quaternion=q_new,
        accel_bias=nominal.accel_bias + error.delta_ba,
        gyro_bias=nominal.gyro_bias + error.delta_bg,
        wind=nominal.wind + error.delta_w,
    )


def nominal_difference(s1: NominalState, s2: NominalState) -> np.ndarray:
    """Compute 17D error-state vector between two nominal states.

    δp = s1.p - s2.p
    δv = s1.v - s2.v
    δθ = 2 · (q_s2⁻¹ ⊗ q_s1)[xyz]   (small angle approximation)
    δb_a = s1.b_a - s2.b_a
    δb_g = s1.b_g - s2.b_g
    δw = s1.w - s2.w
    """
    dp = s1.position - s2.position
    dv = s1.velocity - s2.velocity

    # Quaternion difference: δq = q2⁻¹ ⊗ q1
    q2_inv = quat_conjugate(s2.quaternion)
    dq = quat_multiply(q2_inv, s1.quaternion)
    # Ensure scalar part positive for small angle extraction
    if dq[0] < 0:
        dq = -dq
    # Small angle: δθ ≈ 2 · [x, y, z] of δq
    dtheta = 2.0 * dq[1:4]

    dba = s1.accel_bias - s2.accel_bias
    dbg = s1.gyro_bias - s2.gyro_bias
    dw = s1.wind - s2.wind

    return np.concatenate([dp, dv, dtheta, dba, dbg, dw])
