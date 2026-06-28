import importlib.util
import json
import tarfile
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "package_static_site.py"


def load_module():
    spec = importlib.util.spec_from_file_location("package_static_site", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StaticSitePackageTest(unittest.TestCase):
    def test_static_package_writes_archive_and_manifest(self):
        module = load_module()

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            public = root / "public"
            output = root / "dist"
            for path in [
                public / "cards",
                public / "decks",
                public / "community",
                public / "profile",
                public / "images" / "cards",
            ]:
                path.mkdir(parents=True, exist_ok=True)

            (public / "index.html").write_text("<!doctype html>home", encoding="utf-8")
            (public / "cards" / "index.html").write_text("<!doctype html>cards", encoding="utf-8")
            (public / "decks" / "index.html").write_text("<!doctype html>decks", encoding="utf-8")
            (public / "community" / "index.html").write_text("<!doctype html>community", encoding="utf-8")
            (public / "profile" / "index.html").write_text("<!doctype html>profile", encoding="utf-8")
            (public / "_worker.js").write_text("export default {}", encoding="utf-8")
            (public / "cards.json").write_text(json.dumps([{"id": "A-001"}, {"id": "A-002"}]), encoding="utf-8")
            (public / "images" / "cards" / "A-001.webp").write_bytes(b"webp")

            result = module.create_static_package(
                public_dir=public,
                output_dir=output,
                package_name="riftbound-test",
                generated_at="2026-06-28T00:00:00Z",
            )

            self.assertTrue(result.archive_path.exists())
            self.assertTrue(result.manifest_path.exists())
            manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["package_name"], "riftbound-test")
            self.assertEqual(manifest["generated_at"], "2026-06-28T00:00:00Z")
            self.assertEqual(manifest["cards_json_count"], 2)
            self.assertEqual(manifest["card_image_count"], 1)
            self.assertTrue(manifest["worker_present"])
            self.assertEqual(manifest["entrypoints"]["cards/index.html"], "present")
            self.assertTrue(any(item["path"] == "cards.json" and len(item["sha256"]) == 64 for item in manifest["files"]))

            with tarfile.open(result.archive_path, "r:gz") as archive:
                names = set(archive.getnames())
            self.assertIn("manifest.json", names)
            self.assertIn("public/cards.json", names)
            self.assertIn("public/_worker.js", names)
            self.assertIn("public/images/cards/A-001.webp", names)


if __name__ == "__main__":
    unittest.main()
