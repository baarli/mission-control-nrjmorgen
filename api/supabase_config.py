import os


def supabase_headers():
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise RuntimeError("Configure SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY on the server")

    headers = {"apikey": key}
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {key}"
    return headers
