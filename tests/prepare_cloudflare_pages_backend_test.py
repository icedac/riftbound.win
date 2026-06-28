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
            self.assertNotIn("[[durable_objects.bindings]]", config)

    def test_writes_playground_durable_object_binding(self):
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

            module.write_bindings("d1-uuid", include_r2=False, include_playground_do=True)

            config = config_path.read_text(encoding="utf-8")
            self.assertIn("[[durable_objects.bindings]]", config)
            self.assertIn('name = "PLAYGROUND_TABLE"', config)
            self.assertIn('script_name = "riftbound-playground-table"', config)
            self.assertIn('class_name = "PlaygroundTable"', config)

    def test_reads_existing_d1_database_id_from_config(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "wrangler.toml"
            config_path.write_text(
                'name = "riftbound-win"\n'
                f"{module.START}\n"
                "[[d1_databases]]\n"
                'binding = "DB"\n'
                'database_name = "riftbound-win"\n'
                'database_id = "existing-db-id"\n'
                f"{module.END}\n",
                encoding="utf-8",
            )
            module.CONFIG_PATH = config_path

            self.assertEqual(module.configured_d1_database_id(), "existing-db-id")

    def test_classifies_r2_subscription_errors(self):
        module = load_module()

        message = "R2 is not enabled for this account. Add R2 subscription to my account."

        self.assertEqual(module.r2_setup_failure_reason(message), "R2 subscription is not enabled for this Cloudflare account.")

    def test_classifies_r2_permission_errors(self):
        module = load_module()

        message = "Authentication error [code: 10000]: missing permission com.cloudflare.api.account.r2.write"

        self.assertEqual(module.r2_setup_failure_reason(message), "Cloudflare API token is missing R2 write permissions.")


if __name__ == "__main__":
    unittest.main()
