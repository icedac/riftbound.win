#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


ACCOUNT_ID = os.environ["CLOUDFLARE_ACCOUNT_ID"]
API_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
BASE_URL = "https://api.cloudflare.com/client/v4"
TARGET = os.environ.get("CLOUDFLARE_PAGES_DNS_TARGET", "riftbound-win.pages.dev")
DOMAINS = [
    domain.strip()
    for domain in os.environ.get("CLOUDFLARE_PAGES_DNS_DOMAINS", "riftbound.kr").split(",")
    if domain.strip()
]


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


def zone_for(domain):
    labels = domain.split(".")
    candidates = [".".join(labels[index:]) for index in range(max(0, len(labels) - 2), len(labels) - 1)]
    candidates.insert(0, domain)
    seen = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        status, data = request("GET", f"/zones?name={urllib.parse.quote(candidate)}&account.id={ACCOUNT_ID}")
        if not data.get("success"):
            warn(f"Could not read zone {candidate}: status={status} errors={data.get('errors')}")
            continue
        results = data.get("result") or []
        if results:
            return results[0]
    return None


def records(zone_id, name):
    status, data = request("GET", f"/zones/{zone_id}/dns_records?name={urllib.parse.quote(name)}")
    if not data.get("success"):
        warn(f"Could not list DNS records for {name}: status={status} errors={data.get('errors')}")
        return None
    return data.get("result") or []


def ensure_domain(domain):
    zone = zone_for(domain)
    if not zone:
        warn(f"No Cloudflare zone found for {domain}; leaving DNS unchanged.")
        return

    zone_id = zone["id"]
    current = records(zone_id, domain)
    if current is None:
        return

    desired = next((record for record in current if record["type"] == "CNAME" and record.get("content") == TARGET), None)
    for record in current:
        if record["type"] in {"A", "AAAA", "CNAME"} and record.get("id") != desired:
            status, data = request("DELETE", f"/zones/{zone_id}/dns_records/{record['id']}")
            if data.get("success"):
                print(f"Deleted {record['type']} {domain} -> {record.get('content')}")
            else:
                warn(f"Could not delete {record['type']} {domain}: status={status} errors={data.get('errors')}")

    if desired:
        print(f"{domain} already points to {TARGET}.")
        return

    status, data = request(
        "POST",
        f"/zones/{zone_id}/dns_records",
        {
            "type": "CNAME",
            "name": domain,
            "content": TARGET,
            "ttl": 1,
            "proxied": True,
        },
    )
    if data.get("success"):
        print(f"Created CNAME {domain} -> {TARGET}.")
    else:
        warn(f"Could not create CNAME {domain}: status={status} errors={data.get('errors')}")


def warn(message):
    print(f"::warning::{message}")


for domain in DOMAINS:
    ensure_domain(domain)
