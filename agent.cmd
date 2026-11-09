@echo off
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0server\scripts\cli.js" %*
) else (
  node "%~dp0server\scripts\cli.js" %*
)
