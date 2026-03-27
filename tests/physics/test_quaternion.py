"""Tests for quaternion utilities."""

import numpy as np
import pytest

from core.physics.dynamics._quaternion import (
    quat_conjugate,
    quat_exp,
    quat_integrate,
    quat_multiply,
    quat_normalize,
    quat_to_rotation,
    rotation_to_quat,
    skew,
)


class TestQuatMultiply:
    def test_identity(self) -> None:
        """q ⊗ identity = q."""
        q = np.array([0.5, 0.5, 0.5, 0.5])
        identity = np.array([1.0, 0.0, 0.0, 0.0])
        result = quat_multiply(q, identity)
        np.testing.assert_allclose(result, q, atol=1e-12)

    def test_inverse(self) -> None:
        """q ⊗ q* = identity."""
        q = quat_normalize(np.array([1.0, 2.0, 3.0, 4.0]))
        q_inv = quat_conjugate(q)
        result = quat_multiply(q, q_inv)
        np.testing.assert_allclose(result, [1, 0, 0, 0], atol=1e-12)

    def test_non_commutative(self) -> None:
        """q1 ⊗ q2 ≠ q2 ⊗ q1 in general."""
        q1 = quat_normalize(np.array([1, 1, 0, 0]))
        q2 = quat_normalize(np.array([1, 0, 1, 0]))
        r12 = quat_multiply(q1, q2)
        r21 = quat_multiply(q2, q1)
        assert not np.allclose(r12, r21)


class TestQuatRotation:
    def test_identity_rotation(self) -> None:
        """Identity quaternion → identity matrix."""
        R = quat_to_rotation(np.array([1, 0, 0, 0.0]))
        np.testing.assert_allclose(R, np.eye(3), atol=1e-12)

    def test_90deg_z_rotation(self) -> None:
        """90° rotation about Z axis."""
        angle = np.pi / 2
        q = np.array([np.cos(angle / 2), 0, 0, np.sin(angle / 2)])
        R = quat_to_rotation(q)
        # [1,0,0] → [0,1,0] (in body→NED convention)
        v = R @ np.array([1, 0, 0])
        np.testing.assert_allclose(v, [0, 1, 0], atol=1e-12)

    def test_roundtrip(self) -> None:
        """quat → rotation → quat roundtrip."""
        q_orig = quat_normalize(np.array([1, 0.3, -0.2, 0.5]))
        R = quat_to_rotation(q_orig)
        q_back = rotation_to_quat(R)
        # May differ by sign (q and -q represent same rotation)
        assert np.allclose(q_orig, q_back, atol=1e-10) or np.allclose(
            q_orig, -q_back, atol=1e-10
        )

    def test_rotation_matrix_orthogonal(self) -> None:
        """R · Rᵀ = I, det(R) = 1."""
        q = quat_normalize(np.array([0.7, 0.3, -0.5, 0.1]))
        R = quat_to_rotation(q)
        np.testing.assert_allclose(R @ R.T, np.eye(3), atol=1e-12)
        assert np.linalg.det(R) == pytest.approx(1.0, abs=1e-12)


class TestQuatExp:
    def test_zero_rotation(self) -> None:
        """Zero rotation vector → identity quaternion."""
        dq = quat_exp(np.zeros(3))
        np.testing.assert_allclose(dq, [1, 0, 0, 0], atol=1e-12)

    def test_small_angle(self) -> None:
        """Small angle: δq ≈ [1, ½δθ]."""
        dtheta = np.array([0.001, 0.002, -0.001])
        dq = quat_exp(dtheta)
        assert dq[0] == pytest.approx(1.0, abs=1e-4)
        np.testing.assert_allclose(dq[1:4], 0.5 * dtheta, atol=1e-5)

    def test_180_degree_rotation(self) -> None:
        """π rotation about X axis."""
        dq = quat_exp(np.array([np.pi, 0, 0]))
        # Should be [0, 1, 0, 0] (cos(π/2) = 0, sin(π/2) = 1)
        np.testing.assert_allclose(abs(dq), [0, 1, 0, 0], atol=1e-12)

    def test_unit_quaternion(self) -> None:
        """Result should always be unit quaternion."""
        for _ in range(10):
            omega = np.random.randn(3) * 2
            dq = quat_exp(omega)
            assert np.linalg.norm(dq) == pytest.approx(1.0, abs=1e-12)


class TestQuatIntegrate:
    def test_no_rotation(self) -> None:
        """Zero angular velocity → quaternion unchanged."""
        q = np.array([1.0, 0, 0, 0])
        q_new = quat_integrate(q, np.zeros(3), 0.01)
        np.testing.assert_allclose(q_new, q, atol=1e-12)

    def test_preserves_unit(self) -> None:
        """After integration, quaternion should remain unit."""
        q = quat_normalize(np.array([1, 0.1, -0.2, 0.05]))
        omega = np.array([0.5, -0.3, 0.1])
        for _ in range(1000):
            q = quat_integrate(q, omega, 0.01)
        assert np.linalg.norm(q) == pytest.approx(1.0, abs=1e-10)


class TestSkew:
    def test_skew_shape(self) -> None:
        S = skew(np.array([1, 2, 3.0]))
        assert S.shape == (3, 3)

    def test_skew_antisymmetric(self) -> None:
        v = np.array([1.0, 2.0, 3.0])
        S = skew(v)
        np.testing.assert_allclose(S, -S.T, atol=1e-15)

    def test_skew_cross_product(self) -> None:
        """[v]× · u = v × u."""
        v = np.array([1.0, 2.0, 3.0])
        u = np.array([4.0, 5.0, 6.0])
        np.testing.assert_allclose(skew(v) @ u, np.cross(v, u), atol=1e-12)
