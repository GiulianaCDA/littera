# littera

Aplicação de repetição espaçada para treinar inglês. **Zero dependências** — usa só o que vem no Node 22.

## Como rodar

Clique duas vezes em `start.cmd`, ou no terminal:

```
cd littera
npm start
```

Depois abra <http://localhost:3000>.

### Prática de escrita com IA

A aba **Praticar** sorteia os cartões e pede uma frase própria para cada expressão. Para habilitar a avaliação, defina `OPENROUTER_API_KEY` no ambiente antes de iniciar o servidor. Opcionalmente, defina `OPENROUTER_MODEL`; o padrão é `openrouter/free`, que seleciona um modelo gratuito disponível no OpenRouter. Modelos gratuitos têm limites de uso e disponibilidade variáveis.

No PowerShell, por exemplo:

```powershell
$env:OPENROUTER_API_KEY = "sua-chave"
npm start
```

Sem a chave, a aba continua disponível, mas a avaliação informa que a configuração está ausente. A chave fica apenas no servidor.

## Como usar

**Estudar** mostra um cartão por vez. Você vê a palavra em inglês, tenta lembrar o
significado, revela a resposta e se avalia. Cada botão mostra quando o cartão vai
voltar.

| Tecla | Ação |
|---|---|
| `espaço` / `enter` | revelar resposta → depois vale como "Bom" |
| `1` | Errei — volta em 10 min |
| `2` | Difícil — intervalo curto |
| `3` | Bom — intervalo normal |
| `4` | Fácil — intervalo longo |
| `p` | repetir o áudio da palavra |
| `e` | ouvir a frase de exemplo |

**Cartões** lista tudo, com busca e exclusão. O botão **Buscar IPA** preenche a
transcrição fonética dos cartões que ainda não têm, consultando o
[dictionaryapi.dev](https://dictionaryapi.dev) (gratuito, sem chave). Rodar de novo
só verifica o que falta.

## Pronúncia

**Voz sintética** (`speechSynthesis`, nativa do navegador) é a única fonte de áudio.
Funciona em 100% dos cartões, inclusive frases inteiras. Toca sozinha quando você
revela a resposta; `p` repete, `e` fala o exemplo. Usa as vozes en-US instaladas no
sistema. O `to` inicial é removido antes de falar, então "to figure out" sai como
*figure out*.

**Transcrição IPA** vem do dicionário e sai em ~50% dos cartões. Palavras isoladas
quase sempre têm; expressões como *on the other hand* não.

O botão **Testar voz** (aba Cartões) mostra quantas vozes em inglês o navegador
expõe, qual foi escolhida, e fala uma frase de teste. Use se o áudio não sair — a
lista completa vai para o console (F12).

> O dicionário também devolve URLs de gravações humanas (Wiktionary), guardadas na
> coluna `audio`. **Elas não são usadas**: em 20/08/2026 o host de mídia
> `api.dictionaryapi.dev/media/...` responde 502 em 100% das tentativas. Se voltar
> a funcionar, dá pra tocar o MP3 e cair na voz sintética como reserva.

**Adicionar** cria um cartão por vez ou importa em lote — uma linha por cartão,
separando os campos com `|`, `;` ou ` - `:

```
reliable | confiável | She is a reliable teammate.
awkward; estranho, sem jeito
to show up - aparecer
```

Já vem com 40 cartões de vocabulário, phrasal verbs e expressões para começar.

## Algoritmo

SM-2 (o mesmo do Anki, simplificado) em `srs.mjs`:

- cada cartão tem um *ease factor* (2.5 inicial, entre 1.3 e 2.8) e um intervalo em dias;
- acertar multiplica o intervalo pelo ease; errar zera o progresso, reduz o ease em 0.2 e reagenda em 10 minutos;
- progressão típica com "Bom": 1 dia → 6 dias → 15 dias → 1 mês → 3 meses → 8 meses.

## Arquitetura

```
server.mjs        API HTTP + arquivos estáticos (módulo http nativo)
db.mjs            schema SQLite + seed inicial (node:sqlite)
srs.mjs           algoritmo de agendamento
data.db           banco (criado na primeira execução)
public/
  index.html      3 telas: estudar, cartões, adicionar
  style.css       tema dark minimalista
  app.js          ~230 linhas de JS puro, sem framework
```

### API

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/queue?limit=40` | cartões vencidos + estatísticas |
| `GET` | `/api/stats` | total, na fila, novos, aprendendo, consolidados, acertos, sequência |
| `GET` | `/api/cards?q=` | lista / busca |
| `POST` | `/api/cards` | `{front, back, example?, tag?}` |
| `POST` | `/api/cards/bulk` | `{text, tag?}` |
| `PUT` | `/api/cards/:id` | edita |
| `DELETE` | `/api/cards/:id` | exclui |
| `POST` | `/api/cards/:id/review` | `{grade: 0..3}` — reagenda |
| `POST` | `/api/cards/:id/reset` | volta o cartão ao estado inicial |
| `POST` | `/api/pronuncia` | busca IPA + áudio dos cartões sem transcrição |

## Backup

Todo o seu progresso está em `data.db`. Copie esse arquivo e você levou tudo.
