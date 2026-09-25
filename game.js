// ==== 魔法学院 〜見習い魔法使いの一日〜 ====
// 2D トップダウンRPG (Canvas 2D) + Three.js で3Dモデルをスプライト化して使用

import * as THREE from './vendor/three/build/three.module.js';
import { GLTFLoader } from './vendor/three/examples/jsm/loaders/GLTFLoader.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const TILE = 40, COLS = 20, ROWS = 15;
const WIDTH = COLS * TILE, HEIGHT = ROWS * TILE;
const BLOCKING = new Set(['#', 'T', 'K', 'F', 'B', 'W', 'P', 'V']);
const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
const FAIRY_COLORS = { leaf: '#e0703f', water: '#4a9fd6', star: '#e0c040', queen: '#c77dff', shadow: '#4a3a6e', darkmage: '#8f2a4a', thunder: '#f2e04a', familiar: '#8fd6c9', astra: '#cfa6ff' };
// 妖精の種類ごとに使う3Dモデル由来スプライトのキー(star/queenはモデルなし=手続き型のまま)
const FAIRY_SPRITE_KEY = { leaf: 'fire', water: 'water' };
const MODEL_URLS = { fire: './assets/fire_fairy.glb', water: './assets/water_fairy.glb', castle: './assets/castle.glb' };
const SPELL_DEFS = {
  arcane: { label: 'アルカイン', color: '#fff2b0', dmgMult: 1, cooldown: 0.35, speed: 420, tone: [520, 0.08, 'square'] },
  fire: { label: 'ファイア', color: '#ff7a3f', dmgMult: 1.6, cooldown: 0.55, speed: 380, tone: [300, 0.1, 'sawtooth'] },
  ice: { label: 'アイス', color: '#7fd8ff', dmgMult: 0.8, cooldown: 0.28, speed: 460, tone: [700, 0.09, 'sine'] },
  wind: { label: 'ウィンド', color: '#b8ffb0', dmgMult: 0.7, cooldown: 0.4, speed: 520, tone: [880, 0.07, 'triangle'], piercing: true }
};
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const DEFAULT_MAX_POTIONS = 5;
const ACHIEVEMENTS = [
  { id: 'first_blood', name: '初陣', desc: '妖精を初めて倒した', check: () => totalKills >= 1 },
  { id: 'level5', name: '熟練の魔法使い', desc: 'レベル5に到達した', check: () => player && player.level >= 5 },
  { id: 'crystals', name: '魔法結晶コレクター', desc: '魔法結晶を3つ集めた', check: () => quest && quest.completed },
  { id: 'queen', name: '女王討伐者', desc: '妖精の女王を討伐した', check: () => quest && quest.queenDefeated },
  { id: 'darkmage', name: '封印を解いた者', desc: '闇の魔導士を討伐した', check: () => quest && quest.dungeonBossDefeated },
  { id: 'books', name: '図書委員', desc: '古い魔法書を3冊集めた', check: () => quest && quest.bookQuestCompleted },
  { id: 'herbalist', name: '薬草師', desc: '癒しの葉を4枚集めた', check: () => quest && quest.leafQuestCompleted },
  { id: 'hunter', name: '妖精ハンター', desc: '中庭の妖精を全滅させた', check: () => quest && quest.hunterQuestCompleted },
  { id: 'trials', name: '修行完了', desc: '修行の回廊を全10ステージ制覇した', check: () => quest && quest.trialStage > TRIAL_STAGE_MAX },
  { id: 'treasures', name: '秘宝発見者', desc: '学院に隠された秘宝を全て見つけた', check: () => quest && TREASURE_SPOTS && quest.treasuresFound.length >= TREASURE_SPOTS.length }
];
function playerTitle(q) {
  if (!q) return '新入生';
  if (q.familiarDefeated && q.astraDefeated && q.treasureRewardGiven && q.trialStage > TRIAL_STAGE_MAX && q.kentBookQuestCompleted) return '伝説の魔法使い';
  if (q.dungeonRewardGiven) return '学院の英雄';
  if (q.queenQuestCompleted) return '一人前の魔法使い';
  if (q.completed) return '結晶収集者';
  if (q.started) return '見習い魔法使い';
  return '新入生';
}
const TREASURE_SPOTS = [
  { scene: 'courtyard', x: 13, y: 4 },
  { scene: 'library', x: 10, y: 2 },
  { scene: 'forest', x: 15, y: 7 },
  { scene: 'dungeon1', x: 16, y: 7 },
  { scene: 'dungeon2', x: 3, y: 3 },
  { scene: 'greenhouse', x: 16, y: 7 }
];
const POTION_HEAL_RATIO = 0.35;

function toPx(t) { return t * TILE; }

// ---- 3Dモデル → 2Dスプライト焼き込み ----
const sprites = {};
let assetsLoadedCount = 0;
const ASSET_KEYS = Object.keys(MODEL_URLS);

function frameObjectForBake(camera, object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const radius = Math.max(size.x, size.y, size.z, 0.001) * 0.5;
  const dist = (radius / Math.sin((camera.fov * Math.PI / 180) / 2)) * 1.4;
  const dir = new THREE.Vector3(0.55, 0.62, 0.85).normalize();
  camera.position.copy(dir.multiplyScalar(dist));
  camera.near = Math.max(dist / 100, 0.01);
  camera.far = dist * 10;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

async function bakeAllSprites() {
  const SIZE = 256;
  const bakeCanvas = document.createElement('canvas');
  bakeCanvas.width = SIZE; bakeCanvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas: bakeCanvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const key1 = new THREE.DirectionalLight(0xffffff, 1.5); key1.position.set(3, 5, 4); scene.add(key1);
  const key2 = new THREE.DirectionalLight(0xbcd4ff, 0.6); key2.position.set(-4, 2, -3); scene.add(key2);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
  const loader = new GLTFLoader();

  for (const key of ASSET_KEYS) {
    try {
      const gltf = await loader.loadAsync(MODEL_URLS[key]);
      const obj = gltf.scene;
      scene.add(obj);
      frameObjectForBake(camera, obj);
      renderer.clear();
      renderer.render(scene, camera);
      const out = document.createElement('canvas');
      out.width = SIZE; out.height = SIZE;
      out.getContext('2d').drawImage(bakeCanvas, 0, 0);
      sprites[key] = out;
      scene.remove(obj);
    } catch (e) {
      console.error('モデルの読み込みに失敗:', key, e);
      sprites[key] = null;
    }
    assetsLoadedCount++;
  }
  renderer.dispose();
}

// ---- マップ生成 ----
function emptyMap() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill('.'));
}
function addBorder(map) {
  for (let x = 0; x < COLS; x++) { map[0][x] = '#'; map[ROWS - 1][x] = '#'; }
  for (let y = 0; y < ROWS; y++) { map[y][0] = '#'; map[y][COLS - 1] = '#'; }
}
function buildCourtyard() {
  const map = emptyMap();
  addBorder(map);
  map[0][10] = 'D';
  map[7][0] = 'D';
  map[7][COLS - 1] = 'D';
  map[ROWS - 1][10] = 'D';
  [[3, 3], [16, 3], [3, 11], [16, 11], [3, 7], [16, 7]].forEach(([x, y]) => map[y][x] = 'T');
  [[7, 7], [8, 7], [7, 8], [8, 8]].forEach(([x, y]) => map[y][x] = 'F');
  return map;
}
function buildDungeon1() {
  const map = emptyMap();
  addBorder(map);
  map[0][10] = 'D';
  map[ROWS - 1][10] = 'D';
  [[5, 5], [14, 5], [5, 9], [14, 9]].forEach(([x, y]) => map[y][x] = 'P');
  return map;
}
function buildDungeon2() {
  const map = emptyMap();
  addBorder(map);
  map[0][10] = 'D';
  [[6, 6], [13, 6], [6, 8], [13, 8]].forEach(([x, y]) => map[y][x] = 'P');
  return map;
}
function buildDungeon3() {
  const map = emptyMap();
  addBorder(map);
  map[0][10] = 'D';
  [2, 3].forEach(y => { for (let x = 3; x <= 6; x++) map[y][x] = 'B'; });
  [2, 3].forEach(y => { for (let x = 13; x <= 16; x++) map[y][x] = 'B'; });
  [[7, 7], [12, 7]].forEach(([x, y]) => map[y][x] = 'P');
  return map;
}
function buildForest() {
  const map = emptyMap();
  addBorder(map);
  map[7][0] = 'D';
  map[ROWS - 1][10] = 'D';
  [[4, 3], [15, 3], [4, 11], [15, 11], [9, 3], [9, 11]].forEach(([x, y]) => map[y][x] = 'W');
  return map;
}
function buildTrialRoom() {
  const map = emptyMap();
  addBorder(map);
  map[ROWS - 1][10] = 'D';
  return map;
}
function buildClassroom() {
  const map = emptyMap();
  addBorder(map);
  map[ROWS - 1][10] = 'D';
  for (let x = 3; x <= 7; x++) { map[5][x] = 'K'; map[8][x] = 'K'; }
  for (let x = 12; x <= 16; x++) { map[5][x] = 'K'; map[8][x] = 'K'; }
  return map;
}
function buildObservatory() {
  const map = emptyMap();
  addBorder(map);
  map[ROWS - 1][10] = 'D';
  [[5, 5], [14, 5], [5, 9], [14, 9], [10, 3]].forEach(([x, y]) => map[y][x] = 'P');
  return map;
}
function buildLibrary() {
  const map = emptyMap();
  addBorder(map);
  map[7][COLS - 1] = 'D';
  map[7][0] = 'D';
  [2, 3].forEach(y => { for (let x = 2; x <= 6; x++) map[y][x] = 'B'; });
  [2, 3].forEach(y => { for (let x = 13; x <= 17; x++) map[y][x] = 'B'; });
  [10, 11].forEach(y => { for (let x = 2; x <= 6; x++) map[y][x] = 'B'; });
  [10, 11].forEach(y => { for (let x = 13; x <= 17; x++) map[y][x] = 'B'; });
  return map;
}
function buildGreenhouse() {
  const map = emptyMap();
  addBorder(map);
  map[7][COLS - 1] = 'D';
  [[3, 3], [16, 3], [3, 11], [16, 11]].forEach(([x, y]) => map[y][x] = 'V');
  [[9, 3], [10, 3], [9, 11], [10, 11]].forEach(([x, y]) => map[y][x] = 'V');
  return map;
}

