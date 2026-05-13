.PHONY: up down recreate tofu ansible ansible-deps ssh ssh-key help \
        kamal-setup kamal-deploy kamal-redeploy kamal-rollback kamal-logs kamal-app \
        migrate

# Ambiente alvo: local (Docker) ou prod (Hetzner). Override:  make up ENV=prod
ENV         ?= local
TOFU_DIR    := infra/tofu/environments/$(ENV)
ANSIBLE_DIR := infra/ansible
SSH_KEY     := $(HOME)/.ssh/id_ed25519

help:  ## Mostra esta ajuda
	@echo "Infra (servidor):"
	@echo "  make up [ENV=...]     - Provisiona servidor (SSH key + Tofu + Ansible)"
	@echo "  make down [ENV=...]   - Destrói servidor"
	@echo "  make recreate         - Destrói e recria do zero (local)"
	@echo "  make tofu [ENV=...]   - Apenas Tofu apply"
	@echo "  make ansible          - Apenas Ansible playbook (limit ao ENV)"
	@echo "  make ansible-deps     - Instala collections Ansible (cloud.terraform)"
	@echo "  make ssh-key          - Gera SSH key (idempotente)"
	@echo "  make ssh              - SSH para o servidor local"
	@echo ""
	@echo "App (Kamal):"
	@echo "  make kamal-setup      - 1.ª vez: bootstrap servidor + accessories"
	@echo "  make kamal-deploy     - Build + push + migrate (pre-deploy hook) + roll"
	@echo "  make kamal-redeploy   - Deploy sem rebuild"
	@echo "  make kamal-rollback   - Rollback"
	@echo "  make kamal-logs       - Tail logs"
	@echo "  make kamal-app        - Shell no container"
	@echo "  make migrate          - Escape hatch: migrations manuais"

up: tofu ansible  ## Provisiona servidor completo

down: ssh-key  ## Destrói servidor
	cd $(TOFU_DIR) && tofu destroy -auto-approve

recreate: down up  ## Destrói e recria do zero

ssh-key: $(SSH_KEY)  ## Gera SSH key se não existir

$(SSH_KEY):
	@mkdir -p $(HOME)/.ssh
	@chmod 700 $(HOME)/.ssh
	@echo "Gerando SSH key em $(SSH_KEY)..."
	@ssh-keygen -t ed25519 -f $(SSH_KEY) -N "" -C "meta-menu-deploy"

tofu: ssh-key  ## Tofu apply
	cd $(TOFU_DIR) && tofu init -upgrade && tofu apply -auto-approve

ansible-deps:  ## Instala collections Ansible
	@cd $(ANSIBLE_DIR) && ansible-galaxy collection install -r requirements.yml >/dev/null

# Env vars em vez de ansible.cfg porque /mnt/c (WSL) é world-writable e
# Ansible ignora cfg nessas condições. Inventory plugin precisa de
# ser whitelisted aqui também.
ANSIBLE_ENV := \
  ANSIBLE_HOST_KEY_CHECKING=false \
  ANSIBLE_INVENTORY_ENABLED=cloud.terraform.terraform_provider,host_list,script,auto,yaml,ini,toml \
  ANSIBLE_INVENTORY=./inventory.yml \
  ANSIBLE_PIPELINING=true

ansible: ssh-key ansible-deps  ## Ansible playbook (limit ao $(ENV))
	cd $(ANSIBLE_DIR) && $(ANSIBLE_ENV) ansible-playbook --limit $(ENV) setup.yml

ssh:  ## SSH para o servidor local
	ssh -p 2222 -i ~/.ssh/id_ed25519 deploy@localhost

# ── Kamal ─────────────────────────────────────────────────────────────────────
kamal-setup:     ## Primeiro deploy: bootstrap + accessories
	kamal setup

kamal-deploy:    ## Deploy zero-downtime (pre-deploy hook corre migrations)
	kamal deploy

migrate:         ## Escape hatch: migrations manuais contra imagem actual
	kamal app exec --reuse "node scripts/migrate.mjs"

kamal-redeploy:  ## Redeploy sem rebuild
	kamal redeploy

kamal-rollback:  ## Rollback
	kamal rollback

kamal-logs:      ## Tail dos logs
	kamal app logs -f

kamal-app:       ## Shell no container da app
	kamal app exec --interactive --reuse bash
