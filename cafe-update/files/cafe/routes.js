// [카페 공사중] 자동 발행 — API 라우트. server.js 에서 mount(app) 한 줄로 붙는다.
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');

const chrome = require('./chrome');
const notify = require('./notify');
const style = require('./style');
const boards = require('./boards');
const jobs = require('./jobs');
const settings = require('./settings');
const writer = require('./writer');
const titles = require('./titles');
const tagsLib = require('./tags');
const places = require('./places');
const cover = require('./cover');
const fix = require('./fix');
const ai = require('../lib/ai');
const slideshow = require('../lib/slideshow');
const stampLib = require('../lib/stamp');
const enhanceLib = require('../lib/enhance');   // 사진 자동 보정 (2.10.38)
const { CAFE_ID, COMPANY, CONFIG_ERROR, STARTED_AT, ROOT, readUser } = require('./config');

// ─────────────────────────────────────────────
// 진행 로그 (화면이 주기적으로 가져간다)
// ─────────────────────────────────────────────
const logs = new Map(); // key → { lines: [{m, level, at}], running, error }

function logOf(key) {
  if (!logs.has(key)) logs.set(key, { lines: [], running: false, error: null });
  return logs.get(key);
}

/** key 하나당 한 번에 하나만 돈다. fn(log) 의 실패는 로그에 남기고 서버는 죽이지 않는다. */
function startRun(key, fn) {
  const L = logOf(key);
  if (L.running) return false;
  L.running = true;
  L.error = null;
  L.lines = [];
  const log = (m, level = 'info') => {
    L.lines.push({ m: String(m), level, at: Date.now() });
    if (L.lines.length > 400) L.lines.shift();
  };
  Promise.resolve()
    .then(() => fn(log))
    .catch((e) => {
      L.error = String(e && e.message ? e.message : e).split('\n')[0];
      log(L.error, 'error');
    })
    .finally(() => {
      L.running = false;
    });
  return true;
}

// ─────────────────────────────────────────────
// 업로드
// ─────────────────────────────────────────────
function fixName(name) {
  try {
    const restored = Buffer.from(name, 'latin1').toString('utf8');
    return /�/.test(restored) ? name : restored;
  } catch {
    return name;
  }
}