function collides(map, x, y, w, h) {
  const left = Math.floor(x / TILE), right = Math.floor((x + w - 1) / TILE);
  const top = Math.floor(y / TILE), bottom = Math.floor((y + h - 1) / TILE);
  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (ty < 0 || ty >= ROWS || tx < 0 || tx >= COLS) return true;
      if (BLOCKING.has(map[ty][tx])) return true;
    }
  }
  return false;
}
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---- 会話内容 ----
function pickFlavor(pool) { return pool[Math.floor(Math.random() * pool.length)]; }
function teacherLines(quest) {
  if (!quest.started) {
    return {
      lines: [
        'おお、よく来たね。見習い魔法使いくん。今年編入してきた子だったね。',
        '実は近頃、様子がおかしいんだ。中庭の妖精たちが、突然人を襲うようになった。',
        '本来あの子たちは、学院の庭をそっと見守る大人しい精霊のはずなんだが……。',
        '悪いが、退治して「魔法結晶」を3つ集めてきてくれないか? 何が起きているのか調べる手がかりになるはずだ。',
        '杖の魔法はスペースキーで放てるよ。頑張って!'
      ],
      complete: () => { quest.started = true; }
    };
  }
  if (quest.crystals < quest.required) {
    return { lines: [`まだ魔法結晶が ${quest.crystals}/${quest.required} 個だね。`, '中庭の妖精を探してごらん。心なしか、様子がおかしい子が多い気がするんだ。'], complete: () => {} };
  }
  if (!quest.completed) {
    return {
      lines: [
        'おお、3つとも集めてくれたのか! ありがとう。',
        'この結晶……妖精たちの魔力が、何か禍々しいもので歪められているように見える。',
        'まるで、地の底から嫌な気配が滲み出しているような……私の勘違いだといいんだが。',
        'そうだ、図書室のミナさんなら古い学院史に詳しいはずだ。相談してみてくれないか。',
        '中庭の西側に図書室への扉があるから、会ってみるといい。'
      ],
      complete: () => { quest.completed = true; }
    };
  }
  if (!quest.queenQuestStarted) {
    return { lines: ['図書室のミナさんには会えたかい?', '彼女は学院の古い記録にも詳しいから、きっと力になってくれるはずだ。'], complete: () => {} };
  }
  if (quest.queenQuestStarted && !quest.queenQuestCompleted) {
    return { lines: ['妖精の女王のことはミナさんから聞いたよ。', 'あの子も本来はこの森を守る心優しい存在のはずなんだが……気をつけて行っておいで。'], complete: () => {} };
  }
  if (!quest.dungeonUnlocked) {
    return { lines: ['ありがとう、おかげで中庭は平和になったよ。', 'ただ……女王を苦しめていた「何か」は、まだ解決していない気がするんだ。地下からは今も嫌な気配がする。'], complete: () => {} };
  }
  if (!quest.dungeonBossDefeated) {
    return { lines: ['地下迷宮に入ったのかい? くれぐれも気をつけてくれ。', '何が起きても、私はここで君の無事を祈っているよ。'], complete: () => {} };
  }
  return {
    lines: pickFlavor([
      ['ありがとう、おかげで学院は本当の意味で平和になったよ。', '見習いとは思えない、立派な魔法使いだ。'],
      ['最近は妖精たちも大人しいものだ。君のおかげだね。'],
      ['何か困ったことがあれば、いつでも教室に来るといい。'],
      ['修行の回廊や温室にも、まだやることが残っているんじゃないかな?']
    ]),
    complete: () => {}
  };
}
function alisaLines(quest) {
  if (!quest.started) return { lines: ['先生が中庭のことで悩んでるみたいだよ。', '教室に行って話しかけてみたら?'], complete: () => {} };
  if (quest.crystals < quest.required) return { lines: [`頑張って! あと${quest.required - quest.crystals}個だよ!`, '妖精たち、心なしかいつもよりピリピリしてる気がするんだよね……'], complete: () => {} };
  if (!quest.completed) return { lines: ['結晶、全部集まったね! 先生に届けに行こう!'], complete: () => {} };
  if (!quest.queenQuestStarted) return { lines: ['先生に結晶を渡した? すごいね!', '図書室のミナ先輩にも挨拶しておいでよ、中庭の西側だよ。古いこと何でも知ってるんだって。'], complete: () => {} };
  if (quest.queenQuestStarted && !quest.queenDefeated) return { lines: ['妖精の女王、見た? 気をつけてね!', '中庭のどこかにいるはずだよ。'], complete: () => {} };
  if (quest.queenDefeated && !quest.queenQuestCompleted) return { lines: ['女王を倒したの!? すごい!', '早くミナ先輩に報告しなきゃ!'], complete: () => {} };
  if (!quest.hunterQuestStarted) {
    return {
      lines: [
        '学院いちの魔法使いだね、あなたは!',
        'あ、そうだ。中庭にはまだ妖精が残ってるんじゃない?',
        `今のところ ${fairiesDefeated}/${SCENES.courtyard.enemySpawns.length} 匹しか倒してないよね。`,
        '全部倒してくれたら、私からもお祝いをあげるよ!'
      ],
      complete: () => { quest.hunterQuestStarted = true; }
    };
  }
  if (!quest.hunterQuestCompleted) {
    if (fairiesDefeated >= SCENES.courtyard.enemySpawns.length) {
      return {
        lines: ['え、もう全部倒したの!? やるね!', 'これは私の魔力のおすそ分け。(最大HP +20)', 'これからも頑張ってね!'],
        complete: () => { quest.hunterQuestCompleted = true; player.maxHp += 20; player.hp = player.maxHp; }
      };
    }
    return { lines: [`中庭の妖精、あと ${SCENES.courtyard.enemySpawns.length - fairiesDefeated} 匹だよ!`], complete: () => {} };
  }
  if (quest.dungeonUnlocked && !quest.dungeonBossDefeated) return { lines: ['地下迷宮に行ったの!? 大丈夫、無理しないでね。', '私はここで待ってるから!'], complete: () => {} };
  if (quest.dungeonBossDefeated && !quest.dungeonRewardGiven) return { lines: ['闇の魔導士を倒したって本当!? すごすぎるよ!', '早くガロンさんに報告しなきゃ!'], complete: () => {} };
  if (quest.dungeonRewardGiven) return { lines: ['闇の魔導士を倒したなんて、本当にすごいよ!', 'これで学院はやっと平和だね。私、ずっと応援してたんだから!'], complete: () => {} };
  return {
    lines: pickFlavor([
      ['学院いちの魔法使いだね、あなたは!'],
      ['今日はいい天気だね! 中庭でのんびりするのも好きなんだ。'],
      ['修行の回廊、もう挑戦した? 私はまだ見に行っただけなんだ……'],
      ['温室のお花、綺麗だよね。フローラ先輩によろしく言っておいて!']
    ]),
    complete: () => {}
  };
}
function minaLines(quest) {
  if (!quest.completed) {
    return { lines: ['あら、新入生ね。', '先生のお手伝いをしてるみたいだけど、頑張ってね。', 'ここの本棚、古い学院史の資料が眠ってるのよ。暇な時にでも見てみるといいわ。'], complete: () => {} };
  }
  if (!quest.queenQuestStarted) {
    return {
      lines: [
        'あなた、結晶を集めたのね。やるじゃない。',
        '実はね、最近この学院の古い記録を調べてたの。何百年も前、地下に何かを「封印」した、という記述があってね。',
        'その封印が緩んでいるんじゃないかって思ってるの。中庭の妖精が荒れてるのも、きっと無関係じゃないわ。',
        '案の定、中庭の奥に「妖精の女王」が現れて暴れているの。本来はあの子が森の守り手のはずなんだけど……。',
        '倒してくれたら卒業認定バッジをあげるわ。ついでに、女王が何かに怯えていないか見てきてほしいの。'
      ],
      complete: () => { quest.queenQuestStarted = true; }
    };
  }
  if (!quest.queenDefeated) {
    return { lines: ['女王はまだ中庭のどこかにいるはずよ。', '油断しないでね。'], complete: () => {} };
  }
  if (!quest.queenQuestCompleted) {
    return {
      lines: [
        'やったのね!! さすがだわ。',
        '女王、暴れてたけど……目に見えない「何か」に怯えているようだったでしょう? やっぱり、あの封印が関係してるんだと思う。',
        'これが卒業認定バッジ。学院いちの魔法使いの証よ。',
        'あなたの魔力の器が広がったようね。(最大HP +30)',
        '炎の魔法も教えてあげる。キー「2」で切り替えられるわ。',
        '地下に何かあるなら、確かめてみたほうがいいかもしれない。おめでとう、見習い魔法使いくん。'
      ],
      complete: () => {
        quest.queenQuestCompleted = true;
        player.maxHp += 30;
        player.hp = player.maxHp;
        if (!player.spells.includes('fire')) player.spells.push('fire');
      },
      triggerClear: true
    };
  }
  if (!quest.dungeonUnlocked) {
    return { lines: ['あなたのおかげで中庭は平和よ。ありがとう。', 'でも……本当の原因はまだ地下にあると思うの。気をつけてね。'], complete: () => {} };
  }
  if (!quest.dungeonBossDefeated) {
    return { lines: ['地下は危険よ。無理しないでね。', '何か分かったら、私にも教えてほしいわ。'], complete: () => {} };
  }
  return {
    lines: pickFlavor([
      ['闇の魔導士のこと、聞いたわ……。記録に「レイン」という名の天才魔法使いがいたと書いてあったの。', 'まさか、彼だったなんて。あなたのおかげで、学院は本当の意味で平和になったのね。ありがとう。'],
      ['最近は古い資料の整理をしてるの。落ち着いたら見せてあげるわね。'],
      ['修行の回廊、もう試した? あなたなら10の間も突破できると思うわ。'],
      ['あなたのおかげで、この学院はすっかり平和になったわね。']
    ]),
    complete: () => {}
  };
}
function noahLines(quest) {
  if (!quest.queenQuestCompleted) {
    return { lines: ['ここは「訓練の森」だ。', '力試しをしたいなら、まずは学院の本当のクエストを終えてから来るといい。'], complete: () => {} };
  }
  if (waveActive) {
    return { lines: ['まだ戦いの最中だろう? 気を抜くな!'], complete: () => {} };
  }
  if (quest.waveMilestone10 && !quest.noahQuestCompleted) {
    return {
      lines: [
        '第10波まで生き延びたか……見事だ。',
        '正直、見習いにここまでやれるとは思っていなかった。',
        'これは俺が連戦で鍛えた証だ。お前にやろう。(魔法威力 +8 / 最大HP +20)'
      ],
      complete: () => {
        quest.noahQuestCompleted = true;
        player.power += 8; player.maxHp += 20; player.hp = player.maxHp;
      }
    };
  }
  const recordLine = bestWave > 0 ? `これまでの最高記録は第${bestWave}波だ。` : 'まだ記録はないな。';
  const dungeonLine = quest.dungeonBossDefeated ? '闇の魔導士を倒したそうだな。大したものだ。' : null;
  return {
    lines: [dungeonLine, 'よく来たな、見習い魔法使いくん。', '妖精たちが次々と襲ってくる訓練を受けさせてやろう。', recordLine, '準備はいいか? 話し終えると同時に始まるぞ!'].filter(Boolean),
    complete: () => { startWaveRun(); }
  };
}
function kentLines(quest) {
  if (!quest.started) return { lines: ['やあ、僕はケント。本を読むのが好きなんだ。', 'この学院、たまに妖精が迷い込んでくるんだよ。最近は数が増えてる気がするけどね。'], complete: () => {} };
  if (!quest.completed) return { lines: ['先生のクエスト、進んでる?', '妖精は中庭のあちこちにいるみたいだよ。'], complete: () => {} };
  if (!quest.queenQuestCompleted) return { lines: ['ミナ先輩と話した? 何か古い記録を調べてるみたいだけど…', '僕はここで本を読んでるよ。'], complete: () => {} };
  // once the main story is finished, the post-game "蔵書整理" chain always takes priority --
  // even if the earlier, easily-missable "3 magic books" side quest was never started/finished,
  // a player who beat the final boss shouldn't be permanently stuck on that older dialogue branch
  if (quest.dungeonBossDefeated && !quest.kentBookQuestStarted) {
    return {
      lines: [
        'レインのこと、聞いたよ。まさか本当に地下にいたなんて……',
        'でも、もう安心だね。ありがとう、見習い魔法使いくん。',
        'あ、そうだ。実はまだ困ったことがあってさ。返却されたはずの本が、学院のあちこちに落ちてるみたいなんだ。',
        '中庭や温室、訓練の森で見かけたら拾ってきてくれないか? 3冊探してるんだ。',
        '見つけてきてくれたら、僕からもお礼をするよ。'
      ],
      complete: () => { quest.kentBookQuestStarted = true; }
    };
  }
  if (quest.kentBookQuestStarted && !quest.kentBookQuestCompleted) {
    if (quest.misplacedBooksReturned >= 3) {
      return {
        lines: [
          '3冊とも見つけてくれたのか、ありがとう!',
          'これでまた図書室の棚も整うよ。お礼にこれを受け取って。読書で鍛えた集中力のコツだ。(魔法威力 +8 / 最大HP +10)'
        ],
        complete: () => {
          quest.kentBookQuestCompleted = true;
          player.power += 8;
          player.maxHp += 10;
          player.hp = player.maxHp;
        }
      };
    }
    return { lines: [`迷い込んだ本、まだ ${quest.misplacedBooksReturned}/3 冊だね。`, '中庭や温室、訓練の森を探してみて。'], complete: () => {} };
  }
  if (!quest.dungeonBossDefeated && !quest.bookQuestStarted) {
    return {
      lines: [
        '学院いちの魔法使いと同じ図書室にいるなんて、光栄だな。',
        '実はさ、ミナ先輩が言ってた「封印」の話、僕も気になって調べてたんだ。',
        '古い魔法書が3冊、図書室のあちこちに紛れ込んでるんだけど、きっとそこに手がかりがある。',
        '見つけて持ってきてくれたら、僕が知ってる魔法のコツも教えるよ。'
      ],
      complete: () => { quest.bookQuestStarted = true; }
    };
  }
  if (quest.bookQuestStarted && !quest.bookQuestCompleted) {
    if (quest.booksCollected >= 3) {
      return {
        lines: [
          '3冊とも見つけてくれたのか! すごいな。',
          '読んでみたよ……どうやら大昔、「レイン」という生徒が禁忌の魔法に手を出して姿を消したそうだ。',
          'まさか、地下に眠ってたなんて……これは大発見だ。',
          'お礼に、僕が知ってる魔力操作のコツを教えるよ。(魔法威力 +10)'
        ],
        complete: () => { quest.bookQuestCompleted = true; player.power += 10; }
      };
    }
    return { lines: [`古い魔法書、まだ ${quest.booksCollected}/3 冊だね。`, '図書室の中を探してみて。'], complete: () => {} };
  }
  return {
    lines: pickFlavor([
      ['学院いちの魔法使いと同じ図書室にいるなんて、光栄だな。', 'また今度、面白い魔法の本を貸すよ。'],
      ['最近読んでる本、すごく面白いんだ。今度紹介するよ。'],
      ['図書室の本、たまに変なところに紛れ込んでることがあるんだよね……気のせいかな?'],
      ['温室のフローラ先輩、いつも綺麗な花をくれるんだ。今度お礼を言いに行かなきゃ。']
    ]),
    complete: () => {}
  };
}
function galonLines(quest) {
  if (!quest.queenQuestCompleted) {
    return { lines: ['ここから先は地下迷宮だ。', 'まだ力不足のようだな。学院の本当のクエストを終えてから来い。', 'ここは長年、我が一族が代々見張ってきた場所だ。生半可な覚悟では通さん。'], complete: () => {} };
  }
  if (!quest.dungeonUnlocked) {
    return {
      lines: [
        'ほう、女王を倒したか。見習いとは思えん腕前だ。',
        '正直に言おう。この迷宮の奥には、かつて学院を揺るがした「事件」の元凶が眠っている。',
        '何十年も前、天才と謳われたある生徒が禁じられた力に手を出し、自らその力に飲まれた。それが「闇の魔導士」だ。',
        '儂は若い頃、その封印の番を任されたが……歳には勝てん。儂一人ではもう戦えんのだ。',
        'よかろう、地下への道を開けてやる。奴を止められるのは、お前のような若い魔法使いだけかもしれん。'
      ],
      complete: () => { quest.dungeonUnlocked = true; }
    };
  }
  if (!quest.dungeonBossDefeated) {
    return { lines: ['闇の魔導士はまだ最奥にいるはずだ。', '油断するなよ。'], complete: () => {} };
  }
  if (!quest.dungeonRewardGiven) {
    return {
      lines: [
        '闇の魔導士を倒したか。見事だ、見習いとは思えん。',
        'あの者の名は「レイン」。かつてこの学院で最も才能ある生徒だったと聞く。',
        '何を求めて禁忌に手を出したのかは、儂にも分からん。だが、その執念が中庭の妖精たちや女王まで苦しめていたのだろう。',
        'これを受け取れ。学院の秘宝、大魔法使いの証だ。(魔法威力 +15 / 最大HP +40)',
        '氷の魔法も使えるようになったはずだ。キー「3」で切り替えろ。',
        'お前はもう、この学院の誇りだな。'
      ],
      complete: () => {
        quest.dungeonRewardGiven = true;
        player.power += 15;
        player.maxHp += 40;
        player.hp = player.maxHp;
        if (!player.spells.includes('ice')) player.spells.push('ice');
      },
      triggerClear: true
    };
  }
  return {
    lines: pickFlavor([
      ['お前はもう、この学院の誇りだな。', '封印も安定した。もう妖精たちが暴れることもないだろう。'],
      ['迷宮の見張りも、今はすっかり楽になったわい。'],
      ['修行の回廊で腕を磨いておくのもいいだろう。'],
      ['儂も若い頃はよく妖精たちと戦ったものだ……懐かしいな。']
    ]),
    complete: () => {}
  };
}
function floraLines(quest) {
  if (!quest.dungeonRewardGiven) {
    return { lines: ['あら、いらっしゃい。ここは学院の温室よ。', '最近まで物騒であまり手入れができていなかったの。落ち着いたら、また色々教えてあげるわね。'], complete: () => {} };
  }
  if (!quest.leafQuestStarted) {
    return {
      lines: [
        '学院がすっかり平和になったから、温室の手入れを再開できそうよ。',
        '「癒しの葉」を4枚集めてほしいの。温室のあちこちに生えているはずだわ。',
        '集めてきてくれたら、調合のコツを教えてあげる。ポーションが持てる上限も増えるはずよ。'
      ],
      complete: () => { quest.leafQuestStarted = true; }
    };
  }
  if (!quest.leafQuestCompleted) {
    if (quest.leavesCollected >= 4) {
      return {
        lines: [
          '4枚とも集めてくれたのね、ありがとう!',
          'これが調合のコツよ。ポーションの持てる数が増えるはずだわ。(ポーション上限 +2 / 最大HP +15)',
          'それと、さっき集めてもらった場所には、また新しい葉が生えてくるようにしておいたわ。困ったときは寄ってみてね。'
        ],
        complete: () => {
          quest.leafQuestCompleted = true;
          player.maxPotions += 2;
          player.maxHp += 15;
          player.hp = Math.min(player.maxHp, player.hp + 15);
        }
      };
    }
    return { lines: [`癒しの葉、まだ ${quest.leavesCollected}/4 枚ね。`, '温室の中を探してみて。'], complete: () => {} };
  }
  return {
    lines: pickFlavor([
      ['温室の葉は時間が経つとまた生えてくるわ。', 'ポーションが減ったら、いつでも採りに来てね。'],
      ['最近、珍しい花の苗を手に入れたの。うまく育つといいけれど。'],
      ['修行の回廊、行ってみた? 大変そうだけど頑張ってね。'],
      ['ここでのんびりするのも悪くないでしょう?']
    ]),
    complete: () => {}
  };
}
function renLines(quest) {
  if (!quest.dungeonRewardGiven) {
    return { lines: ['ここは「修行の回廊」だ。', 'まだ早い。学院の本当のクエストを終えてから来るといい。'], complete: () => {} };
  }
  if (quest.trialStage === 0) {
    return {
      lines: [
        'よく来たな。ここには10の試練の間が続いている。',
        '各部屋の妖精をすべて倒せば、次の間へ続く扉が開く。',
        '進むごとに手強くなっていくが……お前ならやれるはずだ。',
        '準備はいいか? 話し終えると同時に第1の間が始まるぞ!'
      ],
      complete: () => { startTrialCorridor(); }
    };
  }
  if (quest.trialStage === TRIAL_STAGE_MAX + 1 && !quest.trialHardUnlocked) {
    return {
      lines: [
        '全ての試練を制した者よ、お前はもう真の魔法使いだ。',
        '……だが、実はまだ先がある。「裏の回廊」だ。ここから更に10の間が続いている。',
        '並大抵の覚悟では務まらんぞ。挑むか?',
        '準備はいいか? 話し終えると同時に第11の間が始まるぞ!'
      ],
      complete: () => { continueTrialHardMode(); }
    };
  }
  if (quest.trialHardUnlocked && quest.trialStage > TRIAL_STAGE_HARD_MAX) {
    return { lines: ['裏の回廊すら制するとはな……お前はもう伝説だ。', 'いつでも修行をやり直しに来るといい。'], complete: () => {} };
  }
  if (quest.trialStage > TRIAL_STAGE_MAX) {
    return { lines: [`裏 第 ${quest.trialStage} の間に挑戦中だな。`, '油断するなよ。'], complete: () => {} };
  }
  return { lines: [`第 ${quest.trialStage} の間に挑戦中だな。`, '油断するなよ。'], complete: () => {} };
}

// ---- シーン定義 ----
const SCENES = {
  courtyard: {
    label: '学院の中庭',
    map: buildCourtyard(),
    doors: [
      { x: 10, y: 0, to: 'classroom', entry: { x: 10, y: ROWS - 2 } },
      { x: 0, y: 7, to: 'library', entry: { x: COLS - 2, y: 7 } },
      { x: COLS - 1, y: 7, to: 'forest', entry: { x: 1, y: 7 } },
      { x: 10, y: ROWS - 1, to: 'dungeon1', entry: { x: 10, y: 1 } }
    ],
    npcs: [
      { x: 4, y: 10, name: 'アリサ', color: '#c95fae', hairColor: '#e07ab0', hairStyle: 'twin', eyeColor: '#ff8fc4', getLines: alisaLines },
      { x: 16, y: 10, name: '行商人ミオ', color: '#c9995a', hairColor: '#8a5a2a', hairStyle: 'side', eyeColor: '#e0b070', getLines: () => ({ lines: ['いらっしゃい!'], complete: () => {} }), isShop: true }
    ],
    enemySpawns: [
      { type: 'leaf', x: 5, y: 5 },
      { type: 'water', x: 15, y: 5 },
      { type: 'star', x: 10, y: 11 },
      { type: 'leaf', x: 13, y: 11 },
      { type: 'water', x: 6, y: 4 }
    ]
  },
  classroom: {
    label: '魔法基礎教室',
    map: buildClassroom(),
    doors: [
      { x: 10, y: ROWS - 1, to: 'courtyard', entry: { x: 10, y: 1 } },
      { x: 10, y: 0, to: 'observatory', entry: { x: 10, y: ROWS - 2 } }
    ],
    npcs: [{ x: 10, y: 2, name: 'ローズ先生', color: '#5b3fae', hairColor: '#3a2560', hairStyle: 'bun', eyeColor: '#c9a2ec', getLines: teacherLines }],
    enemySpawns: []
  },
  observatory: {
    label: '天文台',
    map: buildObservatory(),
    doors: [{ x: 10, y: ROWS - 1, to: 'classroom', entry: { x: 10, y: 1 } }],
    npcs: [],
    enemySpawns: []
  },
  library: {
    label: '図書室',
    map: buildLibrary(),
    doors: [
      { x: COLS - 1, y: 7, to: 'courtyard', entry: { x: 1, y: 7 } },
      { x: 0, y: 7, to: 'greenhouse', entry: { x: COLS - 2, y: 7 } }
    ],
    npcs: [
      { x: 10, y: 6, name: 'ミナ先輩', color: '#4fae8f', hairColor: '#2f8f74', hairStyle: 'side', eyeColor: '#6fe0c4', getLines: minaLines },
      { x: 15, y: 9, name: 'ケント', color: '#5a8fc9', hairColor: '#2a5a94', hairStyle: 'spike', eyeColor: '#7ab8ec', getLines: kentLines }
    ],
    enemySpawns: []
  },
  greenhouse: {
    label: '学院の温室',
    map: buildGreenhouse(),
    doors: [{ x: COLS - 1, y: 7, to: 'library', entry: { x: 1, y: 7 } }],
    npcs: [{ x: 3, y: 7, name: 'フローラ先輩', color: '#5fae5f', hairColor: '#3a7a3a', hairStyle: 'twin', eyeColor: '#9fe0a0', getLines: floraLines }],
    enemySpawns: []
  },
  forest: {
    label: '訓練の森',
    map: buildForest(),
    doors: [
      { x: 0, y: 7, to: 'courtyard', entry: { x: COLS - 2, y: 7 } },
      { x: 10, y: ROWS - 1, to: 'trial', entry: { x: 10, y: 1 } }
    ],
    npcs: [
      { x: 3, y: 7, name: '森の番人ノア', color: '#3a5a3f', hairColor: '#2a3a28', hairStyle: 'spike', eyeColor: '#9fd68a', getLines: noahLines },
      { x: 12, y: 11, name: '修行僧レン', color: '#8a6a3f', hairColor: '#3a2a1a', hairStyle: 'spike', eyeColor: '#d6c09f', getLines: renLines }
    ],
    enemySpawns: []
  },
  trial: {
    label: '修行の回廊',
    map: buildTrialRoom(),
    doors: [
      { x: 10, y: ROWS - 1, to: 'forest', entry: { x: 10, y: ROWS - 2 } },
      { x: 10, y: 0, to: 'trial', entry: { x: 10, y: ROWS - 2 } }
    ],
    npcs: [],
    enemySpawns: []
  },
  dungeon1: {
    label: '地下迷宮 1F',
    map: buildDungeon1(),
    doors: [
      { x: 10, y: 0, to: 'courtyard', entry: { x: 10, y: ROWS - 2 } },
      { x: 10, y: ROWS - 1, to: 'dungeon2', entry: { x: 10, y: 1 } }
    ],
    npcs: [{ x: 10, y: 3, name: '重装騎士ガロン', color: '#7a7f8a', hairColor: '#4a4f5a', hairStyle: 'spike', eyeColor: '#cfe0ff', getLines: galonLines }],
    enemySpawns: []
  },
  dungeon2: {
    label: '地下迷宮 最奥',
    map: buildDungeon2(),
    doors: [
      { x: 10, y: 0, to: 'dungeon1', entry: { x: 10, y: ROWS - 2 } },
      { x: 10, y: ROWS - 1, to: 'dungeon3', entry: { x: 10, y: 1 } }
    ],
    npcs: [],
    enemySpawns: []
  },
  dungeon3: {
    label: '地下迷宮フロア3「レインの書斎」',
    map: buildDungeon3(),
    doors: [{ x: 10, y: 0, to: 'dungeon2', entry: { x: 10, y: ROWS - 2 } }],
    npcs: [],
    enemySpawns: []
  }
};
const DUNGEON1_SPAWNS = [
  { type: 'shadow', x: 5, y: 7 },
  { type: 'shadow', x: 14, y: 7 },
  { type: 'shadow', x: 10, y: 11 },
  { type: 'thunder', x: 10, y: 4 }
];
const DUNGEON2_SHADOW_SPAWNS = [
  { type: 'shadow', x: 4, y: 11 },
  { type: 'shadow', x: 16, y: 11 }
];
const DUNGEON2_BOSS_SPAWN = { type: 'darkmage', x: 10, y: 6 };
const DUNGEON3_SPAWNS = [
  { type: 'shadow', x: 5, y: 9 },
  { type: 'thunder', x: 15, y: 9 }
];
const DUNGEON3_BOSS_SPAWN = { type: 'familiar', x: 10, y: 6 };
const BOOK_SPOTS = [
  { x: 4, y: 9, lore: '『……あの夜、天才と呼ばれた生徒レインは、禁じられた書庫へと姿を消した』' },
  { x: 16, y: 4, lore: '『地下に封じられし力、触れる者は必ず飲まれる、と記されている』' },
  { x: 10, y: 12, lore: '『妖精たちの異変は、地の底で目覚めた何かと無関係ではないだろう』' }
];
const LEAF_SPOTS = [{ x: 6, y: 4 }, { x: 13, y: 4 }, { x: 6, y: 10 }, { x: 13, y: 10 }];
const MISPLACED_BOOK_SPOTS = [
  { scene: 'courtyard', x: 13, y: 9 },
  { scene: 'forest', x: 7, y: 7 },
  { scene: 'greenhouse', x: 13, y: 7 }
];
const LEAF_RESPAWN_TIME = 40;
const TRIAL_STAGE_MAX = 10;
const TRIAL_STAGE_HARD_MAX = 20;
const BESTIARY_TYPES = [
  { type: 'leaf', name: '葉っぱ妖精', desc: '中庭に多く生息する基本的な妖精' },
  { type: 'water', name: '水の妖精', desc: '水辺を好む妖精' },
  { type: 'star', name: '星の妖精', desc: 'すばしっこい妖精' },
  { type: 'thunder', name: '雷の妖精', desc: '突進攻撃を仕掛けてくる' },
  { type: 'shadow', name: '影の妖精', desc: '地下迷宮に潜む屈強な妖精' },
  { type: 'queen', name: '妖精の女王', desc: '中庭の主、ホーミング攻撃を放つ' },
  { type: 'darkmage', name: '闇の魔導士', desc: '地下迷宮最奥の元凶、3方向弾' },
  { type: 'familiar', name: '残された使い魔', desc: 'レインの書斎に眠るミニボス' },
  { type: 'astra', name: '星の番人アストラ', desc: '天文台に眠る最強の守護者' }
];
const SHOP_ITEMS = [
  {
    key: '1', name: 'ポーション', desc: 'HPを回復するポーションを1個購入する',
    cost: () => 4,
    canBuy: () => player.potions < player.maxPotions,
    apply: () => { player.potions++; }
  },
  {
    key: '2', name: '魔力のかけら', desc: '魔法威力+2 (購入するたびに値上がりする)',
    cost: () => 10 + quest.shopPowerLevel * 5,
    canBuy: () => true,
    apply: () => { player.power += 2; quest.shopPowerLevel++; }
  },
  {
    key: '3', name: '守りのお守り', desc: '最大HP+10 (購入するたびに値上がりする)',
    cost: () => 10 + quest.shopHpLevel * 5,
    canBuy: () => true,
    apply: () => { player.maxHp += 10; player.hp += 10; quest.shopHpLevel++; }
  }
];
function tryShopPurchase(key) {
  const item = SHOP_ITEMS.find(s => s.key === key);
  if (!item) return;
  if (!item.canBuy()) {
    shopMessage = 'これ以上は購入できない'; shopMessageT = 1.5;
    playTone(220, 0.12, 'square');
    return;
  }
  const cost = item.cost();
  if (fairyShards < cost) {
    shopMessage = '妖精のかけらが足りない'; shopMessageT = 1.5;
    playTone(220, 0.12, 'square');
    return;
  }
  fairyShards -= cost;
  item.apply();
  shopMessage = `${item.name}を購入した! (-${cost}かけら)`; shopMessageT = 1.5;
  playTone(880, 0.1, 'sine'); playTone(1100, 0.1, 'sine');
}

