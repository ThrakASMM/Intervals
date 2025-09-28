// Reconnaissance des intervalles — niveaux sans mode imposé, fade-out simultané, training-only pour intervalles/octaves
document.addEventListener('DOMContentLoaded', () => {
  // ---- Niveaux (plus de "mode" ici) ----
  const LEVELS = {
    level1: { intervals: ['m2','M2','m3','M3','P4','P5'], maxOct: 1, questions: 20 },
    level2: { intervals: ['m2','M2','m3','M3','P4','P5','m6','M6'], maxOct: 2, questions: 20 },
    level3: { intervals: ['m2','M2','m3','M3','P4','TT','P5','m6','M6','m7','M7'], maxOct: 3, questions: 20 },
    level4: { intervals: ['m2','M2','m3','M3','P4','TT','P5','m6','M6','m7','M7','P8'], maxOct: 5, questions: 20 },
  };

  // ---- Vitesse séparé (tes valeurs) ----
  const PREDELAY_BY_LEVEL = {
    training: 400,
    level1: 400,
    level2: 440,
    level3: 460,
    level4: 480,
  };
  const SIMULTANEOUS_PLAY_MS = 1600;
  const EXAM_LIMIT_S = 5;

  // ---- Intervalles / notes ----
  const ALL_INTERVALS = [
    { code:'m2', st:1,  label:'m2' },{ code:'M2', st:2,  label:'M2' },
    { code:'m3', st:3,  label:'m3' },{ code:'M3', st:4,  label:'M3' },
    { code:'P4', st:5,  label:'P4' },{ code:'TT', st:6,  label:'Tritone' },
    { code:'P5', st:7,  label:'P5' },{ code:'m6', st:8,  label:'m6' },
    { code:'M6', st:9,  label:'M6' },{ code:'m7', st:10, label:'m7' },
    { code:'M7', st:11, label:'M7' },{ code:'P8', st:12, label:'P8' },
  ];
  const intervalByCode = Object.fromEntries(ALL_INTERVALS.map(d => [d.code, d]));
  const noteMap = { 'C':0,'Db':1,'D':2,'Eb':3,'E':4,'F':5,'Gb':6,'G':7,'Ab':8,'A':9,'Bb':10,'B':11 };
  const reverseNoteMap = Object.keys(noteMap).reduce((a,k)=>(a[noteMap[k]]=k,a),{});
  const AUDIO_MIN_OCT = 2, AUDIO_MAX_OCT = 5;

  // ---- UI elements ----
  const progressDiv = document.getElementById('progress');
  const scoreDiv = document.getElementById('score');
  const timingDiv = document.getElementById('timing');

  const menu = document.getElementById('menu');
  const game = document.getElementById('game');
  const resultDiv = document.getElementById('result');
  const feedbackDiv = document.getElementById('feedback');
  const answerButtonsWrap = document.getElementById('answer-buttons');

  // Panneau Training
  const trainingOnlyBlocks = Array.from(document.querySelectorAll('.training-only'));
  const intervalChecksWrap = document.getElementById('interval-checks');
  const intervalWarning = document.getElementById('interval-warning');
  const selectedCountEl = document.getElementById('selected-count');
  const selectAllBtn = document.getElementById('select-all-intervals');
  const deselectAllBtn = document.getElementById('deselect-all-intervals');
  const maxOctavesInput = document.getElementById('max-octaves');
  const maxOctavesLabel = document.getElementById('max-octaves-label');

  // Radios
  const getGametype = () => document.querySelector('[name="gametype"]:checked')?.value || 'training';
  const getSelectedMode = () => document.querySelector('[name="mode"]:checked')?.value || 'sequential';

  // Boutons jeu
  const startBtn = document.getElementById('start-game');
  const backBtn = document.getElementById('back-to-menu');
  const restartBtn = document.getElementById('restart-test');
  const nextBtn = document.getElementById('next-question');
  const replaySeqBtn = document.getElementById('replay-interval-seq');
  const replaySimBtn = document.getElementById('replay-interval-sim');

  // ---- State ----
  let config = {
    gametype:'training',
    mode:'sequential',
    allowedIntervals: ALL_INTERVALS.map(d=>d.code),
    maxOct:0, totalQuestions:10,
    preDelayMs: PREDELAY_BY_LEVEL.training,
    playbackMs: SIMULTANEOUS_PLAY_MS
  };
  let currentPair=null, correctIntervalCode='', questionIndex=0, correctCount=0, scoreTotal=0;
  let startTime=null, questionStartTime=null, hudTimerActive=false, perQuestion=[];
  let preloadedSounds={};

  // ---- Build Training checkboxes ----
  function buildTrainingIntervalChecks(){
    intervalChecksWrap.innerHTML='';
    ALL_INTERVALS.forEach(d=>{
      const l=document.createElement('label');
      const c=document.createElement('input'); c.type='checkbox'; c.value=d.code; c.checked=true;
      c.addEventListener('change', () => { updateSelectedCount(); applySettings(); });
      l.appendChild(c); l.append(d.label);
      intervalChecksWrap.appendChild(l);
    });
    updateSelectedCount();
  }
  function updateSelectedCount(){
    const n = intervalChecksWrap.querySelectorAll('input[type="checkbox"]:checked').length;
    selectedCountEl.textContent = `${n} sélectionné${n>1?'s':''}`;
  }
  buildTrainingIntervalChecks();

  // ---- Helpers affichage ----
  function setTrainingVisibility(on){
    trainingOnlyBlocks.forEach(el=>{
      el.style.display = on ? 'block' : 'none';
      el.setAttribute('aria-hidden', on ? 'false' : 'true');
      Array.from(el.querySelectorAll('input,button')).forEach(inp => inp.disabled = !on);
    });
  }

  // ---- Config ----
  function applySettings(){
    config.gametype = getGametype();
    config.mode = getSelectedMode(); // <— toujours choisi par l’utilisateur (niveaux & training)

    if(config.gametype==='training'){
      const checked = Array.from(intervalChecksWrap.querySelectorAll('input:checked')).map(c=>c.value);
      config.allowedIntervals = checked;
      config.totalQuestions = 10;
      config.maxOct = parseInt(maxOctavesInput.value)||0;
      intervalWarning.style.display = checked.length ? 'none' : 'block';
      config.preDelayMs = PREDELAY_BY_LEVEL.training;
      setTrainingVisibility(true);
    }else{
      const lv = LEVELS[config.gametype];
      config.allowedIntervals = lv.intervals.slice();
      config.totalQuestions = lv.questions;
      config.maxOct = lv.maxOct;
      config.preDelayMs = PREDELAY_BY_LEVEL[config.gametype] ?? 300;
      intervalWarning.style.display = 'none';
      setTrainingVisibility(false);
    }
    maxOctavesLabel.textContent = String(maxOctavesInput.value);
  }

  // ---- Events ----
  document.querySelectorAll('[name="gametype"]').forEach(r=>r.addEventListener('change', applySettings));
  document.querySelectorAll('[name="mode"]').forEach(r=>r.addEventListener('change', applySettings));
  selectAllBtn.onclick=()=>{ intervalChecksWrap.querySelectorAll('input').forEach(c=>c.checked=true); updateSelectedCount(); applySettings(); };
  deselectAllBtn.onclick=()=>{ intervalChecksWrap.querySelectorAll('input').forEach(c=>c.checked=false); updateSelectedCount(); applySettings(); };
  maxOctavesInput.oninput=()=>{ maxOctavesLabel.textContent=maxOctavesInput.value; if(getGametype()==='training') applySettings(); };

  startBtn.onclick=startGame;
  backBtn.onclick=()=>backToMenu();
  restartBtn.onclick=startGame;
  nextBtn.onclick=()=>{ questionIndex++; nextQuestion(); };
  replaySeqBtn.onclick=()=>replayInterval('sequential');
  replaySimBtn.onclick=()=>replayInterval('simultaneous');

  // ---- Init ----
  applySettings();

  // ---- HUD ----
  function updateHud(){
    progressDiv.textContent=`Question ${Math.min(questionIndex, config.totalQuestions)}/${config.totalQuestions}`;
    scoreDiv.textContent=`Score : ${scoreTotal}`;
    timingDiv.textContent=`Temps: ${ startTime ? ((Date.now()-startTime)/1000).toFixed(1) : '0.0'}s`;
  }
  function tickHudTimer(){ updateHud(); if(hudTimerActive) setTimeout(tickHudTimer,500); }
  function skipQuestion(){ if(questionIndex<config.totalQuestions){ questionIndex++; setTimeout(nextQuestion,150);} else{ endGame(); } updateHud(); }

  // ---- Cycle jeu ----
  async function startGame(){
    applySettings();
    if(config.gametype==='training' && !config.allowedIntervals.length){ intervalWarning.style.display='block'; return; }
    menu.style.display='none'; game.style.display='block';
    resultDiv.textContent=''; clearFeedback();
    answerButtonsWrap.innerHTML='';
    questionIndex=0; correctCount=0; scoreTotal=0; perQuestion=[]; nextBtn.disabled=false;
    buildAnswerButtonsTwoColumns();
    startTime=Date.now(); hudTimerActive=true; tickHudTimer();
    await preloadSounds().catch(()=>{});
    window.scrollTo({top:0,behavior:'smooth'});
    skipQuestion();
  }
  function backToMenu(){ stopAllSounds(); hudTimerActive=false; game.style.display='none'; menu.style.display='block'; }
  function restartTest(){ stopAllSounds(); hudTimerActive=false; game.style.display='none'; startGame(); }

  function endGame(){
    hudTimerActive=false;
    const timeTaken=((Date.now()-startTime)/1000).toFixed(2);
    const validated = perQuestion.filter(s=>s.isCorrect && s.responseTime<=EXAM_LIMIT_S).length;
    const pct = config.totalQuestions? Math.round((validated/config.totalQuestions)*100):0;
    const avgTime = perQuestion.length ? perQuestion.reduce((a,s)=>a+s.responseTime,0)/perQuestion.length : 0;
    const slow = perQuestion.filter(s=>s.isCorrect && s.responseTime>EXAM_LIMIT_S).length;

    let label, color, imageSrc;
    if (pct >= 80) { label='Très bien'; color='#1f8b24'; imageSrc='img/success.png'; }
    else if (pct >= 40) { label=(pct>=60?'Bien':'Moyen'); color=(pct>=60?'#2e7dd7':'#f39c12'); imageSrc='img/ok.png'; }
    else { label='Insuffisant'; color='#c62828'; imageSrc='img/fail.png'; }

    if(config.gametype==='training'){
      resultDiv.innerHTML = `<em>Training terminé. Tu peux relancer un set quand tu veux.</em>`;
      nextBtn.disabled=true; window.scrollTo({top:0,behavior:'smooth'}); return;
    }

    resultDiv.innerHTML = `
      <p><strong>Test terminé !</strong></p>
      <p style="color:${color}; font-size:1.2rem; font-weight:700;">${label}</p>
      ${imageSrc ? `<img src="${imageSrc}" alt="${label}" class="score-img">` : ''}
      <p>Bonnes réponses (brut) : ${correctCount} / ${config.totalQuestions}</p>
      <p>Validées (≤ ${EXAM_LIMIT_S}s) : <strong>${validated} / ${config.totalQuestions} (${pct}%)</strong>
         ${slow? `<br><span style="font-size:13px;color:#c62828;">(${slow} correctes mais > ${EXAM_LIMIT_S}s → non validées)</span>`:''}
      </p>
      <p>Score total : ${scoreTotal} points</p>
      <p>Temps total : ${timeTaken}s • Temps moyen/question : ${avgTime.toFixed(1)}s</p>
    `;
    nextBtn.disabled=true;
    window.scrollTo({top:0,behavior:'smooth'});
  }

  // ---- Tirage question ----
  const getRandom = arr => arr[Math.floor(Math.random()*arr.length)];
  function sortNotes(arr){ const toAbs=n=>noteMap[n.slice(0,-1)]+12*parseInt(n.slice(-1),10); return arr.sort((a,b)=>toAbs(a)-toAbs(b)); }
  function getRandomBaseNoteForSemis(totalSemis){
    const jump=Math.floor(totalSemis/12);
    const maxStart = Math.max(AUDIO_MIN_OCT, AUDIO_MAX_OCT - jump - 1);
    const startOct = Math.max(AUDIO_MIN_OCT, Math.min(4, maxStart));
    const oct = Math.floor(Math.random()*(startOct-AUDIO_MIN_OCT+1))+AUDIO_MIN_OCT;
    const name = getRandom(Object.keys(noteMap));
    return `${name}${oct}`;
  }

  function generateQuestion(){
    const code = getRandom(config.allowedIntervals);
    const intv = intervalByCode[code];
    const extra = Math.floor(Math.random()*(config.maxOct+1)); // 0..max
    const semis = intv.st + 12*extra;

    const base = getRandomBaseNoteForSemis(semis);
    const baseIdx = noteMap[base.slice(0,-1)];
    let oct = parseInt(base.slice(-1),10);

    let targetIdx = (baseIdx + (semis % 12)) % 12;
    const jump = Math.floor(semis/12);
    oct = Math.min(AUDIO_MAX_OCT, oct + jump + (targetIdx<baseIdx ? 1 : 0));

    const second = `${reverseNoteMap[targetIdx]}${oct}`;
    currentPair = sortNotes([base, second]);
    correctIntervalCode = code;

    questionStartTime = Date.now();
    clearFeedback();
    replayInterval('selected');
  }
  function nextQuestion(){ clearFeedback(); resultDiv.textContent=''; nextBtn.disabled=false; updateHud(); generateQuestion(); }

  // ---- Audio ----
  function preloadSounds(){
    const promises=[];
    for(let o=AUDIO_MIN_OCT;o<=AUDIO_MAX_OCT;o++){
      for(const n of Object.keys(noteMap)){
        const note=`${n}${o}`, a=new Audio(`audio/${note}.mp3`);
        preloadedSounds[note]=a;
        promises.push(new Promise(res=>{
          a.addEventListener('canplaythrough',()=>res(),{once:true});
          a.addEventListener('error',()=>res(),{once:true});
        }));
      }
    }
    return Promise.all(promises);
  }
  function stopAllSounds(){ Object.values(preloadedSounds).forEach(a=>{ try{a.pause(); a.currentTime=0; a.volume=1;}catch(_){}}); }

  // Fade-out progressif (simultané)
  function fadeOut(audio, duration=2000) {
    if (!audio) return;
    let vol = 1.0;
    const step = 50;
    const decrement = vol / (duration / step);
    const fade = setInterval(() => {
      vol -= decrement;
      if (vol <= 0) {
        clearInterval(fade);
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
      } else {
        audio.volume = Math.max(vol,0);
      }
    }, step);
  }

  function replayInterval(mode='selected'){
    stopAllSounds(); if(!currentPair) return;
    const selectedMode = getSelectedMode(); // <— toujours le choix utilisateur
    const [n1,n2] = currentPair;
    const a1=preloadedSounds[n1], a2=preloadedSounds[n2];
    if(!a1||!a2) return;

    if(selectedMode==='sequential'){
      try{
        a1.currentTime=0; a1.play().then(()=>{
          setTimeout(()=>{ a2.currentTime=0; a2.play(); }, config.preDelayMs);
        });
      }catch(_){}
    }else{
      try{ a1.currentTime=0; a1.play(); }catch(_){}
      try{ a2.currentTime=0; a2.play(); }catch(_){}
      setTimeout(() => { fadeOut(a1, 2000); fadeOut(a2, 2000); }, config.playbackMs);
    }
  }

  // ---- Réponses 2 colonnes ----
  function buildAnswerButtonsTwoColumns(){
    answerButtonsWrap.innerHTML='';
    const left=document.createElement('div'); left.className='interval-col';
    const right=document.createElement('div'); right.className='interval-col';
    ['m2','m3','P4','TT','m6','m7'].forEach(c=>appendBtn(left,c));
    ['M2','M3','P5','M6','M7','P8'].forEach(c=>appendBtn(right,c));
    answerButtonsWrap.append(left,right);
  }
  function appendBtn(col, code){
    const b=document.createElement('button'); b.className='interval-btn'; b.textContent=code;
    b.addEventListener('click',()=>validateAnswer(code));
    col.appendChild(b);
  }

  // ---- Scoring ----
  function getDifficultyMultiplier(cfg){
    const baseCount=4;
    const countBoost = 1 + 0.08 * Math.max(0, (cfg.allowedIntervals?.length||baseCount)-baseCount);
    const compoundBoost = 1 + 0.10 * (cfg.maxOct||0);
    const modeBoost = (cfg.mode==='sequential')?1.00:1.20; // simultané légèrement plus gratifiant
    const level4Boost = (cfg.gametype==='level4')?1.05:1.00;
    return Math.min(2.2, Number((countBoost*compoundBoost*modeBoost*level4Boost).toFixed(2)));
  }
  function getTimeBonus(t){
    const s=Math.max(0,t);
    if(s<=0.8) return 150;
    if(s<=1.5) return 120;
    if(s<=2.5) return 100;
    if(s<=3.5) return 70;
    if(s<=5.0) return 40;
    return 5;
  }
  function computeQuestionPoints(isCorrect, t, cfg){
    if(!isCorrect) return 0;
    const base=100, tb=getTimeBonus(t), mult=getDifficultyMultiplier(cfg);
    return Math.round((base+tb)*mult);
  }

  // ---- Feedback ----
  function clearFeedback(){
    feedbackDiv.textContent='';
    feedbackDiv.classList.remove('ok','err');
  }

  // ---- Validation ----
  function validateAnswer(code){
    const t=(Date.now()-questionStartTime)/1000;
    nextBtn.disabled=true;
    const ok = (code===correctIntervalCode);
    if(ok){
      const gained=computeQuestionPoints(true,t,config);
      scoreTotal+=gained; correctCount++;
      const slow=t>EXAM_LIMIT_S;
      perQuestion.push({isCorrect:true, responseTime:t, points:gained, slow});
      feedbackDiv.innerHTML = `Correct&nbsp;✅`;
      feedbackDiv.classList.remove('err'); feedbackDiv.classList.add('ok');
      updateHud();
      setTimeout(()=>{ nextBtn.disabled=false; skipQuestion(); }, 700);
    }else{
      perQuestion.push({isCorrect:false, responseTime:t, points:0, slow:t>EXAM_LIMIT_S});
      feedbackDiv.innerHTML = `Incorrect&nbsp;❌ — bonne réponse&nbsp;: <strong>${correctIntervalCode}</strong>`;
      feedbackDiv.classList.remove('ok'); feedbackDiv.classList.add('err');
      setTimeout(()=>{ nextBtn.disabled=false; }, 900);
    }
  }
});