# Feito web: instalação

O Feito web roda com Docker Compose a partir das imagens públicas no GitHub Container Registry. Escolha um dos dois caminhos:

| Caminho | Quando usar | O que você precisa |
| --- | --- | --- |
| [A. Banco no Docker](#a-banco-no-docker) | Testar no seu computador ou publicar num servidor com IP público | Portas 80 e 443 abertas, se for publicar |
| [B. Supabase com Cloudflare Tunnel](#b-supabase-com-cloudflare-tunnel) | Servidor sem portas abertas e banco gerenciado | Projeto Supabase e domínio na Cloudflare |

Os comandos abaixo funcionam em Bash, Zsh e Fish e devem ser executados na raiz do repositório.

## Uso no navegador

As descrições das tarefas aceitam Markdown: títulos, negrito, itálico, listas, links, citações, código e tabelas. Clique na descrição para editar a fonte; ao sair do campo, o texto volta a aparecer formatado. No detalhe, a descrição é salva ao sair do campo; na criação e na edição em linha, confirme o formulário. Listas com caixas de seleção são exibidas como parte do texto; clique na descrição para alterar seus marcadores. A formatação também aparece no desktop e nos detalhes de projetos compartilhados.

Na tela **Entrar**, escolha **Usar neste navegador, sem conta** ou entre na sua conta Feito. O espaço sem conta fica separado da cópia sincronizada da conta. Depois que **Ajustes → Acesso offline** indicar que a preparação terminou, o Feito pode ser reaberto sem conexão. A preparação inicial usa a rede e funciona no build de produção.

O navegador guarda a cópia e as alterações pendentes no IndexedDB. Na conta, as alterações sincronizam quando a conexão volta. A sessão expirada pede um novo login e preserva a fila. A ação **Sair** apaga a cópia dessa conta e pede confirmação se houver pendências. Use **Ajustes → Dados** para exportar um backup do espaço aberto. [Implementação dos espaços no navegador](../../docs/06-browser-local-first-implementation.md#implementa%C3%A7%C3%A3o).

## Requisitos

- Docker com o plugin Docker Compose, Git e OpenSSL.
- Um host `linux/amd64`. Em hosts ARM, como Apple Silicon ou Raspberry Pi, as imagens rodam por emulação e ficam mais lentas.

## Baixar e configurar

```sh
git clone https://github.com/danilo-alm/feito.git
cd feito
```

O script `new-env.sh` gera senhas, segredos e as chaves de criptografia num arquivo privado fora do repositório. Informe o endereço HTTPS pelo qual você vai abrir o Feito:

- No seu computador: `https://localhost:3000`.
- Num servidor: o domínio, por exemplo `https://feito.example.org`.

O arquivo gerado vem com `FEITO_PRODUCT_CACHE_MODE=single-process`, que ativa o cache em RAM para Hoje, Em breve e projetos em instalações com um único processo do Feito. Se mais de um processo atende à instalação ou grava dados do Feito, use `FEITO_PRODUCT_CACHE_MODE=revision`. Para ativar o cache em uma instalação existente de processo único, adicione `FEITO_PRODUCT_CACHE_MODE=single-process` ao arquivo de ambiente e repita o comando `up -d --wait` do caminho escolhido. As condições de operação e o procedimento após alterações administrativas estão no [guia do cache](../../docs/03-operations.md#cache-interno-de-leituras-do-produto).

> [!IMPORTANT]
> Guarde uma cópia segura de `~/.config/feito/feito.env`. Sem as chaves desse arquivo, um backup do banco não pode ser decifrado. Reutilize o mesmo arquivo em todas as atualizações.

## A. Banco no Docker

```sh
scripts/new-env.sh ~/.config/feito/feito.env --origin https://localhost:3000
docker compose -f compose.prod.yaml --env-file ~/.config/feito/feito.env up -d --wait
```

O Compose sobe o PostgreSQL 18, aplica as migrações e coloca o Caddy na frente do app para cuidar do HTTPS.

- **Com domínio**: aponte o DNS para o servidor e deixe as portas 80 e 443 acessíveis. O Caddy emite o certificado automaticamente.
- **Em `localhost`**: o Caddy usa uma autoridade certificadora local. Para o navegador e o [Feito desktop](../desktop/README.md) confiarem nela, exporte o certificado raiz e adicione-o às autoridades confiáveis do sistema:

  ```sh
  docker compose -f compose.prod.yaml --env-file ~/.config/feito/feito.env cp caddy:/data/caddy/pki/authorities/local/root.crt ./feito-local-ca.crt
  ```

Siga para [Criar a primeira conta](#criar-a-primeira-conta).

## B. Supabase com Cloudflare Tunnel

Neste caminho, o `cloudflared` leva o tráfego da Cloudflare até o app e nenhum contêiner publica portas. O banco é um projeto Supabase, com o certificado verificado.

**Gerar a configuração.** No painel do Supabase, abra **Connect → Session pooler → View parameters** e anote o host. A referência do projeto é o trecho após `postgres.` no usuário do pooler.

```sh
scripts/new-env.sh ~/.config/feito/feito.env --origin https://feito.example.org --supabase --project-ref SUA_REFERENCIA --pooler-host HOST_DO_POOLER
```

O Session pooler funciona em redes só com IPv4. Para usar a conexão direta, troque `--supabase` por `--supabase-direct` e omita `--pooler-host`. [Conexões do Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)

**Certificado do banco.** Em **Database Settings → SSL Configuration**, baixe o certificado, salve-o em `~/.config/feito/` e registre o caminho:

```sh
chmod 644 ~/.config/feito/prod-ca-2021.crt
echo "FEITO_POSTGRES_CA_FILE=$HOME/.config/feito/prod-ca-2021.crt" >> ~/.config/feito/feito.env
```

**Token do túnel.** No painel Zero Trust da Cloudflare, abra **Networks → Tunnels**, escolha o túnel e copie o valor após `--token` no comando de instalação do conector.

```sh
printf 'CLOUDFLARE_TUNNEL_TOKEN=%s\n' 'COLE_O_TOKEN' >> ~/.config/feito/feito.env
```

Em **Public Hostname**, aponte o domínio para o serviço `HTTP` com URL `app:3000`. Mantenha só este conector no túnel e ative **Always Use HTTPS** na zona.

**Criar os usuários do banco e subir.** O primeiro comando roda uma vez por banco e pede a senha do banco do Supabase.

```sh
scripts/init-external-db.sh ~/.config/feito/feito.env
docker compose -f compose.prod.tunnel.yaml --env-file ~/.config/feito/feito.env up -d --wait
```

Para confirmar o acesso público, `curl -sS https://feito.example.org/api/health` deve retornar `{"status":"ok"}`. Outros provedores de PostgreSQL e o diagnóstico de erros `502` estão em [Operação](../../docs/03-operations.md#produção-com-postgresql-externo-e-cloudflare-tunnel).

## Criar a primeira conta

O cadastro é fechado: cada conta é criada pela linha de comando. Use o mesmo arquivo Compose do caminho escolhido. O comando pede uma senha provisória, e o Feito solicita a troca no primeiro acesso.

```sh
docker compose -f compose.prod.yaml --env-file ~/.config/feito/feito.env run --rm cli pnpm admin account:create --email voce@example.org
```

No caminho B, troque `compose.prod.yaml` por `compose.prod.tunnel.yaml`. Depois, abra o endereço configurado no navegador.

## Atualizar e parar

Antes de atualizar, faça um [backup](../../docs/03-operations.md#backup-e-restauração-isolada). Para baixar as imagens novas e reiniciar, atualize o repositório e repita o `up`:

```sh
git pull
docker compose -f compose.prod.yaml --env-file ~/.config/feito/feito.env pull
docker compose -f compose.prod.yaml --env-file ~/.config/feito/feito.env up -d --wait --remove-orphans
```

Para parar sem apagar os dados, use `down` no lugar de `up -d --wait`. Rotação de chaves, outras operações da CLI e a execução sem Docker estão em [Operação e manutenção](../../docs/03-operations.md).
