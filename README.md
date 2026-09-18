# LEGO Marveldle — projeto final

Jogo em HTML/CSS/JS baseado nos arquivos enviados, com três modos de jogo: **Desafio 6h**, **Prática livre** e **Sombra**.

## Dados
- `data/characters.json` é a fonte editável dos personagens.
- `js/characters.js` é a versão embutida que o navegador carrega diretamente.
- A lista jogável contém **149 personagens/variantes com custo confirmado ou N/A** na tabela fornecida. Os **93 ícones N/D** foram deixados fora do sorteio para não inventar valores.

## Imagens
O ZIP original possui 242 PNGs; todos foram preservados em `assets/characters/`.

## Executar
Abra `index.html` em um navegador moderno. Não há backend.

## Regenerar personagens
Edite `data/characters.json` e rode:

```bash
python scripts/build_characters.py
```

## Observação
O custo em studs é o dado factual trazido pela tabela fornecida. Campos como alinhamento, raça, voo, poder, nível e tamanho são classificações de gameplay utilizadas para as pistas do projeto.
## Interface

A interface é em estilo comic-book: título centralizado, bursts, painel de desafio, busca com bordas pretas fortes, dropdown de sugestões em cards, pontilhado Ben-Day nas células do tabuleiro e um "estouro" em quadrinho quando você acerta o personagem. A busca continua funcionando com mouse e teclado.

## Modos de jogo

- **Desafio 6h** — todo mundo recebe o mesmo personagem secreto, sorteado por uma fórmula determinística (sem resposta "escrita" em lugar nenhum). Ele muda a cada **6 horas**, no mesmo instante para todo mundo (00h/06h/12h/18h UTC), com **8 tentativas** por rodada. É o único modo que conta para as estatísticas.
- **Prática livre** — um personagem é sorteado de verdade (`Math.random`) só para o jogador, sem limite de tentativas. Ao terminar (acertar ou desistir), um botão "Novo personagem"/"Jogar de novo" sorteia outro na hora. Não afeta estatísticas nem o Desafio.
- **Sombra** — igual à Prática (personagem aleatório, tentativas livres), mas a foto do segredo aparece **borrada** acima do tabuleiro como pista visual extra. Um menu inicial (e o botão de trocar modo no topo) deixa escolher entre os três modos a qualquer momento.

## Colunas do tabuleiro

Personagem, Letra (inicial do nome), Alinhamento, Raça, Voo, Custo (studs) e Tamanho (**Fig Pequena** ou **Fig Grande** — as big figs do jogo, como Hulk e Coisa).

As abas no topo da tela alternam entre os dois modos a qualquer momento; cada um guarda seu próprio progresso separadamente (`localStorage`).

## Correções desta versão

- O campo "Poder" (habilidade) de 15 personagens mutantes (Gambit, Beast, Psylocke, Archangel, Pyro, Professor X, Emma Frost, Cyclops, Cyclops (Astonishing), Wolverine, Wolverine (Cowl), Sabretooth, Magneto, Toad, Iceman) estava com o valor `"Mutante"`, que é raça, não tipo de habilidade — isso fazia dois personagens com poderes diferentes aparecerem como "igual" na pista de Poder. Cada um foi reclassificado com sua habilidade real.
- Aunt May tinha Poder `"Nenhum"` (único caso assim no dataset); passou a `"Habilidade"`, como os demais civis.
- Doombot (V-Series) e Venom (Big) estavam marcados como "Herói"; ambos são vilões no jogo original — corrigido.
- The Thing (Future Foundation) estava marcado com "Voo: Sim"; o Thing não voa — corrigido.
- `scripts/validate_characters.py` não aceita mais `"Mutante"`/`"Nenhum"` como valores válidos de Poder, pra não deixar esse tipo de bug voltar.
- Os custos em studs foram conferidos contra os 242 registros do documento-fonte: nenhuma divergência encontrada.

