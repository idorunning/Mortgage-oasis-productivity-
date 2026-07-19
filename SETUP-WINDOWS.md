# Setup (Windows) — connect the dashboard to Google

You do this **once**. After it, refreshing is a single click of the "Refresh
from Google" button in the dashboard. Your Tracker and statement data are read
straight from your own Google account to your own PC — they are never sent to
Claude/Anthropic or any other third party.

Roughly 10 minutes. You'll need to be signed into the Google account that can
see the Tracker sheet and the Statements folder (mel@mortgage-oasis.com, or an
account it's shared with).

---

## 1. Install Python (if you don't have it)

1. Go to <https://www.python.org/downloads/windows/> and install the latest
   **Python 3** ("Windows installer, 64-bit").
2. On the first screen of the installer, tick **"Add python.exe to PATH"**, then
   click **Install Now**.

## 2. Get the project onto your PC

Put this project's folder somewhere easy, e.g. `Documents\MortgageOasis`. (If you
downloaded it as a zip, unzip it there.)

## 3. Create a Google Cloud project + turn on the Drive API

1. Go to <https://console.cloud.google.com/> and sign in with your Google account.
2. At the top, click the project dropdown → **New Project**. Name it
   `Mortgage Oasis Dashboard` and click **Create**. Wait a few seconds, then make
   sure that new project is selected in the dropdown.
3. In the search bar type **"Google Drive API"**, open it, and click **Enable**.

## 4. Set up the consent screen

1. Left menu (☰) → **APIs & Services** → **OAuth consent screen**.
2. Choose **External**, click **Create**.
3. Fill in the required boxes: **App name** (`Mortgage Oasis Dashboard`), your
   email for the two support-email fields. Click **Save and Continue**.
4. On **Scopes**, just click **Save and Continue**.
5. On **Test users**, click **Add users**, enter the Google address you'll sign
   in with, **Save and Continue**.
6. Click **Back to Dashboard**. (You do **not** need to "publish" the app —
   test-user access is enough for your own use.)

## 5. Create the credentials file

1. Left menu → **APIs & Services** → **Credentials**.
2. Click **+ Create Credentials** → **OAuth client ID**.
3. **Application type: Desktop app**. Name it `Dashboard`. Click **Create**.
4. In the popup, click **Download JSON**.
5. Rename the downloaded file to exactly **`credentials.json`** and move it into
   the project folder (next to `run-dashboard.bat`).

## 6. Find your Statements folder ID and fill in the config

1. In Google Drive, open the folder that contains the yearly statement folders
   (2024 / 2025 / 2026). Look at the address bar — the ID is the long code after
   `folders/`:
   `https://drive.google.com/drive/folders/`**`THIS_LONG_CODE`**
2. In the project folder, make a copy of **`config.example.json`** and name the
   copy **`config.json`**.
3. Open `config.json` in Notepad and paste that code as the
   `statementsFolderId` value (keep the quotes). The `trackerSheetId` is already
   filled in; leave the rest as-is. Save.

## 7. Run it

1. Double-click **`run-dashboard.bat`**. The first run sets things up (a minute
   or two) and then opens the dashboard in your browser.
2. Click **Refresh from Google**. A Google sign-in page opens in your browser —
   sign in and click **Allow**. (You may see a "Google hasn't verified this app"
   screen because it's your own private app — click **Advanced → Go to Mortgage
   Oasis Dashboard**.)
3. That's it. The dashboard pulls your latest Tracker and statements. From now on,
   Refresh is one click — no sign-in needed again unless you move to a new PC.

---

## Everyday use

- Double-click `run-dashboard.bat`, click **Refresh from Google** whenever you've
  edited the Tracker or dropped new statement files into the Statements folder.
- Only new/changed statements are downloaded, so routine refreshes are quick.

## Notes & safety

- `credentials.json`, `token.json` and `config.json` stay on your PC — they're
  never committed to GitHub (the `.gitignore` blocks them). Keep `credentials.json`
  and `token.json` private; they're the keys to reading your Drive.
- The dashboard only runs on your machine (`127.0.0.1`) — it isn't reachable from
  the internet or your office network.
- The **Chase** button only opens a pre-filled Gmail compose window; it never
  sends anything until you press Send.
