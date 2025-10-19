.PHONY: help build-all build-master build-chunk build-gateway up down restart logs clean rebuild scale test status health

# Colors for output
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[0;33m
BLUE := \033[0;34m
NC := \033[0m # No Color

# Default target
help:
	@echo "$(BLUE)Hercules Distributed File System - Docker Management$(NC)"
	@echo ""
	@echo "$(GREEN)Build Commands:$(NC)"
	@echo "  make build-all       - Build all server images (master, chunk, gateway)"
	@echo "  make build-master    - Build master server image only"
	@echo "  make build-chunk     - Build chunk server image only"
	@echo "  make build-gateway   - Build gateway server image only"
	@echo ""
	@echo "$(GREEN)Service Management:$(NC)"
	@echo "  make up              - Start all services"
	@echo "  make down            - Stop all services"
	@echo "  make restart         - Restart all services"
	@echo "  make stop            - Stop services without removing"
	@echo "  make start           - Start stopped services"
	@echo "  make ps              - List running services"
	@echo ""
	@echo "$(GREEN)Logging:$(NC)"
	@echo "  make logs            - Show logs from all services"
	@echo "  make logs-master     - Show master server logs"
	@echo "  make logs-chunks     - Show all chunk server logs"
	@echo "  make logs-gateway    - Show gateway server logs"
	@echo "  make logs-follow     - Follow logs in real-time"
	@echo ""
	@echo "$(GREEN)Monitoring:$(NC)"
	@echo "  make status          - Show status of all services"
	@echo "  make health          - Show health check status"
	@echo "  make stats           - Show resource usage statistics"
	@echo "  make top             - Show live container stats"
	@echo ""
	@echo "$(GREEN)Scaling:$(NC)"
	@echo "  make scale N=5       - Scale to N chunk servers"
	@echo "  make scale-up        - Add 2 more chunk servers"
	@echo "  make scale-down      - Remove 2 chunk servers"
	@echo ""
	@echo "$(GREEN)Cleanup:$(NC)"
	@echo "  make clean           - Remove all containers, volumes, and images"
	@echo "  make clean-volumes   - Remove only volumes (data)"
	@echo "  make clean-images    - Remove only images"
	@echo "  make prune           - Clean up unused Docker resources"
	@echo ""
	@echo "$(GREEN)Development:$(NC)"
	@echo "  make dev-master      - Run master in foreground"
	@echo "  make dev-chunk       - Run chunk server 1 in foreground"
	@echo "  make dev-gateway     - Run gateway in foreground"
	@echo "  make shell-master    - Open shell in master container"
	@echo "  make shell-chunk1    - Open shell in chunk server 1"
	@echo "  make shell-gateway   - Open shell in gateway container"
	@echo ""
	@echo "$(GREEN)Utilities:$(NC)"
	@echo "  make rebuild         - Clean and rebuild everything"
	@echo "  make reset           - Complete system reset"
	@echo "  make backup          - Backup all data volumes"
	@echo "  make network-info    - Show network configuration"
	@echo "  make ping-test       - Test network connectivity"
	@echo ""

# ============================================================================
# Build Targets
# ============================================================================

build-all: build-master build-chunk build-gateway
	@echo "$(GREEN)✓ All images built successfully$(NC)"

build-master:
	@echo "$(BLUE)Building master server image...$(NC)"
	@docker build --build-arg SERVER_TYPE=master_server -t hercules-master:latest -f Dockerfile .
	@echo "$(GREEN)✓ Master server image built$(NC)"

build-chunk:
	@echo "$(BLUE)Building chunk server image...$(NC)"
	@docker build --build-arg SERVER_TYPE=chunk_server -t hercules-chunkserver:latest -f Dockerfile .
	@echo "$(GREEN)✓ Chunk server image built$(NC)"

build-gateway:
	@echo "$(BLUE)Building gateway server image...$(NC)"
	@docker build --build-arg SERVER_TYPE=gateway_server -t hercules-gateway:latest -f Dockerfile .
	@echo "$(GREEN)✓ Gateway server image built$(NC)"

# ============================================================================
# Service Management
# ============================================================================

up:
	@echo "$(BLUE)Starting Hercules services...$(NC)"
	@docker-compose up -d
	@echo "$(GREEN)✓ Services started$(NC)"
	@make status

down:
	@echo "$(BLUE)Stopping Hercules services...$(NC)"
	@docker-compose down
	@echo "$(GREEN)✓ Services stopped$(NC)"

restart:
	@echo "$(BLUE)Restarting Hercules services...$(NC)"
	@docker-compose restart
	@echo "$(GREEN)✓ Services restarted$(NC)"

stop:
	@echo "$(BLUE)Stopping Hercules services...$(NC)"
	@docker-compose stop
	@echo "$(GREEN)✓ Services stopped$(NC)"

start:
	@echo "$(BLUE)Starting Hercules services...$(NC)"
	@docker-compose start
	@echo "$(GREEN)✓ Services started$(NC)"

ps:
	@docker-compose ps

# ============================================================================
# Logging
# ============================================================================

logs:
	@docker-compose logs --tail=100

logs-follow:
	@docker-compose logs -f

logs-master:
	@docker-compose logs -f master

logs-chunks:
	@docker-compose logs -f chunkserver1 chunkserver2 chunkserver3 chunkserver4 chunkserver5

logs-gateway:
	@docker-compose logs -f gateway

logs-chunk1:
	@docker-compose logs -f chunkserver1

logs-chunk2:
	@docker-compose logs -f chunkserver2

logs-chunk3:
	@docker-compose logs -f chunkserver3

logs-chunk4:
	@docker-compose logs -f chunkserver4

logs-chunk5:
	@docker-compose logs -f chunkserver5

# ============================================================================
# Monitoring
# ============================================================================

status:
	@echo "$(BLUE)=== Hercules Service Status ===$(NC)"
	@docker-compose ps
	@echo ""
	@echo "$(BLUE)=== Docker Images ===$(NC)"
	@docker images | grep -E "hercules|REPOSITORY"

health:
	@echo "$(BLUE)=== Health Check Status ===$(NC)"
	@echo "Master:       $$(docker inspect -f '{{.State.Health.Status}}' hercules-master 2>/dev/null || echo 'not running')"
	@echo "ChunkServer1: $$(docker inspect -f '{{.State.Health.Status}}' hercules-chunkserver1 2>/dev/null || echo 'not running')"
	@echo "ChunkServer2: $$(docker inspect -f '{{.State.Health.Status}}' hercules-chunkserver2 2>/dev/null || echo 'not running')"
	@echo "ChunkServer3: $$(docker inspect -f '{{.State.Health.Status}}' hercules-chunkserver3 2>/dev/null || echo 'not running')"
	@echo "ChunkServer4: $$(docker inspect -f '{{.State.Health.Status}}' hercules-chunkserver4 2>/dev/null || echo 'not running')"
	@echo "ChunkServer5: $$(docker inspect -f '{{.State.Health.Status}}' hercules-chunkserver5 2>/dev/null || echo 'not running')"
	@echo "Gateway:      $$(docker inspect -f '{{.State.Health.Status}}' hercules-gateway 2>/dev/null || echo 'not running')"

stats:
	@docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}" $$(docker ps --filter "name=hercules" -q)

top:
	@docker stats $$(docker ps --filter "name=hercules" -q)

# ============================================================================
# Scaling
# ============================================================================

scale:
	@if [ -z "$(N)" ]; then \
		echo "$(RED)Error: Please specify number of chunk servers$(NC)"; \
		echo "Usage: make scale N=<number>"; \
		echo "Example: make scale N=7"; \
		exit 1; \
	fi
	@echo "$(BLUE)Scaling chunk servers to $(N) instances...$(NC)"
	@docker-compose up -d --scale chunkserver=$(N)
	@echo "$(GREEN)✓ Scaled to $(N) chunk servers$(NC)"

scale-up:
	@echo "$(BLUE)Adding 2 more chunk servers...$(NC)"
	@CURRENT=$$(docker ps --filter "name=hercules-chunkserver" -q | wc -l); \
	NEW=$$((CURRENT + 2)); \
	echo "Scaling from $$CURRENT to $$NEW servers..."; \
	make scale N=$$NEW

scale-down:
	@echo "$(BLUE)Removing 2 chunk servers...$(NC)"
	@CURRENT=$$(docker ps --filter "name=hercules-chunkserver" -q | wc -l); \
	if [ $$CURRENT -le 2 ]; then \
		echo "$(RED)Error: Cannot scale below 1 chunk server$(NC)"; \
		exit 1; \
	fi; \
	NEW=$$((CURRENT - 2)); \
	echo "Scaling from $$CURRENT to $$NEW servers..."; \
	make scale N=$$NEW

# ============================================================================
# Cleanup
# ============================================================================

clean:
	@echo "$(YELLOW)Removing all Hercules containers and volumes...$(NC)"
	@docker-compose down -v
	@docker rmi hercules-master:latest hercules-chunkserver:latest hercules-gateway:latest 2>/dev/null || true
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

clean-volumes:
	@echo "$(YELLOW)Removing all Hercules volumes...$(NC)"
	@docker-compose down
	@docker volume rm $$(docker volume ls -q | grep hercules) 2>/dev/null || true
	@echo "$(GREEN)✓ Volumes removed$(NC)"

clean-images:
	@echo "$(YELLOW)Removing Hercules images...$(NC)"
	@docker rmi hercules-master:latest hercules-chunkserver:latest hercules-gateway:latest 2>/dev/null || true
	@echo "$(GREEN)✓ Images removed$(NC)"

prune:
	@echo "$(YELLOW)Pruning unused Docker resources...$(NC)"
	@docker system prune -f
	@echo "$(GREEN)✓ Prune complete$(NC)"

# ============================================================================
# Development
# ============================================================================

dev-master:
	@docker-compose up master

dev-chunk:
	@docker-compose up chunkserver1

dev-gateway:
	@docker-compose up gateway

shell-master:
	@docker exec -it hercules-master /bin/sh

shell-chunk1:
	@docker exec -it hercules-chunkserver1 /bin/sh

shell-chunk2:
	@docker exec -it hercules-chunkserver2 /bin/sh

shell-chunk3:
	@docker exec -it hercules-chunkserver3 /bin/sh

shell-chunk4:
	@docker exec -it hercules-chunkserver4 /bin/sh

shell-chunk5:
	@docker exec -it hercules-chunkserver5 /bin/sh

shell-gateway:
	@docker exec -it hercules-gateway /bin/sh

# ============================================================================
# Utilities
# ============================================================================

rebuild: clean build-all
	@echo "$(GREEN)✓ Rebuild complete$(NC)"

reset: clean
	@echo "$(YELLOW)Performing complete system reset...$(NC)"
	@docker volume prune -f
	@docker network prune -f
	@make build-all
	@make up
	@echo "$(GREEN)✓ System reset complete$(NC)"

backup:
	@echo "$(BLUE)Creating backup of Hercules data...$(NC)"
	@mkdir -p backups
	@TIMESTAMP=$$(date +%Y%m%d-%H%M%S); \
	docker run --rm -v hercules_master-data:/data -v $$(pwd)/backups:/backup alpine tar czf /backup/master-$$TIMESTAMP.tar.gz -C /data . && \
	docker run --rm -v hercules_chunk1-data:/data -v $$(pwd)/backups:/backup alpine tar czf /backup/chunk1-$$TIMESTAMP.tar.gz -C /data . && \
	docker run --rm -v hercules_chunk2-data:/data -v $$(pwd)/backups:/backup alpine tar czf /backup/chunk2-$$TIMESTAMP.tar.gz -C /data . && \
	docker run --rm -v hercules_chunk3-data:/data -v $$(pwd)/backups:/backup alpine tar czf /backup/chunk3-$$TIMESTAMP.tar.gz -C /data . && \
	docker run --rm -v hercules_chunk4-data:/data -v $$(pwd)/backups:/backup alpine tar czf /backup/chunk4-$$TIMESTAMP.tar.gz -C /data . && \
	docker run --rm -v hercules_chunk5-data:/data -v $$(pwd)/backups:/backup alpine tar czf /backup/chunk5-$$TIMESTAMP.tar.gz -C /data . && \
	docker run --rm -v hercules_gateway-data:/data -v $$(pwd)/backups:/backup alpine tar czf /backup/gateway-$$TIMESTAMP.tar.gz -C /data .
	@echo "$(GREEN)✓ Backup complete: backups/$(NC)"
	@ls -lh backups/

restore:
	@if [ -z "$(BACKUP)" ]; then \
		echo "$(RED)Usage: make restore BACKUP=<backup-file>$(NC)"; \
		echo "Available backups:"; \
		ls -lh backups/ 2>/dev/null || echo "No backups found"; \
		exit 1; \
	fi
	@echo "$(BLUE)Restoring from $(BACKUP)...$(NC)"
	@docker run --rm -v hercules_master-data:/data -v $$(pwd)/backups:/backup alpine tar xzf /backup/$(BACKUP) -C /data
	@echo "$(GREEN)✓ Restore complete$(NC)"

network-info:
	@echo "$(BLUE)=== Hercules Network Information ===$(NC)"
	@docker network inspect hercules_hercules-net

ping-test:
	@echo "$(BLUE)=== Network Connectivity Test ===$(NC)"
	@echo "Testing master from chunkserver1..."
	@docker exec hercules-chunkserver1 ping -c 3 master || echo "$(RED)Failed$(NC)"
	@echo ""
	@echo "Testing chunkserver1 from master..."
	@docker exec hercules-master ping -c 3 chunkserver1 || echo "$(RED)Failed$(NC)"
	@echo ""
	@echo "Testing gateway from master..."
	@docker exec hercules-master ping -c 3 gateway || echo "$(RED)Failed$(NC)"

# ============================================================================
# Testing
# ============================================================================

test:
	@echo "$(BLUE)Running integration tests...$(NC)"
	@if [ -f tests/integration_test.sh ]; then \
		./tests/integration_test.sh; \
	else \
		echo "$(YELLOW)No test script found at tests/integration_test.sh$(NC)"; \
	fi

# ============================================================================
# Info
# ============================================================================

info:
	@echo "$(BLUE)=== Hercules System Information ===$(NC)"
	@echo ""
	@echo "$(GREEN)Services:$(NC)"
	@echo "  Master Server:  http://localhost:9090"
	@echo "  Gateway Server: http://localhost:8089"
	@echo "  Chunk Servers:  localhost:8081-8085"
	@echo ""
	@echo "$(GREEN)Volumes:$(NC)"
	@docker volume ls | grep hercules
	@echo ""
	@echo "$(GREEN)Network:$(NC)"
	@echo "  Subnet: 172.25.0.0/16"
	@echo ""
	@make health