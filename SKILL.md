# Skill: Universal AI Bridge — operar arquivos e projetos no PC

Você tem acesso ao conjunto de ferramentas do **Universal AI Bridge**, um
servidor MCP que roda na máquina do usuário. Com ele você cria, lê, edita e
executa projetos **dentro de um workspace jaulado** — nunca fora dele.

## Ferramentas disponíveis

- `get_workspace_info` — orientação inicial (raiz, modo de aprovação, shell).
- `list_dir` — lista um diretório.
- `read_file` — lê um arquivo de texto.
- `write_file` — cria/sobrescreve um arquivo.
- `edit_file` — substitui um trecho exato num arquivo existente.
- `make_dir` — cria diretório.
- `move_path` — move/renomeia.
- `create_project` — cria vários arquivos de uma vez (esqueleto de projeto).
- `run_command` — roda **um** comando da allowlist (se o shell estiver ligado).

## Como trabalhar (regras)

1. **Sempre chame `get_workspace_info` primeiro** numa nova conversa, para saber
   a raiz e o modo de aprovação.
2. **Todos os caminhos são relativos ao workspace.** Nunca use caminhos
   absolutos nem `..`; serão bloqueados.
3. **Fluxo de aprovação (`approval: confirm`)** — ações com efeito colateral
   (`write_file`, `edit_file`, `make_dir`, `move_path`, `create_project`,
   `run_command`) exigem dois passos:
   - Primeira chamada → o servidor devolve um `confirm_token` e descreve a ação.
   - Reenvie a **mesma** chamada com os **mesmos argumentos** + `confirm_token`.
   Mostre ao usuário o que vai acontecer antes de confirmar.
4. **Um comando por vez** em `run_command`. Encadeamento (`&&`, `|`, `;`) é
   bloqueado. Só binários da allowlist rodam (`node`, `npm`, `python`, `git`…).
5. **Para criar um projeto novo**, prefira `create_project` com o mapa de
   arquivos, em vez de vários `write_file`.
6. Se algo for bloqueado pela política, **explique o motivo** ao usuário e
   sugira ajustar `config/policy.json` — não tente contornar.

## Exemplo

Usuário: "crie um script Python que imprime olá".

1. `get_workspace_info`
2. `create_project { name: "ola", files: { "main.py": "print('Olá do PC!')" } }`
   → recebe `confirm_token`.
3. Confirma: `create_project { ...mesmos args..., confirm_token: "<t>" }`
4. `run_command { command: "python main.py", cwd: "ola" }` → confirma → mostra a saída.
