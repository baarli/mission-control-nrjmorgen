import io
import json
import runpy
import sys
import unittest
from datetime import datetime
from http.client import HTTPResponse
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


API_DIR = Path(__file__).resolve().parents[1] / "api"
with patch.object(sys, "path", [str(API_DIR), *sys.path]):
    APIHandler = runpy.run_path(str(API_DIR / "backend-v2.py"))["APIHandler"]


class MemoryConnection:
    def __init__(self, request):
        self.input = io.BytesIO(request)
        self.output = io.BytesIO()

    def makefile(self, *_):
        return self.input

    def sendall(self, data):
        self.output.write(data)


def request(method, path):
    request_bytes = f"{method} {path} HTTP/1.0\r\n\r\n".encode()
    connection = MemoryConnection(request_bytes)
    APIHandler(connection, ("127.0.0.1", 0), None)
    result_socket = SimpleNamespace(makefile=lambda *_: io.BytesIO(connection.output.getvalue()))
    response = HTTPResponse(result_socket)
    response.begin()
    return response.status, response.headers, json.load(response)


class ApiRoutingTest(unittest.TestCase):
    def test_health_returns_json(self):
        status, headers, payload = request("GET", "/api/health")

        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertEqual(payload["status"], "ok")
        datetime.fromisoformat(payload["timestamp"])

    def test_known_get_routes_preserve_their_payloads(self):
        cases = (
            ("/api/status", "get_status", {"sample": "status"}),
            ("/api/logs", "get_logs", [{"sample": "log"}]),
            ("/api/automations", "get_automations", [{"sample": "automation"}]),
            ("/api/nrj-stats", "get_nrj_stats", {"sample": "stats"}),
            ("/api/routine/morning/status", "get_morning_routine_status", {"running": False}),
            ("/api/saker?date=2026-01-01", "get_saker", [{"title": "Sample item"}]),
        )
        for path, handler, payload in cases:
            with self.subTest(path=path), patch.object(APIHandler, handler, return_value=payload) as action:
                status, _, body = request("GET", path)
                self.assertEqual((status, body), (200, payload))
                action.assert_called_once_with()

    def test_unknown_get_and_post_return_json_404(self):
        for method in ("GET", "POST"):
            with self.subTest(method=method):
                status, headers, payload = request(method, "/api/missing")
                self.assertEqual(status, 404)
                self.assertEqual(headers["Content-Type"], "application/json")
                self.assertEqual(payload, {"error": "Not found"})