const naturalSort = (a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = file.fieldname === 'video' ? jobs.dir(req.jobId) : jobs.photoDir(req.jobId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    if (file.fieldname === 'video') {
      return cb(null, 'video' + (path.extname(fixName(file.originalname)).toLowerCase() || '.mp4'));
    }
    req.used = req.used || new Set();
    let name = fixName(file.originalname).replace(/[\\/:*?"<>|]/g, '_');
    if (req.used.has(name)) {
      const ext = path.extname(name);
      const base = name.slice(0, name.length - ext.length);
      let n = 2;
      while (req.used.has(`${base}_${n}${ext}`)) n++;
      name = `${base}_${n}${ext}`;
    }
    req.used.add(name);
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 80 },
  fileFilter(req, file, cb) {
    cb(null, file.fieldname === 'video' ? /^video\//.test(file.mimetype) : /^image\//.test(file.mimetype));
  },
});

function assignJobId(req, res, next) {
  req.jobId = jobs.newId();
  next();
}

// ─────────────────────────────────────────────
// 보조
// ─────────────────────────────────────────────
function titlesFor(job) {
  return titles.후보(job);
}

function coverTitle(job) {
  return cover.표지제목(job);
}

/** 서버가 다시 켜져서 '만드는 중' 에 멈춘 작업을 되돌린다. */
function healed(job) {
  if (job && job.stage === 'generating' && !logOf(job.id).running) {
    return jobs.patch(job.id, { stage: 'input', error: '서버가 다시 시작되어 글 만들기가 중단됐습니다. 다시 눌러 주세요.' });
  }
  return job;
}

/** 직접 고친 태그가 있으면 그것을, 없으면 규칙으로 만든 태그를 쓴다. */
/**
 * 영상을 안 올렸으면 사진들로 영상을 자동으로 만든다 (설정에서 끌 수 있다). 임시등록 직전에 한다.
 *  · 직접 올린 영상, 또는 [영상 빼기]로 일부러 뺀 경우는 건드리지 않는다.
 *  · 자동으로 만든 영상은 사진·각인 설정이 그대로이면 다시 만들지 않는다.
 *  · 영상 만들기가 실패해도 글 올리기는 계속한다 (영상 없이).
 */
async function autoVideo(id, log) {
  const set = settings.load();
  const cur = jobs.get(id);
  if (set.autoVideo === false || cur.noAutoVideo) return;
  if (cur.video && !cur.videoAuto) return;
  const stampOn = set.stamp !== false;
  const stampMark = stampOn ? stampLib.REV : false; // 각인 모양(REV)이 바뀌면 예전 자동 영상은 다시 만든다
  const pd = jobs.photoDir(id);
  if (cur.video && cur.videoAuto && cur.videoStamp === stampMark) {
    try {
      const vm = fs.statSync(path.join(jobs.dir(id), cur.video)).mtimeMs;
      const newest = Math.max(0, ...cur.photos.map((n) => { try { return fs.statSync(jobs.photoFile(cur, n)).mtimeMs; } catch { return 0; } }));
      if (vm >= newest) {
        log('이미 만들어 둔 자동 영상을 그대로 씁니다.');
        return;
      }
    } catch {
      /* 파일이 없으면 다시 만든다 */
    }
  }
  const ordered = writer.blocks(withTags(cur)).filter((b) => b.t === 'photos').flatMap((b) => b.files);
  const names = [...new Set(ordered.length ? ordered : cur.photos)];
  try {
    // 수직·수평 보정 / 밝기 / 모자이크를 한 사진은 보정본으로 영상을 만든다
    const file = await slideshow.make({ photoDir: pd, names, outDir: jobs.dir(id), stampOn, onLog: log, fileOf: (n) => jobs.photoFile(cur, n) });
    jobs.patch(id, { video: file, videoAuto: true, videoStamp: stampMark });
  } catch (e) {
    log(`영상 자동 만들기를 건너뜁니다 (영상 없이 올립니다): ${String(e.message).split('\n')[0]}`, 'warn');
  }
}

function withTags(j) {
  return { ...j, tags: Array.isArray(j.tags) ? j.tags : tagsLib.build(j) };
}

function view(job) {
  const j = withTags(healed(job));
  return {
    ...j,
    suggestions: tagsLib.suggestions(j),
    blocks: writer.blocks(j),
    running: logOf(j.id).running,
    hasVideo: !!j.video,
    coverFrame: cover.틀비율(j.분류), // 화면 미리보기의 사진 틀 비율 (PSD 템플릿 기준)
    videoAuto: !!j.videoAuto,
  };
}

/** 썸네일(작은 사본)을 만들어 돌려준다. 화면 확인용 — 발행에는 원본이 쓰인다. */
async function thumbOf(id, name) {
  const src = jobs.photoFile(jobs.get(id), name); // 수직·수평 보정본이 있으면 보정본
  if (!fs.existsSync(src)) return null;
  const out = path.join(jobs.photoDir(id), '_thumb', name.replace(/\.[^.]+$/, '') + '.jpg');
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sharp(src).rotate().resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toFile(out);
  }
  return out;
}

async function makeCover(id, log = () => {}) {
  const job = jobs.get(id);
  const photo = job.cover && job.cover.photo;
  if (!photo) throw new Error('표지에 쓸 사진을 먼저 골라 주세요.');
  log('표지 이미지를 만드는 중입니다…');
  const { warnings } = await cover.만들기({
    photo: jobs.photoFile(job, photo),
    out: jobs.coverFile(id),
    분류: job.분류,
    제목: coverTitle(job),
    x: job.cover.x ?? 50,
    y: job.cover.y ?? job.cover.초점Y ?? 50,
    zoom: job.cover.zoom ?? 1,
  });
  // 표지가 만들어졌으니 이전 실패 문구는 지운다. 남겨 두면 해결된 뒤에도 화면에 계속 빨갛게 보인다.
  // 글꼴이 없거나 PSD 템플릿이 없을 때의 안내는 표지 아래에 따로 보여 준다(warnings).
  jobs.patch(id, { cover: { ...job.cover, made: true, at: Date.now(), warnings }, error: null });
  for (const w of warnings) log(w, 'warn');
  log('표지 이미지를 만들었습니다.');
}

/** 요청에서 온 표지 설정(사진·위치·확대)을 검증해 합친다. */
function mergeCover(job, b) {
  const c = { ...job.cover };
  if (b.photo && job.photos.includes(b.photo)) c.photo = b.photo;
  if (b.x !== undefined) c.x = Math.min(100, Math.max(0, Number(b.x) || 0));
  if (b.y !== undefined) c.y = Math.min(100, Math.max(0, Number(b.y) || 0));
  if (b.초점Y !== undefined) c.y = Math.min(100, Math.max(0, Number(b.초점Y) || 0)); // 예전 이름
  if (b.zoom !== undefined) c.zoom = Math.min(3, Math.max(1, Number(b.zoom) || 1));
  return c;
}

/**
 * 카페 ID 가 없을 때 이유와 해결 방법. 지금 파일을 다시 읽어 보고,
 * 파일은 이미 맞는데 서버가 예전 설정으로 켜져 있으면 needsRestart 를 알려 준다.
 */
function setupProblem() {
  const now = readUser();
  if (now.user && /^\d+$/.test(String(now.user.cafeId || '').trim())) {
    return {
      needsRestart: true,
      message: `설정 파일(${path.basename(now.file)})은 이제 올바릅니다. 서버가 그 전에 켜져서(${new Date(STARTED_AT).toLocaleTimeString('ko-KR')}) 예전 설정을 쓰고 있습니다. [서버 다시 켜기]를 눌러 주세요.`,
    };
  }
  return {
    needsRestart: false,
    message: `카페 ID 가 설정되지 않았습니다 — ${now.error || CONFIG_ERROR || '알 수 없는 이유'} 고친 뒤 [서버 다시 켜기]를 눌러 주세요.`,
  };
}

/** 게시판이 안 정해진 작업은 지역으로 자동으로 고른다 (게시판 목록이 있을 때). */
function autoBoard(job) {
  if (!job || (job.board && job.board.menuId)) return job;
  const b = boards.pick(job.시도, job.구, job.동);
  return b ? jobs.patch(job.id, { board: b }) : job;
}

// 카페에 로그인돼 있는데 게시판 목록이 비어 있으면 한 번 알아서 불러온다.
let boardsAutoTried = false;

function mount(app) {
  const r = express.Router();
  r.use(express.json({ limit: '4mb' }));

  // 카페 ID 가 없으면 아무것도 못 한다. 화면이 이 메시지를 그대로 보여 준다.
  r.use((req, res, next) => {
    if (CAFE_ID || req.path === '/status' || req.path === '/restart') return next();
    res.status(400).json({ error: setupProblem().message });
  });

  // 설정을 고친 뒤 서버를 다시 켠다 (설정 파일은 서버가 켜질 때만 읽는다).
  // 새 서버를 띄우고 이 서버는 끝낸다. 새 서버는 포트가 비면 바로 열린다(server.js).
  r.post('/restart', (req, res) => {
    const busy = [...logs.values()].some((L) => L.running);
    if (busy) return res.status(409).json({ error: '진행 중인 작업이 있어 다시 켤 수 없습니다. 끝난 뒤 눌러 주세요.' });
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 300);
  });

  // ── 상태 ──────────────────────────────────
  r.get('/status', async (req, res) => {
    const st = style.summary();
    const ch = await chrome.status();
    if (CAFE_ID && ch.loggedIn && !boardsAutoTried && !boards.load().updatedAt) {
      boardsAutoTried = true;
      startRun('boards', (log) => boards.refresh(log).then(() => log('끝났습니다.', 'success')));
    }
    res.json({
      chrome: ch,
      settings: settings.load(),
      style: { links: st.links.length, analyzed: st.analyzed, guideAt: st.guideAt },
      boards: boards.load(),
      setup: { cafeId: !!CAFE_ID, company: COMPANY, ai: ai.name(), ...(CAFE_ID ? {} : setupProblem()) },
      ai: ai.status(),
    });
  });

  r.post('/chrome/open', async (req, res) => {
    try {
      res.json(await chrome.launch());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/settings', (req, res) => res.json(settings.load()));
  r.put('/settings', (req, res) => {
    try {
      res.json(settings.save(req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // 이 앱의 크롬이 지금 어떤 IP 로 나가는지 (VPN·프록시가 켜졌는지 확인용)
  r.post('/net/check', async (req, res) => {
    try {
      res.json(await chrome.checkIp());
    } catch (e) {
      res.status(500).json({ error: 'IP를 확인하지 못했습니다: ' + String(e.message).split('\n')[0] });
    }
  });

  // ── 진행 로그 ─────────────────────────────
  r.get('/log/:key', (req, res) => {
    const L = logOf(req.params.key);
    const after = Number(req.query.after) || 0;
    res.json({ lines: L.lines.slice(after), next: L.lines.length, running: L.running, error: L.error });
  });

  // ── 말투(기준 글 링크) ────────────────────
  r.get('/style', (req, res) => res.json(style.summary()));

  r.post('/style/link', (req, res) => {
    const url = String((req.body || {}).url || '').trim();
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: '카페 글 주소(https://…)를 붙여 넣어 주세요.' });
    if (!style.articleId(url)) return res.status(400).json({ error: '주소에서 글 번호를 찾지 못했습니다.' });
    const started = startRun('style', (log) => style.addLink(url, log).then(() => log('끝났습니다.', 'success')));
    res.status(started ? 202 : 409).json(started ? { started: true } : { error: '말투 분석이 이미 진행 중입니다.' });
  });

  // 카페 검색(공사전·공사중)에서 기준 글을 한꺼번에 불러와 다시 분석
  r.post('/style/import', (req, res) => {
    const perKind = Math.min(15, Math.max(1, Number((req.body || {}).perKind) || 6));
    const started = startRun('style', (log) => style.importSearch({ perKind }, log).then(() => log('끝났습니다.', 'success')));
    res.status(started ? 202 : 409).json(started ? { started: true } : { error: '말투 분석이 이미 진행 중입니다.' });
  });

  r.post('/style/rebuild', (req, res) => {
    const started = startRun('style', (log) => style.rebuild(log).then(() => log('끝났습니다.', 'success')));
    res.status(started ? 202 : 409).json(started ? { started: true } : { error: '말투 분석이 이미 진행 중입니다.' });
  });

  r.delete('/style/link/:id', (req, res) => res.json(style.removeLink(req.params.id)));

  // ── 게시판 ────────────────────────────────
  r.get('/boards', (req, res) => res.json(boards.load()));

  r.put('/boards/region', (req, res) => {
    try {
      const { region, menuId, name } = req.body || {};
      res.json(boards.setRegion(region, menuId, name));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  r.post('/boards/refresh', (req, res) => {
    const started = startRun('boards', (log) => boards.refresh(log).then(() => log('끝났습니다.', 'success')));
    res.status(started ? 202 : 409).json(started ? { started: true } : { error: '이미 진행 중입니다.' });
  });

  // ── 작업 ──────────────────────────────────
  r.get('/jobs', (req, res) => res.json(jobs.list()));

  r.post(
    '/jobs',
    assignJobId,
    upload.fields([{ name: 'photos', maxCount: 70 }, { name: 'video', maxCount: 1 }]),
    async (req, res) => {
     try {
      const b = req.body || {};
      const bad = (msg) => {
        fs.rmSync(jobs.dir(req.jobId), { recursive: true, force: true });
        res.status(400).json({ error: msg });
      };
      const 분류 = b.kind === 'before' ? 'before' : b.kind === 'during' ? 'during' : null;
      if (!분류) return bad('공사전/공사중 중 하나를 골라 주세요.');
      const 시도 = (b.sido || '').trim();
      const 구 = (b.gu || '').trim();
      const 아파트명 = (b.apt || '').trim();
      if (!시도 || !구 || !아파트명) return bad('시/도, 구, 아파트명은 꼭 입력해 주세요.');
      const files = ((req.files && req.files.photos) || []).map((f) => f.filename).sort(naturalSort);
      if (!files.length) return bad('사진을 1장 이상 올려 주세요.');

      const video = req.files && req.files.video && req.files.video[0] ? req.files.video[0].filename : null;
      const targetKeywords = String(b.targetKeywords || '')
        .split(/[\n,，;；]/)
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 5);
      const board = boards.pick(시도, 구, (b.dong || '').trim());
      const job = jobs.create(req.jobId, {
        분류, 시도, 구, 동: (b.dong || '').trim(), 아파트명, 평수: (b.size || '').trim(), 메모: (b.memo || '').trim(), photos: files, targetKeywords, board,
      });
      const t = titlesFor(job);
      const placeName = (b.placeName || '').trim();
      const place = placeName ? { name: placeName, address: (b.placeAddress || '').trim() } : null;
      jobs.patch(job.id, { titles: t, title: t[0] || '', video, place, tags: tagsLib.build(job) });
      // 사진 자동 보정 (일정에서 가져온 사진용, 2.10.38) — 문제 있는 사진만 고치고 원본은 photos/_orig 에 남긴다. 실패해도 작업은 그대로 만든다.
      let enhance = null;
      if (b.enhance === '1') {
        try { enhance = await enhanceLib.enhanceDir(jobs.photoDir(job.id), files); }
        catch (e) { enhance = { error: String((e && e.message) || e).slice(0, 120) }; }
      }
      res.json({ id: job.id, enhance });
     } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: '작업을 만들다가 문제가 생겼습니다: ' + String((e && e.message) || e).slice(0, 160) });
     }
    }
  );

  r.get('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    res.json(view(autoBoard(job)));
  });

  r.delete('/jobs/:id', (req, res) => {
    if (logOf(req.params.id).running) return res.status(409).json({ error: '진행 중인 작업은 지울 수 없습니다.' });
    jobs.remove(req.params.id);
    logs.delete(req.params.id);
    res.json({ ok: true });
  });

  // 수정 저장 — 제목, 본문, 표지 선택, 게시판, 현장 정보
  r.put('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    const b = req.body || {};
    const f = {};
    for (const k of ['title', '시도', '구', '동', '아파트명', '평수', '메모']) if (typeof b[k] === 'string') f[k] = b[k];
    if (b.분류 === 'before' || b.분류 === 'during') f.분류 = b.분류;
    if (Array.isArray(b.tags)) f.tags = [...new Set(b.tags.map((t) => String(t).replace(/[\s#]/g, '')).filter(Boolean))].slice(0, 10);
    if (Array.isArray(b.targetKeywords)) f.targetKeywords = [...new Set(b.targetKeywords.map((k) => String(k).trim()).filter(Boolean))].slice(0, 5);
    if (b.place && b.place.name) f.place = { name: String(b.place.name), address: String(b.place.address || '') };
    if (Array.isArray(b.titles)) f.titles = b.titles.map(String);
    if (b.board && b.board.menuId) f.board = { menuId: Number(b.board.menuId), name: String(b.board.name || '') };
    if (b.draft) {
      const d = b.draft;
      const usedPhotos = new Set();
      f.draft = {
        intro: String(d.intro || ''),
        sections: (d.sections || []).map((s) => ({
          space: String(s.space || ''),
          photos: (s.photos || []).map(String).filter((n) => {
            if (!job.photos.includes(n) || usedPhotos.has(n)) return false;
            usedPhotos.add(n);
            return true;
          }),
          text: String(s.text || ''),
          layout: ['individual', 'collage', 'slide'].includes(s.layout) ? s.layout : writer.기본배치((s.photos || []).length),
        })),
        outro: String(d.outro || ''),
        keywords: (job.draft && job.draft.keywords) || [],
      };
    }
    if (b.cover) f.cover = mergeCover(job, b.cover);
    if (b.removeVideo) {
      if (job.video) fs.rmSync(path.join(jobs.dir(job.id), job.video), { force: true });
      f.video = null;
      f.videoAuto = false;
      f.noAutoVideo = true; // 일부러 뺐으면 자동으로 다시 만들지 않는다
    }
    res.json(view(jobs.patch(job.id, f)));
  });

  // 제목 후보를 현장 정보로 다시 만든다.
  r.post('/jobs/:id/titles', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    const t = titlesFor(job);
    res.json(view(jobs.patch(job.id, { titles: t, title: t[0] || job.title })));
  });

  // 공사전/공사중이나 현장 정보를 바꾼 뒤 제목 후보·태그·표지를 새로 만든다. (본문 글은 그대로 둔다)
  r.post('/jobs/:id/refresh', async (req, res) => {
    const id = req.params.id;
    const job = jobs.get(id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    try {
      const t = titlesFor(job);
      const f = { titles: t, title: t[0] || job.title, tags: tagsLib.build(job) };
      if ((req.body || {}).repickBoard) {
        const b = boards.pick(job.시도, job.구, job.동);
        if (b) f.board = b;
      }
      jobs.patch(id, f);
      if (job.cover && job.cover.photo) await makeCover(id);
      res.json(view(jobs.get(id)));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 새 작업 화면을 열 때 검색용 토큰을 미리 받아 둔다. 크롬이 꺼져 있거나 로그인 전이면 아무것도 열지 않고 넘어간다.
  r.post('/places/warm', async (req, res) => {
    try {
      const st = await chrome.status();
      if (!st.loggedIn) return res.json({ ready: false });
      res.json(await places.warm());
    } catch {
      res.json({ ready: false });
    }
  });

  // 현장명 확인 — 네이버 지도 검색 후보 (에디터 토큰으로 직접 호출. 첫 검색 1초, 이후 0.2초)
  r.post('/places', async (req, res) => {
    const b = req.body || {};
    const info = { 시도: String(b.sido || ''), 구: String(b.gu || ''), 동: String(b.dong || ''), 아파트명: String(b.apt || '').trim() };
    if (!info.아파트명) return res.status(400).json({ error: '아파트명을 입력해 주세요.' });
    try {
      res.json({ candidates: await places.search(info) });
    } catch (e) {
      // Playwright 오류 문구에는 'Call log' 가 길게 붙는다. 첫 줄만 보여 준다.
      res.status(500).json({ error: String(e.message).split('\n')[0], login: /로그인/.test(e.message) });
    }
  });

  // 영상 교체
  r.post('/jobs/:id/video', (req, res, next) => {
    req.jobId = req.params.id;
    if (!jobs.get(req.jobId)) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    next();
  }, upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '영상 파일을 올려 주세요.' });
    res.json(view(jobs.patch(req.jobId, { video: req.file.filename, videoAuto: false, noAutoVideo: false })));
  });

  // 글 만들기(초안)
  r.post('/jobs/:id/generate', (req, res) => {
    const id = req.params.id;
    const job = jobs.get(id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    if (job.stage === 'published') return res.status(409).json({ error: '이미 발행한 글입니다.' });
    const started = startRun(id, async (log) => {
      jobs.patch(id, { stage: 'generating', error: null });
      try {
        const { cover: pick, draft } = await writer.generate(id, { onLog: log });
        const cur = jobs.get(id);
        const keepCover = cur.cover && cur.cover.photo && cur.photos.includes(cur.cover.photo);
        // 제목 후보: AI 가 기준 글 제목 형식으로 만든 것 → 규칙 후보 순. 제목을 직접 고치지 않았으면 첫 후보로 바꾼다.
        const 규칙 = titlesFor(cur);
        const 후보 = [...new Set([...(draft.titles || []), ...규칙])];
        const 손댐 = cur.title && !(cur.titles || []).includes(cur.title) && !규칙.includes(cur.title);
        jobs.patch(id, {
          stage: 'drafted',
          titles: 후보,
          title: 손댐 ? cur.title : 후보[0] || cur.title,
          draft,
          tags: tagsLib.build({ ...cur, draft }),
          cover: { ...cur.cover, photo: keepCover ? cur.cover.photo : pick, made: false },
          error: null,
        });
        await makeCover(id, log);
        log('초안이 완성됐습니다. 아래에서 확인하고 고쳐 주세요.', 'success');
      } catch (e) {
        jobs.patch(id, { stage: jobs.get(id).draft ? 'drafted' : 'input', error: e.message.split('\n')[0] });
        notify.toast('⚠ 글 만들기 실패', `${job.title}\n${e.message.split('\n')[0]}`);
        throw e;
      }
    });
    res.status(started ? 202 : 409).json(started ? { started: true } : { error: '이미 글을 만드는 중입니다.' });
  });

  // 표지 다시 만들기(사진·초점 변경 반영)
  r.post('/jobs/:id/cover', async (req, res) => {
    const id = req.params.id;
    const job = jobs.get(id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    try {
      const b = req.body || {};
      // 사진을 새로 고르면 위치·확대는 처음 상태(가운데·1배)로 돌린다.
      const changedPhoto = b.photo && b.photo !== (job.cover && job.cover.photo);
      const merged = mergeCover(job, changedPhoto ? { photo: b.photo, x: 50, y: 50, zoom: 1, ...b } : b);
      jobs.patch(id, { cover: merged });
      await makeCover(id);
      res.json(view(jobs.get(id)));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 표지용 사진을 파일로 직접 올린다. 본문 사진 목록에도 추가하고(맨 앞 묶음), 그 사진으로 표지를 만든다.
  r.post(
    '/jobs/:id/cover-photo',
    (req, res, next) => {
      const job = jobs.get(req.params.id);
      if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
      req.jobId = job.id;
      req.used = new Set(job.photos); // 이미 있는 파일 이름과 겹치지 않게
      next();
    },
    upload.single('photo'),
    async (req, res) => {
      const id = req.params.id;
      if (!req.file) return res.status(400).json({ error: '사진 파일(이미지)을 올려 주세요.' });
      try {
        const job = jobs.get(id);
        const name = req.file.filename;
        const photos = [...job.photos, name];
        const f = { photos, cover: { ...job.cover, photo: name, x: 50, y: 50, zoom: 1, made: false } };
        // 초안이 있으면 본문 맨 앞에 사진만 있는 묶음으로 넣는다. (◀▶ 로 순서를 옮길 수 있다)
        if (job.draft) {
          f.draft = { ...job.draft, sections: [{ space: '표지 사진', photos: [name], text: '', layout: 'individual' }, ...job.draft.sections] };
        }
        jobs.patch(id, f);
        await makeCover(id);
        res.json(view(jobs.get(id)));
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ── 사진 수직·수평 보정 ──────────────────
  // 한 장 저장: { name, rotate, vertical, horizontal } (모두 0 이면 보정 해제)
  r.post('/jobs/:id/fix', async (req, res) => {
    const id = req.params.id;
    const job = jobs.get(id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    const b = req.body || {};
    if (!job.photos.includes(b.name)) return res.status(400).json({ error: '사진을 찾지 못했습니다.' });
    try {
      const saved = await fix.apply(id, b.name, b);
      const f = { ...(job.fix || {}) };
      if (saved) f[b.name] = { ...saved, manual: true, at: Date.now() }; // 직접 고친 사진은 [전체 자동]이 덮어쓰지 않는다
      else delete f[b.name];
      jobs.patch(id, { fix: f });
      if (job.cover && job.cover.photo === b.name && job.cover.made) await makeCover(id);
      res.json(view(jobs.get(id)));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 사진 삭제 / 되돌리기 ──────────────────
  // 공간을 나눈 뒤에도 필요 없는 사진(사람이 찍힌 사진 등)을 글에서 뺀다. 파일은 지우지 않고 '삭제한 사진'에 남겨 두어 되돌릴 수 있다.
  r.post('/jobs/:id/photo-delete', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    const name = String((req.body || {}).name || '');
    if (!job.photos.includes(name)) return res.status(400).json({ error: '사진을 찾지 못했습니다.' });
    if (job.cover && job.cover.photo === name) {
      return res.status(400).json({ error: '표지에 쓰는 사진이라 지울 수 없어요. 표지를 다른 사진으로 바꾼 뒤 지워 주세요.' });
    }
    const f = { photos: job.photos.filter((n) => n !== name) };
    let section = -1;
    if (job.draft) {
      section = job.draft.sections.findIndex((sec) => (sec.photos || []).includes(name));
      f.draft = { ...job.draft, sections: job.draft.sections.map((sec) => ({ ...sec, photos: (sec.photos || []).filter((n) => n !== name) })) };
    }
    f.removed = [...(job.removed || []).filter((x) => x.name !== name), { name, section, at: Date.now() }];
    res.json(view(jobs.patch(job.id, f)));
  });

  r.post('/jobs/:id/photo-restore', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    const name = String((req.body || {}).name || '');
    const item = (job.removed || []).find((x) => x.name === name);
    if (!item || !fs.existsSync(path.join(jobs.photoDir(job.id), name))) return res.status(400).json({ error: '되돌릴 사진을 찾지 못했습니다.' });
    const f = { removed: (job.removed || []).filter((x) => x.name !== name) };
    if (!job.photos.includes(name)) f.photos = [...job.photos, name];
    if (job.draft && job.draft.sections.length) {
      // 지우기 전에 있던 공간으로 (그 공간이 없어졌으면 마지막 공간)
      const si = item.section >= 0 && item.section < job.draft.sections.length ? item.section : job.draft.sections.length - 1;
      f.draft = { ...job.draft, sections: job.draft.sections.map((sec, i) => (i === si ? { ...sec, photos: [...(sec.photos || []).filter((n) => n !== name), name] } : sec)) };
    }
    res.json(view(jobs.patch(job.id, f)));
  });

  // 자동값 계산만 (보정 창의 [자동] 버튼은 화면에서 계산하므로, 이건 확인·도구용)
  r.get('/jobs/:id/fix-detect/:name', async (req, res) => {
    try {
      res.json(await fix.detect(req.params.id, path.basename(req.params.name), String(req.query.mode || 'auto')));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 여러 장 한꺼번에 자동 보정: { names?: [...] (없으면 전체), mode: 'auto'|'vertical'|'level', overwrite?: 직접 고친 사진도 다시 }
  r.post('/jobs/:id/fix-auto', (req, res) => {
    const id = req.params.id;
    const job = jobs.get(id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    const b = req.body || {};
    const mode = ['auto', 'vertical', 'level'].includes(b.mode) ? b.mode : 'auto';
    const names = (Array.isArray(b.names) ? b.names : job.photos).filter((n) => job.photos.includes(n));
    const started = startRun(`fix-${id}`, async (log) => {
      let done = 0;
      let changed = 0;
      for (const name of names) {
        const cur = jobs.get(id);
        if (!b.overwrite && cur.fix && cur.fix[name] && cur.fix[name].manual) {
          log(`${name} — 직접 고친 사진이라 건너뜁니다.`);
          continue;
        }
        const a = await fix.detect(id, name, mode);
        const prev = (cur.fix && cur.fix[name]) || {}; // 밝기·색·모자이크는 그대로 두고 수직·수평만 새로 계산한다
        const saved = await fix.apply(id, name, { ...a, tone: prev.tone, mosaic: prev.mosaic });
        const f = { ...(jobs.get(id).fix || {}) };
        if (saved) { f[name] = { ...saved, auto: mode, at: Date.now() }; changed += 1; }
        else delete f[name];
        jobs.patch(id, { fix: f });
        done += 1;
        log(`${done}/${names.length} ${name} — ${saved ? `회전 ${saved.rotate}° · 수직 ${saved.vertical}` : (a.reason || '이미 반듯함')}`);
      }
      const after = jobs.get(id);
      if (after.cover && after.cover.photo && after.cover.made && names.includes(after.cover.photo)) await makeCover(id, log);
      log(`자동 보정 끝 — ${changed}장 보정, ${names.length - changed}장 그대로`, 'success');
    });
    res.status(started ? 202 : 409).json(started ? { started: true, logKey: `fix-${id}` } : { error: '이미 보정 중입니다.' });
  });

  r.get('/jobs/:id/cover.jpg', (req, res) => {
    const f = jobs.coverFile(req.params.id);
    if (!fs.existsSync(f)) return res.status(404).end();
    res.set('Cache-Control', 'no-store');
    res.sendFile(f);
  });

  r.get('/jobs/:id/photo/:name', async (req, res) => {
    try {
      const name = path.basename(req.params.name);
      // small=썸네일(보정 반영) · mid=보정 창용 중간 크기 원본 · 그 외=실제로 쓰는 파일(보정본 우선)
      const file = req.query.small
        ? await thumbOf(req.params.id, name)
        : req.query.mid
          ? await fix.mid(req.params.id, name)
          : jobs.photoFile(jobs.get(req.params.id), name);
      if (!file || !fs.existsSync(file)) return res.status(404).end();
      res.sendFile(file);
    } catch {
      res.status(404).end();
    }
  });

  // 카페에 입력 → [임시등록]까지.
  // 발행([등록])은 앱이 하지 않는다. 카페의 임시등록 목록에서 사람이 확인하고 직접 등록한다. (AGENTS.md 규칙 1)
  r.post('/jobs/:id/publish', async (req, res) => {
    const id = req.params.id;
    let job = jobs.get(id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    if (!job.draft) return res.status(400).json({ error: '먼저 글을 만들어 주세요.' });
    if (!job.title.trim()) return res.status(400).json({ error: '제목을 입력해 주세요.' });
    if (!job.board || !job.board.menuId) {
      // 게시판 목록이 비어 있으면 카페에서 불러온 뒤 지역으로 고른다.
      // 그래도 못 찾으면 멈추지 않는다 — 게시판 없이 임시저장하고, 사람이 카페에서 직접 고른다.
      try {
        await boards.ensure();
      } catch (e) {
        /* 게시판 목록을 못 불러와도 계속 */
      }
      job = autoBoard(job);
    }
    if (!job.cover || !job.cover.made) return res.status(400).json({ error: '표지 이미지를 먼저 만들어 주세요.' });

    const started = startRun(`pub-${id}`, async (rawLog) => {
      const editor = require('./editor');
      const log0 = rawLog;
      await autoVideo(id, log0);
      const j = withTags(jobs.get(id));
      let warns = 0;
      const log = (m, level) => {
        if (level === 'warn') warns += 1;
        rawLog(m, level);
      };
      let result;
      try {
        result = await editor.publish({ job: j, blocks: writer.blocks(j), onLog: log });
      } catch (e) {
        // 웹페이지를 안 보고 있어도 알 수 있게 윈도우 알림을 띄운다.
        notify.toast('⚠ 카페 작업 실패', `${j.title}\n${String(e.message).split('\n')[0]}`);
        throw e;
      }
      const boardSkipped = !!(result && result.boardSkipped);
      jobs.patch(id, { stage: 'saved', savedAt: new Date().toISOString(), boardSkipped });
      log(
        boardSkipped
          ? '카페에 임시저장했습니다. 게시판은 고르지 못했으니, 카페 글쓰기 화면의 [임시등록] 목록에서 불러와 게시판을 직접 고른 뒤 등록하세요.'
          : '카페에 임시저장했습니다. 카페 글쓰기 화면의 [임시등록] 목록에서 불러와 확인한 뒤 등록하세요.',
        'success'
      );
      notify.toast(
        boardSkipped ? '카페 임시 저장 완료 — 게시판은 직접 골라 주세요' : warns ? '카페 임시 저장 완료 (확인 필요 있음)' : '카페 임시 저장 완료',
        boardSkipped
          ? `${j.title}\n게시판을 못 골라 비워 두고 저장했습니다. 카페 [임시등록]에서 불러와 게시판을 고르세요.`
          : warns
            ? `${j.title}\n경고 ${warns}건이 있습니다. 작업 화면의 로그를 확인해 주세요.`
            : j.title
      );
    });
    res.status(started ? 202 : 409).json(started ? { started: true, logKey: `pub-${id}` } : { error: '이미 진행 중입니다.' });
  });

  app.use('/api/cafe', r);
}

module.exports = { mount, _test: { autoVideo } };
