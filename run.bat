@echo off
title DriverGuard AI - Smart Driver Safety System
color 0a

:: Silence TensorFlow log messages
set TF_ENABLE_ONEDNN_OPTS=0
set TF_CPP_MIN_LOG_LEVEL=3

echo =========================================================================
echo       SMART DRIVER SAFETY ^& FATIGUE DETECTION SYSTEM
echo =========================================================================
echo.
echo Checking Python environment...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH! Please install Python 3.9+.
    pause
    exit /b 1
)

echo Starting DriverGuard AI Server and launching browser...
echo.
python start.py
pause
