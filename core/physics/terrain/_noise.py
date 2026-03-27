"""Hash-based 2D smooth noise — deterministic, zero dependencies beyond numpy.

Used by ProceduralTerrain for terrain generation.
No external libraries (no opensimplex, no noise).
"""

import numpy as np


def _hash(ix: int, iy: int, seed: int) -> float:
    """Hash two ints + seed to a float in [-1, 1].

    Uses large prime mixing — deterministic and fast.
    """
    n = (ix * 73856093 ^ iy * 19349663 ^ seed * 83492791) & 0x7FFFFFFF
    return (n / 0x7FFFFFFF) * 2.0 - 1.0


def _smoothstep(t: float) -> float:
    """Improved smoothstep (Perlin's 6t^5 - 15t^4 + 10t^3)."""
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def noise_2d(x: float, y: float, seed: int = 0) -> float:
    """2D value noise with smooth interpolation. Output in [-1, 1].

    Args:
        x, y: continuous coordinates
        seed: integer seed for reproducibility
    """
    ix = int(np.floor(x))
    iy = int(np.floor(y))
    fx = x - ix
    fy = y - iy

    # Smooth interpolation weights
    sx = _smoothstep(fx)
    sy = _smoothstep(fy)

    # Hash at four corners
    n00 = _hash(ix, iy, seed)
    n10 = _hash(ix + 1, iy, seed)
    n01 = _hash(ix, iy + 1, seed)
    n11 = _hash(ix + 1, iy + 1, seed)

    # Bilinear interpolation with smooth weights
    nx0 = n00 * (1.0 - sx) + n10 * sx
    nx1 = n01 * (1.0 - sx) + n11 * sx

    return nx0 * (1.0 - sy) + nx1 * sy


def fbm_2d(
    x: float,
    y: float,
    octaves: int = 4,
    seed: int = 0,
    lacunarity: float = 2.0,
    persistence: float = 0.5,
) -> float:
    """Fractional Brownian Motion — layered noise for natural terrain.

    Output range approximately [-1, 1] (depends on octaves).

    Args:
        x, y: coordinates
        octaves: number of noise layers (more = finer detail)
        seed: base seed (each octave uses seed + octave_index)
        lacunarity: frequency multiplier per octave
        persistence: amplitude multiplier per octave
    """
    value = 0.0
    amplitude = 1.0
    frequency = 1.0
    max_amplitude = 0.0

    for i in range(octaves):
        value += amplitude * noise_2d(x * frequency, y * frequency, seed + i)
        max_amplitude += amplitude
        amplitude *= persistence
        frequency *= lacunarity

    # Normalize to [-1, 1]
    return value / max_amplitude if max_amplitude > 0 else 0.0
