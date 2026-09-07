# Whatsapp-extrator

Ferramenta independente em Node.js + TypeScript para conectar uma conta do WhatsApp, listar grupos e preparar uma migração autorizada de participantes entre grupos.

## Estado atual

- [x] Projeto TypeScript
- [x] Conexão por QR Code
- [x] Sessão persistente em `data/auth`
- [x] Listagem dos grupos da conta
- [x] Identificação de administrador
- [x] Comparação Grupo A → Grupo B em modo DRY RUN
- [ ] Interface para seleção dos grupos
- [ ] Fila de processamento
- [ ] Execução controlada da adição
- [ ] Relatório detalhado de sucesso/falha

## Instalação

Requer Node.js 20+.

```bash
npm install
npm run dev
```

Na primeira execução, o QR Code aparecerá no terminal. No celular, abra **WhatsApp → Dispositivos conectados → Conectar dispositivo** e escaneie o código.

A sessão será salva localmente em `data/auth/` e não deve ser enviada ao GitHub.

## DRY RUN

Para comparar dois grupos sem alterar participantes:

```bash
SOURCE_GROUP_JID="id-do-grupo-a@g.us" DESTINATION_GROUP_JID="id-do-grupo-b@g.us" npm run dev
```

O programa mostrará quantos participantes existem na origem, quantos já estão no destino e quantos seriam processados. A versão atual não adiciona ninguém.

## Próxima etapa

Implementar uma interface de seleção e, somente depois de validar o DRY RUN, a fila de processamento para adicionar participantes em operações autorizadas.

> Use a ferramenta apenas em grupos nos quais você tenha autorização administrativa e para migrações autorizadas. O projeto não implementa mecanismos para contornar bloqueios, limites ou proteções antispam do WhatsApp.
