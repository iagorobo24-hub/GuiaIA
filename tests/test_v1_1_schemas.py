import json
import unittest
from pathlib import Path

SCHEMA_DIR = Path(__file__).resolve().parent.parent / "schemas" / "v1"

class TestV11Schemas(unittest.TestCase):
    def test_all_v1_1_schemas_exist_and_are_valid_json(self):
        expected_schemas = [
            "compound_mission_spec.json",
            "blueprint_spec.json",
            "pokemon_action_spec.json",
            "web_telemetry_event.json"
        ]
        for name in expected_schemas:
            path = SCHEMA_DIR / name
            self.assertTrue(path.exists(), f"Schema {name} does not exist")
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.assertIn("$schema", data)
            self.assertIn("title", data)
            self.assertIn("type", data)
            self.assertEqual(data["type"], "object")

    def test_compound_mission_spec_bounds(self):
        with open(SCHEMA_DIR / "compound_mission_spec.json", "r", encoding="utf-8") as f:
            schema = json.load(f)
        steps_schema = schema["properties"]["steps"]
        self.assertEqual(steps_schema["minItems"], 1)
        self.assertEqual(steps_schema["maxItems"], 10)
        self.assertEqual(schema["properties"]["maxSteps"]["maximum"], 10)

    def test_blueprint_spec_bounds(self):
        with open(SCHEMA_DIR / "blueprint_spec.json", "r", encoding="utf-8") as f:
            schema = json.load(f)
        dim = schema["properties"]["dimensions"]["properties"]
        self.assertEqual(dim["width"]["maximum"], 16)
        self.assertEqual(dim["height"]["maximum"], 16)
        self.assertEqual(dim["length"]["maximum"], 16)
        self.assertEqual(schema["properties"]["maxBlocks"]["maximum"], 64)

    def test_pokemon_action_spec_bounds(self):
        with open(SCHEMA_DIR / "pokemon_action_spec.json", "r", encoding="utf-8") as f:
            schema = json.load(f)
        consumables = schema["properties"]["maxConsumables"]
        self.assertEqual(consumables["maximum"], 5)
        kinds = schema["properties"]["kind"]["enum"]
        self.assertIn("capture", kinds)
        self.assertIn("battle_wild", kinds)
        self.assertIn("pc_query", kinds)

    def test_web_telemetry_event_spec(self):
        with open(SCHEMA_DIR / "web_telemetry_event.json", "r", encoding="utf-8") as f:
            schema = json.load(f)
        req = schema["required"]
        self.assertIn("timestamp", req)
        self.assertIn("botStatus", req)
        self.assertIn("operator", req)
        self.assertIn("witnessStatus", req)

if __name__ == "__main__":
    unittest.main()