// ---- エンティティクラス ----
class Player {
  constructor(x, y) {
    this.x = x; this.y = y; this.w = 28; this.h = 28;
    this.speed = 180; this.dir = 'down'; this.moving = false;
    this.hp = 100; this.maxHp = 100; this.invuln = 0; this.castCooldown = 0; this.animT = 0;
    this.level = 1; this.xp = 0; this.xpToNext = 50; this.power = 30;
    this.castPoseT = 0;
    this.spells = ['arcane']; this.currentSpell = 'arcane';
    this.potions = 0; this.maxPotions = DEFAULT_MAX_POTIONS;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  update(dt, dx, dy, map) {
    this.moving = dx !== 0 || dy !== 0;
    this.animT = this.moving ? this.animT + dt : 0;
    if (dx > 0) this.dir = 'right'; else if (dx < 0) this.dir = 'left';
    if (dy > 0) this.dir = 'down'; else if (dy < 0) this.dir = 'up';
    const nx = this.x + dx * this.speed * dt;
    if (!collides(map, nx, this.y, this.w, this.h)) this.x = nx;
    const ny = this.y + dy * this.speed * dt;
    if (!collides(map, this.x, ny, this.w, this.h)) this.y = ny;
  }
}

class Fairy {
  constructor(type, x, y) {
    this.type = type; this.x = x; this.y = y;
    this.isBoss = type === 'queen' || type === 'darkmage' || type === 'familiar' || type === 'astra';
    if (type === 'astra') { this.w = 48; this.h = 48; this.hp = 450; this.maxHp = 450; this.speed = 70; this.contactDamage = 30; }
    else if (type === 'darkmage') { this.w = 44; this.h = 44; this.hp = 380; this.maxHp = 380; this.speed = 60; this.contactDamage = 35; }
    else if (type === 'queen') { this.w = 40; this.h = 40; this.hp = 260; this.maxHp = 260; this.speed = 65; this.contactDamage = 25; }
    else if (type === 'familiar') { this.w = 36; this.h = 36; this.hp = 190; this.maxHp = 190; this.speed = 72; this.contactDamage = 22; }
    else if (type === 'shadow') { this.w = 28; this.h = 28; this.hp = 90; this.maxHp = 90; this.speed = 58; this.contactDamage = 20; }
    else if (type === 'thunder') { this.w = 26; this.h = 26; this.hp = 55; this.maxHp = 55; this.speed = 55; this.contactDamage = 18; }
    else { this.w = 26; this.h = 26; this.hp = 60; this.maxHp = 60; this.speed = 50; this.contactDamage = 15; }
    this.state = 'wander';
    this.vx = 0; this.vy = 0; this.dirTimer = 0; this.hitFlash = 0; this.dead = false; this.animT = Math.random() * 10;
    this.baseSpeed = this.speed; this.slowT = 0;
    this.attackT = this.isBoss ? 1.5 + Math.random() : 0;
    this.pendingAttack = false;
    this.dashT = type === 'thunder' ? 1.5 + Math.random() : 0;
    this.dashingT = 0;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  update(dt, map, player) {
    this.animT += dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.slowT > 0) this.slowT -= dt;
    const effSpeed = this.slowT > 0 ? this.baseSpeed * 0.45 : this.baseSpeed;
    const chaseRange = this.isBoss ? 260 : 140, loseRange = this.isBoss ? 340 : 200;
    const dxP = player.cx - this.cx, dyP = player.cy - this.cy;
    const distP = Math.hypot(dxP, dyP) || 1;
    if (distP < chaseRange) this.state = 'chase';
    else if (this.state === 'chase' && distP > loseRange) this.state = 'wander';

    if (this.dashingT > 0) {
      this.dashingT -= dt;
      const nx = this.x + this.dashVx * dt;
      if (!collides(map, nx, this.y, this.w, this.h)) this.x = nx; else this.dashingT = 0;
      const ny = this.y + this.dashVy * dt;
      if (!collides(map, this.x, ny, this.w, this.h)) this.y = ny; else this.dashingT = 0;
    } else if (this.state === 'chase') {
      const sp = effSpeed * (this.isBoss ? 1.25 : 1.1);
      const nx = this.x + (dxP / distP) * sp * dt;
      if (!collides(map, nx, this.y, this.w, this.h)) this.x = nx;
      const ny = this.y + (dyP / distP) * sp * dt;
      if (!collides(map, this.x, ny, this.w, this.h)) this.y = ny;
    } else {
      this.dirTimer -= dt;
      if (this.dirTimer <= 0) {
        const ang = Math.random() * Math.PI * 2;
        this.vx = Math.cos(ang) * effSpeed * 0.5;
        this.vy = Math.sin(ang) * effSpeed * 0.5;
        this.dirTimer = 0.6 + Math.random() * 1.2;
      }
      const nx = this.x + this.vx * dt;
      if (!collides(map, nx, this.y, this.w, this.h)) this.x = nx; else this.vx *= -1;
      const ny = this.y + this.vy * dt;
      if (!collides(map, this.x, ny, this.w, this.h)) this.y = ny; else this.vy *= -1;
    }

    if (this.isBoss) {
      this.attackT -= dt;
      if (this.attackT <= 0 && this.state === 'chase') {
        this.attackT = this.type === 'darkmage' ? 2.0 : this.type === 'familiar' ? 2.3 : this.type === 'astra' ? 2.8 : 2.6;
        this.pendingAttack = true;
      }
    }
    if (this.type === 'thunder' && this.dashingT <= 0) {
      this.dashT -= dt;
      if (this.dashT <= 0 && this.state === 'chase' && distP < 180) {
        this.dashT = 2.2 + Math.random() * 0.8;
        this.dashingT = 0.3;
        this.dashVx = (dxP / distP) * this.baseSpeed * 3.0;
        this.dashVy = (dyP / distP) * this.baseSpeed * 3.0;
      }
    }
  }
}

class EnemyProjectile {
  constructor(x, y, dir, opts) {
    this.x = x; this.y = y; this.speed = opts.speed;
    this.vx = dir.x * opts.speed; this.vy = dir.y * opts.speed;
    this.r = opts.r; this.dmg = opts.dmg; this.color = opts.color; this.homing = !!opts.homing;
    this.life = 3.0; this.dead = false; this.t = 0;
  }
  update(dt, map, player) {
    this.t += dt;
    if (this.homing) {
      const dx = player.cx - this.x, dy = player.cy - this.y;
      const dist = Math.hypot(dx, dy) || 1;
      const desiredVx = (dx / dist) * this.speed, desiredVy = (dy / dist) * this.speed;
      const turn = Math.min(1, dt * 1.5);
      this.vx += (desiredVx - this.vx) * turn;
      this.vy += (desiredVy - this.vy) * turn;
    }
    this.x += this.vx * dt; this.y += this.vy * dt; this.life -= dt;
    if (this.life <= 0) this.dead = true;
    if (collides(map, this.x - this.r, this.y - this.r, this.r * 2, this.r * 2)) this.dead = true;
  }
}
function spawnBossAttack(f, player) {
  const dx = player.cx - f.cx, dy = player.cy - f.cy;
  const dist = Math.hypot(dx, dy) || 1;
  const dirx = dx / dist, diry = dy / dist;
  if (f.type === 'queen') {
    enemyProjectiles.push(new EnemyProjectile(f.cx, f.cy, { x: dirx, y: diry }, { speed: 150, r: 9, dmg: 18, color: '#c77dff', homing: true }));
    playTone(500, 0.15, 'sine');
  } else if (f.type === 'darkmage') {
    const baseAngle = Math.atan2(diry, dirx);
    [-0.28, 0, 0.28].forEach(off => {
      const a = baseAngle + off;
      enemyProjectiles.push(new EnemyProjectile(f.cx, f.cy, { x: Math.cos(a), y: Math.sin(a) }, { speed: 220, r: 7, dmg: 15, color: '#8f2a4a' }));
    });
    playTone(220, 0.2, 'sawtooth');
  } else if (f.type === 'familiar') {
    const baseAngle = Math.atan2(diry, dirx);
    [-0.18, 0.18].forEach(off => {
      const a = baseAngle + off;
      enemyProjectiles.push(new EnemyProjectile(f.cx, f.cy, { x: Math.cos(a), y: Math.sin(a) }, { speed: 170, r: 7, dmg: 14, color: '#8fd6c9', homing: true }));
    });
    playTone(560, 0.14, 'sine');
  } else if (f.type === 'astra') {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * 2 / 6) * i;
      enemyProjectiles.push(new EnemyProjectile(f.cx, f.cy, { x: Math.cos(a), y: Math.sin(a) }, { speed: 190, r: 8, dmg: 16, color: '#cfa6ff' }));
    }
    playTone(660, 0.2, 'triangle');
  }
}

class Projectile {
  constructor(x, y, dir, spellType) {
    this.spellType = spellType || 'arcane';
    const def = SPELL_DEFS[this.spellType];
    this.x = x; this.y = y; this.vx = dir.x * def.speed; this.vy = dir.y * def.speed;
    this.r = 7; this.life = 1.0; this.dead = false;
    this.pierceLeft = def.piercing ? 2 : 0;
    this.hitFairies = def.piercing ? [] : null;
  }
  update(dt, map) {
    this.x += this.vx * dt; this.y += this.vy * dt; this.life -= dt;
    if (this.life <= 0) this.dead = true;
    if (collides(map, this.x - this.r, this.y - this.r, this.r * 2, this.r * 2)) this.dead = true;
  }
}

class Crystal {
  constructor(x, y) {
    this.x = x; this.y = y; this.w = 16; this.h = 16; this.t = Math.random() * 10; this.collected = false;
  }
  update(dt) { this.t += dt; }
}
class Gear {
  constructor(x, y, kind) {
    this.x = x; this.y = y; this.w = 16; this.h = 16; this.t = Math.random() * 10; this.collected = false; this.kind = kind;
  }
  update(dt) { this.t += dt; }
}
class Book {
  constructor(x, y, lore) {
    this.x = x; this.y = y; this.w = 16; this.h = 16; this.t = Math.random() * 10; this.collected = false;
    this.lore = lore || '';
  }
  update(dt) { this.t += dt; }
}
class Potion {
  constructor(x, y) {
    this.x = x; this.y = y; this.w = 16; this.h = 16; this.t = Math.random() * 10; this.collected = false;
  }
  update(dt) { this.t += dt; }
}
class Leaf {
  constructor(x, y) {
    this.x = x; this.y = y; this.w = 16; this.h = 16; this.t = Math.random() * 10; this.collected = false;
  }
  update(dt) { this.t += dt; }
}
class Treasure {
  constructor(x, y, spotIndex) {
    this.x = x; this.y = y; this.w = 16; this.h = 16; this.t = Math.random() * 10; this.collected = false;
    this.spotIndex = spotIndex;
  }
  update(dt) { this.t += dt; }
}
class MisplacedBook {
  constructor(x, y) {
    this.x = x; this.y = y; this.w = 16; this.h = 16; this.t = Math.random() * 10; this.collected = false;
  }
  update(dt) { this.t += dt; }
}
class Shard {
  constructor(x, y, value) {
    this.x = x; this.y = y; this.w = 16; this.h = 16; this.t = Math.random() * 10; this.collected = false;
    this.value = value || 1;
  }
  update(dt) { this.t += dt; }
}

class Dialogue {
  constructor(speaker, lines, onClose) {
    this.speaker = speaker; this.lines = lines; this.index = 0; this.onClose = onClose;
    this.charsShown = 0; this.charTimer = 0; this.charSpeed = 0.02; this.triggerClear = false;
  }
  get currentLine() { return this.lines[this.index]; }
  update(dt) {
    const len = this.currentLine.length;
    if (this.charsShown < len) {
      this.charTimer += dt;
      while (this.charTimer >= this.charSpeed && this.charsShown < len) {
        this.charTimer -= this.charSpeed; this.charsShown++;
      }
    }
  }
  advance() {
    if (this.charsShown < this.currentLine.length) { this.charsShown = this.currentLine.length; return; }
    this.index++; this.charsShown = 0;
    if (this.index >= this.lines.length) this.close();
  }
  close() {
    if (this.onClose) this.onClose();
    gameState = this.triggerClear ? 'clear' : 'playing';
    dialogue = null;
  }
}

// ---- グローバル状態 ----
let keys = {};
let lastTime = 0;
let gameState = 'loading'; // loading, title, playing, dialogue, clear, gameover
let currentSceneKey = 'courtyard';
let player = null;
let quest = null;
let worldEntities = {};
let projectiles = [];
let enemyProjectiles = [];
let particles = [];
let floatingTexts = [];
let dialogue = null;
let doorCooldown = 0;
let titleStars = null;
let titleButtons = null;
let audioCtx = null;
let queenSpawned = false;
let fairiesDefeated = 0;
let totalKills = 0;
let fairyShards = 0;
let observatorySpawned = false;
let shopMessage = '', shopMessageT = 0;
let achievementBannerText = '';
let achievementBannerT = 0;
let uiPanel = null; // null | 'inventory' | 'map' | 'achievements'
let bgm = null;
let shakeT = 0, shakeMag = 0;
let waveActive = false, waveNumber = 0, waveRestT = 0, waveBannerT = 0, waveBannerText = '';
let bestWave = 0;
let dungeonSpawned = false;
let booksSpawned = false;
let leavesSpawned = false;
let trialSpawnedThisRoom = false;
let misplacedBooksSpawned = false;
let darkStudySpawned = false;
let leafSpotTimer = [0, 0, 0, 0];
let courtyardDefeated = [], dungeon1Defeated = [], dungeon2Defeated = [], dungeon3Defeated = [];
let autosaveT = 5;

