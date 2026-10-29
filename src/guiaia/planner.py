"""Deterministic, bounded intent proposal. No actions are executed here."""
from __future__ import annotations
import re
import unicodedata

MATERIALS = {
    "troncos de roble": ("minecraft:oak_log", "minecraft:oak_log"),
    "troncos de jungla": ("minecraft:jungle_log", "minecraft:jungle_log"),
    "carbon": ("minecraft:coal_ore", "minecraft:coal"),
    "mineral de hierro": ("minecraft:iron_ore", "minecraft:raw_iron"),
    "piedra": ("minecraft:stone", "minecraft:cobblestone"),
    "adoquin": ("minecraft:stone", "minecraft:cobblestone"),
}


def propose_gather(message: str) -> dict:
    """Only returns a plan; never talks to RCON, Minecraft, shell or a model."""
    if not isinstance(message, str) or len(message) > 180:
        raise ValueError("Message must be a short string")
    normalized = "".join(
        ch for ch in unicodedata.normalize("NFD", message.casefold().strip())
        if unicodedata.category(ch) != "Mn"
    )
    normalized = re.sub(r"^guia\s*ia[, :] *", "", normalized)
    m = re.fullmatch(
        r"(?:recoge|consigue|recolecta|mina|trae) ([0-9]{1,2}) "
        r"(troncos de roble|troncos de jungla|carbon|mineral de hierro|piedra|adoquin)",
        normalized,
    )
    if m is None:
        raise ValueError("Unknown or unsupported goal; no action proposed")
    count = int(m.group(1))
    if not 1 <= count <= 32:
        raise ValueError("Quantity must be 1..32")
    block, item = MATERIALS[m.group(2)]
    return {
        "goal": "gather",
        "block": block,
        "expected_drop": item,
        "quantity": count,
        "mode": "proposal_only",
        "requires_owner": True,
        "requires_independent_safety_check": True,
        "executed": False,
    }
