# Skill: Universal AI Bridge — operar arquivos, projetos e terminal no PC

Você tem acesso ao **Universal AI Bridge**, um servidor MCP na máquina do
usuário. Com ele você cria, lê, edita e executa projetos **dentro de um
workspace jaulado** — nunca fora dele.

## Ferramentas

**Arquivos e busca (sempre disponíveis)**
- `get_workspace_info` — orientação inicial (raiz, modo, aprovação, shell/docker).
- `list_dir` · `read_file` (offset_lines/limit_lines/tail_lines p/ arquivos grandes) · `read_multiple_files` · `get_file_info`.
- `write_file` · `edit_file` (replace_all, is_regex) · `make_dir` · `move_path` · `create_project`.
- `search_files` (por nome) · `search_content` (grep/regex dentro dos arquivos).
- `read_media_file` (imagem/binário → imagem ou base64).
- `read_pdf` · `read_docx` · `read_sheet` (PDF/DOCX→texto, XLSX/CSV→linhas JSON; com offset/limit).
- `write_sheet` · `write_docx` · `write_pdf` (criar XLSX/CSV, DOCX e PDF; sujeito a aprovação).
- `watch_start` · `watch_poll` · `watch_stop` (monitorar mudanças em arquivos).
- `get_policy` (ver allowlist/denylist e modo).

**Terminal e processos (só quando `shell_enabled: true`)**
- `run_command` — comando curto e síncrono, **sem shell**. Prefira `program` (ex.: "npm") + `args` (ex.: ["install"]); `command` ainda funciona mas é convertido por parser restrito.
- `run_job` — inicia um comando longo (mesma API program+args) e devolve `job_id`.
- `job_status` — estado de um job (ou lista todos).
- `job_output` — saída incremental; passe os cursores retornados para "streamar".
- `job_write` — envia texto ao stdin de um job (processos interativos).
- `job_cancel` — encerra o job e toda a árvore de processos.
- `list_processes` — lista processos do sistema (filtro opcional).
- `kill_process` — encerra um processo pelo PID (e sua árvore).
- `pty_start` · `pty_output` · `pty_write` · `pty_resize` · `pty_kill` — terminal
  interativo REAL (apps full-screen: vim, htop, REPLs). Requer @lydell/node-pty.
- `set_env` · `unset_env` · `list_env` — variáveis de ambiente da sessão (aplicadas a run_command/run_job).

**Modo admin**
- `docker` — roda `docker <args>` como job.
- `manage_allowlist` — adiciona/remove binário da allowlist (nunca libera a denylist).
- `download_to_file` — baixa uma URL http(s) pública para o workspace (bloqueia IP privado/loopback).

**Docker (só quando `docker_enabled: true`, modo admin)**
- `docker` — roda `docker <args>` como job (ex.: `build -t app .`, `compose up -d`).

## Regras

1. **Chame `get_workspace_info` primeiro.** Veja `mode`, `approval`, `shell_enabled`, `docker_enabled`.
2. **Caminhos são relativos ao workspace.** Nunca use `..` nem caminhos absolutos.
3. **Aprovação.** Ações com efeito colateral podem exigir um segundo passo:
   - `confirm`: a chamada devolve um `confirm_token`; repita a MESMA chamada com ele.
   - `local`: o código aparece **só no console do usuário**; peça o código a ele.
   Mostre ao usuário o que vai acontecer antes de confirmar.
4. **Um comando por vez.** Encadeamento e redirecionamento (`&& | ; > <`) são bloqueados. Só binários da allowlist rodam.
5. **Tarefas longas** (build, dev server, testes que ficam rodando): use `run_job` + `job_output`, e `job_cancel` para parar.
6. **Interativo:** use `job_write` para responder prompts do processo.
7. Se algo for bloqueado pela política, **explique** e sugira ajustar `config/policy.json` — não tente contornar.

## Exemplos

**Criar e rodar um script**
1. `get_workspace_info`
2. `create_project { name:"ola", files:{ "main.py":"print('Olá do PC!')" } }` → confirma
3. `run_command { command:"python main.py", cwd:"ola" }` → confirma → mostra saída

**Rodar um dev server longo e acompanhar**
1. `run_job { command:"npm run dev", cwd:"meu-app" }` → confirma → `job_id`
2. `job_output { job_id, since_stdout:0, since_stderr:0 }` (repita com os cursores)
3. `job_cancel { job_id }` quando terminar