function loadBestWave() {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = parseInt(localStorage.getItem('magicAcademyBestWave') || '0', 10);
      if (!isNaN(v)) bestWave = v;
    }
  } catch (e) {}
}
function saveBestWave() {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem('magicAcademyBestWave', String(bestWave)); } catch (e) {}
}
function shake(mag, dur) { shakeMag = Math.max(shakeMag, mag); shakeT = Math.max(shakeT, dur); }
function gainXp(amount) {
  player.xp += amount;
  while (player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    player.level++;
    player.maxHp += 15;
    player.hp = player.maxHp;
    player.power += 4;
    player.xpToNext = Math.round(player.xpToNext * 1.25);
    addFloatingText(player.cx, player.y - 24, `LEVEL UP! Lv${player.level}`, '#ffe066');
    playTone(660, 0.12, 'triangle');
    playTone(880, 0.16, 'triangle');
  }
}

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  startBGM();
}
const SCENE_BGM = {
  courtyard: { notes: [261.6, 329.6, 392.0, 523.3], lfoSpeed: 0.15, type: 'sine' },
  classroom: { notes: [293.7, 349.2, 440.0, 587.3], lfoSpeed: 0.12, type: 'sine' },
  library: { notes: [220.0, 277.2, 329.6, 440.0], lfoSpeed: 0.1, type: 'sine' },
  greenhouse: { notes: [246.9, 311.1, 369.9, 493.9], lfoSpeed: 0.13, type: 'triangle' },
  forest: { notes: [196.0, 246.9, 293.7, 392.0], lfoSpeed: 0.18, type: 'triangle' },
  trial: { notes: [174.6, 220.0, 261.6, 349.2], lfoSpeed: 0.3, type: 'sawtooth' },
  dungeon1: { notes: [164.8, 196.0, 246.9, 311.1], lfoSpeed: 0.2, type: 'square' },
  dungeon2: { notes: [130.8, 164.8, 196.0, 261.6], lfoSpeed: 0.25, type: 'square' },
  dungeon3: { notes: [110.0, 138.6, 164.8, 220.0], lfoSpeed: 0.22, type: 'sine' },
  observatory: { notes: [293.7, 370.0, 440.0, 554.4], lfoSpeed: 0.08, type: 'sine' }
};
function startBGM() {
  if (!audioCtx || bgm) return;
  const theme = SCENE_BGM[currentSceneKey] || SCENE_BGM.courtyard;
  const master = audioCtx.createGain();
  master.gain.value = 1;
  master.connect(audioCtx.destination);
  const oscs = theme.notes.map((freq, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = theme.type;
    osc.frequency.value = freq;
    const g = audioCtx.createGain();
    g.gain.value = 0;
    osc.connect(g).connect(master);
    osc.start();
    return { osc, gain: g, phase: i * 1.3 };
  });
  bgm = { master, oscs, startTime: audioCtx.currentTime, sceneKey: currentSceneKey, lfoSpeed: theme.lfoSpeed };
}
function updateBGM() {
  if (!bgm) return;
  if (bgm.sceneKey !== currentSceneKey) {
    const theme = SCENE_BGM[currentSceneKey] || SCENE_BGM.courtyard;
    bgm.oscs.forEach((o, i) => {
      o.osc.frequency.setTargetAtTime(theme.notes[i] || theme.notes[0], audioCtx.currentTime, 0.4);
      o.osc.type = theme.type;
    });
    bgm.sceneKey = currentSceneKey;
    bgm.lfoSpeed = theme.lfoSpeed;
  }
  const t = audioCtx.currentTime - bgm.startTime;
  bgm.oscs.forEach(o => {
    const lfo = 0.5 + 0.5 * Math.sin(t * bgm.lfoSpeed + o.phase);
    o.gain.gain.value = lfo * 0.05;
  });
}
function playTone(freq, duration, type) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  gain.gain.value = 0.08;
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
  osc.stop(audioCtx.currentTime + duration);
}

function fairyColor(type) { return FAIRY_COLORS[type] || '#ffffff'; }

function spawnBurst(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const life = 0.4 + Math.random() * 0.3;
    particles.push({
      x, y, vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.5) * 160,
      life, maxLife: life, color, size: 3 + Math.random() * 3
    });
  }
}
function addFloatingText(x, y, text, color) {
  floatingTexts.push({ x, y, text, color, life: 0.8, maxLife: 0.8, vy: -30 });
}
function pushAway(target, from, dist, map) {
  const dx = target.cx - from.cx, dy = target.cy - from.cy;
  const d = Math.hypot(dx, dy) || 1;
  const nx = target.x + (dx / d) * dist;
  if (!collides(map, nx, target.y, target.w, target.h)) target.x = nx;
  const ny = target.y + (dy / d) * dist;
  if (!collides(map, target.x, ny, target.w, target.h)) target.y = ny;
}

function freshQuest() {
  return {
    started: false, crystals: 0, required: 3, completed: false,
    queenQuestStarted: false, queenDefeated: false, queenQuestCompleted: false,
    hunterQuestStarted: false, hunterQuestCompleted: false,
    bookQuestStarted: false, booksCollected: 0, bookQuestCompleted: false,
    dungeonUnlocked: false, dungeonBossDefeated: false, dungeonRewardGiven: false,
    leafQuestStarted: false, leavesCollected: 0, leafQuestCompleted: false,
    trialStage: 0, trialsRewardGiven: false,
    unlockedAchievements: [], treasuresFound: [], treasureRewardGiven: false,
    kentBookQuestStarted: false, misplacedBooksReturned: 0, kentBookQuestCompleted: false,
    familiarDefeated: false,
    bestiaryDefeated: [],
    astraDefeated: false,
    trialHardUnlocked: false, trialHardRewardGiven: false,
    noahQuestCompleted: false,
    waveMilestone10: false, waveMilestone20: false, waveMilestone30: false,
    shopPowerLevel: 0, shopHpLevel: 0
  };
}
function makeSpawnedFairies(spawnDefs, defeatedArr) {
  return spawnDefs
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => !(defeatedArr && defeatedArr[i]))
    .map(({ s, i }) => {
      const f = new Fairy(s.type, toPx(s.x) + 6, toPx(s.y) + 6);
      f.spawnIndex = i;
      return f;
    });
}
function rebuildWorld() {
  worldEntities = {};
  for (const key in SCENES) {
    const sc = SCENES[key];
    let fairies;
    if (key === 'courtyard') fairies = makeSpawnedFairies(sc.enemySpawns, courtyardDefeated);
    else fairies = sc.enemySpawns.map(s => new Fairy(s.type, toPx(s.x) + 6, toPx(s.y) + 6));
    worldEntities[key] = { fairies, items: [], npcs: sc.npcs };
  }
  TREASURE_SPOTS.forEach((spot, i) => {
    if (quest.treasuresFound.includes(i)) return;
    worldEntities[spot.scene].items.push(new Treasure(toPx(spot.x) + 6, toPx(spot.y) + 6, i));
  });
  queenSpawned = false;
  dungeonSpawned = false;
  booksSpawned = false;
  leavesSpawned = false;
  leafSpotTimer = [0, 0, 0, 0];
  trialSpawnedThisRoom = false;
  misplacedBooksSpawned = false;
  darkStudySpawned = false;
  observatorySpawned = false;
  SCENES.trial.map[0][10] = '#';
  SCENES.dungeon2.map[ROWS - 1][10] = '#';
  SCENES.classroom.map[0][10] = '#';
  projectiles = []; enemyProjectiles = []; particles = []; floatingTexts = []; dialogue = null; doorCooldown = 0.5;
  waveActive = false; waveNumber = 0; waveRestT = 0; waveBannerT = 0; waveBannerText = '';
  shakeT = 0; shakeMag = 0;
}
function initWorld() {
  quest = freshQuest();
  courtyardDefeated = []; dungeon1Defeated = []; dungeon2Defeated = []; dungeon3Defeated = [];
  fairiesDefeated = 0;
  totalKills = 0;
  fairyShards = 0;
  uiPanel = null;
  currentSceneKey = 'courtyard';
  player = new Player(toPx(10) + (TILE - 28) / 2, toPx(12) + (TILE - 28) / 2);
  rebuildWorld();
}

// ---- セーブ/ロード ----
const SAVE_KEY = 'magicAcademySave';
function saveGame() {
  try {
    if (typeof localStorage === 'undefined' || !player || !quest) return;
    const data = {
      quest, fairiesDefeated, bestWave, totalKills, fairyShards,
      courtyardDefeated, dungeon1Defeated, dungeon2Defeated, dungeon3Defeated,
      currentSceneKey,
      player: {
        x: player.x, y: player.y, dir: player.dir,
        level: player.level, xp: player.xp, xpToNext: player.xpToNext,
        power: player.power, maxHp: player.maxHp, hp: player.hp,
        spells: player.spells, currentSpell: player.currentSpell, potions: player.potions, maxPotions: player.maxPotions
      }
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) {}
}
function loadSaveData() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function hasSaveData() { return !!loadSaveData(); }
function applySaveData(data) {
  quest = Object.assign(freshQuest(), data.quest);
  fairiesDefeated = data.fairiesDefeated || 0;
  totalKills = data.totalKills || 0;
  fairyShards = data.fairyShards || 0;
  uiPanel = null;
  bestWave = Math.max(bestWave, data.bestWave || 0);
  courtyardDefeated = data.courtyardDefeated || [];
  dungeon1Defeated = data.dungeon1Defeated || [];
  dungeon2Defeated = data.dungeon2Defeated || [];
  dungeon3Defeated = data.dungeon3Defeated || [];
  currentSceneKey = data.currentSceneKey || 'courtyard';
  player = new Player(data.player.x, data.player.y);
  Object.assign(player, {
    dir: data.player.dir, level: data.player.level, xp: data.player.xp, xpToNext: data.player.xpToNext,
    power: data.player.power, maxHp: data.player.maxHp, hp: data.player.hp,
    spells: data.player.spells && data.player.spells.length ? data.player.spells : ['arcane'],
    currentSpell: data.player.currentSpell || 'arcane',
    maxPotions: data.player.maxPotions || DEFAULT_MAX_POTIONS,
    potions: Math.min(data.player.maxPotions || DEFAULT_MAX_POTIONS, data.player.potions || 0)
  });
  rebuildWorld();
}
function newGame() {
  initWorld();
  gameState = 'playing';
  saveGame();
}
function continueGame() {
  const data = loadSaveData();
  if (data) { try { applySaveData(data); } catch (e) { initWorld(); } }
  else initWorld();
  gameState = 'playing';
}
function resetGame() { newGame(); }
function respawnAfterDeath() {
  // Dying is a setback, not a save wipe: keep quest/level/spell progress and defeated-enemy
  // records, just heal up and return to a safe spot.
  if (waveActive) endWaveRun();
  currentSceneKey = 'courtyard';
  player.x = toPx(10) + (TILE - player.w) / 2;
  player.y = toPx(12) + (TILE - player.h) / 2;
  player.hp = player.maxHp;
  player.invuln = 1.5;
  rebuildWorld();
  gameState = 'playing';
  saveGame();
}

function findNearestNpc(range) {
  const ents = worldEntities[currentSceneKey];
  let nearest = null, bestD = range;
  ents.npcs.forEach(npc => {
    const cx = toPx(npc.x) + TILE / 2, cy = toPx(npc.y) + TILE / 2;
    const d = Math.hypot(player.cx - cx, player.cy - cy);
    if (d < bestD) { bestD = d; nearest = npc; }
  });
  return nearest;
}
function tryInteract() {
  const npc = findNearestNpc(70);
  if (!npc) return;
  if (npc.isShop) {
    shopMessage = ''; shopMessageT = 0;
    uiPanel = 'shop';
    playTone(660, 0.08, 'sine');
    return;
  }
  const result = npc.getLines(quest);
  dialogue = new Dialogue(npc.name, result.lines, result.complete || (() => {}));
  dialogue.triggerClear = !!result.triggerClear;
  gameState = 'dialogue';
}
function findAutoAimTarget(v) {
  const ents = worldEntities[currentSceneKey];
  if (!ents) return null;
  const maxPerp = 34, maxForward = 260;
  let best = null, bestScore = Infinity;
  ents.fairies.forEach(f => {
    if (f.dead) return;
    const dx = f.cx - player.cx, dy = f.cy - player.cy;
    const forward = dx * v.x + dy * v.y;
    if (forward <= 0 || forward > maxForward) return;
    const perp = Math.abs(dx * v.y - dy * v.x);
    if (perp > maxPerp) return;
    const score = forward + perp * 2;
    if (score < bestScore) { bestScore = score; best = f; }
  });
  return best;
}
function tryCast() {
  if (player.castCooldown > 0) return;
  const def = SPELL_DEFS[player.currentSpell];
  const vecMap = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  const v = vecMap[player.dir];
  const proj = new Projectile(player.cx + v.x * 16, player.cy + v.y * 16, v, player.currentSpell);
  // soft auto-aim: cardinal-only aiming otherwise requires near-pixel-perfect alignment with a
  // constantly wandering target, which made combat feel unresponsive; snap onto a fairy that's
  // roughly ahead so a reasonably-aimed shot still connects.
  const autoTarget = findAutoAimTarget(v);
  if (autoTarget) {
    if (v.x !== 0) proj.y = autoTarget.cy; else proj.x = autoTarget.cx;
  }
  projectiles.push(proj);
  player.castCooldown = def.cooldown;
  player.castPoseT = 0.18;
  playTone(def.tone[0], def.tone[1], def.tone[2]);
}
function switchSpell(spellType) {
  if (player.spells.includes(spellType) && player.currentSpell !== spellType) {
    player.currentSpell = spellType;
    playTone(880, 0.06, 'sine');
  }
}
function drinkPotion() {
  if (player.potions <= 0) return;
  if (player.hp >= player.maxHp) { addFloatingText(player.cx, player.y - 10, 'HPは満タン', '#999999'); return; }
  player.potions--;
  const heal = Math.round(player.maxHp * POTION_HEAL_RATIO);
  player.hp = Math.min(player.maxHp, player.hp + heal);
  addFloatingText(player.cx, player.y - 10, `+${heal} HP`, '#5fd45f');
  playTone(880, 0.12, 'sine'); playTone(1100, 0.14, 'sine');
}

function randomWalkableSpot(map) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const tx = 2 + Math.floor(Math.random() * (COLS - 4));
    const ty = 2 + Math.floor(Math.random() * (ROWS - 4));
    const px = toPx(tx) + 6, py = toPx(ty) + 6;
    if (!collides(map, px, py, 26, 26)) return { x: px, y: py };
  }
  return { x: toPx(10) + 6, y: toPx(7) + 6 };
}
function spawnNextWave() {
  waveNumber++;
  const count = Math.min(3 + Math.floor(waveNumber / 2), 8);
  const types = ['leaf', 'water', 'star'];
  const map = SCENES.forest.map;
  const list = [];
  for (let i = 0; i < count; i++) {
    const spot = randomWalkableSpot(map);
    const type = types[Math.floor(Math.random() * types.length)];
    const f = new Fairy(type, spot.x, spot.y);
    const mult = 1 + waveNumber * 0.12;
    f.hp = Math.round(f.hp * mult); f.maxHp = f.hp;
    f.speed *= (1 + waveNumber * 0.03);
    f.dmgMult = mult;
    list.push(f);
  }
  worldEntities.forest.fairies = list;
  waveBannerText = `第 ${waveNumber} 波`;
  waveBannerT = 1.6;
  playTone(440, 0.15, 'square');
}
function startWaveRun() {
  waveActive = true;
  waveNumber = 0;
  waveRestT = 0;
  spawnNextWave();
}
function endWaveRun() {
  if (!waveActive) return;
  if (waveNumber > bestWave) { bestWave = waveNumber; saveBestWave(); }
  waveActive = false;
  worldEntities.forest.fairies = [];
  waveBannerText = '';
  waveBannerT = 0;
  saveGame();
}

function trialStageComposition(stage) {
  const count = Math.min(2 + Math.ceil(stage / 2), 7);
  const shadowChance = Math.max(0, Math.min(0.9, (stage - 4) * 0.18));
  const basicTypes = stage >= 3 ? ['leaf', 'water', 'star', 'thunder'] : ['leaf', 'water', 'star'];
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push(Math.random() < shadowChance ? 'shadow' : basicTypes[Math.floor(Math.random() * basicTypes.length)]);
  }
  return list;
}
function spawnTrialStage(stage) {
  const map = SCENES.trial.map;
  map[0][10] = '#';
  const mult = 1 + (stage - 1) * 0.14;
  const list = trialStageComposition(stage).map(type => {
    const spot = randomWalkableSpot(map);
    const f = new Fairy(type, spot.x, spot.y);
    f.hp = Math.round(f.hp * mult); f.maxHp = f.hp;
    f.speed *= (1 + (stage - 1) * 0.02);
    f.contactDamage = Math.round(f.contactDamage * mult);
    f.dmgMult = mult;
    return f;
  });
  worldEntities.trial.fairies = list;
  worldEntities.trial.items = [];
  waveBannerText = `第 ${stage} の間`;
  waveBannerT = 1.6;
  trialSpawnedThisRoom = true;
  playTone(440, 0.15, 'square');
}
function startTrialCorridor() {
  quest.trialStage = 1;
  worldEntities.trial.fairies = [];
  trialSpawnedThisRoom = false;
  currentSceneKey = 'trial';
  player.x = toPx(10) + (TILE - player.w) / 2;
  player.y = toPx(ROWS - 2) + (TILE - player.h) / 2;
  saveGame();
}
function continueTrialHardMode() {
  quest.trialHardUnlocked = true;
  worldEntities.trial.fairies = [];
  trialSpawnedThisRoom = false;
  currentSceneKey = 'trial';
  player.x = toPx(10) + (TILE - player.w) / 2;
  player.y = toPx(ROWS - 2) + (TILE - player.h) / 2;
  saveGame();
}
function advanceTrialStage() {
  // Reset the exit door immediately (not just when the next stage spawns) so a still-open 'D'
  // tile can never be walked onto twice in a row and double-advance the stage counter.
  SCENES.trial.map[0][10] = '#';
  worldEntities.trial.fairies = [];
  const ceiling = quest.trialHardUnlocked ? TRIAL_STAGE_HARD_MAX : TRIAL_STAGE_MAX;
  if (quest.trialStage >= ceiling) {
    quest.trialStage = ceiling + 1;
    if (ceiling === TRIAL_STAGE_MAX && !quest.trialsRewardGiven) {
      quest.trialsRewardGiven = true;
      player.power += 25; player.maxHp += 50; player.hp = player.maxHp;
      addFloatingText(player.cx, player.y - 24, '全ステージ制覇! 力+25 HP+50', '#ffe066');
      shake(6, 0.3);
    } else if (ceiling === TRIAL_STAGE_HARD_MAX && !quest.trialHardRewardGiven) {
      quest.trialHardRewardGiven = true;
      player.power += 30; player.maxHp += 60; player.hp = player.maxHp;
      addFloatingText(player.cx, player.y - 24, '裏の回廊 完全制覇! 力+30 HP+60', '#ffe066');
      shake(8, 0.4);
    }
    player.x = toPx(10) + (TILE - player.w) / 2;
    player.y = toPx(ROWS - 2) + (TILE - player.h) / 2;
    saveGame();
    return;
  }
  quest.trialStage++;
  trialSpawnedThisRoom = false;
  player.x = toPx(10) + (TILE - player.w) / 2;
  player.y = toPx(ROWS - 2) + (TILE - player.h) / 2;
  saveGame();
}

function getMoveVector() {
  let dx = 0, dy = 0;
  if (keys.ArrowLeft || keys.KeyA) dx -= 1;
  if (keys.ArrowRight || keys.KeyD) dx += 1;
  if (keys.ArrowUp || keys.KeyW) dy -= 1;
  if (keys.ArrowDown || keys.KeyS) dy += 1;
  if (dx && dy) { const inv = 1 / Math.SQRT2; dx *= inv; dy *= inv; }
  return { dx, dy };
}

