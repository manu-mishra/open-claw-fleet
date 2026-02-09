# Open-Claw-Fleet Makefile
# Convenient commands for building and deploying

.PHONY: help build-images push-images deploy-infra deploy-all clean

# Default AWS settings (override with environment variables)
AWS_ACCOUNT_ID ?= $(shell aws sts get-caller-identity --query Account --output text)
AWS_REGION ?= us-east-1
VERSION ?= latest

help: ## Show this help message
	@echo "Open-Claw-Fleet - Available commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Docker Images
build-images: ## Build all Docker images locally
	@./scripts/build-images.sh $(VERSION)

push-images: ## Push images to ECR (requires AWS_ACCOUNT_ID, AWS_REGION)
	@./scripts/push-images.sh $(AWS_ACCOUNT_ID) $(AWS_REGION) $(VERSION)

create-repos: ## Create ECR repositories
	@./scripts/create-ecr-repos.sh $(AWS_REGION)

# Infrastructure
build-infra: ## Build CDK TypeScript code
	@cd packages/aws/infra && npm run build

deploy-shared: build-infra ## Deploy shared infrastructure
	@cd packages/aws/infra && npm run deploy:shared

deploy-dev: build-infra ## Deploy dev environment
	@cd packages/aws/infra && npm run deploy:dev

deploy-staging: build-infra ## Deploy staging environment
	@cd packages/aws/infra && npm run deploy:staging

deploy-prod: build-infra ## Deploy production environment
	@cd packages/aws/infra && npm run deploy:prod

destroy-dev: ## Destroy dev environment
	@cd packages/aws/infra && npm run destroy:dev

# Complete workflows
setup: create-repos build-images push-images ## Complete setup: create repos, build and push images

deploy-all: setup deploy-shared deploy-dev ## Deploy everything (repos, images, infrastructure)

# Local development
local-up: ## Start local docker-compose environment
	@cd docker && docker-compose up -d

local-down: ## Stop local docker-compose environment
	@cd docker && docker-compose down

local-logs: ## Show logs from local environment
	@cd docker && docker-compose logs -f

# Cleanup
clean: ## Clean build artifacts
	@cd packages/aws/infra && rm -rf bin/ cdk.out/
	@docker system prune -f

# Info
info: ## Show current AWS account and region
	@echo "AWS Account: $(AWS_ACCOUNT_ID)"
	@echo "AWS Region: $(AWS_REGION)"
	@echo "Version: $(VERSION)"
	@echo ""
	@echo "ECR Registry: $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com"
