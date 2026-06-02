"""
mortgage_oasis.datasource — load raw case-log rows from a live Google Sheet,
a CSV export, or the markdown export, returning header-keyed dicts ready for
`analytics.build_records`.

Configuration (env / .env):
  DATA_SOURCE                 sheets | csv | markdown   (default: csv)
  SHEET_ID                    Google Sheet id (sheets mode)
  SHEET_RANGE                 A1 range, e.g. 'Sheet1' or 'Data!A1:V2000'
  GOOGLE_APPLICATION_CREDENTIALS   path to the service-account JSON key
  DATA_CSV                    path to a CSV export (csv mode)
  DATA_MARKDOWN              path to a markdown/JSON export (markdown mode)
"""
import os

from . import analytics

SHEETS_SCOPE = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


def load_from_sheets(sheet_id=None, sheet_range=None, creds_path=None):
    """Read the sheet live via the Google Sheets API using a service account."""
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build

    sheet_id = sheet_id or os.environ["SHEET_ID"]
    sheet_range = sheet_range or os.environ.get("SHEET_RANGE", "A1:Z5000")
    creds_path = creds_path or os.environ["GOOGLE_APPLICATION_CREDENTIALS"]

    creds = Credentials.from_service_account_file(creds_path, scopes=SHEETS_SCOPE)
    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    resp = (service.spreadsheets().values()
            .get(spreadsheetId=sheet_id, range=sheet_range).execute())
    values = resp.get("values", [])
    return analytics.rows_from_table(values)


def load_from_csv(path=None):
    return analytics.parse_csv(path or os.environ["DATA_CSV"])


def load_from_markdown(path=None):
    md = analytics.load_markdown(path or os.environ["DATA_MARKDOWN"])
    return analytics.parse_markdown(md)


def load_rows(source=None):
    """Dispatch to the configured data source and return raw header-keyed rows."""
    source = (source or os.environ.get("DATA_SOURCE", "csv")).lower()
    if source == "sheets":
        return load_from_sheets()
    if source == "markdown":
        return load_from_markdown()
    return load_from_csv()


def describe_source(source=None):
    source = (source or os.environ.get("DATA_SOURCE", "csv")).lower()
    if source == "sheets":
        return f"Google Sheet {os.environ.get('SHEET_ID', '?')} (live)"
    if source == "markdown":
        return f"markdown export ({os.environ.get('DATA_MARKDOWN', '?')})"
    return f"CSV export ({os.environ.get('DATA_CSV', '?')})"
