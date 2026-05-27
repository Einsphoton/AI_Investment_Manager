@echo off
chcp 65001 >nul

REM ============================================
REM AI 投资分析平台 - 本地开发启动脚本
REM 自动安装依赖并同时启动前后端
REM ============================================

echo ============================================
echo   AI 投资分析平台 - 本地开发模式
echo ============================================

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

REM 设置 Python 虚拟环境
echo.
echo [1/4] 设置 Python 虚拟环境...
if not exist "venv" (
    python -m venv venv
)
call venv\Scripts\activate

REM 安装后端依赖
echo [2/4] 安装后端依赖...
pip install -r backend\requirements.txt --quiet

REM 安装前端依赖
echo [3/4] 安装前端依赖...
cd frontend
call npm install --silent
cd ..

REM 创建数据目录
if not exist data mkdir data

REM 启动后端
echo [4/4] 启动服务...
echo.

echo ============================================
echo   前端: http://localhost:5173
echo   后端: http://localhost:8000
echo   API:  http://localhost:8000/docs
echo ============================================
echo 按 Ctrl+C 停止所有服务
echo.

start "AI-Backend" cmd /c "call venv\Scripts\activate && cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
start "AI-Frontend" cmd /c "cd frontend && npx vite --host 0.0.0.0 --port 5173"

pause
