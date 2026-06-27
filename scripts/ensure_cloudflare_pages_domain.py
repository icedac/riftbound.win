#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request


ACCOUNT_ID = os.environ["CLOUDFLARE_ACCOUNT_ID"]
API_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
PROJECT_NAME = os.environ.get("CLOUDFLARE_PAGES_PROJECT", "riftbound-win")
DOMAIN = os.environ.get("CLOUDFLARE_PAGES_DOMAIN", "riftbound.win")
BASE_URL = "https://api.cloudflare.com/client/v4"


def request(method, path, payload=None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {API_TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        try:
            data = json.load(error)
        except json.JSONDecodeError:
            data = {"success": False, "errors": [{"message": error.reason}]}
        return error.code, data


status, data = request(
    "POST",
    f"/accounts/{ACCOUNT_ID}/pages/projects/{PROJECT_NAME}/domains",
    {"name": DOMAIN},
)

if data.get("success"):
    print(f"Attached {DOMAIN} to {PROJECT_NAME}.")
    sys.exit(0)

errors = data.get("errors") or []
messages = " ".join(str(error.get("message", "")) for error in errors).lower()
codes = {str(error.get("code")) for error in errors}

if status in {409, 422} or "already" in messages or "exists" in messages or "duplicate" in messages:
    print(f"{DOMAIN} is already attached to {PROJECT_NAME}.")
    sys.exit(0)

print(json.dumps({"status": status, "errors": errors}, indent=2), file=sys.stderr)
sys.exit(1)
