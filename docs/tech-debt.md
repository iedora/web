# Tech debt

- Kamal usa builder remoto SSH para build — lento para dev. Ideal:
  build local + push + `kamal deploy`
- `infra-bootstrap/` são scripts bash — sem testes, sem idempotência
  garantida
- `docs/deploy/*` referenciam `bin/dev-stack` que foi removido
