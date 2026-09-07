# Whatsapp-extrator

Ferramenta independente em Node.js + TypeScript para conectar uma conta do WhatsApp, listar grupos e preparar uma migração autorizada de participantes entre grupos.

## Estado atual

- [x] Projeto TypeScript
- [x] Conexão por QR Code
- [x] Sessão persistente local em `data/auth`
- [x] Listagem dos grupos da conta
- [x] Identificação robusta de administrador por aliases PN/LID
- [x] Comparação Grupo A → Grupo B em modo DRY RUN
- [x] Exclusão automática de admins/owner da origem
- [x] Exclusão da própria conta
- [x] Exclusões manuais por número/JID
- [x] Detecção de participante já presente no destino usando aliases `id`, `phoneNumber` e `lid`
- [x] Remoção defensiva de duplicados na origem
- [x] Prévia dos candidatos no terminal
- [x] Relatórios locais JSON e CSV
- [x] Testes automatizados
- [x] CI no GitHub Actions
- [ ] Interface para seleção dos grupos
- [ ] Fila de processamento
- [ ] Execução controlada da adição
- [ ] Confirmação pós-adição no destino
- [ ] Relatório de execução real

## Segurança desta versão

A versão `0.2.0` é deliberadamente **DRY RUN only**. Mesmo que `REAL_RUN=true` seja informado, a ferramenta aborta antes de qualquer operação de escrita no WhatsApp.

A conta conectada também precisa ser administradora tanto do Grupo A quanto do Grupo B para executar a análise.

## Instalação

Requer Node.js 20+.

```bash
npm install
npm run check
npm run dev
```

Na primeira execução, o QR Code aparecerá no terminal. No celular, abra **WhatsApp → Dispositivos conectados → Conectar dispositivo** e escaneie o código.

A sessão é salva localmente em `data/auth/` e não deve ser enviada ao GitHub.

## DRY RUN

PowerShell:

```powershell
$env:SOURCE_GROUP_JID="id-do-grupo-a@g.us"
$env:DESTINATION_GROUP_JID="id-do-grupo-b@g.us"
$env:EXCLUDED_JIDS="5593999990000,5593999990001" # opcional
$env:PREVIEW_LIMIT="5"
npm run dev
```

O programa mostra a composição do filtro, lista os primeiros candidatos e salva relatórios em `reports/`.

Categorias auditadas:

- admins/owner ignorados;
- própria conta ignorada;
- exclusões manuais;
- já presentes no destino;
- duplicados defensivos da origem;
- candidatos finais.

## Próxima etapa

Depois que o DRY RUN for validado com grupos reais, a próxima etapa será implementar uma operação controlada para **um único participante**, com confirmação pós-operação, checkpoint e relatório. Não há código de adição nesta versão.

> Use a ferramenta apenas em grupos nos quais você tenha autorização administrativa e para migrações autorizadas. O projeto não implementa mecanismos para contornar bloqueios, limites, configurações de privacidade ou proteções antispam do WhatsApp.
