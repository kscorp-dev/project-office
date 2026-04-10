#!/bin/bash
# project-office 배포 스크립트
# 사용: ./scripts/deploy.sh [build|restart|logs|status]
set -e

cd /opt/project-office

ACTION=${1:-deploy}

case $ACTION in
  deploy)
    echo "📦 Pulling latest code..."
    git pull origin main
    echo "🔨 Building & starting containers..."
    docker-compose up -d --build --remove-orphans
    echo "🧹 Cleaning up old images..."
    docker image prune -f
    echo "✅ Deploy complete!"
    docker-compose ps
    ;;
  build)
    echo "🔨 Rebuilding containers..."
    docker-compose up -d --build --remove-orphans
    docker image prune -f
    docker-compose ps
    ;;
  restart)
    echo "🔄 Restarting containers..."
    docker-compose restart
    docker-compose ps
    ;;
  logs)
    docker-compose logs -f --tail=100
    ;;
  status)
    docker-compose ps
    echo ""
    echo "=== Resource Usage ==="
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null || true
    ;;
  down)
    docker-compose down
    echo "⏹ All containers stopped"
    ;;
  *)
    echo "Usage: $0 {deploy|build|restart|logs|status|down}"
    exit 1
    ;;
esac
