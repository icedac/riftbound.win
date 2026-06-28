import importlib.util
import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "check_frontend_perf.py"


def load_module():
    if not SCRIPT.exists():
      raise AssertionError(f"missing script: {SCRIPT}")
    spec = importlib.util.spec_from_file_location("check_frontend_perf", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CheckFrontendPerfTest(unittest.TestCase):
    def test_extracts_perf_sample_from_rendered_dom(self):
        module = load_module()
        html = textwrap.dedent(
            """
            <!doctype html>
            <html data-riftbound-fps="58" data-riftbound-avg-frame-ms="17"
              data-riftbound-p95-frame-ms="24" data-riftbound-perf-source="requestAnimationFrame">
              <head><title>Riftbound.kr Cards</title></head>
              <body>
                <p id="summary">96 shown / 1,139 filtered / 1,147 cards</p>
              </body>
            </html>
            """
        )

        sample = module.extract_perf_sample(html, "https://riftbound.win/cards/")

        self.assertEqual(sample["url"], "https://riftbound.win/cards/")
        self.assertEqual(sample["title"], "Riftbound.kr Cards")
        self.assertEqual(sample["fps"], 58)
        self.assertEqual(sample["avg_frame_ms"], 17)
        self.assertEqual(sample["p95_frame_ms"], 24)
        self.assertEqual(sample["source"], "requestAnimationFrame")
        self.assertEqual(sample["cards_summary"], "96 shown / 1,139 filtered / 1,147 cards")

    def test_cli_fails_when_sample_is_under_minimum_fps(self):
        html = '<html data-riftbound-fps="22" data-riftbound-avg-frame-ms="45" data-riftbound-p95-frame-ms="80"></html>'
        with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as handle:
            handle.write(html)
            dom_path = handle.name

        try:
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "https://riftbound.win/cards/",
                    "--dom-file",
                    dom_path,
                    "--min-fps",
                    "45",
                ],
                text=True,
                capture_output=True,
                check=False,
            )
        finally:
            Path(dom_path).unlink(missing_ok=True)

        self.assertTrue(SCRIPT.exists(), f"missing script: {SCRIPT}")
        self.assertEqual(result.returncode, 2)
        self.assertTrue(result.stdout.strip(), result.stderr)
        body = json.loads(result.stdout)
        self.assertEqual(body["fps"], 22)
        self.assertIn("below_min_fps", body["status"])

    def test_uses_live_window_perf_sample_when_available(self):
        module = load_module()
        live_result = {
            "html": '<html data-riftbound-fps="0"></html>',
            "title": "Riftbound.kr Cards",
            "cards_summary": "96 shown / 1,139 filtered / 1,147 cards",
            "perf": {
                "fps": 57,
                "avgFrameMs": 18,
                "p95FrameMs": 25,
                "frames": 120,
                "stallFrames": 1,
                "maxFrameMs": 950,
                "source": "requestAnimationFrame",
            },
        }

        sample = module.sample_from_live_result(live_result, "https://riftbound.win/cards/")

        self.assertEqual(sample["fps"], 57)
        self.assertEqual(sample["avg_frame_ms"], 18)
        self.assertEqual(sample["p95_frame_ms"], 25)
        self.assertEqual(sample["frames"], 120)
        self.assertEqual(sample["stall_frames"], 1)
        self.assertEqual(sample["max_frame_ms"], 950)
        self.assertEqual(sample["source"], "requestAnimationFrame")
        self.assertEqual(sample["cards_summary"], "96 shown / 1,139 filtered / 1,147 cards")

    def test_websocket_request_target_omits_empty_query_marker(self):
        module = load_module()

        self.assertEqual(
            module.websocket_request_target("ws://127.0.0.1:9222/devtools/page/abc"),
            "/devtools/page/abc",
        )
        self.assertEqual(
            module.websocket_request_target("ws://127.0.0.1:9222/devtools/page/abc?token=1"),
            "/devtools/page/abc?token=1",
        )


if __name__ == "__main__":
    unittest.main()
