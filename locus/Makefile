# Locus userspace commands; independent of the upstream kernel Makefile.
SHELL_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/shell)

.PHONY: help shell-install shell-dev shell-typecheck shell-test shell-build shell-check shell-preview shell-e2e
help:
	@echo "shell-install: install locked dependencies"
	@echo "shell-dev / shell-preview: serve development / built production shell"
	@echo "shell-check: typecheck, unit tests, production build"
	@echo "shell-e2e: real-browser integration tests (requires Chromium)"
shell-install:
	cd "$(SHELL_DIR)" && npm ci
shell-dev:
	cd "$(SHELL_DIR)" && npm run dev
shell-typecheck:
	cd "$(SHELL_DIR)" && npm run typecheck
shell-test:
	cd "$(SHELL_DIR)" && npm test
shell-build:
	cd "$(SHELL_DIR)" && npm run build
shell-check:
	$(MAKE) shell-typecheck
	$(MAKE) shell-test
	$(MAKE) shell-build
shell-preview:
	cd "$(SHELL_DIR)" && npm run preview
shell-e2e:
	cd "$(SHELL_DIR)" && npm run test:e2e
