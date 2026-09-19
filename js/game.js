/* ===========================================================================
   Lego Marveldle — lógica do jogo
   ===========================================================================
   Depende de CHARACTERS (definido em characters.js, carregado antes deste
   arquivo).

   QUATRO MODOS DE JOGO
   -------------------------------
   1) DESAFIO 2H — não existe nenhuma resposta "escrita" no código. O jogo:
      1) calcula quantos períodos de 2 horas se passaram desde um instante
         de referência fixo (a cada dia: 00h, 02h, 04h... 22h, sempre em
         horário UTC — o mesmo instante para todo mundo, em qualquer fuso);
      2) usa esse número para embaralhar (de forma determinística, via um
         gerador pseudoaleatório com semente) a lista inteira de personagens;
      3) percorre esse embaralhado período a período, sem repetir nenhum
         personagem até passar por toda a lista — quando a lista acaba, um
         novo embaralhamento (a próxima "temporada") começa.
      É o único modo que conta para as Estatísticas, a Galeria e as
      Conquistas.

   2) SOMBRA DIÁRIO — igual ao Desafio no funcionamento (muda a cada 2 horas,
      mesmo personagem pra todo mundo, 8 tentativas), mas usa uma semente de
      sorteio diferente (então normalmente é um personagem diferente do
      Desafio) e mostra a silhueta borrada do segredo como pista extra. Não
      altera Estatísticas/Galeria/Conquistas.

   3) PRÁTICA LIVRE — um personagem é sorteado de verdade (Math.random) só
      para o jogador, sem limite de tentativas e sem hora certa.

   4) SOMBRA PRÁTICA — igual à Prática Livre, mas com a silhueta borrada do
      segredo como pista extra.

   Nenhum desses três últimos modos altera as estatísticas do Desafio.
   =========================================================================== */

