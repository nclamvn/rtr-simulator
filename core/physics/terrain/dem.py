"""DEM (Digital Elevation Model) terrain loader from GeoTIFF files.

Requires optional dependencies: rasterio, pyproj, scipy.
Install: pip install rasterio pyproj
"""

import logging
from typing import Optional

import numpy as np

from core.physics.terrain.base import TerrainProvider
from core.physics.types import LOSResult

logger = logging.getLogger(__name__)


class DEMTerrain(TerrainProvider):
    """Real terrain from GeoTIFF DEM files.

    Converts between NED coordinates (used by physics engine)
    and UTM/geographic coordinates (used by DEM data).
    """

    def __init__(self, dem_path: str, origin_latlon: tuple[float, float]) -> None:
        """Load DEM from GeoTIFF file.

        Args:
            dem_path: path to GeoTIFF file
            origin_latlon: (latitude, longitude) of simulation origin (drop point B)

        Raises:
            ImportError: if rasterio/pyproj not installed
        """
        try:
            import rasterio  # noqa: F401
            from pyproj import Transformer  # noqa: F401
            from scipy.interpolate import RegularGridInterpolator  # noqa: F401
        except ImportError as e:
            raise ImportError(
                "DEM terrain requires optional dependencies. Install with:\n"
                "  pip install rasterio pyproj scipy\n"
                f"Missing: {e.name}"
            ) from e

        self.dem_path = dem_path
        self.origin_latlon = origin_latlon

        # Load DEM
        with rasterio.open(dem_path) as src:
            self._data = src.read(1).astype(np.float64)
            self._transform = src.transform
            self._crs = src.crs
            self._bounds = src.bounds
            nrows, ncols = self._data.shape

        # Set up coordinate transformer: WGS84 → DEM CRS
        self._transformer = Transformer.from_crs(
            "EPSG:4326", self._crs, always_xy=True
        )

        # Origin in DEM CRS
        origin_x, origin_y = self._transformer.transform(
            origin_latlon[1], origin_latlon[0]  # pyproj: (lon, lat)
        )
        self._origin_x = origin_x
        self._origin_y = origin_y

        # Build interpolator on pixel grid
        rows = np.arange(nrows)
        cols = np.arange(ncols)
        self._interpolator = RegularGridInterpolator(
            (rows, cols), self._data, method="linear", bounds_error=False, fill_value=0.0
        )

    def get_elevation(self, north: float, east: float) -> float:
        """Convert NED → DEM CRS → pixel → interpolate elevation.

        Out-of-bounds returns 0.0 with a warning.
        """
        import rasterio

        # NED to DEM CRS: x = origin_x + east, y = origin_y + north
        dem_x = self._origin_x + east
        dem_y = self._origin_y + north

        # DEM CRS to pixel coordinates
        row, col = rasterio.transform.rowcol(self._transform, dem_x, dem_y)

        # Interpolate
        elev = float(self._interpolator((row, col)))
        if elev == 0.0 and (
            row < 0
            or col < 0
            or row >= self._data.shape[0]
            or col >= self._data.shape[1]
        ):
            logger.warning(
                "DEM query out of bounds: north=%.1f, east=%.1f → row=%d, col=%d",
                north, east, row, col,
            )
        return max(0.0, elev)

    def check_los(
        self,
        from_pos: np.ndarray,
        to_pos: np.ndarray,
        step_size: float = 10.0,
    ) -> LOSResult:
        """Line-of-sight check via ray marching on DEM."""
        diff = to_pos - from_pos
        distance = np.linalg.norm(diff)
        if distance < 1e-6:
            return LOSResult(visible=True, distance=0.0)

        num_steps = max(int(distance / step_size), 2)

        for i in range(1, num_steps):
            t = i / num_steps
            point = from_pos + t * diff
            terrain_elev = self.get_elevation(point[0], point[1])
            ray_altitude = -point[2]  # NED: altitude = -Z

            if terrain_elev > ray_altitude:
                return LOSResult(
                    visible=False,
                    distance=t * distance,
                    occlusion_point=point.copy(),
                )

        return LOSResult(visible=True, distance=distance)

    @classmethod
    def from_srtm(
        cls, lat: float, lon: float, radius_km: float = 20
    ) -> "DEMTerrain":
        """Download SRTM tile covering area — STUB.

        Full implementation deferred. For now, provide DEM files manually.
        Download SRTM tiles from: https://dwtkns.com/srtm30m/
        """
        raise NotImplementedError(
            f"Auto-download not implemented. Manually download SRTM tile for "
            f"({lat:.4f}, {lon:.4f}) with {radius_km}km radius from:\n"
            f"  https://dwtkns.com/srtm30m/\n"
            f"Then use: DEMTerrain('path/to/tile.tif', ({lat}, {lon}))"
        )
