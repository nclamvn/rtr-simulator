"""Quaternion utilities — Hamilton convention [w, x, y, z] scalar-first.

Compatible with scipy.spatial.transform.Rotation:
    R = Rotation.from_quat([x, y, z, w])  # scipy uses scalar-last

All functions here use [w, x, y, z] (our convention).
"""

import numpy as np


def quat_multiply(q1: np.ndarray, q2: np.ndarray) -> np.ndarray:
    """Hamilton quaternion multiplication q1 ⊗ q2.

    Convention: [w, x, y, z]
    """
    w1, x1, y1, z1 = q1
    w2, x2, y2, z2 = q2
    return np.array([
        w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
        w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
        w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
        w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    ])


def quat_conjugate(q: np.ndarray) -> np.ndarray:
    """Quaternion conjugate (= inverse for unit quaternion)."""
    return np.array([q[0], -q[1], -q[2], -q[3]])


def quat_normalize(q: np.ndarray) -> np.ndarray:
    """Normalize to unit quaternion."""
    n = np.linalg.norm(q)
    if n < 1e-15:
        return np.array([1.0, 0.0, 0.0, 0.0])
    return q / n


def quat_to_rotation(q: np.ndarray) -> np.ndarray:
    """Quaternion [w,x,y,z] → 3×3 rotation matrix (body → NED).

    R rotates vectors from body frame to NED frame.
    """
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def rotation_to_quat(R: np.ndarray) -> np.ndarray:
    """3×3 rotation matrix → quaternion [w, x, y, z].

    Uses Shepperd's method for numerical stability.
    """
    trace = R[0, 0] + R[1, 1] + R[2, 2]

    if trace > 0:
        s = 0.5 / np.sqrt(trace + 1.0)
        w = 0.25 / s
        x = (R[2, 1] - R[1, 2]) * s
        y = (R[0, 2] - R[2, 0]) * s
        z = (R[1, 0] - R[0, 1]) * s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = 2.0 * np.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2])
        w = (R[2, 1] - R[1, 2]) / s
        x = 0.25 * s
        y = (R[0, 1] + R[1, 0]) / s
        z = (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = 2.0 * np.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2])
        w = (R[0, 2] - R[2, 0]) / s
        x = (R[0, 1] + R[1, 0]) / s
        y = 0.25 * s
        z = (R[1, 2] + R[2, 1]) / s
    else:
        s = 2.0 * np.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1])
        w = (R[1, 0] - R[0, 1]) / s
        x = (R[0, 2] + R[2, 0]) / s
        y = (R[1, 2] + R[2, 1]) / s
        z = 0.25 * s

    q = np.array([w, x, y, z])
    # Ensure w > 0 for consistency
    if q[0] < 0:
        q = -q
    return quat_normalize(q)


def quat_exp(omega_dt: np.ndarray) -> np.ndarray:
    """Quaternion exponential: rotation vector → delta quaternion.

    Exact formula:
        θ = ||omega_dt||
        δq = [cos(θ/2), sin(θ/2) · omega_dt/θ]

    For small angles (θ < 1e-8), uses first-order:
        δq ≈ [1, ½·omega_dt]
    """
    theta = np.linalg.norm(omega_dt)
    if theta < 1e-8:
        # First-order approximation
        return quat_normalize(np.array([1.0, 0.5 * omega_dt[0],
                                        0.5 * omega_dt[1], 0.5 * omega_dt[2]]))
    half_theta = theta / 2.0
    axis = omega_dt / theta
    return np.array([
        np.cos(half_theta),
        np.sin(half_theta) * axis[0],
        np.sin(half_theta) * axis[1],
        np.sin(half_theta) * axis[2],
    ])


def quat_integrate(q: np.ndarray, omega: np.ndarray, dt: float) -> np.ndarray:
    """Integrate quaternion: q_new = q ⊗ quat_exp(ω·dt).

    Args:
        q: current quaternion [w,x,y,z]
        omega: angular velocity in body frame [rad/s]
        dt: time step [s]

    Returns normalized quaternion.
    """
    dq = quat_exp(omega * dt)
    return quat_normalize(quat_multiply(q, dq))


def skew(v: np.ndarray) -> np.ndarray:
    """3-vector → 3×3 skew-symmetric matrix [v]×.

    [v]× · u = v × u  (cross product)
    """
    return np.array([
        [0, -v[2], v[1]],
        [v[2], 0, -v[0]],
        [-v[1], v[0], 0],
    ])
