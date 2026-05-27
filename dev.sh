#!/bin/bash

# ============================================
# AI 投资分析平台 - 本地开发启动脚本
# 自动安装依赖并同时启动前后端
# ============================================

set -e

echo "============================================"
echo "  AI 投资分析平台 - 本地开发模式"
echo "============================================"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 设置 Python 虚拟环境
echo ""
echo "[1/4] 设置 Python 虚拟环境..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate

# 安装后端依赖
echo "[2/4] 安装后端依赖..."
pip install -r backend/requirements.txt --quiet

# 安装前端依赖
echo "[3/4] 安装前端依赖..."
cd frontend
npm install --silent
cd ..

# 启动后端
echo "[4/4] 启动服务..."
echo ""

mkdir -p data

cleanup() {
    echo ""
    echo "正在关闭服务..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

source venv/bin/activate
cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
cd ..

cd frontend && npx vite --host 0.0.0.0 --port 5173 &
FRONTEND_PID=$!

echo "============================================"
echo "  前端: http://localhost:5173"
echo "  后端: http://localhost:8000"
echo "  API:  http://localhost:8000/docs"
echo "============================================"
echo "按 Ctrl+C 停止所有服务"

wait
