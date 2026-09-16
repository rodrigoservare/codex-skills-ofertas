# Skills de ofertas para Codex

Este repositório privado contém as duas skills usadas no fluxo de mapear uma oferta pública e cloná-la para um ambiente local:

- `mapeador-de-esteiras-de-ofertas`
- `clonador-landing-pages`

## Instalação

Depois de receber acesso ao repositório, execute:

```bash
git clone https://github.com/rodrigoservare/codex-skills-ofertas.git
cd codex-skills-ofertas
./install.sh
```

O instalador copia as duas pastas completas para `~/.codex/skills/`. Depois, reinicie ou recarregue o Codex para que as skills apareçam.

## Atualização

Dentro da pasta clonada:

```bash
git pull
./install.sh
```

Se a instalação do Codex usar outro diretório de skills, informe-o assim:

```bash
CODEX_SKILLS_DIR="/caminho/para/.codex/skills" ./install.sh
```

As pastas são mantidas completas porque o mapeador reutiliza referências e scripts do clonador.
