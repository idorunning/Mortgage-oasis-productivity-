@echo off
REM Mortgage Oasis dashboard launcher (Windows).
REM First run: creates a local Python environment and installs the requirements.
REM Every run: starts the local dashboard and opens it in your browser.

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo First-time setup: creating a local Python environment...
  py -3 -m venv .venv || python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)

if not exist "config.json" (
  echo.
  echo No config.json found yet. Copy config.example.json to config.json and
  echo follow SETUP-WINDOWS.md to connect Google, then run this again.
  echo Opening the dashboard with the existing data for now...
  echo.
)

".venv\Scripts\python.exe" server.py
pause
