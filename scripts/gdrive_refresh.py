#!/usr/bin/env python3
"""Refresh the dashboard's data directly from Google Drive — on this machine.

This is the privacy-preserving refresh: it authenticates to Google with the
owner's own credentials and pulls the Tracker sheet and the weekly statement
workbooks straight to local JSON. No client data passes through any third party
— it flows only between this computer and the owner's Google account.

    python3 scripts/gdrive_refresh.py            # refresh both data files
    python3 scripts/gdrive_refresh.py --config path/to/config.json

Setup (one-time) is in SETUP-WINDOWS.md: a Google Cloud OAuth "Desktop" client
whose credentials.json sits next to this repo; a token.json is cached after the
first browser consent.

The Google client is injected (see refresh_all's `drive` arg) so the pipeline
can be tested with local files and without the Google libraries installed.
"""
import io
import json
import os
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import extract_tracker
import merge_statements
import statement_parser

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
SHEET_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
FOLDER_MIME = "application/vnd.google-apps.folder"
STATEMENT_EXTS = (".xlsx", ".xlsm")


# ---------------------------------------------------------------------------
# Google Drive access (real). Imports the Google libraries lazily so this
# module can be imported and unit-tested without them.
# ---------------------------------------------------------------------------

class GoogleDrive:
    def __init__(self, credentials_path, token_path):
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build

        creds = None
        if os.path.exists(token_path):
            creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                if not os.path.exists(credentials_path):
                    raise FileNotFoundError(
                        "Missing %s — see SETUP-WINDOWS.md to create your Google "
                        "OAuth credentials." % credentials_path)
                flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
                creds = flow.run_local_server(port=0)
            with open(token_path, "w") as fh:
                fh.write(creds.to_json())
        self._service = build("drive", "v3", credentials=creds, cache_discovery=False)

    def list_folder(self, folder_id):
        out, page = [], None
        while True:
            resp = self._service.files().list(
                q="'%s' in parents and trashed = false" % folder_id,
                fields="nextPageToken, files(id, name, mimeType, modifiedTime)",
                pageSize=200, pageToken=page,
                supportsAllDrives=True, includeItemsFromAllDrives=True,
            ).execute()
            out.extend(resp.get("files", []))
            page = resp.get("nextPageToken")
            if not page:
                return out

    def export_sheet(self, file_id):
        return self._service.files().export(
            fileId=file_id, mimeType=SHEET_XLSX).execute()

    def download_file(self, file_id):
        from googleapiclient.http import MediaIoBaseDownload
        buf = io.BytesIO()
        req = self._service.files().get_media(fileId=file_id, supportsAllDrives=True)
        downloader = MediaIoBaseDownload(buf, req)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buf.getvalue()


# ---------------------------------------------------------------------------
# Pipeline (drive-agnostic)
# ---------------------------------------------------------------------------

def _walk_statements(drive, folder_id):
    """Recursively yield statement files {id, name, modifiedTime} under a folder."""
    for entry in drive.list_folder(folder_id):
        if entry["mimeType"] == FOLDER_MIME:
            for f in _walk_statements(drive, entry["id"]):
                yield f
        elif entry["name"].lower().endswith(STATEMENT_EXTS):
            yield entry


def _cache_paths(cache_dir):
    return os.path.join(cache_dir, "statements"), os.path.join(cache_dir, "manifest.json")


def refresh_tracker(drive, config, repo_root):
    xlsx = drive.export_sheet(config["trackerSheetId"])
    cache_dir = os.path.join(repo_root, config.get("cacheDir", ".cache"))
    os.makedirs(cache_dir, exist_ok=True)
    tmp = os.path.join(cache_dir, "Tracker.xlsx")
    with open(tmp, "wb") as fh:
        fh.write(xlsx)
    cases = extract_tracker.extract(tmp)
    payload = {
        "generatedAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Tracker (Google Sheets) - Business Register tabs",
        "cases": cases,
    }
    out = os.path.join(repo_root, "data", "tracker.json")
    with open(out, "w") as fh:
        json.dump(payload, fh, indent=1)
    return len(cases)


def refresh_statements(drive, config, repo_root):
    cache_dir = os.path.join(repo_root, config.get("cacheDir", ".cache"))
    stmt_cache, manifest_path = _cache_paths(cache_dir)
    os.makedirs(stmt_cache, exist_ok=True)
    manifest = {}
    if os.path.exists(manifest_path):
        try:
            manifest = json.load(open(manifest_path))
        except (ValueError, OSError):
            manifest = {}

    files = list(_walk_statements(drive, config["statementsFolderId"]))
    new_manifest = {}
    statements = []
    downloaded = 0
    for f in files:
        ext = os.path.splitext(f["name"])[1].lower()
        local = os.path.join(stmt_cache, f["id"] + ext)
        # Only re-download when Drive shows the file changed (or it's new).
        if manifest.get(f["id"]) != f["modifiedTime"] or not os.path.exists(local):
            with open(local, "wb") as fh:
                fh.write(drive.download_file(f["id"]))
            downloaded += 1
        new_manifest[f["id"]] = f["modifiedTime"]
        parsed = statement_parser.parse_statement(local, f["name"])
        if "skipped" not in parsed:
            statements.append(parsed)

    # Drop cached workbooks that no longer exist in Drive.
    keep = set(new_manifest.keys())
    for name in os.listdir(stmt_cache):
        if os.path.splitext(name)[0] not in keep:
            try:
                os.remove(os.path.join(stmt_cache, name))
            except OSError:
                pass

    result = merge_statements.merge(statements)
    with open(manifest_path, "w") as fh:
        json.dump(new_manifest, fh)
    out = os.path.join(repo_root, "data", "statements.json")
    with open(out, "w") as fh:
        json.dump(result, fh, indent=1)
    return len(result["statements"]), downloaded


def refresh_all(config, drive=None, repo_root=None):
    """Pull the Tracker + statements into data/*.json. Returns a summary dict.

    `drive` must expose list_folder(id), export_sheet(id) -> bytes, and
    download_file(id) -> bytes. If omitted, a real GoogleDrive is built from the
    credentials/token paths in `config`.
    """
    repo_root = repo_root or REPO
    if drive is None:
        drive = GoogleDrive(
            os.path.join(repo_root, config.get("credentials", "credentials.json")),
            os.path.join(repo_root, config.get("token", "token.json")),
        )
    os.makedirs(os.path.join(repo_root, "data"), exist_ok=True)
    n_cases = refresh_tracker(drive, config, repo_root)
    n_statements, downloaded = refresh_statements(drive, config, repo_root)
    return {
        "cases": n_cases,
        "statements": n_statements,
        "downloaded": downloaded,
        "summary": "%d cases · %d statements%s" % (
            n_cases, n_statements,
            " · %d new" % downloaded if downloaded else ""),
    }


def load_config(path):
    with open(path) as fh:
        return json.load(fh)


def main():
    args = sys.argv[1:]
    config_path = os.path.join(REPO, "config.json")
    if "--config" in args:
        config_path = args[args.index("--config") + 1]
    if not os.path.exists(config_path):
        sys.exit("Missing %s — copy config.example.json to config.json and fill it in "
                 "(see SETUP-WINDOWS.md)." % config_path)
    config = load_config(config_path)
    result = refresh_all(config)
    print("Refreshed: " + result["summary"])


if __name__ == "__main__":
    main()
