@echo off
chcp 65001 >nul

REM ============================================
REM AI 投资分析平台 - Windows 启动脚本
REM ============================================

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

echo ============================================
echo   AI 投资分析平台 - 启动脚本
echo ============================================

REM 检查 Docker
where docker >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [错误] 未找到 Docker，请先安装 Docker Desktop
    echo       Windows: https://docs.docker.com/desktop/setup/install/windows-install/
    pause
    exit /b 1
)

REM 检查 Docker Compose
docker compose version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [错误] 未找到 Docker Compose
    pause
    exit /b 1
)

REM 创建数据目录
if not exist data mkdir data

echo.
echo [1/3] 正在构建 Docker 镜像...
docker compose build

echo.
echo [2/3] 正在启动服务...
docker compose up -d

echo.
echo [3/3] 服务启动完成！
echo.
echo ============================================
echo   访问地址: http://localhost:8000
echo ============================================
echo.
echo 常用命令：
echo   查看日志: docker compose logs -f
echo   停止服务: docker compose down
echo   重启服务: docker compose restart
echo.
pause
