#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request


ACCOUNT_ID = os.environ["CLOUDFLARE_ACCOUNT_ID"]
API_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
PROJECT_NAME = os.environ.get("CLOUDFLARE_PAGES_PROJECT", "riftbound-win")
BASE_URL = "https://api.cloudflare.com/client/v4"


def configured_domains():
    domains = os.environ.get("CLOUDFLARE_PAGES_DOMAINS")
    if not domains:
        domains = os.environ.get("CLOUDFLARE_PAGES_DOMAIN", "riftbound.win")
    return [domain.strip() for domain in domains.split(",") if domain.strip()]


OPTIONAL_DOMAINS = {
    domain.strip()
    for domain in os.environ.get("CLOUDFLARE_OPTIONAL_PAGES_DOMAINS", "").split(",")
    if domain.strip()
}


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


def ensure_domain(domain):
    status, data = request(
        "POST",
        f"/accounts/{ACCOUNT_ID}/pages/projects/{PROJECT_NAME}/domains",
        {"name": domain},
    )

    if data.get("success"):
        print(f"Attached {domain} to {PROJECT_NAME}.")
        return True

    errors = data.get("errors") or []
    messages = " ".join(str(error.get("message", "")) for error in errors).lower()

    if status in {409, 422} or "already" in messages or "exists" in messages or "duplicate" in messages:
        print(f"{domain} is already attached to {PROJECT_NAME}.")
        return True

    payload = {"domain": domain, "status": status, "errors": errors}
    if domain in OPTIONAL_DOMAINS:
        print(json.dumps({"optional_domain_warning": payload}, indent=2), file=sys.stderr)
        return True

    print(json.dumps(payload, indent=2), file=sys.stderr)
    return False


failed = False
for domain in configured_domains():
    failed = not ensure_domain(domain) or failed

sys.exit(1 if failed else 0)
