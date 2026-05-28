# Git & Gitea — commit / push canonical

Setup HTTPS-only para empurrar para `git.iedora.com` (Gitea self-hosted)
**de qualquer rede** (casa, café, 4G) e em **qualquer laptop**.

Stack:

- **HTTPS via Cloudflare Tunnel** para o transporte git (passa qualquer rede)
- **Personal Access Token (PAT) per-laptop** no keychain do OS
- **Hooks** (pre-commit + commit-msg) instalados pelo `bun install`

```
                 OS keychain (per-laptop PAT)
                         │
                         ▼
            git push gitea  (HTTPS via Cloudflare)
```

PATs são descartáveis. Se perdes o keychain (Mac novo, reinstall),
corres o script outra vez — gera PAT novo. Não há nada para fazer
backup; só guardamos coisas insubstituíveis em vaults.

> **Operator SSH key** (`~/.ssh/iedora-homelab-*` que faz `ssh root@homelab`
> + Kamal) é **independente** deste fluxo. Não toca git, não precisa de
> estar registada no Gitea. Cobertura: `docs/deploy/`.

Workflow assumido: **trunk-based**. Pushes ao `main` disparam CI. PRs
opcionais para revisão explícita.

---

## 1. Macos — atalho automatizado

`bun run setup:mac` (corre `scripts/setup-laptop-mac.sh`). Faz tudo em
~30s: cria PAT no Gitea via API, guarda no keychain, switcha o remote
para HTTPS, smoke-test.

Precisa de:
- Username + password do Gitea
- OTP 2FA (se tens 2FA ligada)

---

## 2. Setup manual (Linux / Windows / scripted)

### Remote HTTPS

```bash
git remote set-url gitea https://git.iedora.com/eduvhc/iedora.git
```

### Credential helper

| OS | Comando |
|---|---|
| macOS | `git config --global credential.helper osxkeychain` |
| Linux | `git config --global credential.helper libsecret` |
| Windows | `git config --global credential.helper manager` (built-in com Git for Windows) |

### Gera o PAT

1. Vai a https://git.iedora.com/user/settings/applications
2. **Generate New Token**, scopes: `write:repository`
3. Nome sugerido: `iedora-<os>-<hostname>-<YYYYMMDD-HHMM>`
4. Primeira push pede `Username: eduvhc` e `Password: <PAT>` — o
   keychain cacheia automaticamente. Não precisas de guardar o PAT
   noutro sítio; se perdes, regeneras.

---

## 3. Hooks (auto-instalados)

`bun install` na raiz copia:

- `scripts/git-hooks/pre-commit` → `actionlint` em ficheiros de
  `.gitea/workflows/` alterados.
- `scripts/git-hooks/commit-msg` → valida o subject contra Conventional
  Commits.

Funciona em macOS/Linux/Windows (Git Bash). Bypass de emergência:
`git commit --no-verify`.

### Conventional Commits — formato

```
<type>(<scope>)?!?: <subject ≤ 72 chars>
```

Types: `feat fix perf docs refactor test chore ci build style`.

Exemplos:

```
fix(ci): vitest 5 beta workaround for Bun __esModule bug
feat(menu)!: drop legacy slug API
chore: bump deps
```

---

## 4. Push flow (dia-a-dia)

```bash
git checkout -b fix/something
# ... edits ...
git add -A
git commit -m "fix(scope): mensagem"     # commit-msg hook valida
git push gitea fix/something              # HTTPS, keychain → PAT
```

Trunk-based (push direto ao main):

```bash
git checkout main
git pull --rebase gitea main
git commit -m "..."
git push gitea main
```

PR via API (sem `gh` para Gitea):

```bash
PAT=$(printf 'protocol=https\nhost=git.iedora.com\n' | git credential-osxkeychain get | awk -F= '/^password=/{print $2}')
curl -X POST -H "Authorization: token $PAT" \
  -H "Content-Type: application/json" \
  -d '{"title":"fix: something","head":"fix/something","base":"main"}' \
  https://git.iedora.com/api/v1/repos/eduvhc/iedora/pulls
```

---

## 5. Onboarding novo laptop

1. Instala Git, Bun
2. Configura credential helper (§ 2 tabela)
3. `git clone https://git.iedora.com/eduvhc/iedora.git`
4. `cd iedora && bun install`   (instala hooks)
5. Primeira push: cola PAT na prompt (ou corre `bun run setup:mac` no macOS — automatiza tudo)

---

## 6. Rotação de PAT

A cada 6-12 meses:

1. Vai a https://git.iedora.com/user/settings/applications
2. Revoga o PAT antigo
3. Gera novo
4. Limpa cache local + cola o novo:

```bash
echo "url=https://git.iedora.com" | git credential reject
git ls-remote gitea HEAD   # pede credenciais — cola o PAT novo
```

---

## 7. Troubleshooting

**`fatal: Authentication failed for 'https://git.iedora.com/...'`.** PAT
expirou, foi revogado ou cache stale. Limpa:
`echo "url=https://git.iedora.com" | git credential reject` e tenta de
novo (vai pedir credenciais).

**Commit recusado por `✗ commit message não-conventional`.** Reescreve
o último: `git commit --amend -m "feat(scope): mensagem"`.

**Hooks não correm em Windows.** Garante Git for Windows (Git Bash) e
permissão de execução: `chmod +x .git/hooks/*` em Git Bash.

**`git push` lento dentro de casa.** É HTTPS via Cloudflare round-trip
(≈30-50ms vs 1ms LAN). Imaterial para solo dev — sustenta o trade-off
"funciona em qualquer rede sem ramificações por-localização".
