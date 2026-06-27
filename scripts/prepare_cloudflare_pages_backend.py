#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


PROJECT_NAME = os.environ.get("CLOUDFLARE_PAGES_PROJECT", "riftbound-win")
D1_NAME = os.environ.get("RIFTBOUND_D1_NAME", "riftbound-win")
R2_BUCKET = os.environ.get("RIFTBOUND_R2_BUCKET", "riftbound-win-media")
WRANGLER = os.environ.get("WRANGLER_CMD", "npx --yes wrangler@4.105.0")
CONFIG_PATH = Path(os.environ.get("WRANGLER_CONFIG", "wrangler.toml"))
START = "# BEGIN generated Riftbound backend bindings"
END = "# END generated Riftbound backend bindings"


def run(command, *, allow_failure=False):
    full = f"{WRANGLER} {command}"
    result = subprocess.run(full, shell=True, text=True, capture_output=True)
    if result.returncode != 0 and not allow_failure:
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode)
    return result


def d1_database_id():
    database_id = find_d1_database()
    if database_id:
        print(f"D1 database {D1_NAME} already exists.")
        return database_id

    print(f"Creating D1 database {D1_NAME}.")
    run(f"d1 create {quote(D1_NAME)}")
    database_id = find_d1_database()
    if not database_id:
        raise SystemExit(f"Could not find D1 database id for {D1_NAME} after create.")
    return database_id


def find_d1_database():
    result = run("d1 list --json")
    databases = json.loads(result.stdout or "[]")
    for database in databases:
        if database.get("name") == D1_NAME:
            return database.get("uuid") or database.get("id")
    return None


def ensure_r2_bucket():
    result = run(f"r2 bucket create {quote(R2_BUCKET)}", allow_failure=True)
    output = f"{result.stdout}\n{result.stderr}".lower()
    if result.returncode == 0:
        print(f"Created R2 bucket {R2_BUCKET}.")
        return
    if "already exists" in output or "already own" in output or "bucket_exists" in output:
        print(f"R2 bucket {R2_BUCKET} already exists.")
        return
    sys.stderr.write(result.stdout)
    sys.stderr.write(result.stderr)
    raise SystemExit(result.returncode)


def write_bindings(database_id):
    current = CONFIG_PATH.read_text(encoding="utf-8")
    current = re.sub(
        rf"\n?{re.escape(START)}.*?{re.escape(END)}\n?",
        "\n",
        current,
        flags=re.S,
    ).rstrip()
    block = f"""

{START}
[[d1_databases]]
binding = "DB"
database_name = "{toml_string(D1_NAME)}"
database_id = "{toml_string(database_id)}"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "{toml_string(R2_BUCKET)}"
{END}
"""
    CONFIG_PATH.write_text(f"{current}{block}", encoding="utf-8")
    print(f"Wrote DB and MEDIA bindings to {CONFIG_PATH}.")


def upload_oauth_secrets():
    secrets = {
        key: os.environ.get(key, "")
        for key in [
            "GOOGLE_CLIENT_ID",
            "GOOGLE_CLIENT_SECRET",
            "NAVER_CLIENT_ID",
            "NAVER_CLIENT_SECRET",
        ]
    }
    secrets = {key: value for key, value in secrets.items() if value}
    if not secrets:
        print("No OAuth secrets provided; skipping Pages secret upload.")
        return

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as handle:
        json.dump(secrets, handle)
        path = handle.name
    try:
        run(f"pages secret bulk {quote(path)} --project-name {quote(PROJECT_NAME)}")
        print(f"Uploaded {len(secrets)} OAuth secret(s) to Pages project {PROJECT_NAME}.")
    finally:
        Path(path).unlink(missing_ok=True)


def quote(value):
    return "'" + str(value).replace("'", "'\"'\"'") + "'"


def toml_string(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def main():
    database_id = d1_database_id()
    ensure_r2_bucket()
    write_bindings(database_id)
    upload_oauth_secrets()


if __name__ == "__main__":
    main()