// ---- 更新 ----
function checkAchievements() {
  ACHIEVEMENTS.forEach(a => {
    if (quest.unlockedAchievements.includes(a.id)) return;
    if (a.check()) {
      quest.unlockedAchievements.push(a.id);
      achievementBannerText = `🏆 実績解除: ${a.name}`;
      achievementBannerT = 3.0;
      playTone(700, 0.1, 'triangle'); playTone(1050, 0.16, 'triangle');
    }
  });
}
function update(dt) {
  if (gameState === 'playing') {
    if (uiPanel) return;
    autosaveT -= dt;
    if (autosaveT <= 0) { autosaveT = 5; saveGame(); }
    doorCooldown = Math.max(0, doorCooldown - dt);
    if (achievementBannerT > 0) achievementBannerT -= dt;
    checkAchievements();
    updateBGM();
    const scene = SCENES[currentSceneKey];
    const { dx, dy } = getMoveVector();
    player.update(dt, dx, dy, scene.map);
    player.castCooldown = Math.max(0, player.castCooldown - dt);
    player.invuln = Math.max(0, player.invuln - dt);
    player.castPoseT = Math.max(0, player.castPoseT - dt);

    if (doorCooldown <= 0) {
      const tx = Math.floor(player.cx / TILE), ty = Math.floor(player.cy / TILE);
      const tile = scene.map[ty] && scene.map[ty][tx];
      if (currentSceneKey === 'trial' && tx === 10 && ty === 0 && tile === 'D') {
        advanceTrialStage();
        doorCooldown = 0.5;
      } else if (tile === 'D') {
        const doorDef = scene.doors.find(d => d.x === tx && d.y === ty);
        if (doorDef) {
          if (currentSceneKey === 'forest' && waveActive) endWaveRun();
          currentSceneKey = doorDef.to;
          player.x = toPx(doorDef.entry.x) + (TILE - player.w) / 2;
          player.y = toPx(doorDef.entry.y) + (TILE - player.h) / 2;
          doorCooldown = 0.5;
          saveGame();
        }
      }
    }

    const trialCeiling = quest.trialHardUnlocked ? TRIAL_STAGE_HARD_MAX : TRIAL_STAGE_MAX;
    if (currentSceneKey === 'trial' && quest.trialStage >= 1 && quest.trialStage <= trialCeiling) {
      const doorOpen = SCENES.trial.map[0][10] === 'D';
      if (!doorOpen && worldEntities.trial.fairies.length === 0) {
        if (!trialSpawnedThisRoom) {
          spawnTrialStage(quest.trialStage);
        } else {
          SCENES.trial.map[0][10] = 'D';
          waveBannerText = `第 ${quest.trialStage} の間 クリア! 扉が開いた`;
          waveBannerT = 1.8;
          playTone(660, 0.15, 'triangle'); playTone(880, 0.2, 'triangle');
          shake(3, 0.2);
        }
      }
    }

    if (waveActive && currentSceneKey === 'forest') {
      if (worldEntities.forest.fairies.length === 0 && waveRestT <= 0) {
        if (waveNumber > bestWave) { bestWave = waveNumber; saveBestWave(); }
        waveRestT = 1.5;
        waveBannerText = `第 ${waveNumber} 波 クリア!`;
        waveBannerT = 1.4;
        if (waveNumber === 10 && !quest.waveMilestone10) {
          quest.waveMilestone10 = true;
          player.power += 5;
          addFloatingText(player.cx, player.y - 30, '10波達成! 力+5', '#ffe066');
        } else if (waveNumber === 20 && !quest.waveMilestone20) {
          quest.waveMilestone20 = true;
          player.maxHp += 30; player.hp = player.maxHp;
          addFloatingText(player.cx, player.y - 30, '20波達成! 最大HP+30', '#ffe066');
        } else if (waveNumber === 30 && !quest.waveMilestone30) {
          quest.waveMilestone30 = true;
          player.power += 15; player.maxHp += 30; player.hp = player.maxHp;
          addFloatingText(player.cx, player.y - 30, '30波達成! 力+15 HP+30', '#ffe066');
        }
      }
      if (waveRestT > 0) {
        waveRestT -= dt;
        if (waveRestT <= 0) spawnNextWave();
      }
    }
    if (waveBannerT > 0) waveBannerT -= dt;
    if (shakeT > 0) { shakeT -= dt; if (shakeT <= 0) shakeMag = 0; }

    if (quest.queenQuestStarted && !quest.queenDefeated && !queenSpawned) {
      worldEntities.courtyard.fairies.push(new Fairy('queen', toPx(12), toPx(9)));
      queenSpawned = true;
    }
    if (quest.dungeonUnlocked && !dungeonSpawned) {
      worldEntities.dungeon1.fairies = makeSpawnedFairies(DUNGEON1_SPAWNS, dungeon1Defeated);
      worldEntities.dungeon2.fairies = makeSpawnedFairies(DUNGEON2_SHADOW_SPAWNS, dungeon2Defeated);
      if (!quest.dungeonBossDefeated) {
        worldEntities.dungeon2.fairies.push(new Fairy('darkmage', toPx(DUNGEON2_BOSS_SPAWN.x) + 6, toPx(DUNGEON2_BOSS_SPAWN.y) + 6));
      }
      dungeonSpawned = true;
    }
    if (quest.dungeonRewardGiven && !darkStudySpawned) {
      SCENES.dungeon2.map[ROWS - 1][10] = 'D';
      worldEntities.dungeon3.fairies = makeSpawnedFairies(DUNGEON3_SPAWNS, dungeon3Defeated);
      if (!quest.familiarDefeated) {
        worldEntities.dungeon3.fairies.push(new Fairy('familiar', toPx(DUNGEON3_BOSS_SPAWN.x) + 6, toPx(DUNGEON3_BOSS_SPAWN.y) + 6));
      }
      darkStudySpawned = true;
    }
    if (quest.treasureRewardGiven && !observatorySpawned) {
      SCENES.classroom.map[0][10] = 'D';
      if (!quest.astraDefeated) {
        worldEntities.observatory.fairies.push(new Fairy('astra', toPx(10) + 6, toPx(6) + 6));
      }
      observatorySpawned = true;
    }
    if (quest.bookQuestStarted && !booksSpawned) {
      const remaining = Math.max(0, 3 - quest.booksCollected);
      BOOK_SPOTS.slice(0, remaining).forEach(spot => {
        worldEntities.library.items.push(new Book(toPx(spot.x) + 6, toPx(spot.y) + 6, spot.lore));
      });
      booksSpawned = true;
    }
    if (quest.leafQuestStarted && !leavesSpawned) {
      const remaining = Math.max(0, 4 - quest.leavesCollected);
      LEAF_SPOTS.slice(0, remaining).forEach(spot => {
        worldEntities.greenhouse.items.push(new Leaf(toPx(spot.x) + 6, toPx(spot.y) + 6));
      });
      leavesSpawned = true;
    }
    if (quest.kentBookQuestStarted && !misplacedBooksSpawned) {
      const remaining = Math.max(0, 3 - quest.misplacedBooksReturned);
      MISPLACED_BOOK_SPOTS.slice(0, remaining).forEach(spot => {
        worldEntities[spot.scene].items.push(new MisplacedBook(toPx(spot.x) + 6, toPx(spot.y) + 6));
      });
      misplacedBooksSpawned = true;
    }
    if (quest.leafQuestCompleted && currentSceneKey === 'greenhouse') {
      LEAF_SPOTS.forEach((spot, i) => {
        const px = toPx(spot.x) + 6, py = toPx(spot.y) + 6;
        const occupied = worldEntities.greenhouse.items.some(it => it instanceof Potion && Math.abs(it.x - px) < 4 && Math.abs(it.y - py) < 4);
        if (occupied) { leafSpotTimer[i] = LEAF_RESPAWN_TIME; return; }
        leafSpotTimer[i] -= dt;
        if (leafSpotTimer[i] <= 0) {
          worldEntities.greenhouse.items.push(new Potion(px, py));
          leafSpotTimer[i] = LEAF_RESPAWN_TIME;
        }
      });
    }

    const liveEnts = worldEntities[currentSceneKey];
    liveEnts.fairies.forEach(f => {
      if (f.dead) return;
      f.update(dt, SCENES[currentSceneKey].map, player);
      if (f.pendingAttack) { f.pendingAttack = false; spawnBossAttack(f, player); }
      if (rectsOverlap(player, f) && player.invuln <= 0) {
        const dmg = Math.round(f.contactDamage * (f.dmgMult || 1));
        player.hp = Math.max(0, player.hp - dmg);
        player.invuln = 1.0;
        addFloatingText(player.cx, player.y - 10, '-' + dmg, '#ff6666');
        pushAway(player, f, 26, SCENES[currentSceneKey].map);
        playTone(140, 0.15, 'square');
        shake(f.isBoss ? 5 : 2.5, 0.2);
      }
    });

    enemyProjectiles.forEach(ep => {
      ep.update(dt, SCENES[currentSceneKey].map, player);
      if (ep.dead) return;
      const epBox = { x: ep.x - ep.r, y: ep.y - ep.r, w: ep.r * 2, h: ep.r * 2 };
      if (rectsOverlap(epBox, player) && player.invuln <= 0) {
        player.hp = Math.max(0, player.hp - ep.dmg);
        player.invuln = 1.0;
        addFloatingText(player.cx, player.y - 10, '-' + ep.dmg, '#ff88cc');
        playTone(160, 0.15, 'square');
        shake(4, 0.2);
        ep.dead = true;
      }
    });
    enemyProjectiles = enemyProjectiles.filter(ep => !ep.dead);

    projectiles.forEach(p => {
      p.update(dt, SCENES[currentSceneKey].map);
      if (p.dead) return;
      liveEnts.fairies.forEach(f => {
        if (f.dead || p.dead) return;
        if (p.hitFairies && p.hitFairies.includes(f)) return;
        const pBox = { x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2 };
        if (rectsOverlap(pBox, f)) {
          const spellDef = SPELL_DEFS[p.spellType] || SPELL_DEFS.arcane;
          const dmg = Math.max(1, Math.round(player.power * spellDef.dmgMult));
          f.hp -= dmg; f.hitFlash = 0.2;
          if (p.hitFairies) {
            p.hitFairies.push(f);
            if (p.pierceLeft > 0) p.pierceLeft--; else p.dead = true;
          } else {
            p.dead = true;
          }
          if (p.spellType === 'ice') f.slowT = 1.5;
          addFloatingText(f.cx, f.y - 6, '-' + dmg, spellDef.color);
          if (f.hp <= 0) {
            f.dead = true;
            totalKills++;
            if (!quest.bestiaryDefeated.includes(f.type)) quest.bestiaryDefeated.push(f.type);
            const shardChance = f.isBoss ? 1.0 : 0.5;
            if (Math.random() < shardChance) {
              liveEnts.items.push(new Shard(f.x + (f.w - 16) / 2, f.y + (f.h - 16) / 2, f.isBoss ? 5 : 1));
            }
            spawnBurst(f.cx, f.cy, fairyColor(f.type), f.isBoss ? 30 : 14);
            if (f.isBoss) {
              addFloatingText(f.cx, f.y - 20, '討伐成功!', '#ffe066');
              playTone(880, 0.3, 'triangle');
              shake(6, 0.3);
              if (f.type === 'queen') { quest.queenDefeated = true; gainXp(120); }
              else if (f.type === 'darkmage') { quest.dungeonBossDefeated = true; gainXp(250); }
              else if (f.type === 'familiar' && !quest.familiarDefeated) {
                quest.familiarDefeated = true;
                gainXp(200);
                player.power += 12; player.maxHp += 25; player.hp = player.maxHp;
                addFloatingText(f.cx, f.y - 40, 'レインの書斎の謎を解いた! 力+12 HP+25', '#8fd6c9');
              } else if (f.type === 'astra' && !quest.astraDefeated) {
                quest.astraDefeated = true;
                gainXp(350);
                player.power += 20; player.maxHp += 40; player.hp = player.maxHp;
                if (!player.spells.includes('wind')) player.spells.push('wind');
                addFloatingText(f.cx, f.y - 40, '「風」の魔法を会得した! 力+20 HP+40', '#b8ffb0');
              }
            } else {
              gainXp(15 + (waveActive ? waveNumber * 3 : 0));
              const dropX = f.x + (f.w - 16) / 2, dropY = f.y + (f.h - 16) / 2;
              if (!waveActive) {
                if (currentSceneKey === 'courtyard') {
                  fairiesDefeated++;
                  if (f.spawnIndex != null) courtyardDefeated[f.spawnIndex] = true;
                  liveEnts.items.push(new Crystal(dropX, dropY));
                  if (Math.random() < 0.15) liveEnts.items.push(new Potion(dropX + 10, dropY + 10));
                } else if (currentSceneKey === 'dungeon1' || currentSceneKey === 'dungeon2' || currentSceneKey === 'dungeon3') {
                  const defeatedArr = currentSceneKey === 'dungeon1' ? dungeon1Defeated : currentSceneKey === 'dungeon2' ? dungeon2Defeated : dungeon3Defeated;
                  if (f.spawnIndex != null) defeatedArr[f.spawnIndex] = true;
                  const roll = Math.random();
                  if (roll < 0.45) liveEnts.items.push(new Gear(dropX, dropY, Math.random() < 0.5 ? 'power' : 'hp'));
                  else if (roll < 0.7) liveEnts.items.push(new Potion(dropX, dropY));
                }
              } else if (Math.random() < 0.22) {
                liveEnts.items.push(new Potion(dropX, dropY));
              }
              playTone(660, 0.18, 'triangle');
            }
          } else {
            playTone(300, 0.1, 'sawtooth');
          }
        }
      });
    });
    projectiles = projectiles.filter(p => !p.dead);
    liveEnts.fairies = liveEnts.fairies.filter(f => !f.dead);

    liveEnts.items.forEach(it => {
      it.update(dt);
      if (it.collected || !rectsOverlap(player, it)) return;
      it.collected = true;
      if (it instanceof Crystal) {
        quest.crystals = Math.min(quest.required, quest.crystals + 1);
        addFloatingText(player.cx, player.y - 10, '結晶+1', '#7fd8ff');
        playTone(880, 0.12, 'sine');
      } else if (it instanceof Book) {
        quest.booksCollected = Math.min(3, quest.booksCollected + 1);
        addFloatingText(player.cx, player.y - 10, `魔法書+1 (${quest.booksCollected}/3)`, '#e0c040');
        playTone(720, 0.14, 'sine');
        dialogue = new Dialogue('古い魔法書', [it.lore || '……古びたページには、判読できない文字が並んでいる。'], () => {});
        gameState = 'dialogue';
      } else if (it instanceof Leaf) {
        quest.leavesCollected = Math.min(4, quest.leavesCollected + 1);
        addFloatingText(player.cx, player.y - 10, `癒しの葉+1 (${quest.leavesCollected}/4)`, '#9fe0a0');
        playTone(740, 0.12, 'sine');
      } else if (it instanceof Treasure) {
        if (!quest.treasuresFound.includes(it.spotIndex)) quest.treasuresFound.push(it.spotIndex);
        addFloatingText(player.cx, player.y - 10, `秘宝発見! (${quest.treasuresFound.length}/${TREASURE_SPOTS.length})`, '#ffd76b');
        playTone(900, 0.18, 'triangle'); playTone(1200, 0.14, 'triangle');
        if (quest.treasuresFound.length >= TREASURE_SPOTS.length && !quest.treasureRewardGiven) {
          quest.treasureRewardGiven = true;
          player.power += 10; player.maxHp += 20; player.hp = player.maxHp;
          addFloatingText(player.cx, player.y - 30, '全ての秘宝を発見! 力+10 HP+20', '#ffe066');
        }
      } else if (it instanceof MisplacedBook) {
        quest.misplacedBooksReturned = Math.min(3, quest.misplacedBooksReturned + 1);
        addFloatingText(player.cx, player.y - 10, `迷い込んだ本+1 (${quest.misplacedBooksReturned}/3)`, '#c9a6ff');
        playTone(760, 0.12, 'sine');
      } else if (it instanceof Shard) {
        fairyShards += it.value;
        addFloatingText(player.cx, player.y - 10, `妖精のかけら+${it.value}`, '#7fe0c9');
        playTone(820, 0.1, 'sine');
      } else if (it instanceof Gear) {
        if (it.kind === 'power') {
          player.power += 3;
          addFloatingText(player.cx, player.y - 10, 'ちからの指輪 +3', '#ff9f6b');
        } else {
          player.maxHp += 15; player.hp = Math.min(player.maxHp, player.hp + 15);
          addFloatingText(player.cx, player.y - 10, '強靭のお守り +15', '#6bd6ff');
        }
        playTone(760, 0.16, 'triangle');
      } else if (it instanceof Potion) {
        if (player.potions < player.maxPotions) {
          player.potions++;
          addFloatingText(player.cx, player.y - 10, `ポーション+1 (${player.potions}/${player.maxPotions})`, '#ff6bb8');
        } else {
          addFloatingText(player.cx, player.y - 10, 'ポーション上限!', '#999999');
        }
        playTone(700, 0.1, 'sine');
      }
    });
    liveEnts.items = liveEnts.items.filter(it => !it.collected);

    particles.forEach(pt => { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 200 * dt; pt.life -= dt; });
    particles = particles.filter(pt => pt.life > 0);
    floatingTexts.forEach(ft => { ft.y += ft.vy * dt; ft.life -= dt; });
    floatingTexts = floatingTexts.filter(ft => ft.life > 0);

    if (player.hp <= 0) { endWaveRun(); gameState = 'gameover'; }
  } else if (gameState === 'dialogue') {
    dialogue.update(dt);
  }
}

// ---- 描画 ----
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapText(text, x, y, maxWidth, lineHeight) {
  let line = '', ly = y;
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, ly); line = ch; ly += lineHeight;
    } else line = test;
  }
  ctx.fillText(line, x, ly);
}

