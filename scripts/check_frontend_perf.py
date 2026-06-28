#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen


DEFAULT_CHROME_PATHS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
]


def extract_perf_sample(html, url):
    html_attrs = html_attributes(html)
    title = first_match(r"<title>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
    summary = first_match(r"(\d[\d,]* shown / \d[\d,]* filtered / \d[\d,]* cards)", html)
    return {
        "url": url,
        "title": clean_text(title),
        "fps": int_attr(html_attrs, "data-riftbound-fps"),
        "avg_frame_ms": int_attr(html_attrs, "data-riftbound-avg-frame-ms"),
        "p95_frame_ms": int_attr(html_attrs, "data-riftbound-p95-frame-ms"),
        "frames": int_attr(html_attrs, "data-riftbound-frames"),
        "stall_frames": int_attr(html_attrs, "data-riftbound-stall-frames"),
        "max_frame_ms": int_attr(html_attrs, "data-riftbound-max-frame-ms"),
        "source": html_attrs.get("data-riftbound-perf-source", ""),
        "cards_summary": summary or "",
    }


def sample_from_live_result(result, url):
    sample = extract_perf_sample(result.get("html", ""), url)
    sample["title"] = result.get("title") or sample["title"]
    sample["cards_summary"] = result.get("cards_summary") or sample["cards_summary"]

    perf = result.get("perf") or {}
    if int_value(perf.get("fps")) > 0:
        sample["fps"] = int_value(perf.get("fps"))
        sample["avg_frame_ms"] = int_value(perf.get("avgFrameMs"))
        sample["p95_frame_ms"] = int_value(perf.get("p95FrameMs"))
        sample["frames"] = int_value(perf.get("frames"))
        sample["stall_frames"] = int_value(perf.get("stallFrames"))
        sample["max_frame_ms"] = int_value(perf.get("maxFrameMs"))
        sample["source"] = perf.get("source") or sample["source"]
    return sample


def html_attributes(html):
    match = re.search(r"<html\b([^>]*)>", html, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return {}
    attrs = {}
    for key, quote, value in re.findall(r"([:\w-]+)\s*=\s*(['\"])(.*?)\2", match.group(1), flags=re.DOTALL):
        attrs[key.lower()] = value.strip()
    return attrs


def int_attr(attrs, key):
    value = attrs.get(key)
    if value is None or value == "":
        return 0
    try:
        return int(float(value))
    except ValueError:
        return 0


def int_value(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def first_match(pattern, text, flags=0):
    match = re.search(pattern, text, flags=flags)
    return match.group(1).strip() if match else ""


def clean_text(text):
    return re.sub(r"\s+", " ", text or "").strip()


def read_sample(args):
    if args.dom_file:
        html = Path(args.dom_file).read_text(encoding="utf-8")
        return extract_perf_sample(html, args.url)

    return sample_from_live_result(read_live_result(args), args.url)


def read_live_result(args):
    chrome = args.chrome or find_chrome()
    if not chrome:
        raise RuntimeError("Chrome executable not found. Set CHROME_BIN or pass --chrome.")

    port = free_port()
    with tempfile.TemporaryDirectory(prefix="riftbound-perf-chrome-") as profile:
        command = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-extensions",
            "--no-first-run",
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            f"--window-size={args.window_size}",
            args.url,
        ]
        proc = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            page_ws = wait_for_page_websocket(port, args.url, args.budget_ms / 1000)
            sock = websocket_connect(page_ws)
            try:
                return wait_for_live_perf(sock, args.budget_ms / 1000)
            finally:
                sock.close()
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


def wait_for_live_perf(sock, timeout):
    deadline = time.time() + timeout
    last_result = {}
    while time.time() < deadline:
        last_result = cdp_evaluate(sock, LIVE_SAMPLE_EXPRESSION)
        if int_value((last_result.get("perf") or {}).get("fps")) > 0:
            return last_result
        time.sleep(0.25)
    return last_result


LIVE_SAMPLE_EXPRESSION = """
(() => ({
  html: document.documentElement.outerHTML,
  title: document.title,
  cards_summary: document.querySelector("#summary")?.textContent?.trim() || "",
  perf: window.RiftboundPerf || null
}))()
"""


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for_page_websocket(port, expected_url, timeout):
    deadline = time.time() + timeout
    endpoint = f"http://127.0.0.1:{port}/json/list"
    last_error = ""
    while time.time() < deadline:
        try:
            with urlopen(endpoint, timeout=1) as response:
                pages = json.loads(response.read().decode("utf-8"))
            for page in pages:
                if page.get("type") == "page" and page.get("webSocketDebuggerUrl"):
                    if page.get("url") == expected_url or page.get("url", "").startswith("http"):
                        return page["webSocketDebuggerUrl"]
        except Exception as error:
            last_error = str(error)
        time.sleep(0.2)
    raise RuntimeError(f"Could not connect to Chrome page target: {last_error}")


def websocket_connect(ws_url):
    parsed = urlparse(ws_url)
    sock = socket.create_connection((parsed.hostname, parsed.port), timeout=5)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = (
        f"GET {websocket_request_target(ws_url)} HTTP/1.1\r\n"
        f"Host: {parsed.hostname}:{parsed.port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(request.encode("ascii"))
    response = recv_until(sock, b"\r\n\r\n").decode("iso-8859-1")
    accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()).decode("ascii")
    if " 101 " not in response or accept not in response:
        raise RuntimeError("Chrome websocket handshake failed")
    return sock


def websocket_request_target(ws_url):
    parsed = urlparse(ws_url)
    return parsed.path + (f"?{parsed.query}" if parsed.query else "")


def recv_until(sock, marker):
    data = b""
    while marker not in data:
        chunk = sock.recv(4096)
        if not chunk:
            break
        data += chunk
    return data


def cdp_evaluate(sock, expression):
    cdp_evaluate.counter += 1
    message_id = cdp_evaluate.counter
    websocket_send_text(
        sock,
        json.dumps(
            {
                "id": message_id,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": expression,
                    "returnByValue": True,
                    "awaitPromise": True,
                },
            }
        ),
    )
    while True:
        message = json.loads(websocket_recv_text(sock))
        if message.get("id") != message_id:
            continue
        if message.get("exceptionDetails"):
            raise RuntimeError(json.dumps(message["exceptionDetails"]))
        return message.get("result", {}).get("result", {}).get("value") or {}


cdp_evaluate.counter = 0


def websocket_send_text(sock, text):
    payload = text.encode("utf-8")
    mask = os.urandom(4)
    header = bytearray([0x81])
    if len(payload) < 126:
        header.append(0x80 | len(payload))
    elif len(payload) < 65536:
        header.extend([0x80 | 126, (len(payload) >> 8) & 0xFF, len(payload) & 0xFF])
    else:
        header.append(0x80 | 127)
        header.extend(len(payload).to_bytes(8, "big"))
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    sock.sendall(bytes(header) + mask + masked)


def websocket_recv_text(sock):
    while True:
        first, second = recv_exact(sock, 2)
        opcode = first & 0x0F
        masked = second & 0x80
        length = second & 0x7F
        if length == 126:
            length = int.from_bytes(recv_exact(sock, 2), "big")
        elif length == 127:
            length = int.from_bytes(recv_exact(sock, 8), "big")
        mask = recv_exact(sock, 4) if masked else b""
        payload = recv_exact(sock, length)
        if mask:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        if opcode == 1:
            return payload.decode("utf-8")
        if opcode == 8:
            raise RuntimeError("Chrome websocket closed")


def recv_exact(sock, count):
    chunks = []
    remaining = count
    while remaining:
        chunk = sock.recv(remaining)
        if not chunk:
            raise RuntimeError("Unexpected websocket EOF")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def find_chrome():
    env_path = os.environ.get("CHROME_BIN")
    if env_path:
        return env_path
    for path in DEFAULT_CHROME_PATHS:
        if Path(path).exists():
            return path
    for name in ["google-chrome", "chromium", "chromium-browser"]:
        found = shutil.which(name)
        if found:
            return found
    return ""


def apply_threshold(sample, min_fps):
    status = []
    if sample["fps"] <= 0:
        status.append("missing_perf_sample")
    elif sample["fps"] < min_fps:
        status.append("below_min_fps")
    else:
        status.append("ok")
    sample["min_fps"] = min_fps
    sample["status"] = status
    return sample


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Measure Riftbound frontend FPS from rendered DOM.")
    parser.add_argument("url", help="Page URL to render, for example https://riftbound.win/cards/")
    parser.add_argument("--chrome", help="Chrome or Chromium executable path")
    parser.add_argument("--dom-file", help="Read an already dumped DOM file instead of launching Chrome")
    parser.add_argument("--budget-ms", type=int, default=8000, help="Maximum time to wait for a live FPS sample")
    parser.add_argument("--min-fps", type=int, default=45, help="Minimum acceptable sampled FPS")
    parser.add_argument("--window-size", default="1600,1100", help="Chrome window size as WIDTH,HEIGHT")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv or sys.argv[1:])
    try:
        sample = apply_threshold(read_sample(args), args.min_fps)
    except Exception as error:
        sample = {"url": args.url, "status": ["error"], "error": str(error)}
        print(json.dumps(sample, ensure_ascii=False, indent=2))
        return 1

    print(json.dumps(sample, ensure_ascii=False, indent=2))
    if "missing_perf_sample" in sample["status"]:
        return 3
    if "below_min_fps" in sample["status"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
