@echo off
cd /d "%~dp0.."
"C:\Program Files\nodejs\node.exe" --env-file=.env "%~dp0pull-yangju-factories.js"
