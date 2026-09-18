/* ===========================================================================
   Lego Marveldle — lógica do jogo
   ===========================================================================
   Depende de CHARACTERS (definido em characters.js, carregado antes deste
   arquivo).

   DOIS MODOS DE JOGO
   -------------------------------
   1) DESAFIO 6H — não existe nenhuma resposta "escrita" no código. O jogo:
      1) calcula quantos períodos de 6 horas se passaram desde um instante
         de referência fixo;
      2) usa esse número para embaralhar (de forma determinística, via um
         gerador pseudoaleatório com semente) a lista inteira de personagens;
      3) percorre esse embaralhado período a período, sem repetir nenhum
         personagem até passar por toda a lista — quando a lista acaba, um
         novo embaralhamento (a próxima "temporada") começa.
      Como o embaralhamento depende só do relógio e de uma fórmula
      matemática, ninguém — nem quem programou o jogo — sabe qual é o
      personagem do período sem rodar o cálculo. E como todo jogador roda o
      mesmo cálculo pro mesmo período de 6 horas, todo mundo recebe o mesmo
      desafio ao mesmo tempo, em qualquer fuso horário.

   2) PRÁTICA LIVRE — um personagem é sorteado de verdade (Math.random) só
      para o jogador, sem limite de tentativas e sem hora certa. Ao acertar
      (ou desistir), o jogador pode pedir um personagem novo a qualquer
      momento. Esse modo não altera as estatísticas do Desafio.
   =========================================================================== */

