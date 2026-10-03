# Thoughts, unsigned: common tasks. Needs Docker Desktop (or Docker + Compose).
COMPOSE ?= docker compose
PROD ?= docker compose -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: dev up down logs migrate seed test e2e backup restore audit prod prod-down prod-logs prod-seed prod-backup prod-restore prod-reset-password

dev:            ## Build and start everything: site http://localhost:8080  Studio /studio  mail http://localhost:8025
	$(COMPOSE) up -d --build
	@echo "Site: http://localhost:8080   Studio: http://localhost:8080/studio   Mail inbox: http://localhost:8025"

down:           ## Stop everything (data is kept)
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=100

migrate:        ## Apply database migrations (also runs automatically when the API starts)
	$(COMPOSE) exec api alembic upgrade head

seed:           ## Placeholder content + the owner account. Prints recovery codes ONCE. ARGS=--no-demo-stats for a clean slate
	$(COMPOSE) exec api python -m app.cli seed $(ARGS)

test:           ## Backend tests (pytest, throwaway database + bucket)
	$(COMPOSE) run --rm --no-deps -v "$(CURDIR)/api:/srv" api python -m pytest -q

e2e:            ## Browser journeys (Playwright). Starts the API with rate limits off for the run, then restores them.
	RATE_LIMIT_ENABLED=false $(COMPOSE) up -d api
	cd web && npx playwright test; status=$$?; cd .. && $(COMPOSE) up -d api; exit $$status

backup:         ## Encrypted pg_dump + media manifest, uploaded to the bucket (also runs nightly at 03:00 IST)
	$(COMPOSE) exec api python -m app.cli backup

restore:        ## Restore the newest backup (or: make restore NAME=2026-10-03_2130). Replaces the current database!
	$(COMPOSE) exec api python -m app.cli restore $(NAME)

audit:          ## Dependency vulnerability scan (also runs in CI)
	$(COMPOSE) run --rm --no-deps api sh -c "pip install -q pip-audit && pip-audit -r requirements.txt"
	cd web && npm audit --omit=dev

# ---- Production (on the server; see docs/DEPLOY.md) ------------------------------------------------------------
prod:           ## Build and start the production stack (also the way to update after git pull)
	$(PROD) up -d --build

prod-down:
	$(PROD) down

prod-logs:
	$(PROD) logs -f --tail=100

prod-seed:      ## Creates the owner account only (no sample posts). Starting login: admin / admin@123
	$(PROD) exec api python -m app.cli seed --owner-only

prod-backup:
	$(PROD) exec api python -m app.cli backup

prod-restore:   ## Replaces the database with the newest backup (NAME=... for another)
	$(PROD) exec api python -m app.cli restore $(NAME)

prod-reset-password:  ## make prod-reset-password ID=admin
	$(PROD) exec api python -m app.cli reset-password $(ID)

# ---- Free-hosting rehearsal (the single-container build used on Render) ----------------------------------------
render-rehearsal:   ## Build and run the Render image locally with a 512 MB memory limit: http://localhost:8090
	docker compose -f docker/render/rehearsal.compose.yml up -d --build
	@echo "Open http://localhost:8090  (starting login: admin / admin@123). Mail inbox: http://localhost:8026"

render-rehearsal-down:
	docker compose -f docker/render/rehearsal.compose.yml down -v
