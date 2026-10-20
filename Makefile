.PHONY: install dev test lint typecheck build dist-check hygiene binary ci hooks clean help

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install:  ## Install dependencies (reproducible, from package-lock.json)
	npm ci

dev:  ## Install all dependencies, including dev tooling
	npm install

test:  ## Run unit tests
	npm test

lint:  ## Run ESLint
	npm run lint

typecheck:  ## Run the TypeScript type checker
	npm run typecheck

build:  ## Compile TypeScript to dist/
	npm run build

dist-check:  ## Verify the npm package contents (CI equivalent)
	npm pack --dry-run --json | node scripts/check-package-entry.mjs

binary:  ## Build standalone binary for current platform (esbuild + Node SEA)
	npm ci
	node scripts/build_binary.mjs

hygiene:  ## Fail on committed local paths / credential-like strings (CI equivalent)
	npm run check:hygiene

ci:  ## Run local CI equivalent (single Node version; NOT a full substitute for the Node 20/22 matrix in GitHub Actions)
	$(MAKE) hygiene
	npm run typecheck
	npm run lint
	rm -rf dist/
	npm run build
	npm test
	npm run parity:coverage
	$(MAKE) dist-check
	@echo "Note: this runs on a single Node.js version; the Node 20/22 matrix can only be fully covered by GitHub Actions CI."

hooks:  ## Install pre-commit (called automatically via .githooks/pre-commit)
	pip install pre-commit
	@echo "pre-commit installed. It will be called automatically via .githooks/pre-commit."

clean:  ## Clean build artifacts
	rm -rf build/ dist/ coverage/ *.tgz