(() => {
  "use strict";

  /* ---------------------------------------------------------------------
     Config
     --------------------------------------------------------------------- */
  const CHALLENGE_MAX_TRIES = 8;
  const RESET_PERIOD_HOURS = 6; // o personagem do Desafio muda a cada 6 horas
  const RESET_PERIOD_MS = RESET_PERIOD_HOURS * 3600000;
  const EPOCH_MS = Date.UTC(2024, 0, 1, 0, 0, 0); // referência fixa (1 jan 2024 UTC)
  const STORAGE_PREFIX = "legoMarveldle_";

  // Categoria de tamanho: as únicas "Big Figs" de LEGO Marvel Super Heroes
  // são estas oito — o resto do elenco (mesmo os visualmente grandes, como
  // She-Hulk, Rhino ou o Hulkbuster) joga como minifigura comum.
  const BIG_FIGS = new Set([
    "Abomination",
    "Blob",
    "Colossus",
    "The Hulk",
    "Juggernaut",
    "The Thing",
    "The Thing (Future Foundation)",
    "Green Goblin (Ultimate)",
  ]);
  CHARACTERS.forEach((c) => {
    c.sizeCategory = BIG_FIGS.has(c.name) ? "Fig Grande" : "Fig Pequena";
  });

  const COLUMNS = [
    { key: "photo",    label: "Personagem", type: "photo" },
    { key: "letter",   label: "Letra",      type: "letter" },
    { key: "faction",  label: "Alinhamento", type: "category" },
    { key: "race",     label: "Raça",       type: "category", groupKey: "raceGroup" },
    { key: "flight",   label: "Voo",        type: "category" },
    { key: "coins",    label: "Custo (studs)", type: "numeric" },
    { key: "sizeCategory", label: "Tamanho", type: "category" },
  ];

  /* ---------------------------------------------------------------------
     RNG determinístico (mulberry32) — mesma semente = mesma sequência
     --------------------------------------------------------------------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(array, seed) {
    const rng = mulberry32(seed);
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ---------------------------------------------------------------------
     Período do desafio (a cada 6 horas)
     -------------------------------------------------------------------
     O personagem secreto do Desafio muda a cada 6 horas, no mesmo
     instante para todo mundo (não depende do fuso de quem está
     jogando). Contamos quantos blocos de 6 horas já se passaram desde
     um instante de referência fixo (EPOCH_MS) e usamos esse número
     como semente do sorteio.
     --------------------------------------------------------------------- */
  function currentPeriodIndex(nowMs) {
    return Math.floor((nowMs - EPOCH_MS) / RESET_PERIOD_MS);
  }

  function periodStartMs(periodIndex) {
    return EPOCH_MS + periodIndex * RESET_PERIOD_MS;
  }

  function getCurrentChallenge() {
    const nowMs = Date.now();
    const periodIndex = currentPeriodIndex(nowMs); // conta contínua de blocos de 6h desde a referência
    const n = CHARACTERS.length;
    const cycle = Math.floor(periodIndex / n);
    const posInCycle = ((periodIndex % n) + n) % n;
    // semente única por temporada (cycle) — cada temporada é um embaralhado novo
    const order = seededShuffle(CHARACTERS, 1000003 * (cycle + 1));
    return {
      character: order[posInCycle],
      periodIndex,
      puzzleNumber: periodIndex + 1,
      periodKey: String(periodIndex),
      resetAt: new Date(periodStartMs(periodIndex) + RESET_PERIOD_MS),
    };
  }

  /* ---------------------------------------------------------------------
     Modo Prática — personagem aleatório de verdade, sem período fixo
     --------------------------------------------------------------------- */
  function randomCharacter(excludeId) {
    if (CHARACTERS.length <= 1) return CHARACTERS[0];
    let pick;
    do {
      pick = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
    } while (pick.id === excludeId);
    return pick;
  }

  function newPracticeState(excludeId) {
    return {
      secretId: randomCharacter(excludeId).id,
      guessIds: [],
      finished: false,
      won: false,
      statsRecorded: false,
    };
  }

  /* ---------------------------------------------------------------------
     Utilitários
     --------------------------------------------------------------------- */
  function normalize(str) {
    return (str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function byId(id) { return CHARACTERS.find((c) => c.id === id) || null; }

  // Letra inicial do nome (pista alfabética) — calculada a partir do nome,
  // não precisa existir no data original.
  function firstLetter(character) {
    return (character && character.name ? character.name : "").trim().charAt(0).toUpperCase();
  }

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function defaultStats(maxTries) {
    return {
      played: 0,
      wins: 0,
      currentStreak: 0,
      maxStreak: 0,
      distribution: new Array(maxTries).fill(0),
      lastFinishedPeriodIndex: null,
    };
  }

  /* ---------------------------------------------------------------------
     Estado
     --------------------------------------------------------------------- */
  const VALID_MODES = ["challenge", "practice", "shadow"];
  let mode = loadJSON("mode", "challenge"); // "challenge" | "practice" | "shadow"
  if (!VALID_MODES.includes(mode)) mode = "challenge";

  const today = getCurrentChallenge();
  const challengeSecret = today.character;

  let showPhoto = loadJSON("showPhoto", true);
  let stats = loadJSON("stats", defaultStats(CHALLENGE_MAX_TRIES));

  let challengeState = loadJSON("state_" + today.periodKey, null);
  if (!challengeState || challengeState.secretId !== challengeSecret.id) {
    challengeState = {
      secretId: challengeSecret.id,
      periodIndex: today.periodIndex,
      guessIds: [],
      finished: false,
      won: false,
      statsRecorded: false,
    };
  }

  let practiceState = loadJSON("practiceState", null);
  if (!practiceState || !byId(practiceState.secretId)) {
    practiceState = newPracticeState(null);
  }

  // Modo Sombra usa a mesma mecânica da Prática (personagem aleatório,
  // tentativas livres), mas guarda seu próprio progresso e mostra a
  // silhueta/versão borrada do segredo como pista extra.
  let shadowState = loadJSON("shadowState", null);
  if (!shadowState || !byId(shadowState.secretId)) {
    shadowState = newPracticeState(null);
  }

  // "Contexto" ativo — tudo abaixo trabalha em cima do modo atual (Desafio
  // 6h, Prática livre ou Sombra), sem duplicar a lógica de comparação,
  // renderização ou envio de palpite.
  function activeSecret() {
    if (mode === "practice") return byId(practiceState.secretId);
    if (mode === "shadow") return byId(shadowState.secretId);
    return challengeSecret;
  }
  function activeState() {
    if (mode === "practice") return practiceState;
    if (mode === "shadow") return shadowState;
    return challengeState;
  }
  function activeMaxTries() { return mode === "challenge" ? CHALLENGE_MAX_TRIES : Infinity; }
  function isFreeMode() { return mode === "practice" || mode === "shadow"; }

  function persistMode() { saveJSON("mode", mode); }
  function persistChallengeState() { saveJSON("state_" + today.periodKey, challengeState); }
  function persistPracticeState() { saveJSON("practiceState", practiceState); }
  function persistShadowState() { saveJSON("shadowState", shadowState); }
  function persistState() {
    if (mode === "practice") return persistPracticeState();
    if (mode === "shadow") return persistShadowState();
    return persistChallengeState();
  }
  function persistStats() { saveJSON("stats", stats); }
  function persistShowPhoto() { saveJSON("showPhoto", showPhoto); }

  /* ---------------------------------------------------------------------
     DOM refs
     --------------------------------------------------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const input = $("#guess-input");
  const suggestionsEl = $("#suggestions");
  const comboboxEl = $("#combobox");
  const btnGuess = $("#btn-guess");
  const triesLabel = $("#tries-label");
  const gameOverBadge = $("#game-over-badge");
  const boardHeader = $("#board-header");
  const boardRows = $("#board-rows");
  const togglePhoto = $("#toggle-photo");
  const issueBadge = $("#issue-badge");

  const btnStats = $("#btn-stats");
  const btnSettings = $("#btn-settings");
  const btnHelp = $("#btn-help");
  const btnShareStats = $("#btn-share");
  const btnShareResult = $("#btn-share-2");

  const btnModes = $("#btn-modes");
  const modeIndicator = $("#mode-indicator");
  const modeIndicatorIcon = $("#mode-indicator-icon");
  const modeIndicatorLabel = $("#mode-indicator-label");
  const modeCards = document.querySelectorAll(".mode-card");

  const challengeRibbon = $("#challenge-ribbon");
  const practiceRibbon = $("#practice-ribbon");
  const shadowRibbon = $("#shadow-ribbon");
  const resetChip = $("#reset-chip");
  const freeChip = $("#free-chip");
  const freeChipIcon = $("#free-chip-icon");
  const freeChipText = $("#free-chip-text");
  const btnNewFree = $("#btn-new-free");
  const taglineDetail = $("#tagline-detail");

  const shadowHint = $("#shadow-hint");
  const shadowHintImg = $("#shadow-hint-img");

  let activeSuggestionIndex = -1;
  let currentSuggestions = [];

  /* ---------------------------------------------------------------------
     Toast
     --------------------------------------------------------------------- */
  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  /* ---------------------------------------------------------------------
     Render: cabeçalho da tabela
     --------------------------------------------------------------------- */
  const GRID_TEMPLATE = ["144px", "64px", "118px", "118px", "84px", "128px", "118px"].join(" ");

  function renderHeader() {
    boardHeader.innerHTML = "";
    boardHeader.style.gridTemplateColumns = GRID_TEMPLATE;
    COLUMNS.forEach((col) => {
      const div = document.createElement("div");
      div.className = "col-label";
      div.textContent = col.label;
      boardHeader.appendChild(div);
    });
  }

  /* ---------------------------------------------------------------------
     Comparação de atributos
     --------------------------------------------------------------------- */
  function compareCategory(col, guessChar, secretChar) {
    const gVal = guessChar[col.key];
    const sVal = secretChar[col.key];
    if (gVal === sVal) return { cls: "correct" };
    if (col.groupKey && guessChar[col.groupKey] === secretChar[col.groupKey]) {
      return { cls: "partial" };
    }
    return { cls: "wrong" };
  }

  function compareNumeric(col, guessChar, secretChar) {
    const gVal = guessChar[col.key];
    const sVal = secretChar[col.key];
    if (gVal === sVal) return { cls: "correct", arrow: null };
    if (gVal == null || sVal == null) return { cls: "wrong", arrow: null };
    return { cls: "wrong", arrow: sVal > gVal ? "up" : "down" };
  }

  // Letra inicial: mesma lógica de seta que os campos numéricos, mas
  // comparando ordem alfabética (A antes de B, etc.).
  function compareLetter(guessChar, secretChar) {
    const g = firstLetter(guessChar);
    const s = firstLetter(secretChar);
    if (g === s) return { cls: "correct", arrow: null };
    return { cls: "wrong", arrow: s > g ? "up" : "down" };
  }

  function formatValue(col, value) {
    if (col.key === "coins") return value == null ? "N/A" : value.toLocaleString("pt-BR");
    return value;
  }

  /* ---------------------------------------------------------------------
     Render: uma linha de palpite
     --------------------------------------------------------------------- */
  function buildRow(guessChar) {
    const row = document.createElement("div");
    row.className = "guess-row";
    row.style.gridTemplateColumns = GRID_TEMPLATE;

    COLUMNS.forEach((col) => {
      const cell = document.createElement("div");
      cell.className = "cell";

      const stud = document.createElement("span");
      stud.className = "stud";
      cell.appendChild(stud);

      if (col.type === "photo") {
        cell.classList.add("photo-cell");

        const badge = document.createElement("span");
        badge.className = "guess-badge";
        badge.textContent = `#${activeState().guessIds.indexOf(guessChar.id) + 1}`;
        cell.appendChild(badge);

        const media = document.createElement("div");
        media.className = "photo-media";
        if (showPhoto) {
          const img = document.createElement("img");
          img.src = guessChar.img;
          img.alt = guessChar.name;
          img.loading = "lazy";
          media.appendChild(img);
        } else {
          const span = document.createElement("span");
          span.className = "hidden-photo";
          span.textContent = "🧱";
          span.title = guessChar.name;
          media.appendChild(span);
        }
        cell.appendChild(media);

        const name = document.createElement("span");
        name.className = "guess-name";
        name.textContent = guessChar.name;
        cell.appendChild(name);
      } else if (col.type === "category") {
        const res = compareCategory(col, guessChar, activeSecret());
        cell.classList.add(res.cls);
        const val = document.createElement("span");
        val.className = "cell-value";
        val.textContent = guessChar[col.key];
        val.title = String(guessChar[col.key] ?? "N/A");
        cell.appendChild(val);
      } else if (col.type === "numeric" || col.type === "letter") {
        const isLetter = col.type === "letter";
        const res = isLetter ? compareLetter(guessChar, activeSecret()) : compareNumeric(col, guessChar, activeSecret());
        cell.classList.add(res.cls);
        if (isLetter) cell.classList.add("letter-cell");
        const val = document.createElement("span");
        val.className = "cell-value";
        val.textContent = isLetter ? firstLetter(guessChar) : formatValue(col, guessChar[col.key]);
        val.title = String(val.textContent);
        cell.appendChild(val);
        if (res.arrow) {
          const arrow = document.createElement("span");
          arrow.className = "arrow";
          arrow.textContent = res.arrow === "up" ? "↑" : "↓";
          cell.appendChild(arrow);
        }
      }
      row.appendChild(cell);
    });

    return row;
  }

  function renderBoard() {
    boardRows.innerHTML = "";
    activeState().guessIds.forEach((id) => {
      const c = byId(id);
      if (c) boardRows.appendChild(buildRow(c));
    });
  }

  /* ---------------------------------------------------------------------
     Estado da UI (tentativas, badge, input travado)
     --------------------------------------------------------------------- */
  function refreshMeta() {
    const state = activeState();
    const maxTries = activeMaxTries();
    const used = state.guessIds.length;
    const triesSuffix = Number.isFinite(maxTries) ? ` de ${maxTries}` : "";

    if (state.finished) {
      triesLabel.textContent = state.won
        ? `Acertou em ${used}${triesSuffix}`
        : `Não foi dessa vez — ${used}${triesSuffix}`;
      gameOverBadge.classList.remove("hidden");
      gameOverBadge.classList.toggle("win", state.won);
      gameOverBadge.classList.toggle("lose", !state.won);
      gameOverBadge.textContent = state.won ? "Vitória" : "Fim de jogo";
      input.disabled = true;
      btnGuess.disabled = true;
      input.placeholder = isFreeMode()
        ? "Clique em “Novo personagem” para jogar de novo!"
        : "Volte em algumas horas para um novo desafio!";
    } else {
      triesLabel.textContent = `Tentativa ${used + 1}${triesSuffix}`;
      gameOverBadge.classList.add("hidden");
      input.disabled = false;
      btnGuess.disabled = false;
      input.placeholder = "Digite o nome de um personagem…";
    }
  }

  /* ---------------------------------------------------------------------
     Autocomplete
     --------------------------------------------------------------------- */
  function closeSuggestions() {
    suggestionsEl.hidden = true;
    suggestionsEl.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    activeSuggestionIndex = -1;
    currentSuggestions = [];
  }

  function renderSuggestions(query) {
    const norm = normalize(query);
    suggestionsEl.innerHTML = "";
    activeSuggestionIndex = -1;

    if (!norm) { closeSuggestions(); return; }

    const guessed = new Set(activeState().guessIds);
    const results = CHARACTERS
      .filter((c) => !guessed.has(c.id) && normalize(c.name).includes(norm))
      .sort((a, b) => normalize(a.name).indexOf(norm) - normalize(b.name).indexOf(norm))
      .slice(0, 8);

    currentSuggestions = results;

    if (results.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Nenhum personagem encontrado";
      suggestionsEl.appendChild(li);
    } else {
      results.forEach((c, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.dataset.id = c.id;
        li.dataset.index = String(i);

        const img = document.createElement("img");
        img.src = c.img;
        img.alt = "";
        img.loading = "lazy";

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = c.name;

        li.appendChild(img);
        li.appendChild(name);
        li.addEventListener("click", () => selectSuggestion(c));
        suggestionsEl.appendChild(li);
      });
    }

    suggestionsEl.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function selectSuggestion(character) {
    input.value = character.name;
    input.dataset.selectedId = character.id;
    closeSuggestions();
    input.focus();
  }

  function highlightSuggestion(index) {
    const items = suggestionsEl.querySelectorAll("li[role='option']");
    items.forEach((li) => li.classList.remove("active"));
    if (index >= 0 && index < items.length) {
      items[index].classList.add("active");
      items[index].scrollIntoView({ block: "nearest" });
      activeSuggestionIndex = index;
    }
  }

  input.addEventListener("input", () => {
    delete input.dataset.selectedId;
    renderSuggestions(input.value);
  });

  input.addEventListener("keydown", (e) => {
    const items = suggestionsEl.hidden ? [] : currentSuggestions;
    if (e.key === "ArrowDown") {
      if (items.length) {
        e.preventDefault();
        highlightSuggestion(Math.min(activeSuggestionIndex + 1, items.length - 1));
      }
    } else if (e.key === "ArrowUp") {
      if (items.length) {
        e.preventDefault();
        highlightSuggestion(Math.max(activeSuggestionIndex - 1, 0));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items.length && activeSuggestionIndex >= 0) {
        selectSuggestion(items[activeSuggestionIndex]);
      } else {
        submitGuess();
      }
    } else if (e.key === "Escape") {
      closeSuggestions();
    }
  });

  document.addEventListener("click", (e) => {
    if (!comboboxEl.contains(e.target)) closeSuggestions();
  });

  /* ---------------------------------------------------------------------
     Envio de palpite
     --------------------------------------------------------------------- */
  function shakeInput() {
    input.classList.remove("shake");
    void input.offsetWidth; // reflow p/ reiniciar a animação
    input.classList.add("shake");
  }

  function resolveTypedCharacter() {
    if (input.dataset.selectedId) {
      const c = byId(input.dataset.selectedId);
      if (c && normalize(c.name) === normalize(input.value)) return c;
    }
    const norm = normalize(input.value);
    if (!norm) return null;
    return CHARACTERS.find((c) => normalize(c.name) === norm) || null;
  }

  function submitGuess() {
    const state = activeState();
    const maxTries = activeMaxTries();
    if (state.finished) return;

    const character = resolveTypedCharacter();
    if (!character) {
      toast("Personagem não encontrado. Escolha um da lista.");
      shakeInput();
      return;
    }
    if (state.guessIds.includes(character.id)) {
      toast("Você já tentou esse personagem.");
      shakeInput();
      return;
    }

    state.guessIds.push(character.id);
    const rowEl = buildRow(character);
    boardRows.appendChild(rowEl);

    input.value = "";
    delete input.dataset.selectedId;
    closeSuggestions();

    if (character.id === activeSecret().id) {
      state.finished = true;
      state.won = true;
      addWinBurst(rowEl);
    } else if (Number.isFinite(maxTries) && state.guessIds.length >= maxTries) {
      state.finished = true;
      state.won = false;
    }

    if (state.finished && !state.statsRecorded) {
      recordStats();
      state.statsRecorded = true;
    }

    persistState();
    refreshMeta();

    if (state.finished) {
      setTimeout(openResultModal, 550);
    }

    input.focus();
  }

  /* ---------------------------------------------------------------------
     Estouro em quadrinho quando acerta o personagem secreto
     --------------------------------------------------------------------- */
  const WIN_PHRASES = ["ACERTOU!", "BINGO!", "TCHARAM!", "É ISSO AÍ!", "SHAZAM!"];
  function addWinBurst(rowEl) {
    const photoCell = rowEl && rowEl.querySelector(".photo-cell");
    if (!photoCell) return;
    const el = document.createElement("span");
    el.className = "win-burst";
    el.textContent = WIN_PHRASES[Math.floor(Math.random() * WIN_PHRASES.length)];
    photoCell.appendChild(el);
  }

  btnGuess.addEventListener("click", submitGuess);

  /* ---------------------------------------------------------------------
     Estatísticas
     --------------------------------------------------------------------- */
  function recordStats() {
    if (mode !== "challenge") return; // o modo Prática não altera as estatísticas
    if (stats.lastFinishedPeriodIndex === today.periodIndex) return; // já contado
    stats.played += 1;
    if (challengeState.won) {
      stats.wins += 1;
      stats.currentStreak += 1;
      stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
      const idx = Math.min(challengeState.guessIds.length, CHALLENGE_MAX_TRIES) - 1;
      stats.distribution[idx] += 1;
    } else {
      stats.currentStreak = 0;
    }
    stats.lastFinishedPeriodIndex = today.periodIndex;
    persistStats();
  }

  function renderStatsModal() {
    const winRate = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
    $("#stat-played").textContent = String(stats.played);
    $("#stat-winrate").textContent = `${winRate}%`;
    $("#stat-streak").textContent = String(stats.currentStreak);
    $("#stat-max-streak").textContent = String(stats.maxStreak);

    const statsNote = $("#stats-practice-note");
    if (statsNote) statsNote.classList.toggle("hidden", mode === "challenge");

    const chart = $("#dist-chart");
    chart.innerHTML = "";
    const max = Math.max(1, ...stats.distribution);
    const todayIdx = challengeState.finished && challengeState.won ? challengeState.guessIds.length - 1 : -1;

    stats.distribution.forEach((count, i) => {
      const row = document.createElement("div");
      row.className = "dist-row" + (i === todayIdx ? " today" : "");

      const num = document.createElement("span");
      num.className = "dist-num";
      num.textContent = String(i + 1);

      const wrap = document.createElement("span");
      wrap.className = "dist-bar-wrap";

      const bar = document.createElement("span");
      bar.className = "dist-bar";
      const pct = Math.max(8, Math.round((count / max) * 100));
      bar.style.width = pct + "%";
      bar.textContent = String(count);

      wrap.appendChild(bar);
      row.appendChild(num);
      row.appendChild(wrap);
      chart.appendChild(row);
    });

    btnShareStats.classList.toggle("hidden", !(mode === "challenge" && challengeState.finished));
  }

  /* ---------------------------------------------------------------------
     Modal de resultado
     --------------------------------------------------------------------- */
  function renderResultModal() {
    const state = activeState();
    const secret = activeSecret();
    const maxTries = activeMaxTries();
    const triesSuffix = Number.isFinite(maxTries) ? ` de ${maxTries}` : "";
    const body = $("#result-body");
    body.innerHTML = "";

    const title = document.createElement("div");
    title.className = "result-title " + (state.won ? "win" : "lose");
    title.textContent = state.won
      ? `Você acertou em ${state.guessIds.length}${triesSuffix}!`
      : "Você não descobriu dessa vez.";
    body.appendChild(title);

    const img = document.createElement("img");
    img.src = secret.img;
    img.alt = secret.name;
    body.appendChild(img);

    const p = document.createElement("p");
    const quando = isFreeMode() ? "dessa rodada" : "de hoje";
    p.innerHTML = `O personagem secreto ${quando} era <strong>${secret.name}</strong> (${secret.faction}, ${secret.team}).`;
    body.appendChild(p);

    const p2 = document.createElement("p");
    p2.className = "muted small";
    p2.textContent = isFreeMode()
      ? "Clique em “Novo personagem” para jogar de novo, quando quiser."
      : "Um novo desafio chega a cada 6 horas — o mesmo para todo mundo.";
    body.appendChild(p2);

    if (isFreeMode()) {
      const btnAgain = document.createElement("button");
      btnAgain.type = "button";
      btnAgain.className = "share-btn";
      btnAgain.textContent = "Jogar de novo";
      btnAgain.addEventListener("click", () => {
        closeModal("modal-result");
        startNewFreeRound();
      });
      body.appendChild(btnAgain);
    }
  }

  /* ---------------------------------------------------------------------
     Compartilhar
     --------------------------------------------------------------------- */
  function emojiForCategory(cls) {
    if (cls === "correct") return "🟩";
    if (cls === "partial") return "🟨";
    return "⬛";
  }
  function emojiForNumeric(res) {
    if (res.cls === "correct") return "🟩";
    return res.arrow === "up" ? "🔼" : "🔽";
  }

  function buildShareText() {
    const state = activeState();
    const secret = activeSecret();
    const maxTries = activeMaxTries();
    const used = state.guessIds.length;
    const maxLabel = Number.isFinite(maxTries) ? String(maxTries) : "∞";
    const scoreLabel = state.won ? `${used}/${maxLabel}` : `X/${maxLabel}`;
    let heading;
    if (mode === "practice") heading = `🧱 Lego Marveldle (Prática) — ${scoreLabel}`;
    else if (mode === "shadow") heading = `🧱 Lego Marveldle (Sombra) — ${scoreLabel}`;
    else heading = `🧱 Lego Marveldle #${today.puzzleNumber} — ${scoreLabel}`;
    const lines = [heading, ""];

    state.guessIds.forEach((id) => {
      const c = byId(id);
      const rowEmojis = COLUMNS
        .filter((col) => col.type !== "photo")
        .map((col) => {
          if (col.type === "category") return emojiForCategory(compareCategory(col, c, secret).cls);
          if (col.type === "letter") return emojiForNumeric(compareLetter(c, secret));
          return emojiForNumeric(compareNumeric(col, c, secret));
        })
        .join("");
      lines.push(rowEmojis);
    });

    let footer;
    if (mode === "practice") footer = "LEGO Marveldle — modo prática de LEGO Marvel Super Heroes";
    else if (mode === "shadow") footer = "LEGO Marveldle — modo sombra de LEGO Marvel Super Heroes";
    else footer = "LEGO Marveldle — desafio de 6 em 6 horas de LEGO Marvel Super Heroes";
    lines.push("", footer);
    return lines.join("\n");
  }

  async function shareResult() {
    const text = buildShareText();
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch {
      /* usuário cancelou o share nativo — cai pro clipboard abaixo */
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("Resultado copiado!");
    } catch {
      window.prompt("Copie seu resultado:", text);
    }
  }

  btnShareStats.addEventListener("click", shareResult);
  btnShareResult.addEventListener("click", shareResult);

  /* ---------------------------------------------------------------------
     Modais genéricos
     --------------------------------------------------------------------- */
  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("hidden");
    if (id === "modal-stats") renderStatsModal();
    if (id === "modal-result") renderResultModal();
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  }
  function openResultModal() { openModal("modal-result"); }

  document.querySelectorAll(".modal-close").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".modal-overlay:not(.hidden)").forEach((o) => o.classList.add("hidden"));
  });

  btnStats.addEventListener("click", () => openModal("modal-stats"));
  btnHelp.addEventListener("click", () => openModal("modal-help"));
  btnSettings.addEventListener("click", () => openModal("modal-settings"));

  /* ---------------------------------------------------------------------
     Configurações
     --------------------------------------------------------------------- */
  togglePhoto.checked = showPhoto;
  togglePhoto.addEventListener("change", () => {
    showPhoto = togglePhoto.checked;
    persistShowPhoto();
    renderBoard(); // reconstrói as linhas já jogadas com/sem foto
  });

  /* ---------------------------------------------------------------------
     Contagem regressiva até o próximo desafio (21h, horário de Brasília)
     --------------------------------------------------------------------- */
  const resetCountdownEl = $("#reset-countdown");
  let reloadQueued = false;

  function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  function tickResetCountdown() {
    if (!resetCountdownEl || mode !== "challenge") return;
    const msLeft = today.resetAt.getTime() - Date.now();
    if (msLeft <= 0) {
      resetCountdownEl.textContent = "00:00:00";
      if (!reloadQueued) {
        reloadQueued = true;
        // dá uma folguinha pro relógio do servidor/CDN assentar antes de recarregar
        setTimeout(() => window.location.reload(), 2000);
      }
      return;
    }
    resetCountdownEl.textContent = formatCountdown(msLeft);
  }

  /* ---------------------------------------------------------------------
     Modos livres (Prática / Sombra) — novo personagem sob demanda
     --------------------------------------------------------------------- */
  function startNewFreeRound() {
    if (mode === "shadow") {
      const previousId = shadowState.secretId;
      shadowState = newPracticeState(previousId);
      persistShadowState();
    } else {
      const previousId = practiceState.secretId;
      practiceState = newPracticeState(previousId);
      persistPracticeState();
    }
    closeSuggestions();
    input.value = "";
    delete input.dataset.selectedId;
    renderBoard();
    refreshMeta();
    updateShadowHint();
    input.focus();
    toast("Novo personagem sorteado. Boa sorte!");
  }

  if (btnNewFree) btnNewFree.addEventListener("click", startNewFreeRound);

  /* ---------------------------------------------------------------------
     Modo Sombra — o segredo aparece borrado acima do tabuleiro
     --------------------------------------------------------------------- */
  function updateShadowHint() {
    if (mode !== "shadow") return;
    const secret = activeSecret();
    if (shadowHintImg && secret) {
      shadowHintImg.src = secret.img;
      shadowHintImg.alt = "";
    }
  }

  /* ---------------------------------------------------------------------
     Troca de modo (Desafio 6h / Prática livre / Sombra)
     --------------------------------------------------------------------- */
  const MODE_META = {
    challenge: { icon: "⏱", label: "DESAFIO 6H" },
    practice:  { icon: "🎲", label: "PRÁTICA LIVRE" },
    shadow:    { icon: "🌑", label: "SOMBRA" },
  };

  function markActiveModeCard() {
    modeCards.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
  }

  function applyModeUI() {
    const meta = MODE_META[mode] || MODE_META.challenge;
    if (modeIndicatorIcon) modeIndicatorIcon.textContent = meta.icon;
    if (modeIndicatorLabel) modeIndicatorLabel.textContent = meta.label;

    if (challengeRibbon) challengeRibbon.classList.toggle("hidden", mode !== "challenge");
    if (practiceRibbon) practiceRibbon.classList.toggle("hidden", mode !== "practice");
    if (shadowRibbon) shadowRibbon.classList.toggle("hidden", mode !== "shadow");

    if (resetChip) resetChip.classList.toggle("hidden", mode !== "challenge");
    if (freeChip) freeChip.classList.toggle("hidden", mode === "challenge");
    if (freeChipIcon) freeChipIcon.textContent = mode === "shadow" ? "🌑" : "🎲";
    if (freeChipText) {
      freeChipText.textContent = mode === "shadow"
        ? "SEM LIMITE DE TENTATIVAS — USE A SOMBRA COMO PISTA"
        : "SEM LIMITE DE TENTATIVAS — JOGUE QUANTAS VEZES QUISER";
    }

    if (shadowHint) shadowHint.classList.toggle("hidden", mode !== "shadow");
    updateShadowHint();

    if (taglineDetail) {
      if (mode === "practice") {
        taglineDetail.textContent = "sem limite de tentativas • personagem novo a qualquer hora";
      } else if (mode === "shadow") {
        taglineDetail.textContent = "sem limite de tentativas • silhueta do segredo como pista extra";
      } else {
        taglineDetail.textContent = "8 tentativas • 1 personagem • pistas em cada palpite";
      }
    }

    if (issueBadge) issueBadge.textContent = `#${today.puzzleNumber}`;

    markActiveModeCard();
    renderBoard();
    refreshMeta();
    if (mode === "challenge") tickResetCountdown();
  }

  function switchMode(nextMode) {
    if (!VALID_MODES.includes(nextMode)) return;
    if (nextMode === mode) return;
    mode = nextMode;
    persistMode();
    closeSuggestions();
    input.value = "";
    delete input.dataset.selectedId;
    applyModeUI();
  }

  modeCards.forEach((btn) => {
    btn.addEventListener("click", () => {
      switchMode(btn.dataset.mode);
      closeModal("modal-mode-select");
    });
  });
  if (btnModes) btnModes.addEventListener("click", () => openModal("modal-mode-select"));
  if (modeIndicator) modeIndicator.addEventListener("click", () => openModal("modal-mode-select"));

  /* ---------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------- */
  renderHeader();
  applyModeUI();
  markActiveModeCard();
  setInterval(tickResetCountdown, 1000);
})();
