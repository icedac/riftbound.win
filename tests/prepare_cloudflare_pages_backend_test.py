import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "prepare_cloudflare_pages_backend.py"


def load_module():
    spec = importlib.util.spec_from_file_location("prepare_cloudflare_pages_backend", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PrepareCloudflarePagesBackendTest(unittest.TestCase):
    def test_writes_d1_binding_when_r2_bucket_is_unavailable(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "wrangler.toml"
            config_path.write_text(
                'name = "riftbound-win"\n'
                'pages_build_output_dir = "public"\n'
                'compatibility_date = "2026-06-27"\n',
                encoding="utf-8",
            )
            module.CONFIG_PATH = config_path

            module.write_bindings("d1-uuid", include_r2=False)

            config = config_path.read_text(encoding="utf-8")
            self.assertIn('binding = "DB"', config)
            self.assertIn('database_id = "d1-uuid"', config)
            self.assertNotIn("[[r2_buckets]]", config)


if __name__ == "__main__":
    unittest.main()
