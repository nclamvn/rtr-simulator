"""Procedural terrain generator — simplex-like noise + ridges.

Zero external dependencies beyond numpy.
Used for development, testing, and Monte Carlo simulations.
"""

from __future__ import annotations

import numpy as np

from core.physics.terrain._noise import fbm_2d
from core.physics.terrain.base import TerrainProvider
from core.physics.types import LOSResult, TerrainConfig


class ProceduralTerrain(TerrainProvider):
    """Procedural terrain using hash-based noise + sinusoidal ridges.

    Terrain is deterministic given TerrainConfig.seed.
    """

    def __init__(self, config: TerrainConfig | None = None) -> None:
        self.config = config or TerrainConfig()
        self._c = self.config  # shorthand

    def get_elevation(self, north: float, east: float) -> float:
        """Elevation at (north, east) in meters.

        Components:
        1. Base elevation (constant)
        2. Ridge component (sinusoidal, perpendicular to corridor)
        3. FBM noise (multi-octave for natural detail)
        """
        c = self._c

        # 1. Base
        base = c.base_elevation

        # 2. Ridge component: sin-based ridges along north axis
        #    Modulated by distance from corridor centerline
        east_factor = 1.0 - min(abs(east) / (c.corridor_width / 2.0), 1.0)
        ridge = (
            c.ridge_height
            * 0.5
            * (1.0 + np.sin(2.0 * np.pi * north * c.ridge_frequency / 1000.0))
            * east_factor
        )

        # 3. FBM noise
        nx = north / c.noise_scale
        ny = east / c.noise_scale
        noise_val = fbm_2d(nx, ny, octaves=c.noise_octaves, seed=c.seed)
        noise = c.ridge_height * 0.25 * noise_val  # ±25% of ridge_height

        return max(0.0, base + ridge + noise)

    def check_los(
        self,
        from_pos: np.ndarray,
        to_pos: np.ndarray,
        step_size: float = 10.0,
    ) -> LOSResult:
        """Line-of-sight check via ray marching.

        NED convention: altitude = -position[2].
        Ray is sampled at step_size intervals along the 3D line.
        """
        diff = to_pos - from_pos
        distance = np.linalg.norm(diff)
        if distance < 1e-6:
            return LOSResult(visible=True, distance=0.0)

        num_steps = max(int(distance / step_size), 2)
        direction = diff / distance

        for i in range(1, num_steps):
            t = i / num_steps
            point = from_pos + t * diff

            terrain_elev = self.get_elevation(point[0], point[1])
            # NED: altitude = -Z, so ray height above ground = terrain_elev - (-point[2]) ... wait
            # point[2] is "down" in NED. Altitude = -point[2].
            # Terrain elevation is positive up.
            # LOS blocked if terrain_elev > altitude at that point
            ray_altitude = -point[2]  # altitude in meters (positive up)

            if terrain_elev > ray_altitude:
                return LOSResult(
                    visible=False,
                    distance=t * distance,
                    occlusion_point=point.copy(),
                )

        return LOSResult(visible=True, distance=distance)

    def get_normal(self, north: float, east: float) -> np.ndarray:
        """Surface normal via central finite differences.

        Returns unit vector in NED frame pointing away from surface.
        """
        dx = 1.0  # meter
        dz_dn = (self.get_elevation(north + dx, east) - self.get_elevation(north - dx, east)) / (
            2.0 * dx
        )
        dz_de = (self.get_elevation(north, east + dx) - self.get_elevation(north, east - dx)) / (
            2.0 * dx
        )
        # Normal in NED: [-dz/dn, -dz/de, -1] (points "up" = negative Z in NED)
        normal = np.array([-dz_dn, -dz_de, -1.0])
        return normal / np.linalg.norm(normal)

    def get_roughness(self, north: float, east: float) -> float:
        """Terrain roughness — gradient magnitude, clamped to [0, 1].

        Higher roughness = steeper terrain = more wind turbulence.
        """
        dx = 1.0
        dz_dn = (self.get_elevation(north + dx, east) - self.get_elevation(north - dx, east)) / (
            2.0 * dx
        )
        dz_de = (self.get_elevation(north, east + dx) - self.get_elevation(north, east - dx)) / (
            2.0 * dx
        )
        gradient_mag = np.sqrt(dz_dn**2 + dz_de**2)
        return float(np.clip(gradient_mag, 0.0, 1.0))

    def get_profile(
        self, start: np.ndarray, end: np.ndarray, num_points: int = 100
    ) -> np.ndarray:
        """1D elevation profile along a line.

        Args:
            start: [2] or [3] start position (north, east, ...)
            end: [2] or [3] end position
            num_points: number of sample points

        Returns:
            [num_points × 3] array: [north, east, elevation]
        """
        result = np.zeros((num_points, 3))
        for i in range(num_points):
            t = i / max(num_points - 1, 1)
            n = start[0] + t * (end[0] - start[0])
            e = start[1] + t * (end[1] - start[1])
            result[i] = [n, e, self.get_elevation(n, e)]
        return result
