@echo off
setlocal
set "BUILD_MODE=desktop"
set "SKIP_INSTALL=0"

:parse_args
if "%~1"=="" goto build
if /I "%~1"=="--help" goto help
if /I "%~1"=="--frontend" (
  set "BUILD_MODE=frontend"
  shift
  goto parse_args
)
if /I "%~1"=="--exe" (
  set "BUILD_MODE=exe"
  shift
  goto parse_args
)
if /I "%~1"=="--skip-install" (
  set "SKIP_INSTALL=1"
  shift
  goto parse_args
)
echo [ERROR] Unknown argument: %~1
exit /b 2

:build
pushd "%~dp0"
if errorlevel 1 exit /b 1

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is required. Install Node.js and reopen the terminal.
  goto failed
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found in PATH.
  goto failed
)
if "%BUILD_MODE%"=="frontend" goto dependencies
where cargo.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Rust is required. Install Rust with the MSVC toolchain.
  echo         Also install Visual Studio Build Tools: Desktop development with C++.
  goto failed
)
where rustc.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] rustc.exe was not found in PATH.
  goto failed
)

:dependencies
if "%SKIP_INSTALL%"=="1" (
  if not exist "node_modules\.bin\vite.cmd" (
    echo [ERROR] Dependencies are missing. Run without --skip-install first.
    goto failed
  )
) else (
  echo [1/2] Installing dependencies from package-lock.json...
  call npm.cmd ci
  if errorlevel 1 goto failed
)

echo [2/2] Building %BUILD_MODE% release...
if "%BUILD_MODE%"=="frontend" goto frontend
if not exist "node_modules\.bin\tauri.cmd" (
  echo [ERROR] Tauri CLI is missing. Run without --skip-install first.
  goto failed
)
rem Tauri runs the frontend build through beforeBuildCommand.
if "%BUILD_MODE%"=="exe" (
  call npm.cmd run tauri -- build --no-bundle
) else (
  call npm.cmd run tauri -- build
)
if errorlevel 1 goto failed
echo.
echo [OK] Desktop build completed. See Tauri output above for artifact paths.
echo Default executable: "%CD%\src-tauri\target\release\markdown-viewer.exe"
if "%BUILD_MODE%"=="desktop" echo Default installers: "%CD%\src-tauri\target\release\bundle"
echo Custom Cargo target settings may change these paths.
goto success

:frontend
call npm.cmd run build
if errorlevel 1 goto failed
echo.
echo [OK] Frontend output: "%CD%\dist"

:success
popd
exit /b 0

:failed
echo.
echo [ERROR] Build failed. Review the error output above.
popd
exit /b 1

:help
echo Usage: build.cmd [--frontend ^| --exe] [--skip-install]
echo.
echo Default          Build release desktop application and installers.
echo --frontend       Build only the frontend into dist.
echo --exe            Build release desktop executable without installers.
echo --skip-install   Reuse installed node_modules instead of npm ci.
echo --help           Show this help.
echo.
echo Desktop prerequisites: Node.js, Rust MSVC, Visual Studio C++ Build Tools.
exit /b 0
