"""Pure, fail-closed guards extracted conceptually from the private GuiaIA mission design.

All protected locations are operator-configured. Never assume a server/world's coordinates.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from math import isfinite


DANGERS = frozenset({"water", "lava", "bubble_column", "fire", "soul_fire", "cactus", "powder_snow"})
COORD_LIMIT = 30_000_000


@dataclass(frozen=True)
class ProtectedRegion:
    x: float
    z: float
    radius: float


@dataclass(frozen=True)
class SafetyConfig:
    regions: tuple[ProtectedRegion, ...] = field(default_factory=tuple)
    max_owner_distance: float = 40.0
    min_health: float = 12.0
    min_air: int = 170
    min_y: float = -64.0
    max_y: float = 319.0


@dataclass(frozen=True)
class Observation:
    bot_pos: tuple[float, float, float]
    owner_pos: tuple[float, float, float]
    health: float
    air: int
    feet_block: str
    head_block: str
    bot_status: str
    owner_online: bool


def evaluate_mining(obs: Observation, config: SafetyConfig, phase: str = "before") -> tuple[bool, str]:
    """Evaluate without changing the world; reject missing, malformed and NaN observations."""
    if phase not in ("before", "during"):
        return False, "Unknown phase"
    if not isinstance(obs.owner_online, bool) or not obs.owner_online:
        return False, "Owner offline or unverified"
    try:
        coords = (*obs.bot_pos, *obs.owner_pos)
        if len(obs.bot_pos) != 3 or len(obs.owner_pos) != 3 or not all(
            isinstance(v, (int, float)) and not isinstance(v, bool) and isfinite(v)
            and abs(v) <= COORD_LIMIT for v in coords
        ):
            return False, "Invalid coordinates"
        x, y, z = obs.bot_pos
        ox, oy, oz = obs.owner_pos
        if not config.min_y <= y <= config.max_y:
            return False, "Unsafe world height"
        if ((x - ox) ** 2 + (z - oz) ** 2) ** 0.5 > config.max_owner_distance:
            return False, "Owner too far away"
        for region in config.regions:
            if not all(isfinite(v) for v in (region.x, region.z, region.radius)) or region.radius < 0:
                return False, "Invalid protected region"
            if ((x - region.x) ** 2 + (z - region.z) ** 2) ** 0.5 < region.radius:
                return False, "Protected building area"
        if not isinstance(obs.health, (int, float)) or not isfinite(obs.health) or obs.health < config.min_health:
            return False, "Low or unknown health"
        if not isinstance(obs.air, int) or obs.air < config.min_air:
            return False, "Low or unknown air"
        if not all(isinstance(v, str) for v in (obs.feet_block, obs.head_block, obs.bot_status)):
            return False, "Invalid observation"
        if any(v.removeprefix("minecraft:") in DANGERS for v in (obs.feet_block, obs.head_block)):
            return False, "Environmental hazard"
        if phase == "before" and "state=IDLE" not in obs.bot_status:
            return False, "Bot busy or status unknown"
    except (TypeError, ValueError, OverflowError):
        return False, "Incomplete observation"
    return True, "Allowed by safety policy (not execution permission)"