(() => {
  "use strict";

  /* ---------------------------------------------------------------------
     Config
     --------------------------------------------------------------------- */
  const CHALLENGE_MAX_TRIES = 8;
  const RESET_PERIOD_HOURS = 2; // o personagem do Desafio/Sombra Diário muda a cada 2 horas
  const RESET_PERIOD_MS = RESET_PERIOD_HOURS * 3600000;
  const EPOCH_MS = Date.UTC(2026, 8, 18, 0, 0, 0); // referência fixa (18 set 2026, 00h UTC) — reinicia a contagem do #desafio a partir de um "lançamento" recente
  const STORAGE_PREFIX = "legoMarveldle_";
  const CHALLENGE_SEED = 1000003;
  const SHADOW_DAILY_SEED = 2000117; // semente diferente => geralmente um segredo diferente do Desafio

  // Modos multi-tabuleiro (Duo/Team): cada palpite vale em todos os
  // tabuleiros ainda não resolvidos; ao resolver um, ele congela. Usam o
  // mesmo relógio de 2h do Desafio (mesmo período pra todo mundo), mas cada
  // um sorteia seus próprios N segredos (nunca repetidos entre si) e não
  // altera Estatísticas/Galeria/Conquistas.
  const MULTI_MODES = {
    duo:  { boards: 2, maxTries: 10, seed: 3000233, label: "DUO",  icon: "👥" },
    team: { boards: 4, maxTries: 12, seed: 4000381, label: "TEAM", icon: "🛡" },
  };

  // Categoria de tamanho: as únicas "Big Figs" de LEGO Marvel Super Heroes
  // são estas vinte — o resto do elenco joga como minifigura comum.
  const BIG_FIGS = new Set([
    "A-Bomb",
    "Abomination",
    "Blob",
    "Colossus",
    "Doombot (V-Series)",
    "Green Goblin (Ultimate)",
    "Groot",
    "Iron Man (Hulkbuster)",
    "Juggernaut",
    "Kingpin",
    "Kurse",
    "Kurse (The Dark World)",
    "Red Hulk",
    "Stan Lee (Hulk)",
    "Thanos",
    "The Hulk",
    "The Lizard",
    "The Rhino",
    "The Thing",
    "Venom (Big)",
  ]);
  CHARACTERS.forEach((c) => {
    c.sizeCategory = BIG_FIGS.has(c.name) ? "Fig Grande" : "Fig Pequena";
  });

  /* ---------------------------------------------------------------------
     Letra inicial / letra final (pistas alfabéticas)
     --------------------------------------------------------------------- */
  function firstLetter(character) {
    return (character && character.name ? character.name : "").trim().charAt(0).toUpperCase();
  }
  // Nome "núcleo": tira um sufixo entre parênteses no final (ex.: "Iron Man
  // (Mark-7)" -> "Iron Man"), pra pegar a última letra de algo mais
  // interessante do que um ")".
  function coreName(character) {
    const name = (character && character.name) || "";
    return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  }
  function lastLetter(character) {
    const core = coreName(character) || (character && character.name) || "";
    return core.charAt(core.length - 1).toUpperCase();
  }

  const COLUMNS = [
    { key: "photo",         label: "Personagem",    type: "photo" },
    { key: "firstLetter",   label: "1ª Letra",       type: "letter", letterFn: firstLetter },
    { key: "lastLetter",    label: "Última Letra",  type: "letter", letterFn: lastLetter },
    { key: "faction",       label: "Alinhamento",   type: "category" },
    { key: "team",          label: "Time",          type: "category" },
    { key: "race",          label: "Raça",          type: "category", groupKey: "raceGroup" },
    { key: "locomotion",    label: "Locomoção",     type: "category" },
    { key: "coins",         label: "Custo (studs)", type: "numeric" },
    { key: "sizeCategory",  label: "Tamanho",       type: "category" },
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
     Período do desafio (a cada 2 horas: 00h, 02h, 04h... 22h UTC)
     -------------------------------------------------------------------
     O personagem secreto muda a cada 2 horas, no mesmo instante para todo
     mundo (não depende do fuso de quem está jogando). Contamos quantos
     blocos de 2 horas já se passaram desde um instante de referência fixo
     (EPOCH_MS) e usamos esse número como semente do sorteio. Desafio e
     Sombra Diário compartilham o mesmo relógio (mesmo periodIndex/resetAt),
     só usam sementes de embaralhamento diferentes.
     --------------------------------------------------------------------- */
  function currentPeriodIndex(nowMs) {
    return Math.floor((nowMs - EPOCH_MS) / RESET_PERIOD_MS);
  }
  function periodStartMs(periodIndex) {
    return EPOCH_MS + periodIndex * RESET_PERIOD_MS;
  }
  function pickForPeriod(periodIndex, seedBase) {
    const n = CHARACTERS.length;
    const cycle = Math.floor(periodIndex / n);
    const posInCycle = ((periodIndex % n) + n) % n;
    // semente única por temporada (cycle) — cada temporada é um embaralhado novo
    const order = seededShuffle(CHARACTERS, seedBase * (cycle + 1));
    return order[posInCycle];
  }
  function getPeriodInfo(periodIndex) {
    return {
      periodIndex,
      puzzleNumber: periodIndex + 1,
      periodKey: String(periodIndex),
      resetAt: new Date(periodStartMs(periodIndex) + RESET_PERIOD_MS),
    };
  }
  function getCurrentChallenge() {
    const periodIndex = currentPeriodIndex(Date.now());
    return { ...getPeriodInfo(periodIndex), character: pickForPeriod(periodIndex, CHALLENGE_SEED) };
  }
  function getCurrentShadowDaily() {
    const periodIndex = currentPeriodIndex(Date.now());
    return { ...getPeriodInfo(periodIndex), character: pickForPeriod(periodIndex, SHADOW_DAILY_SEED) };
  }
  // Sorteia N personagens distintos para o período atual (Duo/Team). Como
  // vêm de um único embaralhado, nunca se repetem entre si dentro do mesmo
  // período.
  function pickManyForPeriod(periodIndex, seedBase, count) {
    const order = seededShuffle(CHARACTERS, seedBase * (periodIndex + 7) + count);
    return order.slice(0, count);
  }
  function getCurrentMulti(modeKey) {
    const cfg = MULTI_MODES[modeKey];
    const periodIndex = currentPeriodIndex(Date.now());
    return { ...getPeriodInfo(periodIndex), secrets: pickManyForPeriod(periodIndex, cfg.seed, cfg.boards) };
  }

  /* ---------------------------------------------------------------------
     Modos livres — personagem aleatório de verdade, sem período fixo
     --------------------------------------------------------------------- */
  function randomCharacter(excludeId) {
    if (CHARACTERS.length <= 1) return CHARACTERS[0];
    let pick;
    do {
      pick = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
    } while (pick.id === excludeId);
    return pick;
  }
  function newFreeState(excludeId) {
    return {
      secretId: randomCharacter(excludeId).id,
      guessIds: [],
      finished: false,
      won: false,
      statsRecorded: false,
    };
  }

  /* ---------------------------------------------------------------------
     Estado dos modos multi-tabuleiro (Duo/Team)
     --------------------------------------------------------------------- */
  function idsEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  function newMultiState(periodIndex, secrets) {
    return {
      periodIndex,
      secretIds: secrets.map((s) => s.id),
      boards: secrets.map(() => ({ guessIds: [], solved: false })),
      totalGuessIds: [],
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
      totalGuesses: 0,   // total de palpites enviados no Desafio (contando derrotas/jogos em andamento)
      oneShotWins: 0,    // vitórias na primeira tentativa
    };
  }

  /* ---------------------------------------------------------------------
     Estado
     --------------------------------------------------------------------- */
  const VALID_MODES = ["challenge", "shadowDaily", "practice", "shadowPractice", "duo", "team"];
  let mode = loadJSON("mode", "challenge");
  if (!VALID_MODES.includes(mode)) mode = "challenge";

  const today = getCurrentChallenge();
  const challengeSecret = today.character;
  const todayShadow = getCurrentShadowDaily();
  const shadowDailySecret = todayShadow.character;
  const todayDuo = getCurrentMulti("duo");
  const todayTeam = getCurrentMulti("team");

  let showPhoto = loadJSON("showPhoto", true);

  // Migra estatísticas antigas preenchendo os campos novos que ainda não existiam.
  let stats = Object.assign(defaultStats(CHALLENGE_MAX_TRIES), loadJSON("stats", {}));

  // Galeria: só personagens VENCIDOS no Desafio 2h entram aqui.
  // { [characterId]: { wins, bestTries, worstTries } }
  let gallery = loadJSON("gallery", {});
  // Conquistas desbloqueadas: { [achievementId]: isoTimestamp }
  let achievements = loadJSON("achievements", {});

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

  let shadowDailyState = loadJSON("shadowDailyState_" + todayShadow.periodKey, null);
  if (!shadowDailyState || shadowDailyState.secretId !== shadowDailySecret.id) {
    shadowDailyState = {
      secretId: shadowDailySecret.id,
      periodIndex: todayShadow.periodIndex,
      guessIds: [],
      finished: false,
      won: false,
      statsRecorded: false,
    };
  }

  let practiceState = loadJSON("practiceState", null);
  if (!practiceState || !byId(practiceState.secretId)) {
    practiceState = newFreeState(null);
  }

  let shadowPracticeState = loadJSON("shadowState", null); // chave antiga reaproveitada
  if (!shadowPracticeState || !byId(shadowPracticeState.secretId)) {
    shadowPracticeState = newFreeState(null);
  }

  let duoState = loadJSON("duoState_" + todayDuo.periodKey, null);
  if (!duoState || !idsEqual(duoState.secretIds, todayDuo.secrets.map((s) => s.id))) {
    duoState = newMultiState(todayDuo.periodIndex, todayDuo.secrets);
  }
  let teamState = loadJSON("teamState_" + todayTeam.periodKey, null);
  if (!teamState || !idsEqual(teamState.secretIds, todayTeam.secrets.map((s) => s.id))) {
    teamState = newMultiState(todayTeam.periodIndex, todayTeam.secrets);
  }

  // Estados de períodos passados (state_<periodo>, duoState_<periodo>, etc.)
  // nunca eram apagados — cada 2h sobrava mais uma chave no localStorage.
  // Mantém só a chave do período atual de cada categoria.
  function pruneOldPeriodStates() {
    try {
      const keepKey = {
        [STORAGE_PREFIX + "state_"]: STORAGE_PREFIX + "state_" + today.periodKey,
        [STORAGE_PREFIX + "shadowDailyState_"]: STORAGE_PREFIX + "shadowDailyState_" + todayShadow.periodKey,
        [STORAGE_PREFIX + "duoState_"]: STORAGE_PREFIX + "duoState_" + todayDuo.periodKey,
        [STORAGE_PREFIX + "teamState_"]: STORAGE_PREFIX + "teamState_" + todayTeam.periodKey,
      };
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        for (const prefix in keepKey) {
          if (key.startsWith(prefix) && key !== keepKey[prefix]) toRemove.push(key);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* localStorage indisponível — ignora */
    }
  }
  pruneOldPeriodStates();

  // "Contexto" ativo — tudo abaixo trabalha em cima do modo atual, sem
  // duplicar a lógica de comparação, renderização ou envio de palpite.
  function activeSecret() {
    if (mode === "practice") return byId(practiceState.secretId);
    if (mode === "shadowPractice") return byId(shadowPracticeState.secretId);
    if (mode === "shadowDaily") return shadowDailySecret;
    return challengeSecret;
  }
  function activeState() {
    if (mode === "practice") return practiceState;
    if (mode === "shadowPractice") return shadowPracticeState;
    if (mode === "shadowDaily") return shadowDailyState;
    return challengeState;
  }
  function activeMaxTries() {
    if (mode === "challenge" || mode === "shadowDaily") return CHALLENGE_MAX_TRIES;
    if (isMultiMode()) return MULTI_MODES[mode].maxTries;
    return Infinity;
  }
  function isFreeMode() { return mode === "practice" || mode === "shadowPractice"; }
  function isMultiMode() { return mode === "duo" || mode === "team"; }
  // Desafio, Sombra Diário, Duo e Team compartilham o mesmo relógio de 2h.
  function isDailyMode() { return mode === "challenge" || mode === "shadowDaily" || isMultiMode(); }
  function isShadowMode() { return mode === "shadowDaily" || mode === "shadowPractice"; }
  function activeMultiState() { return mode === "duo" ? duoState : teamState; }
  function activeMultiToday() { return mode === "duo" ? todayDuo : todayTeam; }

  function persistMode() { saveJSON("mode", mode); }
  function persistChallengeState() { saveJSON("state_" + today.periodKey, challengeState); }
  function persistShadowDailyState() { saveJSON("shadowDailyState_" + todayShadow.periodKey, shadowDailyState); }
  function persistPracticeState() { saveJSON("practiceState", practiceState); }
  function persistShadowPracticeState() { saveJSON("shadowState", shadowPracticeState); }
  function persistDuoState() { saveJSON("duoState_" + todayDuo.periodKey, duoState); }
  function persistTeamState() { saveJSON("teamState_" + todayTeam.periodKey, teamState); }
  function persistState() {
    if (mode === "practice") return persistPracticeState();
    if (mode === "shadowPractice") return persistShadowPracticeState();
    if (mode === "shadowDaily") return persistShadowDailyState();
    if (mode === "duo") return persistDuoState();
    if (mode === "team") return persistTeamState();
    return persistChallengeState();
  }
  function persistStats() { saveJSON("stats", stats); }
  function persistGallery() { saveJSON("gallery", gallery); }
  function persistAchievements() { saveJSON("achievements", achievements); }
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
  const boardWrapEl = $("#board-wrap");
  const multiBoardWrap = $("#multi-board-wrap");
  const togglePhoto = $("#toggle-photo");
  const issueBadge = $("#issue-badge");
  const issueBadgeShadow = $("#issue-badge-shadow");
  const issueBadgeDuo = $("#issue-badge-duo");
  const issueBadgeTeam = $("#issue-badge-team");

  const btnStats = $("#btn-stats");
  const btnSettings = $("#btn-settings");
  const btnHelp = $("#btn-help");
  const btnShareStats = $("#btn-share");
  const btnShareResult = $("#btn-share-2");
  const btnOpenGallery = $("#btn-open-gallery");
  const btnOpenAchievements = $("#btn-open-achievements");

  const btnModes = $("#btn-modes");
  const modeIndicator = $("#mode-indicator");
  const modeIndicatorIcon = $("#mode-indicator-icon");
  const modeIndicatorLabel = $("#mode-indicator-label");
  const modeCards = document.querySelectorAll(".mode-card");

  const challengeRibbon = $("#challenge-ribbon");
  const shadowDailyRibbon = $("#shadow-daily-ribbon");
  const practiceRibbon = $("#practice-ribbon");
  const shadowRibbon = $("#shadow-ribbon");
  const duoRibbon = $("#duo-ribbon");
  const teamRibbon = $("#team-ribbon");
  const resetChip = $("#reset-chip");
  const resetLabel = $("#reset-label");
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
  const GRID_TEMPLATE = ["144px", "64px", "64px", "118px", "140px", "118px", "84px", "128px", "118px"].join(" ");

  function buildHeaderEl() {
    const el = document.createElement("div");
    el.className = "board-header";
    el.style.gridTemplateColumns = GRID_TEMPLATE;
    COLUMNS.forEach((col) => {
      const div = document.createElement("div");
      div.className = "col-label";
      div.textContent = col.label;
      el.appendChild(div);
    });
    return el;
  }

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

  // Letras (inicial/final): mesma lógica de seta que os campos numéricos,
  // mas comparando ordem alfabética (A antes de B, etc.).
  function compareLetter(col, guessChar, secretChar) {
    const g = col.letterFn(guessChar);
    const s = col.letterFn(secretChar);
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
  // secret e tryNumber são explícitos (em vez de vir de activeSecret()/
  // activeState()) para essa mesma função poder desenhar tanto o tabuleiro
  // único quanto cada mini-tabuleiro dos modos Duo/Team.
  function buildRow(guessChar, secret, tryNumber) {
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
        badge.textContent = `#${tryNumber}`;
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
        name.title = guessChar.name;
        cell.appendChild(name);
      } else if (col.type === "category") {
        const res = compareCategory(col, guessChar, secret);
        cell.classList.add(res.cls);
        const val = document.createElement("span");
        val.className = "cell-value";
        val.textContent = guessChar[col.key];
        val.title = String(guessChar[col.key] ?? "N/A");
        cell.appendChild(val);
      } else if (col.type === "numeric" || col.type === "letter") {
        const isLetter = col.type === "letter";
        const res = isLetter ? compareLetter(col, guessChar, secret) : compareNumeric(col, guessChar, secret);
        cell.classList.add(res.cls);
        if (isLetter) cell.classList.add("letter-cell");
        const val = document.createElement("span");
        val.className = "cell-value";
        val.textContent = isLetter ? col.letterFn(guessChar) : formatValue(col, guessChar[col.key]);
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
    if (isMultiMode()) return renderMultiBoard();
    boardRows.innerHTML = "";
    const secret = activeSecret();
    activeState().guessIds.forEach((id, i) => {
      const c = byId(id);
      if (c) boardRows.appendChild(buildRow(c, secret, i + 1));
    });
  }

  /* ---------------------------------------------------------------------
     Render: tabuleiros dos modos Duo/Team
     --------------------------------------------------------------------- */
  function renderMultiBoard() {
    if (!multiBoardWrap) return;
    const state = activeMultiState();
    const secrets = activeMultiToday().secrets;

    multiBoardWrap.innerHTML = "";
    multiBoardWrap.className = "multi-board-wrap multi-" + mode;

    secrets.forEach((secret, i) => {
      const board = state.boards[i];
      const card = document.createElement("div");
      card.className = "multi-board-card" + (board.solved ? " solved" : "");

      const title = document.createElement("div");
      title.className = "multi-board-card-title";
      const label = document.createElement("span");
      label.textContent = `Tabuleiro ${i + 1}`;
      title.appendChild(label);
      if (board.solved) {
        const chip = document.createElement("span");
        chip.className = "multi-board-chip win";
        chip.textContent = "✓ Resolvido";
        title.appendChild(chip);
      } else if (state.finished && !state.won) {
        const chip = document.createElement("span");
        chip.className = "multi-board-chip lose";
        chip.textContent = `Era ${secret.name}`;
        title.appendChild(chip);
      }
      card.appendChild(title);

      const scroll = document.createElement("div");
      scroll.className = "board-scroll";
      scroll.appendChild(buildHeaderEl());
      const rows = document.createElement("div");
      rows.className = "board-rows";
      board.guessIds.forEach((id, gi) => {
        const c = byId(id);
        if (c) rows.appendChild(buildRow(c, secret, gi + 1));
      });
      scroll.appendChild(rows);
      card.appendChild(scroll);

      multiBoardWrap.appendChild(card);
    });
  }

  /* ---------------------------------------------------------------------
     Estado da UI (tentativas, badge, input travado)
     --------------------------------------------------------------------- */
  function refreshMeta() {
    if (isMultiMode()) return refreshMultiMeta();
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

  function refreshMultiMeta() {
    const cfg = MULTI_MODES[mode];
    const state = activeMultiState();
    const used = state.totalGuessIds.length;
    const solvedCount = state.boards.filter((b) => b.solved).length;

    if (state.finished) {
      triesLabel.textContent = state.won
        ? `Acertou os ${state.boards.length} em ${used} de ${cfg.maxTries}`
        : `Não foi dessa vez — ${solvedCount}/${state.boards.length} resolvidos, ${used} de ${cfg.maxTries}`;
      gameOverBadge.classList.remove("hidden");
      gameOverBadge.classList.toggle("win", state.won);
      gameOverBadge.classList.toggle("lose", !state.won);
      gameOverBadge.textContent = state.won ? "Vitória" : "Fim de jogo";
      input.disabled = true;
      btnGuess.disabled = true;
      input.placeholder = "Volte em algumas horas para um novo desafio!";
    } else {
      triesLabel.textContent = `Tentativa ${used + 1} de ${cfg.maxTries} — ${solvedCount}/${state.boards.length} resolvidos`;
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

    const guessed = new Set(isMultiMode() ? activeMultiState().totalGuessIds : activeState().guessIds);
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
    if (isMultiMode()) return submitMultiGuess();
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
    if (mode === "challenge") {
      stats.totalGuesses += 1;
      persistStats();
    }

    const rowEl = buildRow(character, activeSecret(), state.guessIds.length);
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
    if (mode === "challenge") checkAchievements();

    if (state.finished) {
      setTimeout(openResultModal, 550);
    }

    input.focus();
  }

  /* ---------------------------------------------------------------------
     Envio de palpite — modos Duo/Team (um palpite vale em todos os
     tabuleiros ainda abertos; o tabuleiro resolvido congela)
     --------------------------------------------------------------------- */
  function submitMultiGuess() {
    const cfg = MULTI_MODES[mode];
    const state = activeMultiState();
    const secrets = activeMultiToday().secrets;
    if (state.finished) return;

    const character = resolveTypedCharacter();
    if (!character) {
      toast("Personagem não encontrado. Escolha um da lista.");
      shakeInput();
      return;
    }
    if (state.totalGuessIds.includes(character.id)) {
      toast("Você já tentou esse personagem.");
      shakeInput();
      return;
    }

    state.totalGuessIds.push(character.id);
    state.boards.forEach((board, i) => {
      if (board.solved) return;
      board.guessIds.push(character.id);
      if (secrets[i] && character.id === secrets[i].id) board.solved = true;
    });

    input.value = "";
    delete input.dataset.selectedId;
    closeSuggestions();

    const allSolved = state.boards.every((b) => b.solved);
    if (allSolved) {
      state.finished = true;
      state.won = true;
    } else if (state.totalGuessIds.length >= cfg.maxTries) {
      state.finished = true;
      state.won = false;
    }

    persistState();
    renderMultiBoard();
    refreshMeta();

    if (state.finished) setTimeout(openResultModal, 550);

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
     Galeria — apenas personagens vencidos no Desafio 2h
     --------------------------------------------------------------------- */
  function recordGalleryWin(character, tries) {
    const prev = gallery[character.id];
    if (prev) {
      prev.wins += 1;
      prev.bestTries = Math.min(prev.bestTries, tries);
      prev.worstTries = Math.max(prev.worstTries, tries);
    } else {
      gallery[character.id] = { wins: 1, bestTries: tries, worstTries: tries };
    }
    persistGallery();
  }

  function galleryCount() { return Object.keys(gallery).length; }
  function galleryEntries() {
    return Object.keys(gallery)
      .map((id) => ({ id, character: byId(id), entry: gallery[id] }))
      .filter((row) => row.character);
  }
  function hardestCharacter() {
    let best = null;
    galleryEntries().forEach((row) => {
      if (!best || row.entry.worstTries > best.entry.worstTries) best = row;
    });
    return best;
  }

  /* ---------------------------------------------------------------------
     Conquistas
     --------------------------------------------------------------------- */
  const ACHIEVEMENTS = [
    { id: "primeiro-bloco", tier: "bronze", icon: "🥉", name: "Primeiro bloco",
      desc: "Faça seu primeiro palpite.", test: () => stats.totalGuesses >= 1 },
    { id: "heroi", tier: "bronze", icon: "🥉", name: "Herói!",
      desc: "Acerte seu primeiro personagem.", test: () => stats.wins >= 1 },
    { id: "detetive", tier: "bronze", icon: "🥉", name: "Detetive",
      desc: "Acerte em 3 tentativas ou menos.",
      test: () => galleryEntries().some((row) => row.entry.bestTries <= 3) },
    { id: "conhecedor", tier: "prata", icon: "🥈", name: "Conhecedor da Marvel",
      desc: "Acerte 50 personagens diferentes.", test: () => galleryCount() >= 50 },
    { id: "multiverso", tier: "prata", icon: "🥈", name: "Multiverso",
      desc: "Acerte personagens de 10 times diferentes.",
      test: () => new Set(galleryEntries().map((row) => row.character.team)).size >= 10 },
    { id: "shield-database", tier: "prata", icon: "🥈", name: "S.H.I.E.L.D. Database",
      desc: "Descubra 100 personagens.", test: () => galleryCount() >= 100 },
    { id: "stan-lee", tier: "ouro", icon: "🥇", name: "Stan Lee aprovaria",
      desc: "Acerte 10 desafios consecutivos.", test: () => stats.maxStreak >= 10 },
    { id: "figurante", tier: "ouro", icon: "🥇", name: "Conhece até os figurantes",
      desc: "Acerte um personagem genérico/capanga.",
      test: () => galleryEntries().some((row) => row.character.team === "Capangas") },
    { id: "lego-master", tier: "ouro", icon: "🥇", name: "LEGO Marvel Master",
      desc: "Descubra todos os personagens.", test: () => galleryCount() >= CHARACTERS.length },
  ];

  function checkAchievements() {
    const newlyUnlocked = [];
    ACHIEVEMENTS.forEach((a) => {
      if (achievements[a.id]) return;
      if (a.test()) {
        achievements[a.id] = new Date().toISOString();
        newlyUnlocked.push(a);
      }
    });
    if (newlyUnlocked.length) {
      persistAchievements();
      newlyUnlocked.forEach((a, i) => {
        setTimeout(() => toast(`${a.icon} Conquista desbloqueada: ${a.name}`), i * 1700);
      });
    }
  }

  /* ---------------------------------------------------------------------
     Estatísticas
     --------------------------------------------------------------------- */
  function recordStats() {
    if (mode !== "challenge") return; // só o Desafio 2h altera as estatísticas
    if (stats.lastFinishedPeriodIndex === today.periodIndex) return; // já contado
    stats.played += 1;
    if (challengeState.won) {
      stats.wins += 1;
      stats.currentStreak += 1;
      stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
      const tries = challengeState.guessIds.length;
      const idx = Math.min(tries, CHALLENGE_MAX_TRIES) - 1;
      stats.distribution[idx] += 1;
      if (tries === 1) stats.oneShotWins += 1;
      recordGalleryWin(challengeSecret, tries);
    } else {
      stats.currentStreak = 0;
    }
    stats.lastFinishedPeriodIndex = today.periodIndex;
    persistStats();
  }

  function renderStatsModal() {
    const winRate = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
    const avgTries = stats.wins
      ? (stats.distribution.reduce((sum, count, i) => sum + count * (i + 1), 0) / stats.wins)
      : 0;

    const heroesTotal = CHARACTERS.filter((c) => c.faction === "Herói").length;
    const villainsTotal = CHARACTERS.filter((c) => c.faction === "Vilão").length;
    const rows = galleryEntries();
    const heroesFound = rows.filter((r) => r.character.faction === "Herói").length;
    const villainsFound = rows.filter((r) => r.character.faction === "Vilão").length;

    $("#stat-played").textContent = String(stats.played);
    $("#stat-wins").textContent = String(stats.wins);
    $("#stat-winrate").textContent = `${winRate}%`;
    $("#stat-avg-tries").textContent = avgTries ? avgTries.toFixed(1).replace(".", ",") : "—";
    $("#stat-max-streak").textContent = String(stats.maxStreak);
    $("#stat-oneshot").textContent = String(stats.oneShotWins);
    $("#stat-discovered").textContent = `${galleryCount()} / ${CHARACTERS.length}`;
    $("#stat-heroes").textContent = `${heroesFound} / ${heroesTotal}`;
    $("#stat-villains").textContent = `${villainsFound} / ${villainsTotal}`;

    const hardestCard = $("#hardest-card");
    const hardest = hardestCharacter();
    if (hardest && hardestCard) {
      hardestCard.classList.remove("hidden");
      $("#hardest-img").src = hardest.character.img;
      $("#hardest-img").alt = hardest.character.name;
      $("#hardest-name").textContent = hardest.character.name;
      $("#hardest-tries").textContent = `${hardest.entry.worstTries} tentativa${hardest.entry.worstTries === 1 ? "" : "s"}`;
    } else if (hardestCard) {
      hardestCard.classList.add("hidden");
    }

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
     Galeria (modal) — almanaque só com personagens vencidos no Desafio 2h
     --------------------------------------------------------------------- */
  function renderGalleryModal() {
    const grid = $("#gallery-grid");
    const countEl = $("#gallery-count");
    if (!grid) return;
    countEl.textContent = `${galleryCount()} / ${CHARACTERS.length}`;
    grid.innerHTML = "";

    const rows = galleryEntries().sort((a, b) => a.character.name.localeCompare(b.character.name, "pt-BR"));

    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted small gallery-empty";
      empty.textContent = "Você ainda não acertou nenhum personagem no Desafio 2h. Jogue uma rodada para começar sua galeria!";
      grid.appendChild(empty);
      return;
    }

    rows.forEach(({ character, entry }) => {
      const card = document.createElement("div");
      card.className = "gallery-card " + (character.faction === "Herói" ? "gallery-hero" : "gallery-villain");

      const img = document.createElement("img");
      img.src = character.img;
      img.alt = character.name;
      img.loading = "lazy";
      card.appendChild(img);

      const name = document.createElement("span");
      name.className = "gallery-name";
      name.textContent = character.name;
      card.appendChild(name);

      if (entry.wins > 1) {
        const badge = document.createElement("span");
        badge.className = "gallery-wins";
        badge.textContent = `×${entry.wins}`;
        card.appendChild(badge);
      }

      grid.appendChild(card);
    });
  }

  /* ---------------------------------------------------------------------
     Conquistas (modal)
     --------------------------------------------------------------------- */
  const TIER_META = {
    bronze: { title: "🥉 Fáceis", cls: "tier-bronze" },
    prata:  { title: "🥈 Médias", cls: "tier-prata" },
    ouro:   { title: "🥇 Difíceis", cls: "tier-ouro" },
  };

  function renderAchievementsModal() {
    const list = $("#achievements-list");
    const countEl = $("#achievements-count");
    if (!list) return;

    const unlockedCount = ACHIEVEMENTS.filter((a) => achievements[a.id]).length;
    countEl.textContent = `${unlockedCount} / ${ACHIEVEMENTS.length}`;
    list.innerHTML = "";

    ["bronze", "prata", "ouro"].forEach((tier) => {
      const items = ACHIEVEMENTS.filter((a) => a.tier === tier);
      if (!items.length) return;

      const heading = document.createElement("h3");
      heading.className = "achv-tier-title " + TIER_META[tier].cls;
      heading.textContent = TIER_META[tier].title;
      list.appendChild(heading);

      items.forEach((a) => {
        const unlocked = Boolean(achievements[a.id]);
        const row = document.createElement("div");
        row.className = "achv-row" + (unlocked ? " unlocked" : " locked");

        const icon = document.createElement("span");
        icon.className = "achv-icon";
        icon.textContent = unlocked ? a.icon : "🔒";
        row.appendChild(icon);

        const text = document.createElement("span");
        text.className = "achv-text";
        const strong = document.createElement("strong");
        strong.textContent = a.name;
        const small = document.createElement("small");
        small.textContent = a.desc;
        text.appendChild(strong);
        text.appendChild(small);
        row.appendChild(text);

        list.appendChild(row);
      });
    });
  }

  if (btnOpenGallery) btnOpenGallery.addEventListener("click", () => openModal("modal-gallery"));
  if (btnOpenAchievements) btnOpenAchievements.addEventListener("click", () => openModal("modal-achievements"));

  /* ---------------------------------------------------------------------
     Modal de resultado
     --------------------------------------------------------------------- */
  function renderResultModal() {
    if (isMultiMode()) return renderMultiResultModal();
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
    if (mode === "challenge") {
      p2.textContent = "Um novo desafio chega a cada 2 horas — o mesmo para todo mundo.";
    } else if (mode === "shadowDaily") {
      p2.textContent = "Uma nova sombra diária chega a cada 2 horas — a mesma para todo mundo.";
    } else {
      p2.textContent = "Clique em “Novo personagem” para jogar de novo, quando quiser.";
    }
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

  function renderMultiResultModal() {
    const cfg = MULTI_MODES[mode];
    const state = activeMultiState();
    const secrets = activeMultiToday().secrets;
    const body = $("#result-body");
    body.innerHTML = "";

    const title = document.createElement("div");
    title.className = "result-title " + (state.won ? "win" : "lose");
    title.textContent = state.won
      ? `Você resolveu os ${secrets.length} em ${state.totalGuessIds.length} de ${cfg.maxTries}!`
      : "Você não descobriu todos dessa vez.";
    body.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "multi-result-grid";
    secrets.forEach((secret, i) => {
      const card = document.createElement("div");
      card.className = "multi-result-card" + (state.boards[i].solved ? " solved" : "");
      const img = document.createElement("img");
      img.src = secret.img;
      img.alt = secret.name;
      const name = document.createElement("span");
      name.textContent = secret.name;
      card.appendChild(img);
      card.appendChild(name);
      grid.appendChild(card);
    });
    body.appendChild(grid);

    const p2 = document.createElement("p");
    p2.className = "muted small";
    p2.textContent = mode === "duo"
      ? "Um novo Duo chega a cada 2 horas — o mesmo para todo mundo."
      : "Um novo Team chega a cada 2 horas — o mesmo para todo mundo.";
    body.appendChild(p2);
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
    if (isMultiMode()) return buildMultiShareText();
    const state = activeState();
    const secret = activeSecret();
    const maxTries = activeMaxTries();
    const used = state.guessIds.length;
    const maxLabel = Number.isFinite(maxTries) ? String(maxTries) : "∞";
    const scoreLabel = state.won ? `${used}/${maxLabel}` : `X/${maxLabel}`;
    let heading;
    if (mode === "practice") heading = `🧱 Lego Marveldle (Prática) — ${scoreLabel}`;
    else if (mode === "shadowPractice") heading = `🧱 Lego Marveldle (Sombra Prática) — ${scoreLabel}`;
    else if (mode === "shadowDaily") heading = `🧱 Lego Marveldle Sombra #${todayShadow.puzzleNumber} — ${scoreLabel}`;
    else heading = `🧱 Lego Marveldle #${today.puzzleNumber} — ${scoreLabel}`;
    const lines = [heading, ""];

    state.guessIds.forEach((id) => {
      const c = byId(id);
      const rowEmojis = COLUMNS
        .filter((col) => col.type !== "photo")
        .map((col) => {
          if (col.type === "category") return emojiForCategory(compareCategory(col, c, secret).cls);
          if (col.type === "letter") return emojiForNumeric(compareLetter(col, c, secret));
          return emojiForNumeric(compareNumeric(col, c, secret));
        })
        .join("");
      lines.push(rowEmojis);
    });

    let footer;
    if (mode === "practice") footer = "LEGO Marveldle — modo prática de LEGO Marvel Super Heroes";
    else if (mode === "shadowPractice") footer = "LEGO Marveldle — modo sombra prática de LEGO Marvel Super Heroes";
    else if (mode === "shadowDaily") footer = "LEGO Marveldle — sombra diária (2 em 2 horas) de LEGO Marvel Super Heroes";
    else footer = "LEGO Marveldle — desafio de 2 em 2 horas de LEGO Marvel Super Heroes";
    lines.push("", footer);
    return lines.join("\n");
  }

  function buildMultiShareText() {
    const cfg = MULTI_MODES[mode];
    const state = activeMultiState();
    const secrets = activeMultiToday().secrets;
    const today_ = activeMultiToday();
    const used = state.totalGuessIds.length;
    const scoreLabel = state.won ? `${used}/${cfg.maxTries}` : `X/${cfg.maxTries}`;
    const modeName = mode === "duo" ? "Duo" : "Team";
    const lines = [`🧱 Lego Marveldle ${modeName} #${today_.puzzleNumber} — ${scoreLabel}`, ""];

    secrets.forEach((secret, i) => {
      const board = state.boards[i];
      lines.push(`Tabuleiro ${i + 1}${board.solved ? " ✅" : ""}`);
      board.guessIds.forEach((id) => {
        const c = byId(id);
        const rowEmojis = COLUMNS
          .filter((col) => col.type !== "photo")
          .map((col) => {
            if (col.type === "category") return emojiForCategory(compareCategory(col, c, secret).cls);
            if (col.type === "letter") return emojiForNumeric(compareLetter(col, c, secret));
            return emojiForNumeric(compareNumeric(col, c, secret));
          })
          .join("");
        lines.push(rowEmojis);
      });
      lines.push("");
    });

    lines.push(mode === "duo"
      ? "LEGO Marveldle — modo Duo de LEGO Marvel Super Heroes"
      : "LEGO Marveldle — modo Team de LEGO Marvel Super Heroes");
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
    if (id === "modal-gallery") renderGalleryModal();
    if (id === "modal-achievements") renderAchievementsModal();
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
     Contagem regressiva até o próximo período de 2h (Desafio e Sombra
     Diário compartilham o mesmo relógio de reset)
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
    if (!resetCountdownEl || !isDailyMode()) return;
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
     Modos livres (Prática / Sombra Prática) — novo personagem sob demanda
     --------------------------------------------------------------------- */
  function startNewFreeRound() {
    if (mode === "shadowPractice") {
      const previousId = shadowPracticeState.secretId;
      shadowPracticeState = newFreeState(previousId);
      persistShadowPracticeState();
    } else {
      const previousId = practiceState.secretId;
      practiceState = newFreeState(previousId);
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
     Modos Sombra (Diário e Prática) — o segredo aparece borrado acima do
     tabuleiro
     --------------------------------------------------------------------- */
  function updateShadowHint() {
    if (!isShadowMode()) return;
    const secret = activeSecret();
    if (shadowHintImg && secret) {
      shadowHintImg.src = secret.img;
      shadowHintImg.alt = "";
    }
  }

  /* ---------------------------------------------------------------------
     Troca de modo (Desafio 2h / Sombra Diário / Prática / Sombra Prática)
     --------------------------------------------------------------------- */
  const MODE_META = {
    challenge:      { icon: "⏱",  label: "DESAFIO 2H" },
    shadowDaily:    { icon: "🌘", label: "SOMBRA DIÁRIO" },
    practice:       { icon: "🎲", label: "PRÁTICA LIVRE" },
    shadowPractice: { icon: "🌑", label: "SOMBRA PRÁTICA" },
    duo:            { icon: MULTI_MODES.duo.icon,  label: MULTI_MODES.duo.label },
    team:           { icon: MULTI_MODES.team.icon, label: MULTI_MODES.team.label },
  };

  function markActiveModeCard() {
    modeCards.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
  }

  function applyModeUI() {
    const meta = MODE_META[mode] || MODE_META.challenge;
    if (modeIndicatorIcon) modeIndicatorIcon.textContent = meta.icon;
    if (modeIndicatorLabel) modeIndicatorLabel.textContent = meta.label;

    if (challengeRibbon) challengeRibbon.classList.toggle("hidden", mode !== "challenge");
    if (shadowDailyRibbon) shadowDailyRibbon.classList.toggle("hidden", mode !== "shadowDaily");
    if (practiceRibbon) practiceRibbon.classList.toggle("hidden", mode !== "practice");
    if (shadowRibbon) shadowRibbon.classList.toggle("hidden", mode !== "shadowPractice");
    if (duoRibbon) duoRibbon.classList.toggle("hidden", mode !== "duo");
    if (teamRibbon) teamRibbon.classList.toggle("hidden", mode !== "team");

    if (resetChip) resetChip.classList.toggle("hidden", !isDailyMode());
    if (resetLabel) {
      resetLabel.textContent = mode === "shadowDaily" ? "PRÓXIMA SOMBRA EM"
        : mode === "duo" ? "PRÓXIMO DUO EM"
        : mode === "team" ? "PRÓXIMO TEAM EM"
        : "PRÓXIMO DESAFIO EM";
    }
    if (freeChip) freeChip.classList.toggle("hidden", isDailyMode());
    if (freeChipIcon) freeChipIcon.textContent = mode === "shadowPractice" ? "🌑" : "🎲";
    if (freeChipText) {
      freeChipText.textContent = mode === "shadowPractice"
        ? "SEM LIMITE DE TENTATIVAS — USE A SOMBRA COMO PISTA"
        : "SEM LIMITE DE TENTATIVAS — JOGUE QUANTAS VEZES QUISER";
    }

    if (shadowHint) shadowHint.classList.toggle("hidden", !isShadowMode());
    updateShadowHint();

    if (taglineDetail) {
      if (mode === "practice") {
        taglineDetail.textContent = "sem limite de tentativas • personagem novo a qualquer hora";
      } else if (mode === "shadowPractice") {
        taglineDetail.textContent = "sem limite de tentativas • silhueta do segredo como pista extra";
      } else if (mode === "shadowDaily") {
        taglineDetail.textContent = "8 tentativas • muda a cada 2h • silhueta do segredo como pista extra";
      } else if (mode === "duo") {
        taglineDetail.textContent = `${MULTI_MODES.duo.maxTries} tentativas • ${MULTI_MODES.duo.boards} personagens ao mesmo tempo • muda a cada 2h`;
      } else if (mode === "team") {
        taglineDetail.textContent = `${MULTI_MODES.team.maxTries} tentativas • ${MULTI_MODES.team.boards} personagens ao mesmo tempo • muda a cada 2h`;
      } else {
        taglineDetail.textContent = "8 tentativas • 1 personagem • muda a cada 2h • conta pras estatísticas";
      }
    }

    if (issueBadge) issueBadge.textContent = `#${today.puzzleNumber}`;
    if (issueBadgeShadow) issueBadgeShadow.textContent = `#${todayShadow.puzzleNumber}`;
    if (issueBadgeDuo) issueBadgeDuo.textContent = `#${todayDuo.puzzleNumber}`;
    if (issueBadgeTeam) issueBadgeTeam.textContent = `#${todayTeam.puzzleNumber}`;

    if (boardWrapEl) boardWrapEl.classList.toggle("hidden", isMultiMode());
    if (multiBoardWrap) multiBoardWrap.classList.toggle("hidden", !isMultiMode());

    markActiveModeCard();
    renderBoard();
    refreshMeta();
    if (isDailyMode()) tickResetCountdown();
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