function drawFloor(px, py, tx, ty) {
  const dark = (tx + ty) % 2 === 0;
  let c1 = '#a9835a', c2 = '#9c7750';
  if (currentSceneKey === 'courtyard') { c1 = '#4d8a3f'; c2 = '#457d36'; }
  else if (currentSceneKey === 'library') { c1 = '#7a4a3a'; c2 = '#6d4233'; }
  else if (currentSceneKey === 'forest') { c1 = '#243a24'; c2 = '#1f321f'; }
  else if (currentSceneKey === 'dungeon1' || currentSceneKey === 'dungeon2') { c1 = '#332b45'; c2 = '#2c2438'; }
  else if (currentSceneKey === 'dungeon3') { c1 = '#2a2440'; c2 = '#241f38'; }
  else if (currentSceneKey === 'greenhouse') { c1 = '#dff0d8'; c2 = '#d0e8cc'; }
  else if (currentSceneKey === 'trial') { c1 = '#6b5a3a'; c2 = '#5f4f32'; }
  else if (currentSceneKey === 'observatory') { c1 = '#141230'; c2 = '#10102a'; }
  ctx.fillStyle = dark ? c1 : c2;
  ctx.fillRect(px, py, TILE, TILE);
  if (currentSceneKey === 'courtyard' && (tx * 31 + ty * 17) % 7 === 0) {
    ctx.fillStyle = ['#ffb3c6', '#fff2b0', '#c9a6ff'][(tx + ty) % 3];
    ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, 2.4, 0, Math.PI * 2); ctx.fill();
  }
  if (currentSceneKey === 'forest' && (tx * 23 + ty * 13) % 9 === 0) {
    ctx.fillStyle = 'rgba(150,220,255,0.25)';
    ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  if (currentSceneKey === 'greenhouse' && (tx * 29 + ty * 19) % 8 === 0) {
    ctx.fillStyle = 'rgba(120,180,120,0.35)';
    ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, 2.2, 0, Math.PI * 2); ctx.fill();
  }
}
function drawObstacle(px, py, tile) {
  if (currentSceneKey === 'courtyard') {
    if (tile === '#') {
      ctx.fillStyle = '#2c4a22'; ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = '#3d6530'; ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, TILE / 2 - 4, 0, Math.PI * 2); ctx.fill();
    } else if (tile === 'T') {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(px + TILE / 2 - 3, py + TILE / 2, 6, TILE / 2 - 2);
      ctx.fillStyle = '#2f5a26'; ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2 - 4, TILE / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3f7433'; ctx.beginPath(); ctx.arc(px + TILE / 2 - 6, py + TILE / 2 - 10, TILE / 2 - 8, 0, Math.PI * 2); ctx.fill();
    } else if (tile === 'F') {
      ctx.fillStyle = '#8a8a86'; ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, TILE / 2 - 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3f9adf'; ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, TILE / 2 - 9, 0, Math.PI * 2); ctx.fill();
    } else if (tile === 'D') {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 4);
      ctx.fillStyle = '#3a2818'; ctx.fillRect(px + 4, py + 4, TILE - 8, 6);
    }
  } else if (currentSceneKey === 'classroom') {
    if (tile === '#') {
      ctx.fillStyle = '#5a5248'; ctx.fillRect(px, py, TILE, TILE);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.moveTo(px, py + TILE / 2); ctx.lineTo(px + TILE, py + TILE / 2); ctx.stroke();
    } else if (tile === 'K') {
      ctx.fillStyle = '#8a6a3f'; ctx.fillRect(px + 3, py + 8, TILE - 6, TILE - 12);
      ctx.fillStyle = '#a9835a'; ctx.fillRect(px + 3, py + 8, TILE - 6, 6);
    } else if (tile === 'D') {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 4);
      ctx.fillStyle = '#3a2818'; ctx.fillRect(px + 4, py + 4, TILE - 8, 6);
    }
  } else if (currentSceneKey === 'library') {
    if (tile === '#') {
      ctx.fillStyle = '#4a3528'; ctx.fillRect(px, py, TILE, TILE);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.moveTo(px, py + TILE / 2); ctx.lineTo(px + TILE, py + TILE / 2); ctx.stroke();
    } else if (tile === 'B') {
      ctx.fillStyle = '#5c3a22'; ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = '#7a5230'; ctx.fillRect(px + 2, py + 2, TILE - 4, 6);
      const bookColors = ['#c94f4f', '#4f8bc9', '#c9b14f', '#5fae5f'];
      for (let i = 0; i < 4; i++) { ctx.fillStyle = bookColors[i]; ctx.fillRect(px + 5 + i * 7, py + 12, 5, TILE - 20); }
    } else if (tile === 'D') {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 4);
      ctx.fillStyle = '#3a2818'; ctx.fillRect(px + 4, py + 4, TILE - 8, 6);
    }
  } else if (currentSceneKey === 'forest') {
    if (tile === '#') {
      ctx.fillStyle = '#152015'; ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = '#1e2c1e'; ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, TILE / 2 - 4, 0, Math.PI * 2); ctx.fill();
    } else if (tile === 'W') {
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(px + TILE / 2 - 3, py + TILE / 2, 6, TILE / 2 - 2);
      ctx.fillStyle = '#16241a'; ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2 - 4, TILE / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#213822'; ctx.beginPath(); ctx.arc(px + TILE / 2 - 6, py + TILE / 2 - 10, TILE / 2 - 8, 0, Math.PI * 2); ctx.fill();
    } else if (tile === 'D') {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 4);
      ctx.fillStyle = '#3a2818'; ctx.fillRect(px + 4, py + 4, TILE - 8, 6);
    }
  } else if (currentSceneKey === 'greenhouse') {
    if (tile === '#') {
      ctx.fillStyle = '#cfe8d8'; ctx.fillRect(px, py, TILE, TILE);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
      ctx.strokeRect(px + 3, py + 3, TILE - 6, TILE - 6);
    } else if (tile === 'V') {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(px + 6, py + TILE - 12, TILE - 12, 10);
      ctx.fillStyle = '#3f7433'; ctx.beginPath(); ctx.ellipse(px + TILE / 2, py + TILE / 2 - 4, TILE / 2 - 6, TILE / 2 - 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5fae5f'; ctx.beginPath(); ctx.ellipse(px + TILE / 2 - 5, py + TILE / 2 - 8, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
      ['#ff9fc4', '#fff2b0', '#c9a6ff'].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(px + 10 + i * 8, py + TILE / 2 - 6 + (i % 2) * 6, 2.2, 0, Math.PI * 2); ctx.fill();
      });
    } else if (tile === 'D') {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 4);
      ctx.fillStyle = '#3a2818'; ctx.fillRect(px + 4, py + 4, TILE - 8, 6);
    }
  } else {
    if (tile === '#') {
      ctx.fillStyle = '#1a1522'; ctx.fillRect(px, py, TILE, TILE);
      ctx.strokeStyle = 'rgba(120,90,200,0.15)'; ctx.beginPath(); ctx.moveTo(px, py + TILE / 2); ctx.lineTo(px + TILE, py + TILE / 2); ctx.stroke();
    } else if (tile === 'P') {
      ctx.fillStyle = '#2a2438'; ctx.fillRect(px + 6, py, TILE - 12, TILE);
      ctx.fillStyle = '#3d3552'; ctx.fillRect(px + 8, py + 2, TILE - 16, TILE - 4);
      ctx.fillStyle = 'rgba(150,110,255,0.5)'; ctx.fillRect(px + TILE / 2 - 1, py + 4, 2, TILE - 8);
    } else if (tile === 'B') {
      ctx.fillStyle = '#2e2540'; ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = '#453a5e'; ctx.fillRect(px + 2, py + 2, TILE - 4, 6);
      const bookColors = ['#8f6bd6', '#5a4a8f', '#6b8fd6', '#8f5a9f'];
      for (let i = 0; i < 4; i++) { ctx.fillStyle = bookColors[i]; ctx.fillRect(px + 5 + i * 7, py + 12, 5, TILE - 20); }
    } else if (tile === 'D') {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 4);
      ctx.fillStyle = '#3a2818'; ctx.fillRect(px + 4, py + 4, TILE - 8, 6);
    }
  }
}
function drawSceneTiles(scene) {
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      const px = tx * TILE, py = ty * TILE;
      drawFloor(px, py, tx, ty);
      drawObstacle(px, py, scene.map[ty][tx]);
    }
  }
}

