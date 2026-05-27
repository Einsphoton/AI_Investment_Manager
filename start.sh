#!/bin/bash

# ============================================
# AI 投资分析平台 - macOS/Linux 启动脚本
# ============================================

set -e

cd "$(dirname "$0")"

echo "============================================"
echo "  AI 投资分析平台 - 启动脚本"
echo "============================================"

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "[错误] 未找到 Docker，请先安装 Docker"
    echo "       macOS: https://docs.docker.com/desktop/setup/install/mac-install/"
    echo "       Linux: https://docs.docker.com/engine/install/"
    exit 1
fi

# 检查 Docker Compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null 2>&1; then
    echo "[错误] 未找到 Docker Compose"
    exit 1
fi

# 创建数据目录
mkdir -p data

echo ""
echo "[1/3] 正在构建 Docker 镜像..."
docker compose build

echo ""
echo "[2/3] 正在启动服务..."
docker compose up -d

echo ""
echo "[3/3] 服务启动完成！"
echo ""
echo "============================================"
echo "  访问地址: http://localhost:8000"
echo "============================================"
echo ""
echo "常用命令："
echo "  查看日志: docker compose logs -f"
echo "  停止服务: docker compose down"
echo "  重启服务: docker compose restart"
echo ""
