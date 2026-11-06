/* 고객 한마디 분류기 — 화면.
 *
 * 흐름: 문장 → 가림(mask.js, 브라우저 안) → AI(api/classify) → 실패하면 규칙(rules.js)
 * 채점: 정답 100건을 규칙으로, 또는 AI로(BATCH 건씩 나눠) 돌려 맞힌 비율을 잰다.
 */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const S = { criteria: null, test: [], practice: [], aiResults: null, defaultModel: null };

  const BATCH = 10;  // 채점 때 한 번에 보내는 문장 수. 서버의 MAX_TEXTS(20) 이하여야 한다

  // 공식 가격표(https://aistudio.google.com/docs/pricing, 2026-11-06 확인)의 Standard 표에서
  // Free Tier 가 «Free of charge» 인 글쓰기 모델 중 5개. 음성·번역·임베딩·TTS 는 뺐다.
  // 순서는 «추정»이다: 하루 무료 요청 수는 가격표에 없어 대조하지 못했다.
  // «Lite 계열의 한도가 더 높을 것»이라는 짐작으로 앞에 둔 것일 뿐, 한도가 높은 순서가 아니다.
  const MODELS = [
    { id: "gemini-3.5-flash-lite" },
    { id: "gemini-3.1-flash-lite" },
    { id: "gemini-3.8-flash" },
    { id: "gemini-3.6-flash", note: "이전 세대" },
    { id: "gemini-3-flash-preview", note: "프리뷰 · 구형" },
  ];
  const CUSTOM = "__custom__";
  const STORE_CHOICE = "classifier.model.choice";
  const STORE_CUSTOM = "classifier.model.custom";

  // 시크릿 창 등에서 localStorage 가 막혀 있어도 앱은 그대로 돈다
  function remember(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 기억만 못 할 뿐이다 */ }
  }
  function recall(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  async function load() {
    const [c, t, p] = await Promise.all([
      fetch("criteria.json").then(r => r.json()),
      fetch("data/answer100.json").then(r => r.json()),
      fetch("data/practice200.json").then(r => r.json()),
    ]);
    S.criteria = c; S.test = t; S.practice = p;
    renderCriteria();
  }

  // ── 탭 ──────────────────────────────────────────────
  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
    ["try", "score", "rules"].forEach(k => { $("#tab-" + k).hidden = k !== b.dataset.tab; });
  }));

  // ── AI 모델 고르기 ───────────────────────────────────
  // 돌려주는 값이 요청의 "model" 이 된다. 빈 문자열이면 서버가 기본 모델을 쓴다.
  function currentModel() {
    const choice = $("#model-select").value;
    return choice === CUSTOM ? $("#model-custom").value.trim() : choice;
  }

  function renderModelNow() {
    const choice = $("#model-select").value;
    const name = currentModel();
    const server = S.defaultModel ? `서버 기본값 (${S.defaultModel})` : "서버 기본값 (이름 확인 불가 — 서버 함수에 닿지 못함)";
    let line;
    if (choice === CUSTOM && !name) line = `모델 이름을 입력하세요. 입력 전에는 ${server}으로 호출합니다.`;
    else if (!name) line = `지금 호출하는 모델: ${server}`;
    else line = `지금 호출하는 모델: ${name}`;
    $("#model-now").textContent = line;
  }

  function setupModelPicker() {
    const select = $("#model-select");
    const custom = $("#model-custom");
    const add = (value, label) => {
      const o = document.createElement("option");
      o.value = value; o.textContent = label;
      select.appendChild(o);
    };
    add("", "서버 기본값");
    MODELS.forEach(m => add(m.id, m.note ? `${m.id} (${m.note})` : m.id));
    add(CUSTOM, "직접 입력…");

    const saved = recall(STORE_CHOICE);
    if ([...select.options].some(o => o.value === saved)) select.value = saved;
    custom.value = recall(STORE_CUSTOM) || "";
    custom.hidden = select.value !== CUSTOM;
    renderModelNow();

    select.addEventListener("change", () => {
      custom.hidden = select.value !== CUSTOM;
      remember(STORE_CHOICE, select.value);
      renderModelNow();
      if (!custom.hidden) custom.focus();
    });
    custom.addEventListener("input", () => {
      remember(STORE_CUSTOM, custom.value.trim());
      renderModelNow();
    });
  }

  async function loadDefaultModel() {
    try {
      const r = await fetch("api/classify");
      if (r.ok) S.defaultModel = (await r.json()).default || null;
    } catch (e) { /* 서버 함수가 없으면 이름만 못 보여 줄 뿐이다 */ }
    renderModelNow();
  }

  // ── AI 호출 ─────────────────────────────────────────
  async function askAI(maskedTexts, model = currentModel()) {
    try {
      const r = await fetch("api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: maskedTexts, criteria: S.criteria, model }),
      });
      if (!r.ok) return { results: null, reason: `서버 함수가 없습니다 (${r.status}) — 배포하면 생깁니다` };
      return await r.json();
    } catch (e) {
      return { results: null, reason: "서버 함수에 닿지 못했습니다" };
    }
  }

  function chips(el, res) {
    el.innerHTML = ["category", "sentiment", "urgency"]
      .map(k => `<span class="chip ${res[k]}">${res[k]}</span>`).join("");
  }

  // ── 분류해 보기 ─────────────────────────────────────
  $("#btn-sample").addEventListener("click", () => {
    const r = S.practice[Math.floor(Math.random() * S.practice.length)];
    $("#input").value = r.text;
  });

  $("#btn-classify").addEventListener("click", async () => {
    const text = $("#input").value.trim();
    if (!text) return;
    const btn = $("#btn-classify");
    btn.disabled = true; btn.textContent = "분류 중…";

    const m = Mask.mask(text);
    $("#sent").hidden = false;
    $("#sent-text").textContent = m.masked;
    $("#sent-found").innerHTML = m.found.length
      ? m.found.map(f => `<span class="tag">${f.type} 가림</span>`).join("")
      : `<span class="muted">가린 것 없음</span>`;

    const rule = Rules.classify(m.masked, S.criteria);
    const ai = await askAI([m.masked]);
    const got = ai.results && ai.results[0];

    $("#result").hidden = false;
    if (got) {
      $("#main-by").textContent = "AI · " + (ai.model || "");
      chips($("#main-chips"), got);
      $("#main-reason").textContent = got.reason || "";
      $("#note").hidden = true;
    } else {
      $("#main-by").textContent = "규칙";
      chips($("#main-chips"), rule);
      $("#main-reason").textContent = `분류: ${rule.why.category} · 감정: ${rule.why.sentiment} · 긴급도: ${rule.why.urgency}`;
      $("#note").hidden = false;
      $("#note").textContent = `AI 없이 규칙으로만 분류했습니다 — ${ai.reason || "AI 응답 없음"}`;
    }
    chips($("#rule-chips"), rule);
    $("#rule-reason").textContent = `분류: ${rule.why.category}`;
    $("#card-rule").hidden = !got;

    btn.disabled = false; btn.textContent = "분류하기";
  });

  // ── 채점 ───────────────────────────────────────────
  function pct(x) { return x.toFixed(x % 1 ? 1 : 0) + "%"; }

  function showScore(who, s) {
    $("#score-table").hidden = false;
    for (const k of ["category", "sentiment", "urgency"]) {
      document.querySelector(`[data-k="${who}-${k}"]`).textContent = pct(s.accuracy[k]);
    }
    document.querySelector(`[data-k="${who}-all"]`).textContent = `${s.n - s.wrong.length} / ${s.n}`;
    $("#wrong").hidden = false;
    $("#wrong-who").textContent = (who === "ai" ? "— AI" : "— 규칙") + " · 정답 → 판정";
    $("#wrong-list").innerHTML = s.wrong.slice(0, 15).map(w => {
      const diff = ["category", "sentiment", "urgency"].filter(k => w.got[k] !== w.want[k])
        .map(k => `${w.want[k]}→${w.got[k]}`).join(" · ");
      return `<li><span class="t">${w.text}</span><br><span class="d">${diff}${w.note ? " · " + w.note : ""}</span></li>`;
    }).join("") + (s.wrong.length > 15 ? `<li class="d">… 외 ${s.wrong.length - 15}건</li>` : "");
  }

  $("#btn-score-rule").addEventListener("click", () => {
    const s = Rules.score(S.test, r => Rules.classify(Mask.mask(r.text).masked, S.criteria));
    showScore("rule", s);
    $("#score-msg").hidden = true;
  });

  $("#btn-score-ai").addEventListener("click", async () => {
    const btn = $("#btn-score-ai");
    btn.disabled = true;
    const masked = S.test.map(r => Mask.mask(r.text).masked);
    const results = [];
    const model = currentModel();  // 채점 도중 드롭다운을 바꿔도 한 번의 채점은 한 모델로 끝낸다
    let usedModel = "";
    for (let i = 0; i < masked.length; i += BATCH) {
      const progress = `AI 채점 중… ${i}/${masked.length}`;
      btn.textContent = progress;
      const batch = masked.slice(i, i + BATCH);
      let r = await askAI(batch, model);
      if (r.timeout) {  // 시간을 넘긴 묶음만 한 번 더 보낸다
        btn.textContent = `${progress} · 다시 시도`;
        r = await askAI(batch, model);
      }
      if (!r.results) {
        $("#score-msg").hidden = false;
        $("#score-msg").textContent = `AI로 채점하지 못했습니다 — ${r.reason}`;
        btn.disabled = false; btn.textContent = "AI로 채점";
        return;
      }
      results.push(...r.results);
      usedModel = r.model || usedModel;
    }
    // 답을 못 받은 문장은 «오답»으로 센다 — 빠진 것을 빼고 세면 점수가 부풀려진다
    const miss = { category: "-", sentiment: "-", urgency: "-" };
    S.aiResults = results;
    const s = Rules.score(S.test, (r, i) => results[i] || miss);
    showScore("ai", s);
    $("#score-ai-head").textContent = usedModel ? `AI · ${usedModel}` : "AI";
    const blank = results.filter(x => !x).length;
    $("#score-msg").hidden = !blank;
    if (blank) $("#score-msg").textContent = `AI가 답하지 않은 문장 ${blank}건은 오답으로 셌습니다.`;
    $("#btn-download").hidden = false;
    btn.disabled = false; btn.textContent = "AI로 채점";
  });

  $("#btn-download").addEventListener("click", () => {
    const rows = S.test.map((r, i) => ({ id: r.id, text: r.text, 정답: r, AI: S.aiResults[i] }));
    const blob = new Blob([JSON.stringify(rows, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "ai_채점결과.json"; a.click();
  });

  // ── 기준 ───────────────────────────────────────────
  function renderCriteria() {
    const c = S.criteria;
    $("#owner").textContent = c.owner;
    $("#crit-cats").innerHTML = c.categories
      .map(x => `<tr><td>${x.name}</td><td>${x.definition}</td></tr>`).join("");
    $("#crit-priority").textContent = c.priority.join(" → ") + " 순서로 먼저 봅니다.";
    $("#crit-priority-reason").textContent = c.priority_reason;
    $("#crit-sent").textContent = c.sentiment.guide;
    $("#crit-urg").textContent = c.urgency.guide;
  }

  setupModelPicker();
  loadDefaultModel();
  load();
})();