// ---- アニメ調キャラクター描画ヘルパー ----
function shadeColor(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(255 * percent / 100);
  let r = Math.min(255, Math.max(0, (num >> 16) + amt));
  let g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
  let b = Math.min(255, Math.max(0, (num & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}
function drawStarSpark(cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.3, cy - r * 0.3); ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx + r * 0.3, cy + r * 0.3); ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.3, cy + r * 0.3); ctx.lineTo(cx - r, cy);
  ctx.lineTo(cx - r * 0.3, cy - r * 0.3);
  ctx.closePath(); ctx.fill();
}
function drawAnimeEyes(cx, eyeY, dir, irisColor, scale) {
  scale = scale || 1;
  if (dir === 'up') return;
  let ex1 = cx - 3.6 * scale, ex2 = cx + 3.6 * scale;
  if (dir === 'left') { ex1 = cx - 5.6 * scale; ex2 = cx - 1 * scale; }
  else if (dir === 'right') { ex1 = cx + 1 * scale; ex2 = cx + 5.6 * scale; }
  [ex1, ex2].forEach(ex => {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(ex, eyeY, 2.4 * scale, 3.1 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = irisColor;
    ctx.beginPath(); ctx.ellipse(ex, eyeY + 0.5 * scale, 1.9 * scale, 2.4 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#20161a';
    ctx.beginPath(); ctx.ellipse(ex, eyeY + 0.9 * scale, 1 * scale, 1.3 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(ex - 0.7 * scale, eyeY - 0.5 * scale, 0.8 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2a1a20'; ctx.lineWidth = 1 * scale;
    ctx.beginPath(); ctx.arc(ex, eyeY - 0.4 * scale, 2.8 * scale, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
  });
}
function drawBlush(cx, y) {
  ctx.fillStyle = 'rgba(255,140,140,0.4)';
  ctx.beginPath(); ctx.ellipse(cx - 7, y, 2.4, 1.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 7, y, 2.4, 1.5, 0, 0, Math.PI * 2); ctx.fill();
}

function drawPlayer(p) {
  if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) return;
  const bob = p.moving ? Math.sin(p.animT * 10) * 2 : Math.sin(performance.now() / 400) * 1.5;
  const cx = p.x + p.w / 2, topY = p.y + bob;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(cx, p.y + p.h - 2, p.w / 2.2, 5, 0, 0, Math.PI * 2); ctx.fill();

  const wingFlap = Math.sin(performance.now() / 90) * 4;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath(); ctx.ellipse(cx - 13, topY + 16 + wingFlap * 0.2, 10, 6, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 13, topY + 16 - wingFlap * 0.2, 10, 6, 0.4, 0, Math.PI * 2); ctx.fill();

  const bodyGrad = ctx.createLinearGradient(cx, topY + 8, cx, topY + 28);
  bodyGrad.addColorStop(0, '#d3b3f2'); bodyGrad.addColorStop(1, '#9a66d6');
  ctx.fillStyle = bodyGrad;
  ctx.beginPath(); ctx.ellipse(cx, topY + 19, 10.5, 11.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5b3fae'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#f2d34a';
  ctx.beginPath(); ctx.ellipse(cx, topY + 11, 3, 1.6, 0, 0, Math.PI * 2); ctx.fill();

  const headGrad = ctx.createRadialGradient(cx - 3, topY + 3, 2, cx, topY + 7, 10);
  headGrad.addColorStop(0, '#fff2e2'); headGrad.addColorStop(1, '#ffd7ae');
  ctx.fillStyle = headGrad;
  ctx.beginPath(); ctx.arc(cx, topY + 7, 9, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#6c46b8';
  ctx.beginPath();
  ctx.moveTo(cx - 10, topY + 8);
  ctx.quadraticCurveTo(cx - 12, topY - 6, cx, topY - 9);
  ctx.quadraticCurveTo(cx + 12, topY - 6, cx + 10, topY + 8);
  ctx.quadraticCurveTo(cx, topY + 1, cx - 10, topY + 8);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = shadeColor('#6c46b8', 18);
  ctx.beginPath();
  ctx.moveTo(cx - 8, topY + 2);
  ctx.quadraticCurveTo(cx - 4, topY - 5, cx, topY - 2);
  ctx.quadraticCurveTo(cx + 4, topY - 5, cx + 8, topY + 2);
  ctx.quadraticCurveTo(cx, topY + 5, cx - 8, topY + 2);
  ctx.closePath(); ctx.fill();

  ctx.strokeStyle = '#caa24a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, topY - 9); ctx.lineTo(cx, topY - 15); ctx.stroke();
  drawStarSpark(cx, topY - 17, 3.2, '#fff2b0');

  if (p.dir !== 'up') {
    drawAnimeEyes(cx, topY + 8, p.dir, '#7a4fd6');
    drawBlush(cx, topY + 11);
  }
  const wd = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[p.dir];
  const castBoost = p.castPoseT > 0 ? p.castPoseT / 0.18 : 0;
  const tipX = cx + wd[0] * (19 + castBoost * 6), tipY = topY + 15 + wd[1] * (10 + castBoost * 6);
  ctx.strokeStyle = '#caa24a'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx + wd[0] * 9, topY + 15 + wd[1] * 4);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  const spellColor = SPELL_DEFS[p.currentSpell] ? SPELL_DEFS[p.currentSpell].color : '#fff2b0';
  if (castBoost > 0) {
    const [gr, gg, gb] = hexToRgb(spellColor);
    const glowR = (3 + castBoost * 4) * 2.2;
    const glow = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, glowR);
    glow.addColorStop(0, `rgba(${gr},${gg},${gb},0.9)`); glow.addColorStop(1, `rgba(${gr},${gg},${gb},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(tipX, tipY, glowR, 0, Math.PI * 2); ctx.fill();
  }
  drawStarSpark(tipX, tipY, 3 + castBoost * 4, spellColor);
}
function drawFairy(f) {
  const isBoss = f.isBoss;
  const spriteImg = sprites[FAIRY_SPRITE_KEY[f.type]];
  if (spriteImg) drawFairySprite(f, spriteImg, isBoss);
  else drawFairyProcedural(f, isBoss);
  if (f.hp < f.maxHp && !isBoss) {
    const bx = f.x, by = f.y - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, f.w, 4);
    ctx.fillStyle = '#7CFC00'; ctx.fillRect(bx, by, f.w * Math.max(0, f.hp / f.maxHp), 4);
  }
}
function drawFairySprite(f, img, isBoss) {
  const bob = Math.sin(f.animT * (isBoss ? 2.5 : 3.2) + f.x + f.y) * (isBoss ? 4 : 3);
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2 + bob;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(f.x + f.w / 2, f.y + f.h - 2, f.w / 2.2, isBoss ? 8 : 5, 0, 0, Math.PI * 2); ctx.fill();
  const size = isBoss ? f.w * 2.5 : f.w * 2.1;
  ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  if (isBoss) {
    const topEdge = cy - size * 0.42;
    ctx.fillStyle = '#f2d34a';
    ctx.beginPath();
    ctx.moveTo(cx - 9, topEdge + 2);
    ctx.lineTo(cx - 9, topEdge - 7);
    ctx.lineTo(cx - 4, topEdge - 1);
    ctx.lineTo(cx, topEdge - 9);
    ctx.lineTo(cx + 4, topEdge - 1);
    ctx.lineTo(cx + 9, topEdge - 7);
    ctx.lineTo(cx + 9, topEdge + 2);
    ctx.closePath(); ctx.fill();
  }
}
function drawFairyProcedural(f, isBoss) {
  const bob = Math.sin(f.animT * (isBoss ? 2.5 : 4) + f.x + f.y) * (isBoss ? 4 : 3);
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2 + bob;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(f.x + f.w / 2, f.y + f.h - 2, f.w / 2.4, isBoss ? 7 : 5, 0, 0, Math.PI * 2); ctx.fill();
  if (isBoss) {
    const auraR = (f.type === 'darkmage' ? 38 : 30) + Math.sin(f.animT * 3) * 4;
    const ac = fairyColor(f.type);
    const [ar, ag, ab] = [parseInt(ac.slice(1, 3), 16), parseInt(ac.slice(3, 5), 16), parseInt(ac.slice(5, 7), 16)];
    const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, auraR);
    grad.addColorStop(0, `rgba(${ar},${ag},${ab},0.4)`); grad.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, auraR, 0, Math.PI * 2); ctx.fill();
  }
  const wingFlap = Math.sin(f.animT * 14) * 3;
  const wingRX = isBoss ? 15 : 9, wingRY = isBoss ? 8 : 5, wingOff = isBoss ? 17 : 10;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.ellipse(cx - wingOff, cy - 4 + wingFlap * 0.2, wingRX, wingRY, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + wingOff, cy - 4 - wingFlap * 0.2, wingRX, wingRY, 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = f.hitFlash > 0 ? '#ffffff' : fairyColor(f.type);
  ctx.beginPath(); ctx.ellipse(cx, cy, f.w / 2.2, f.h / 2.4, 0, 0, Math.PI * 2); ctx.fill();
  if (isBoss && f.type === 'queen') {
    const topEdge = cy - f.h / 2.4;
    ctx.fillStyle = '#f2d34a';
    ctx.beginPath();
    ctx.moveTo(cx - 9, topEdge + 2);
    ctx.lineTo(cx - 9, topEdge - 7);
    ctx.lineTo(cx - 4, topEdge - 1);
    ctx.lineTo(cx, topEdge - 9);
    ctx.lineTo(cx + 4, topEdge - 1);
    ctx.lineTo(cx + 9, topEdge - 7);
    ctx.lineTo(cx + 9, topEdge + 2);
    ctx.closePath(); ctx.fill();
  } else if (isBoss && f.type === 'darkmage') {
    const topEdge = cy - f.h / 2.4;
    ctx.fillStyle = '#1a1220';
    [-8, 0, 8].forEach(o => {
      ctx.beginPath();
      ctx.moveTo(cx + o - 3, topEdge + 3);
      ctx.lineTo(cx + o, topEdge - 10);
      ctx.lineTo(cx + o + 3, topEdge + 3);
      ctx.closePath(); ctx.fill();
    });
  } else if (f.type === 'thunder') {
    const topEdge = cy - f.h / 2.4;
    ctx.fillStyle = '#fff2a0';
    ctx.beginPath();
    ctx.moveTo(1, topEdge - 8); ctx.lineTo(-4, topEdge - 1); ctx.lineTo(0, topEdge - 1);
    ctx.lineTo(-2, topEdge + 5); ctx.lineTo(4, topEdge - 3); ctx.lineTo(0, topEdge - 3);
    ctx.closePath(); ctx.fill();
  } else if (isBoss && f.type === 'familiar') {
    const topEdge = cy - f.h / 2.4;
    ctx.fillStyle = 'rgba(200,240,230,0.85)';
    ctx.save();
    ctx.translate(cx, topEdge - 6);
    ctx.rotate(f.animT * 0.6);
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate((Math.PI * 2 / 3) * i);
      ctx.beginPath(); ctx.ellipse(0, -8, 2.5, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  } else if (isBoss && f.type === 'astra') {
    const orbitR = 26 + Math.sin(f.animT * 2) * 3;
    for (let i = 0; i < 4; i++) {
      const a = f.animT * 1.2 + (Math.PI / 2) * i;
      drawStarSpark(cx + Math.cos(a) * orbitR, cy + Math.sin(a) * orbitR * 0.6, 4, 'rgba(207,166,255,0.85)');
    }
  }
  const eyeGap = isBoss ? 6 : 4, eyeR = isBoss ? 2.6 : 1.9;
  [cx - eyeGap, cx + eyeGap].forEach(ex => {
    ctx.fillStyle = '#20161a';
    ctx.beginPath(); ctx.ellipse(ex, cy - 1, eyeR, eyeR * 1.25, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(ex - eyeR * 0.35, cy - 1 - eyeR * 0.35, eyeR * 0.42, 0, Math.PI * 2); ctx.fill();
  });
  ctx.strokeStyle = 'rgba(40,20,20,0.55)'; ctx.lineWidth = isBoss ? 1.3 : 1;
  ctx.beginPath(); ctx.arc(cx, cy + 2, isBoss ? 4 : 2.6, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
}
function drawNpcHair(cx, headY, npc) {
  const hc = npc.hairColor || '#3d2b1f';
  ctx.fillStyle = hc;
  ctx.beginPath();
  ctx.moveTo(cx - 9, headY + 6);
  ctx.quadraticCurveTo(cx - 11, headY - 7, cx, headY - 10);
  ctx.quadraticCurveTo(cx + 11, headY - 7, cx + 9, headY + 6);
  ctx.quadraticCurveTo(cx, headY, cx - 9, headY + 6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = shadeColor(hc, 16);
  ctx.beginPath();
  ctx.moveTo(cx - 7, headY);
  ctx.quadraticCurveTo(cx - 3, headY - 6, cx, headY - 3);
  ctx.quadraticCurveTo(cx + 3, headY - 6, cx + 7, headY);
  ctx.quadraticCurveTo(cx, headY + 3, cx - 7, headY);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = hc;
  if (npc.hairStyle === 'bun') {
    ctx.beginPath(); ctx.arc(cx, headY - 13, 4, 0, Math.PI * 2); ctx.fill();
  } else if (npc.hairStyle === 'twin') {
    ctx.beginPath(); ctx.ellipse(cx - 11, headY + 3, 3, 6.5, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 11, headY + 3, 3, 6.5, 0.3, 0, Math.PI * 2); ctx.fill();
  } else if (npc.hairStyle === 'side') {
    ctx.beginPath(); ctx.ellipse(cx + 9, headY + 6, 3, 8, 0.4, 0, Math.PI * 2); ctx.fill();
  } else if (npc.hairStyle === 'spike') {
    [-5, 0, 5].forEach(o => {
      ctx.beginPath(); ctx.moveTo(cx + o - 2, headY - 8); ctx.lineTo(cx + o, headY - 14); ctx.lineTo(cx + o + 2, headY - 8); ctx.closePath(); ctx.fill();
    });
  }
}
function drawNPC(npc) {
  const px = toPx(npc.x), py = toPx(npc.y);
  const cx = px + TILE / 2, cy = py + TILE / 2;
  const bob = Math.sin(performance.now() / 500 + npc.x * 3 + npc.y) * 1.2;
  const topY = py + bob;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(cx, py + TILE - 4, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
  const bodyGrad = ctx.createLinearGradient(cx, topY + TILE - 26, cx, topY + TILE - 2);
  bodyGrad.addColorStop(0, shadeColor(npc.color, 22)); bodyGrad.addColorStop(1, npc.color);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(cx - 11, topY + TILE - 4); ctx.lineTo(cx - 9, topY + TILE / 2 - 6);
  ctx.quadraticCurveTo(cx, topY + TILE / 2 - 13, cx + 9, topY + TILE / 2 - 6); ctx.lineTo(cx + 11, topY + TILE - 4);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1.1; ctx.stroke();
  const headY = topY + TILE / 2 - 11;
  const headGrad = ctx.createRadialGradient(cx - 3, headY - 3, 2, cx, headY, 9);
  headGrad.addColorStop(0, '#fff2e2'); headGrad.addColorStop(1, '#ffd7ae');
  ctx.fillStyle = headGrad;
  ctx.beginPath(); ctx.arc(cx, headY, 8, 0, Math.PI * 2); ctx.fill();
  drawNpcHair(cx, headY, npc);
  drawAnimeEyes(cx, headY + 1, 'down', npc.eyeColor || '#5a3c8a', 0.95);
  drawBlush(cx, headY + 4);
}
function drawCrystal(it) {
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2 + Math.sin(it.t * 3) * 3;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(it.t * 1.5);
  ctx.fillStyle = '#7fd8ff';
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 0); ctx.lineTo(0, 8); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(3, -1); ctx.lineTo(0, 0); ctx.lineTo(-3, -1); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawGear(it) {
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2 + Math.sin(it.t * 3) * 3;
  ctx.save(); ctx.translate(cx, cy);
  if (it.kind === 'power') {
    ctx.strokeStyle = '#ff9f6b'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffe066';
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(2, -3); ctx.lineTo(-2, -3); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = '#6bd6ff';
    ctx.beginPath(); ctx.arc(0, -2, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, -2, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-4, 2); ctx.lineTo(0, 8); ctx.lineTo(4, 2); ctx.stroke();
  }
  ctx.restore();
}
function drawBook(it) {
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2 + Math.sin(it.t * 3) * 3;
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = '#a34f4f';
  ctx.fillRect(-7, -6, 14, 12);
  ctx.fillStyle = '#e0c98f';
  ctx.fillRect(-5, -4, 10, 8);
  ctx.strokeStyle = '#5a2a2a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, 4); ctx.stroke();
  ctx.restore();
}
function drawPotion(it) {
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2 + Math.sin(it.t * 3) * 3;
  ctx.save(); ctx.translate(cx, cy);
  ctx.strokeStyle = '#7a4a3a'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-2, -8); ctx.lineTo(-2, -5); ctx.lineTo(2, -5); ctx.lineTo(2, -8); ctx.stroke();
  ctx.fillStyle = 'rgba(255,107,184,0.9)';
  ctx.beginPath(); ctx.moveTo(-3, -5); ctx.lineTo(3, -5); ctx.lineTo(5, 3); ctx.quadraticCurveTo(5, 8, 0, 8); ctx.quadraticCurveTo(-5, 8, -5, 3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-3, -5); ctx.lineTo(3, -5); ctx.lineTo(5, 3); ctx.quadraticCurveTo(5, 8, 0, 8); ctx.quadraticCurveTo(-5, 8, -5, 3); ctx.closePath(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath(); ctx.arc(-2, 2, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawLeaf(it) {
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2 + Math.sin(it.t * 3) * 3;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.sin(it.t * 1.5) * 0.3);
  ctx.fillStyle = '#5fae5f';
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.quadraticCurveTo(6, -3, 0, 7); ctx.quadraticCurveTo(-6, -3, 0, -7);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#2f6a2f'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, 6); ctx.stroke();
  ctx.restore();
}
function drawTreasure(it) {
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2 + Math.sin(it.t * 3) * 3;
  const glowR = 14 + Math.sin(it.t * 4) * 3;
  ctx.save(); ctx.translate(cx, cy);
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
  grad.addColorStop(0, 'rgba(255,215,107,0.6)'); grad.addColorStop(1, 'rgba(255,215,107,0)');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, glowR, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(it.t * 2);
  ctx.fillStyle = '#f2d34a';
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(7, 0); ctx.lineTo(0, 8); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(3, -1); ctx.lineTo(0, 1); ctx.lineTo(-3, -1); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawShard(it) {
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2 + Math.sin(it.t * 3) * 3;
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = '#7fe0c9';
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4, -1); ctx.lineTo(2, 7); ctx.lineTo(-2, 7); ctx.lineTo(-4, -1); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(2, -1); ctx.lineTo(0, 3); ctx.lineTo(-2, -1); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawProjectile(p) {
  const def = SPELL_DEFS[p.spellType] || SPELL_DEFS.arcane;
  const [r, g, b] = hexToRgb(def.color);
  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.2);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.95)`); grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff8dc'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
}
function drawEnemyProjectile(ep) {
  const [r, g, b] = hexToRgb(ep.color);
  const pulse = 1 + Math.sin(ep.t * 12) * 0.15;
  const grad = ctx.createRadialGradient(ep.x, ep.y, 0, ep.x, ep.y, ep.r * 2.4 * pulse);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.95)`); grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(ep.x, ep.y, ep.r * 2.4 * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.beginPath(); ctx.arc(ep.x, ep.y, ep.r, 0, Math.PI * 2); ctx.fill();
}
function drawParticle(pt) {
  ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
  ctx.fillStyle = pt.color;
  ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  ctx.globalAlpha = 1;
}
function drawFloatingText(ft) {
  ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
  ctx.fillStyle = ft.color; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(ft.text, ft.x, ft.y);
  ctx.globalAlpha = 1; ctx.textAlign = 'left';
}
function drawInteractIndicator(x, y) {
  const bob = Math.sin(performance.now() / 200) * 3;
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('▼', x, y + bob);
  ctx.font = '11px sans-serif'; ctx.fillStyle = '#f2d34a';
  ctx.fillText('Enter', x, y - 12 + bob);
  ctx.textAlign = 'left';
}

function drawScene() {
  const scene = SCENES[currentSceneKey];
  const ents = worldEntities[currentSceneKey];
  if (currentSceneKey === 'courtyard' && sprites.castle) {
    const cw = 260, ch = 260;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(sprites.castle, WIDTH / 2 - cw / 2, -ch * 0.62, cw, ch);
    ctx.globalAlpha = 1;
  }
  drawSceneTiles(scene);

  const drawables = [];
  ents.npcs.forEach(npc => drawables.push({ y: toPx(npc.y) + TILE, fn: () => drawNPC(npc) }));
  ents.fairies.forEach(f => { if (!f.dead) drawables.push({ y: f.y + f.h, fn: () => drawFairy(f) }); });
  ents.items.forEach(it => {
    const fn = it instanceof Gear ? () => drawGear(it)
      : it instanceof Book || it instanceof MisplacedBook ? () => drawBook(it)
      : it instanceof Potion ? () => drawPotion(it)
      : it instanceof Leaf ? () => drawLeaf(it)
      : it instanceof Treasure ? () => drawTreasure(it)
      : it instanceof Shard ? () => drawShard(it)
      : () => drawCrystal(it);
    drawables.push({ y: it.y + it.h, fn });
  });
  drawables.push({ y: player.y + player.h, fn: () => drawPlayer(player) });
  drawables.sort((a, b) => a.y - b.y);
  drawables.forEach(d => d.fn());

  projectiles.forEach(drawProjectile);
  enemyProjectiles.forEach(drawEnemyProjectile);
  particles.forEach(drawParticle);

  if (gameState === 'playing') {
    const npc = findNearestNpc(70);
    if (npc) drawInteractIndicator(toPx(npc.x) + TILE / 2, toPx(npc.y) - 6);
  }
  floatingTexts.forEach(drawFloatingText);
}

function drawHUD() {
  ctx.fillStyle = 'rgba(20,10,30,0.6)'; roundRect(16, 16, 248, 80, 8); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.fillText('HP', 26, 36);
  const bx = 54, by = 26, bw = 140, bh = 14;
  ctx.fillStyle = '#3a1a1a'; ctx.fillRect(bx, by, bw, bh);
  const ratio = Math.max(0, player.hp / player.maxHp);
  ctx.fillStyle = ratio > 0.5 ? '#5fd45f' : ratio > 0.25 ? '#e0c040' : '#e04040';
  ctx.fillRect(bx, by, bw * ratio, bh);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);

  ctx.fillStyle = '#f2d34a'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(`Lv.${player.level}`, 26, 60);
  const xbx = 62, xby = 52, xbw = 132, xbh = 8;
  ctx.fillStyle = '#2a2035'; ctx.fillRect(xbx, xby, xbw, xbh);
  ctx.fillStyle = '#7fd8ff'; ctx.fillRect(xbx, xby, xbw * Math.max(0, player.xp / player.xpToNext), xbh);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(xbx, xby, xbw, xbh);

  const spellKeys = { arcane: '1', fire: '2', ice: '3', wind: '4' };
  let sx = 26;
  Object.keys(spellKeys).forEach(sp => {
    const owned = player.spells.includes(sp);
    const active = player.currentSpell === sp;
    const def = SPELL_DEFS[sp];
    ctx.fillStyle = owned ? (active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)') : 'rgba(255,255,255,0.03)';
    roundRect(sx, 68, 40, 20, 4); ctx.fill();
    if (active) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; roundRect(sx, 68, 40, 20, 4); ctx.stroke(); }
    ctx.fillStyle = owned ? def.color : 'rgba(255,255,255,0.25)';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(`${spellKeys[sp]}:${owned ? def.label.slice(0, 2) : '?'}`, sx + 4, 82);
    sx += 44;
  });

  const potionActive = player.potions > 0 && player.hp < player.maxHp;
  ctx.fillStyle = potionActive ? 'rgba(255,107,184,0.25)' : 'rgba(255,255,255,0.06)';
  roundRect(sx + 4, 68, 46, 20, 4); ctx.fill();
  ctx.fillStyle = player.potions > 0 ? '#ff6bb8' : 'rgba(255,255,255,0.3)';
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText(`🧪E:${player.potions}`, sx + 8, 82);
  sx += 54;

  ctx.fillStyle = 'rgba(127,224,201,0.12)';
  roundRect(sx + 4, 68, 54, 20, 4); ctx.fill();
  ctx.fillStyle = '#7fe0c9';
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText(`◆${fairyShards}`, sx + 8, 82);

  const qx = WIDTH - 230, qy = 16, qw = 214, qh = 76;
  ctx.fillStyle = 'rgba(20,10,30,0.6)'; roundRect(qx, qy, qw, qh, 8); ctx.fill();
  let questTitle = '教室で先生に話しかけよう', questSub = '';
  if (quest.started && quest.crystals < quest.required) { questTitle = 'クエスト: 魔法結晶集め'; questSub = `結晶 ${quest.crystals} / ${quest.required}`; }
  else if (quest.started && !quest.completed) { questTitle = '先生に結晶を報告しよう'; }
  else if (quest.completed && !quest.queenQuestStarted) { questTitle = '図書室のミナに会いに行こう'; }
  else if (quest.queenQuestStarted && !quest.queenDefeated) { questTitle = 'クエスト: 妖精の女王を倒せ'; }
  else if (quest.queenDefeated && !quest.queenQuestCompleted) { questTitle = 'ミナに討伐を報告しよう'; }
  else if (quest.dungeonUnlocked && !quest.dungeonBossDefeated) { questTitle = 'クエスト: 闇の魔導士を倒せ'; }
  else if (quest.dungeonBossDefeated && !quest.dungeonRewardGiven) { questTitle = 'ガロンに討伐を報告しよう'; }
  else if (quest.bookQuestStarted && !quest.bookQuestCompleted) { questTitle = 'クエスト: 古い魔法書探し'; questSub = `魔法書 ${quest.booksCollected} / 3`; }
  else if (quest.hunterQuestStarted && !quest.hunterQuestCompleted) { questTitle = 'クエスト: 妖精ハンター'; questSub = `討伐 ${fairiesDefeated} / ${SCENES.courtyard.enemySpawns.length}`; }
  else if (quest.leafQuestStarted && !quest.leafQuestCompleted) { questTitle = 'クエスト: 癒しの葉集め'; questSub = `癒しの葉 ${quest.leavesCollected} / 4`; }
  else if (quest.dungeonRewardGiven && !quest.leafQuestStarted) { questTitle = '温室のフローラ先輩に会いに行こう'; }
  else if (quest.kentBookQuestStarted && !quest.kentBookQuestCompleted) { questTitle = 'クエスト: 迷い込んだ本探し'; questSub = `本 ${quest.misplacedBooksReturned} / 3`; }
  else if (quest.dungeonRewardGiven && !quest.familiarDefeated) { questTitle = 'クエスト: レインの書斎を探索せよ'; }
  else if (quest.treasureRewardGiven && !quest.astraDefeated) { questTitle = 'クエスト: 天文台の星の番人を倒せ'; }
  else if (quest.queenQuestCompleted) { questTitle = '学院いちの魔法使い!'; }
  ctx.fillStyle = '#f2d34a'; ctx.font = 'bold 13px sans-serif';
  ctx.fillText(questTitle, qx + 12, qy + 20);
  ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
  ctx.fillText(questSub, qx + 12, qy + 40);
  ctx.fillStyle = '#bcefe0'; ctx.font = '11px sans-serif';
  ctx.fillText(`妖精討伐 ${fairiesDefeated} / ${SCENES.courtyard.enemySpawns.length}`, qx + 12, qy + 58);

  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(SCENES[currentSceneKey].label, WIDTH / 2, 26);
  ctx.textAlign = 'left';

  if (currentSceneKey === 'forest') {
    const fx = WIDTH - 230, fy = qy + qh + 10, fw = 214, fh = 54;
    ctx.fillStyle = 'rgba(20,10,30,0.6)'; roundRect(fx, fy, fw, fh, 8); ctx.fill();
    ctx.fillStyle = '#9fd68a'; ctx.font = 'bold 13px sans-serif';
    if (waveActive) {
      const alive = worldEntities.forest.fairies.filter(f => !f.dead).length;
      ctx.fillText(`第 ${waveNumber} 波`, fx + 12, fy + 20);
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
      ctx.fillText(`残り ${alive} 体`, fx + 12, fy + 40);
    } else {
      ctx.fillText('森の番人ノアに話しかけよう', fx + 12, fy + 20);
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
      ctx.fillText(`最高記録: 第 ${bestWave} 波`, fx + 12, fy + 40);
    }
  }

  if (currentSceneKey === 'trial') {
    const fx = WIDTH - 230, fy = qy + qh + 10, fw = 214, fh = 54;
    ctx.fillStyle = 'rgba(20,10,30,0.6)'; roundRect(fx, fy, fw, fh, 8); ctx.fill();
    ctx.fillStyle = '#ffb85f'; ctx.font = 'bold 13px sans-serif';
    const hudCeiling = quest.trialHardUnlocked ? TRIAL_STAGE_HARD_MAX : TRIAL_STAGE_MAX;
    if (quest.trialStage === 0) {
      ctx.fillText('修行僧レンに話しかけよう', fx + 12, fy + 20);
    } else if (quest.trialStage === TRIAL_STAGE_MAX + 1 && !quest.trialHardUnlocked) {
      ctx.fillText('表10ステージ制覇!', fx + 12, fy + 20);
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
      ctx.fillText('レンに話すと裏の回廊へ', fx + 12, fy + 40);
    } else if (quest.trialStage > hudCeiling) {
      ctx.fillText('全ステージ制覇!', fx + 12, fy + 20);
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
      ctx.fillText('おめでとう!', fx + 12, fy + 40);
    } else {
      const alive = worldEntities.trial.fairies.filter(f => !f.dead).length;
      const doorOpen = SCENES.trial.map[0][10] === 'D';
      const prefix = quest.trialStage > TRIAL_STAGE_MAX ? '裏 ' : '';
      ctx.fillText(`${prefix}第 ${quest.trialStage} / ${hudCeiling} の間`, fx + 12, fy + 20);
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
      ctx.fillText(doorOpen ? '扉が開いた! 奥へ進もう' : `残り ${alive} 体`, fx + 12, fy + 40);
    }
  }

  const liveEnts = worldEntities[currentSceneKey];
  const boss = liveEnts && liveEnts.fairies.find(f => f.isBoss && !f.dead);
  if (boss) {
    const bw = 300, bh = 16, bx = (WIDTH - bw) / 2, by = 44;
    ctx.fillStyle = 'rgba(20,10,30,0.7)'; roundRect(bx - 6, by - 18, bw + 12, bh + 24, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(boss.type === 'darkmage' ? '闇の魔導士' : '妖精の女王', WIDTH / 2, by - 4);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#3a1a1a'; ctx.fillRect(bx, by, bw, bh);
    const r = Math.max(0, boss.hp / boss.maxHp);
    ctx.fillStyle = r > 0.5 ? '#c77dff' : r > 0.25 ? '#e0c040' : '#e04040';
    ctx.fillRect(bx, by, bw * r, bh);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);
  }
}
function drawDialogueBox() {
  const boxH = 120, boxY = HEIGHT - boxH - 20, boxX = 40, boxW = WIDTH - 80;
  ctx.fillStyle = 'rgba(10,8,20,0.88)'; roundRect(boxX, boxY, boxW, boxH, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; roundRect(boxX, boxY, boxW, boxH, 14); ctx.stroke();
  ctx.fillStyle = '#f2d34a'; ctx.font = 'bold 16px sans-serif'; ctx.fillText(dialogue.speaker, boxX + 20, boxY + 30);
  ctx.fillStyle = '#fff'; ctx.font = '15px sans-serif';
  wrapText(dialogue.currentLine.substring(0, dialogue.charsShown), boxX + 20, boxY + 58, boxW - 40, 22);
  if (dialogue.charsShown >= dialogue.currentLine.length && Math.floor(performance.now() / 400) % 2 === 0) {
    ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('▼', boxX + boxW - 16, boxY + boxH - 14);
    ctx.textAlign = 'left';
  }
}
function drawTitle() {
  const t = performance.now() / 1000;
  const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  grad.addColorStop(0, '#0d0a2b'); grad.addColorStop(1, '#251a4a');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (!titleStars) titleStars = Array.from({ length: 60 }, () => ({ x: Math.random() * WIDTH, y: Math.random() * HEIGHT, ph: Math.random() * 10, r: 1 + Math.random() * 1.8 }));
  titleStars.forEach(s => {
    const a = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + s.ph));
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  });
  if (sprites.castle) {
    const cw = 420, ch = 420;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(sprites.castle, WIDTH / 2 - cw / 2, HEIGHT / 2 - ch / 2 - 30, cw, ch);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2d34a'; ctx.font = 'bold 56px serif';
  ctx.shadowColor = 'rgba(242,211,74,0.6)'; ctx.shadowBlur = 20;
  ctx.fillText('魔法学院', WIDTH / 2, HEIGHT / 2 - 40);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#cbb8ff'; ctx.font = '16px sans-serif';
  ctx.fillText('〜 見習い魔法使いの一日 〜', WIDTH / 2, HEIGHT / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '12px sans-serif';
  ctx.fillText('平和だったはずの学院に、奇妙な異変が起きている……', WIDTH / 2, HEIGHT / 2 + 24);
  ctx.textAlign = 'left';

  const hasSave = hasSaveData();
  const btnW = 280, btnH = 48, btnX = WIDTH / 2 - btnW / 2;
  titleButtons = {};

  if (hasSave) {
    const savedData = loadSaveData();
    if (savedData) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f2d34a'; ctx.font = 'bold 13px sans-serif';
      ctx.fillText(`称号: ${playerTitle(savedData.quest)}`, WIDTH / 2, HEIGHT / 2 + 40);
      ctx.textAlign = 'left';
    }
    const y1 = HEIGHT / 2 + 55;
    titleButtons.continue = { x: btnX, y: y1, w: btnW, h: btnH };
    ctx.fillStyle = '#f2d34a';
    roundRect(btnX, y1, btnW, btnH, 10); ctx.fill();
    ctx.fillStyle = '#2a1a45'; ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('▶ つづきから (Enter)', WIDTH / 2, y1 + btnH / 2 + 6);

    const y2 = y1 + btnH + 16;
    titleButtons.newGame = { x: btnX, y: y2, w: btnW, h: btnH };
    ctx.strokeStyle = '#cbb8ff'; ctx.lineWidth = 2;
    roundRect(btnX, y2, btnW, btnH, 10); ctx.stroke();
    ctx.fillStyle = '#cbb8ff'; ctx.font = 'bold 15px sans-serif';
    ctx.fillText('🔄 最初からはじめる (Space)', WIDTH / 2, y2 + btnH / 2 + 5);

    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px sans-serif';
    ctx.fillText('※「最初からはじめる」は今のセーブデータを上書きします', WIDTH / 2, y2 + btnH + 22);
  } else {
    const y1 = HEIGHT / 2 + 55;
    titleButtons.newGame = { x: btnX, y: y1, w: btnW, h: btnH };
    ctx.fillStyle = '#f2d34a';
    roundRect(btnX, y1, btnW, btnH, 10); ctx.fill();
    ctx.fillStyle = '#2a1a45'; ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('▶ はじめる (Enter)', WIDTH / 2, y1 + btnH / 2 + 6);
  }
  ctx.textAlign = 'left';
}
function drawLoadingScreen() {
  const t = performance.now() / 1000;
  const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  grad.addColorStop(0, '#0d0a2b'); grad.addColorStop(1, '#251a4a');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2d34a'; ctx.font = 'bold 28px serif';
  ctx.fillText('魔法学院', WIDTH / 2, HEIGHT / 2 - 20);
  ctx.fillStyle = '#cbb8ff'; ctx.font = '15px sans-serif';
  const dots = '.'.repeat(Math.floor(t * 2) % 4);
  ctx.fillText(`モデルを読み込み中${dots}`, WIDTH / 2, HEIGHT / 2 + 14);
  const bw = 220, bx = WIDTH / 2 - bw / 2, by = HEIGHT / 2 + 34;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, 10);
  ctx.fillStyle = '#f2d34a';
  ctx.fillRect(bx, by, bw * (assetsLoadedCount / ASSET_KEYS.length), 10);
  ctx.textAlign = 'left';
}
function drawWaveBanner() {
  const a = Math.min(1, waveBannerT / 0.4);
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2d34a'; ctx.font = 'bold 26px serif';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8;
  ctx.fillText(waveBannerText, WIDTH / 2, HEIGHT / 2 - 60);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}
function drawAchievementBanner() {
  const a = Math.min(1, achievementBannerT / 0.5);
  const y = 34;
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.font = 'bold 15px sans-serif';
  const w = Math.min(420, ctx.measureText(achievementBannerText).width + 40);
  const x = WIDTH / 2 - w / 2;
  ctx.fillStyle = 'rgba(20,14,40,0.85)';
  ctx.strokeStyle = '#f2d34a'; ctx.lineWidth = 2;
  ctx.fillRect(x, y - 20, w, 32);
  ctx.strokeRect(x, y - 20, w, 32);
  ctx.fillStyle = '#f2d34a';
  ctx.fillText(achievementBannerText, WIDTH / 2, y + 2);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}
const MAP_LAYOUT = {
  classroom: { x: 0, y: -1 },
  courtyard: { x: 0, y: 0 },
  library: { x: -1, y: 0 },
  greenhouse: { x: -2, y: 0 },
  forest: { x: 1, y: 0 },
  trial: { x: 2, y: 0 },
  dungeon1: { x: 0, y: 1 },
  dungeon2: { x: 0, y: 2 },
  dungeon3: { x: 0, y: 3 },
  observatory: { x: 0, y: -2 }
};
function drawPanelBackdrop(title) {
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2d34a'; ctx.font = 'bold 22px serif';
  ctx.fillText(title, WIDTH / 2, 36);
  ctx.fillStyle = '#cbb8ff'; ctx.font = '12px sans-serif';
  ctx.fillText('もう一度キーを押す、または Esc で閉じる', WIDTH / 2, 56);
  ctx.textAlign = 'left';
}
function drawAchievementsPanel() {
  drawPanelBackdrop('実績 (C)');
  const startY = 84, rowH = 30;
  ctx.font = '14px sans-serif';
  ACHIEVEMENTS.forEach((a, i) => {
    const unlocked = quest.unlockedAchievements.includes(a.id);
    const y = startY + i * rowH;
    ctx.fillStyle = unlocked ? '#3a2f10' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(120, y, WIDTH - 240, rowH - 6);
    ctx.fillStyle = unlocked ? '#f2d34a' : '#666';
    ctx.fillText(unlocked ? '🏆' : '🔒', 130, y + rowH - 12);
    ctx.fillStyle = unlocked ? '#fff' : '#888';
    ctx.fillText(`${a.name} ─ ${a.desc}`, 160, y + rowH - 12);
  });
  const count = quest.unlockedAchievements.length;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#cbb8ff'; ctx.font = '13px sans-serif';
  ctx.fillText(`達成数: ${count} / ${ACHIEVEMENTS.length}`, WIDTH / 2, startY + ACHIEVEMENTS.length * rowH + 16);
  ctx.textAlign = 'left';
}
function drawBestiaryPanel() {
  drawPanelBackdrop('図鑑 (B)');
  const startY = 84, rowH = 30;
  ctx.font = '14px sans-serif';
  BESTIARY_TYPES.forEach((b, i) => {
    const defeated = quest.bestiaryDefeated.includes(b.type);
    const y = startY + i * rowH;
    ctx.fillStyle = defeated ? '#1a3020' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(120, y, WIDTH - 240, rowH - 6);
    ctx.fillStyle = defeated ? fairyColor(b.type) : '#666';
    ctx.fillText(defeated ? '●' : '？', 130, y + rowH - 12);
    ctx.fillStyle = defeated ? '#fff' : '#888';
    ctx.fillText(defeated ? `${b.name} ─ ${b.desc}` : '未討伐', 160, y + rowH - 12);
  });
  const count = quest.bestiaryDefeated.length;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#cbb8ff'; ctx.font = '13px sans-serif';
  ctx.fillText(`討伐図鑑: ${count} / ${BESTIARY_TYPES.length}`, WIDTH / 2, startY + BESTIARY_TYPES.length * rowH + 16);
  ctx.textAlign = 'left';
}
function drawShopPanel() {
  drawPanelBackdrop('行商人ミオの店');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7fe0c9'; ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`所持: 妖精のかけら ◆${fairyShards}`, WIDTH / 2, 66);
  ctx.textAlign = 'left';
  const startY = 92, rowH = 46;
  SHOP_ITEMS.forEach((item, i) => {
    const y = startY + i * rowH;
    const affordable = item.canBuy() && fairyShards >= item.cost();
    ctx.fillStyle = affordable ? 'rgba(127,224,201,0.12)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(120, y, WIDTH - 240, rowH - 8);
    ctx.fillStyle = affordable ? '#fff' : '#888';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`[${item.key}] ${item.name}`, 132, y + 18);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = affordable ? '#cbb8ff' : '#666';
    ctx.fillText(item.desc, 132, y + 34);
    ctx.textAlign = 'right';
    ctx.fillStyle = item.canBuy() ? (affordable ? '#f2d34a' : '#a86') : '#666';
    ctx.fillText(item.canBuy() ? `◆${item.cost()}` : '購入済上限', WIDTH - 132, y + 26);
    ctx.textAlign = 'left';
  });
  if (shopMessageT > 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe066'; ctx.font = 'bold 13px sans-serif';
    ctx.fillText(shopMessage, WIDTH / 2, startY + SHOP_ITEMS.length * rowH + 20);
    ctx.textAlign = 'left';
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px sans-serif';
  ctx.fillText('数字キーで購入 / F または Esc で店を出る', WIDTH / 2, HEIGHT - 20);
  ctx.textAlign = 'left';
}
function drawInventoryPanel() {
  drawPanelBackdrop('ステータス (I)');
  const lines = [
    `称号: ${playerTitle(quest)}`,
    `レベル ${player.level}  (次のレベルまで ${player.xpToNext - player.xp} XP)`,
    `魔法威力: ${player.power}`,
    `最大HP: ${player.maxHp}`,
    `ポーション所持上限: ${player.maxPotions}`,
    `使用可能な魔法: ${player.spells.map(s => SPELL_DEFS[s].label).join(' / ')}`,
    '',
    `魔法結晶: ${quest.crystals} / ${quest.required}`,
    `妖精の女王: ${quest.queenQuestCompleted ? '討伐済み' : quest.queenDefeated ? '討伐(未報告)' : '未討伐'}`,
    `闇の魔導士: ${quest.dungeonRewardGiven ? '討伐済み' : quest.dungeonBossDefeated ? '討伐(未報告)' : '未討伐'}`,
    `古い魔法書: ${quest.booksCollected} / 3`,
    `癒しの葉: ${quest.leavesCollected} / 4`,
    `修行の回廊: 第 ${Math.min(quest.trialStage, TRIAL_STAGE_MAX)} / ${TRIAL_STAGE_MAX} 間` + (quest.trialHardUnlocked ? ` (裏 第${Math.min(quest.trialStage, TRIAL_STAGE_HARD_MAX)}/${TRIAL_STAGE_HARD_MAX}間)` : ''),
    `秘宝: ${quest.treasuresFound.length} / ${TREASURE_SPOTS.length}`,
    `迷い込んだ本: ${quest.misplacedBooksReturned} / 3`,
    `天文台の星の番人: ${quest.astraDefeated ? '討伐済み' : quest.treasureRewardGiven ? '挑戦可能' : '未発見'}`,
    `討伐数: ${totalKills}　妖精のかけら: ${fairyShards}`,
    `図鑑: ${quest.bestiaryDefeated.length} / ${BESTIARY_TYPES.length}`,
    `実績: ${quest.unlockedAchievements.length} / ${ACHIEVEMENTS.length}`
  ];
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#fff';
  const startY = 92, rowH = 22;
  lines.forEach((line, i) => { if (line) ctx.fillText(line, 130, startY + i * rowH); });
}
function drawMapPanel() {
  drawPanelBackdrop('学院マップ (M)');
  const cx0 = WIDTH / 2, cy0 = HEIGHT / 2 - 10, cellW = 130, cellH = 90;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
  Object.keys(SCENES).forEach(key => {
    const pos = MAP_LAYOUT[key];
    if (!pos) return;
    const x1 = cx0 + pos.x * cellW, y1 = cy0 + pos.y * cellH;
    SCENES[key].doors.forEach(d => {
      const p2 = MAP_LAYOUT[d.to];
      if (!p2) return;
      const x2 = cx0 + p2.x * cellW, y2 = cy0 + p2.y * cellH;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });
  });
  Object.keys(SCENES).forEach(key => {
    const pos = MAP_LAYOUT[key];
    if (!pos) return;
    const x = cx0 + pos.x * cellW, y = cy0 + pos.y * cellH;
    const isHere = key === currentSceneKey;
    ctx.fillStyle = isHere ? '#f2d34a' : '#4a3f7a';
    ctx.strokeStyle = isHere ? '#fff' : 'rgba(255,255,255,0.5)'; ctx.lineWidth = isHere ? 3 : 1.5;
    ctx.beginPath(); ctx.arc(x, y, isHere ? 16 : 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = isHere ? '#fff' : '#cbb8ff'; ctx.font = isHere ? 'bold 13px sans-serif' : '12px sans-serif';
    ctx.fillText(SCENES[key].label, x, y + (pos.y <= 0 ? -22 : 30));
  });
  ctx.textAlign = 'left';
}
function drawUIPanel() {
  if (uiPanel === 'achievements') drawAchievementsPanel();
  else if (uiPanel === 'inventory') drawInventoryPanel();
  else if (uiPanel === 'map') drawMapPanel();
  else if (uiPanel === 'bestiary') drawBestiaryPanel();
  else if (uiPanel === 'shop') drawShopPanel();
}
function drawOverlay(title, sub, tint) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = tint; ctx.globalAlpha = 0.4; ctx.fillRect(0, 0, WIDTH, HEIGHT); ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff'; ctx.font = 'bold 40px serif';
  ctx.fillText(title, WIDTH / 2, HEIGHT / 2 - 10);
  if (Math.floor(performance.now() / 400) % 2 === 0) {
    ctx.font = '16px sans-serif'; ctx.fillText(sub, WIDTH / 2, HEIGHT / 2 + 34);
  }
  ctx.textAlign = 'left';
}

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  if (gameState === 'loading') { drawLoadingScreen(); return; }
  if (gameState === 'title') { drawTitle(); return; }
  ctx.save();
  if (shakeT > 0) ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
  drawScene();
  ctx.restore();
  if (gameState === 'dialogue') drawDialogueBox();
  drawHUD();
  if (waveBannerT > 0) drawWaveBanner();
  if (achievementBannerT > 0) drawAchievementBanner();
  if (uiPanel && gameState === 'playing') drawUIPanel();
  if (gameState === 'gameover') drawOverlay('やられてしまった…', 'Enter / Space で中庭に戻る(進行状況は保持されます)', '#3a0d0d');
  if (gameState === 'clear') drawOverlay('クエストクリア!', 'Enter / Space で冒険を続ける', '#0d2a3a');
}

// ---- 入力 ----
function onKeyDown(e) {
  const code = e.code;
  if (MOVE_KEYS.has(code) || code === 'Space' || code === 'Enter') e.preventDefault();
  keys[code] = true;
  if (uiPanel === 'shop') {
    if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') { tryShopPurchase(code.slice(-1)); return; }
    if (code === 'Escape' || code === 'KeyF') { uiPanel = null; return; }
    if (code === 'KeyI' || code === 'KeyM' || code === 'KeyC' || code === 'KeyB') return;
  }
  if (code === 'Digit1') { switchSpell('arcane'); return; }
  if (code === 'Digit2') { switchSpell('fire'); return; }
  if (code === 'Digit3') { switchSpell('ice'); return; }
  if (code === 'Digit4') { switchSpell('wind'); return; }
  if (code === 'KeyE') { if (gameState === 'playing') { ensureAudio(); drinkPotion(); } return; }
  if (code === 'KeyI' || code === 'KeyM' || code === 'KeyC' || code === 'KeyB') {
    if (e.repeat) return;
    const want = code === 'KeyI' ? 'inventory' : code === 'KeyM' ? 'map' : code === 'KeyC' ? 'achievements' : 'bestiary';
    if (gameState === 'playing') { uiPanel = uiPanel === want ? null : want; }
    return;
  }
  if (code === 'Escape') { if (uiPanel) { uiPanel = null; return; } }
  if (uiPanel) return;
  if (code !== 'Space' && code !== 'Enter') return;
  // Casting is self-throttled by player.castCooldown, so let the OS's key-repeat auto-fire it
  // at the correct cadence when the player just holds Space down (the natural instinct) instead
  // of requiring a fresh release+press per shot, which made combat feel broken for anyone who
  // held the key.
  if (gameState === 'playing' && code === 'Space') {
    ensureAudio();
    tryCast();
    return;
  }
  if (e.repeat) return;
  ensureAudio();
  if (gameState === 'title') {
    if (code === 'Enter') continueGame(); else newGame();
    return;
  }
  if (gameState === 'gameover') { respawnAfterDeath(); return; }
  if (gameState === 'clear') { gameState = 'playing'; saveGame(); return; }
  if (gameState === 'dialogue') { dialogue.advance(); return; }
  if (gameState === 'playing') {
    tryInteract();
  }
}
function onKeyUp(e) { keys[e.code] = false; }
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}
function pointInRect(px, py, r) { return r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }

canvas.addEventListener('click', (e) => {
  ensureAudio();
  if (gameState === 'title') {
    const { x, y } = canvasPos(e);
    if (titleButtons && pointInRect(x, y, titleButtons.newGame)) { newGame(); return; }
    if (titleButtons && pointInRect(x, y, titleButtons.continue)) { continueGame(); return; }
    if (!hasSaveData()) continueGame();
  } else if (gameState === 'gameover') respawnAfterDeath();
  else if (gameState === 'clear') { gameState = 'playing'; saveGame(); }
});

// ---- メインループ ----
function loop(ts) {
  const dt = Math.min(0.05, (ts - lastTime) / 1000 || 0);
  lastTime = ts;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

loadBestWave();
bakeAllSprites().then(() => { if (gameState === 'loading') gameState = 'title'; });
requestAnimationFrame(loop);
