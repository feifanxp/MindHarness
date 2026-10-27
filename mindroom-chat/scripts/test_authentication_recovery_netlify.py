"""Check the Netlify routing and header rules, including /connect framing."""

import fnmatch
from pathlib import Path
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[1]


def load_config():
    return tomllib.loads((ROOT / "netlify.toml").read_text())


def headers_for(config, path):
    headers = {}
    for rule in config.get("headers", []):
        if fnmatch.fnmatchcase(path, rule["for"]):
            headers.update(rule["values"])
    return headers


class AuthenticationRecoveryNetlifyTests(unittest.TestCase):
    def test_bootstrap_assets_win_before_the_spa_fallback(self):
        config = load_config()
        for path in (
            "/authentication-recovery.js",
            "/runtime-config.js",
            "/.well-known/apple-app-site-association",
        ):
            with self.subTest(path=path):
                # Netlify applies the first matching redirect, including forced rewrites.
                rule = next(
                    rule
                    for rule in config["redirects"]
                    if fnmatch.fnmatchcase(path, rule["from"])
                )
                self.assertEqual(rule["to"], path)
                self.assertEqual(rule["status"], 200)
                self.assertTrue((ROOT / "dist" / path.removeprefix("/")).is_file())

    def test_bootstrap_assets_are_not_stored_in_caches(self):
        config = load_config()
        for path in ("/authentication-recovery.js", "/runtime-config.js"):
            with self.subTest(path=path):
                cache_control = headers_for(config, path).get("Cache-Control", "")
                self.assertIn("no-store", cache_control.split(", "))

    def test_connect_page_cannot_be_framed(self):
        config = load_config()
        for path in ("/connect", "/connect/"):
            with self.subTest(path=path):
                headers = headers_for(config, path)
                self.assertEqual(
                    headers.get("Content-Security-Policy"), "frame-ancestors 'none'"
                )
                self.assertEqual(headers.get("X-Frame-Options"), "DENY")

    def test_association_file_is_json(self):
        headers = headers_for(load_config(), "/.well-known/apple-app-site-association")
        self.assertEqual(headers.get("Content-Type"), "application/json")


if __name__ == "__main__":
    unittest.main()
