#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path


PROJECT_NAME = os.environ.get("CLOUDFLARE_PAGES_PROJECT", "riftbound-win")
D1_NAME = os.environ.get("RIFTBOUND_D1_NAME", "riftbound-win")
R2_BUCKET = os.environ.get("RIFTBOUND_R2_BUCKET", "riftbound-win-media")
PLAYGROUND_DO_WORKER = os.environ.get("RIFTBOUND_PLAYGROUND_DO_WORKER", "riftbound-playground-table")
PLAYGROUND_DO_CLASS = os.environ.get("RIFTBOUND_PLAYGROUND_DO_CLASS", "PlaygroundTable")
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


def configured_d1_database_id():
    if not CONFIG_PATH.exists():
        return None
    try:
        config = tomllib.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError:
        return None
    for database in config.get("d1_databases", []):
        if database.get("binding") == "DB" and database.get("database_name") == D1_NAME:
            return database.get("database_id")
    return None


def ensure_r2_bucket():
    result = run(f"r2 bucket create {quote(R2_BUCKET)}", allow_failure=True)
    output = f"{result.stdout}\n{result.stderr}"
    normalized = output.lower()
    if result.returncode == 0:
        print(f"Created R2 bucket {R2_BUCKET}.")
        return
    if "already exists" in normalized or "already own" in normalized or "bucket_exists" in normalized:
        print(f"R2 bucket {R2_BUCKET} already exists.")
        return
    print(f"R2 setup reason: {r2_setup_failure_reason(output)}")
    sys.stderr.write(result.stdout)
    sys.stderr.write(result.stderr)
    raise SystemExit(result.returncode)


def r2_setup_failure_reason(output):
    normalized = str(output or "").lower()
    if "subscription" in normalized or "not enabled" in normalized or "r2 is not enabled" in normalized:
        return "R2 subscription is not enabled for this Cloudflare account."
    if "permission" in normalized or "not authorized" in normalized or "authentication error" in normalized:
        return "Cloudflare API token is missing R2 write permissions."
    return "R2 bucket setup failed for an unknown Cloudflare response."


def write_bindings(database_id, *, include_r2=True, include_playground_do=False):
    current = CONFIG_PATH.read_text(encoding="utf-8")
    current = re.sub(
        rf"\n?{re.escape(START)}.*?{re.escape(END)}\n?",
        "\n",
        current,
        flags=re.S,
    ).rstrip()
    r2_block = ""
    if include_r2:
        r2_block = f"""

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "{toml_string(R2_BUCKET)}"
"""
    playground_do_block = ""
    if include_playground_do:
        playground_do_block = f"""

[[durable_objects.bindings]]
name = "PLAYGROUND_TABLE"
script_name = "{toml_string(PLAYGROUND_DO_WORKER)}"
class_name = "{toml_string(PLAYGROUND_DO_CLASS)}"
"""
    block = f"""

{START}
[[d1_databases]]
binding = "DB"
database_name = "{toml_string(D1_NAME)}"
database_id = "{toml_string(database_id)}"
{r2_block.rstrip()}
{playground_do_block.rstrip()}
{END}
"""
    CONFIG_PATH.write_text(f"{current}{block}", encoding="utf-8")
    if include_r2:
        print(f"Wrote DB and MEDIA bindings to {CONFIG_PATH}.")
    else:
        print(f"Wrote DB binding to {CONFIG_PATH}; MEDIA binding is pending R2 setup.")


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
    database_id = None
    try:
        database_id = d1_database_id()
    except SystemExit as error:
        database_id = configured_d1_database_id()
        if database_id:
            print(f"Using committed D1 database binding for {D1_NAME}.")
        elif os.environ.get("RIFTBOUND_BACKEND_REQUIRED") == "1":
            raise
        else:
            print(
                "::warning::Skipping DB/MEDIA binding setup because the Cloudflare token "
                "does not have the required D1 permissions and no committed DB binding exists. "
                "Static Pages deploy will continue."
            )
            if isinstance(error.code, int) and error.code not in (0, None):
                print(f"Backend setup skipped after command exit code {error.code}.")
    if database_id:
        include_r2 = True
        try:
            ensure_r2_bucket()
        except SystemExit as error:
            if os.environ.get("RIFTBOUND_BACKEND_REQUIRED") == "1":
                raise
            include_r2 = False
            print(
                "::warning::Skipping MEDIA binding setup because R2 is unavailable "
                "or the Cloudflare token lacks R2 permissions. DB binding will still be written."
            )
            if isinstance(error.code, int) and error.code not in (0, None):
                print(f"R2 setup skipped after command exit code {error.code}.")
        include_playground_do = os.environ.get("RIFTBOUND_PLAYGROUND_DO_ENABLED") == "1"
        write_bindings(database_id, include_r2=include_r2, include_playground_do=include_playground_do)
    upload_oauth_secrets()


if __name__ == "__main__":
    main()
