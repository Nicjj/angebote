@echo off
cd /d "%~dp0"
start "" http://localhost:5610
node server.js
