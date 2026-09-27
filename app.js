/* SingStar Web Karaoke — YouTube player + microphone mixer with sync delay.
   No build step, no external deps besides the YouTube IFrame API. */

(() => {
  'use strict';

  const STORAGE_KEY = 'singstar-karaoke-settings-v1';

  const els = {
    tabYoutube: document.getElementById('tabYoutube'),
    tabLocal: document.getElementById('tabLocal'),
    youtubeControls: document.getElementById('youtubeControls'),
    localControls: document.getElementById('localControls'),
    playerEl: document.getElementById('player'),
    localVideo: document.getElementById('localVideo'),
    localFileInput: document.getElementById('localFileInput'),
    localFileName: document.getElementById('localFileName'),
    btnLocalQueueAdd: document.getElementById('btnLocalQueueAdd'),

    videoUrl: document.getElementById('videoUrl'),
    btnLoad: document.getElementById('btnLoad'),
    btnPlayPause: document.getElementById('btnPlayPause'),
    btnRestart: document.getElementById('btnRestart'),
    videoPlaceholder: document.getElementById('videoPlaceholder'),
    playerErrorBanner: document.getElementById('playerErrorBanner'),
    btnRetryPlayer: document.getElementById('btnRetryPlayer'),

    searchQuery: document.getElementById('searchQuery'),
    btnSearch: document.getElementById('btnSearch'),
    apiKeyStatus: document.getElementById('apiKeyStatus'),
    apiKeyRow: document.getElementById('apiKeyRow'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    btnSaveApiKey: document.getElementById('btnSaveApiKey'),
    btnApiKeyHelp: document.getElementById('btnApiKeyHelp'),
    btnApiKeyChange: document.getElementById('btnApiKeyChange'),
    btnApiKeyRemove: document.getElementById('btnApiKeyRemove'),
    searchStatus: document.getElementById('searchStatus'),
    searchResultsHeader: document.getElementById('searchResultsHeader'),
    btnSearchClose: document.getElementById('btnSearchClose'),
    searchResults: document.getElementById('searchResults'),
    btnSearchMore: document.getElementById('btnSearchMore'),

    sessionStartRow: document.getElementById('sessionStartRow'),
    btnSessionStart: document.getElementById('btnSessionStart'),
    sessionActiveRow: document.getElementById('sessionActiveRow'),
    sessionCode: document.getElementById('sessionCode'),
    sessionQr: document.getElementById('sessionQr'),
    btnCopyLink: document.getElementById('btnCopyLink'),
    btnLeaveSession: document.getElementById('btnLeaveSession'),
    sessionStatus: document.getElementById('sessionStatus'),

    btnUsePhoneAsMic: document.getElementById('btnUsePhoneAsMic'),
    btnStopPhoneAsMic: document.getElementById('btnStopPhoneAsMic'),
    phoneMicStatus: document.getElementById('phoneMicStatus'),
    phoneMicActive: document.getElementById('phoneMicActive'),
    phoneMicIcon: document.getElementById('phoneMicIcon'),
    phoneMicVu: document.getElementById('phoneMicVu'),
    phoneMicsGroup: document.getElementById('phoneMicsGroup'),
    phoneMicsHint: document.getElementById('phoneMicsHint'),
    phoneMicsList: document.getElementById('phoneMicsList'),

    queueSection: document.getElementById('queueSection'),
    queueUrl: document.getElementById('queueUrl'),
    btnQueueAdd: document.getElementById('btnQueueAdd'),
    btnQueueNext: document.getElementById('btnQueueNext'),
    queueList: document.getElementById('queueList'),
    btnQueueExport: document.getElementById('btnQueueExport'),
    queueImportInput: document.getElementById('queueImportInput'),
    clearPlayedFromQueue: document.getElementById('clearPlayedFromQueue'),

    videoVolume: document.getElementById('videoVolume'),
    videoVolumeVal: document.getElementById('videoVolumeVal'),
    videoOffset: document.getElementById('videoOffset'),
    videoOffsetVal: document.getElementById('videoOffsetVal'),

    btnMicStart: document.getElementById('btnMicStart'),
    micDeviceSelect: document.getElementById('micDeviceSelect'),
    stereoSplit: document.getElementById('stereoSplit'),
    micStatus: document.getElementById('micStatus'),

    mic1Gain: document.getElementById('mic1Gain'),
    mic1GainVal: document.getElementById('mic1GainVal'),
    mic1Delay: document.getElementById('mic1Delay'),
    mic1DelayVal: document.getElementById('mic1DelayVal'),
    mic1Mute: document.getElementById('mic1Mute'),
    vu1: document.getElementById('vu1'),

    mic2Gain: document.getElementById('mic2Gain'),
    mic2GainVal: document.getElementById('mic2GainVal'),
    mic2Delay: document.getElementById('mic2Delay'),
    mic2DelayVal: document.getElementById('mic2DelayVal'),
    mic2Mute: document.getElementById('mic2Mute'),
    vu2: document.getElementById('vu2'),

    masterMicGain: document.getElementById('masterMicGain'),
    masterMicGainVal: document.getElementById('masterMicGainVal'),

    btnHelp: document.getElementById('btnHelp'),
    btnHelpClose: document.getElementById('btnHelpClose'),
    helpModal: document.getElementById('helpModal'),
    btnStage: document.getElementById('btnStage'),
    btnMenu: document.getElementById('btnMenu'),

    btnSettings: document.getElementById('btnSettings'),
    btnSettingsClose: document.getElementById('btnSettingsClose'),
    settingsModal: document.getElementById('settingsModal'),
    btnOpenApiKeySettings: document.getElementById('btnOpenApiKeySettings'),

    toast: document.getElementById('toast'),

    ytStatus: document.getElementById('ytStatus'),
    audioStatus: document.getElementById('audioStatus'),
  };

  // ---------------------------------------------------------------------
  // Settings persistence
  // ---------------------------------------------------------------------
  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveSettings(patch) {
    const current = loadSettings();
    const next = Object.assign(current, patch);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      /* storage unavailable — ignore */
    }
  }

  const settings = loadSettings();

  // ---------------------------------------------------------------------
  // Toast (brief confirmation messages, e.g. "added to queue")
  // ---------------------------------------------------------------------
  let toastTimer = null;
  function showToast(message, type, durationMs) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.toggle('toast-error', type === 'error');
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), durationMs || (type === 'error' ? 4500 : 2200));
  }

  // ---------------------------------------------------------------------
  // YouTube video ID extraction
  // ---------------------------------------------------------------------
  function extractVideoId(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) return null;
    if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
    try {
      const url = new URL(trimmed);
      if (url.hostname.includes('youtu.be')) {
        return url.pathname.slice(1) || null;
      }
      if (url.hostname.includes('youtube.com')) {
        if (url.searchParams.get('v')) return url.searchParams.get('v');
        const shortsMatch = url.pathname.match(/\/shorts\/([\w-]{11})/);
        if (shortsMatch) return shortsMatch[1];
        const embedMatch = url.pathname.match(/\/embed\/([\w-]{11})/);
        if (embedMatch) return embedMatch[1];
      }
    } catch (e) {
      /* not a URL */
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Shared audio context (used by both the local-file video source and the
  // microphone mixer)
  // ---------------------------------------------------------------------
  let audioCtx = null;
  function ensureAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // audioCtx often gets created/resumed from a timer (polling for a phone
  // mic offer, for example) rather than directly inside a click handler —
  // browsers only auto-run an AudioContext when its creation/resume traces
  // back to a genuine user gesture, so a context created from a timer can
  // stay silently "suspended" forever with no code ever retrying it. This
  // catches the next real interaction anywhere on the page and gives it
  // one more nudge.
  ['click', 'touchstart', 'keydown'].forEach((evt) => {
    document.addEventListener(evt, () => {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    }, { passive: true });
  });

  // ---------------------------------------------------------------------
  // Video source mode: 'youtube' or 'local'. Both sources are wrapped behind
  // a small adapter interface (getState/getCurrentTime/seekTo/play/pause/
  // setVolume) so the transport buttons and the sync-offset loop below don't
  // need to care which one is active.
  // ---------------------------------------------------------------------
  let mode = 'youtube';
  let ytVideoLoaded = false;
  let localObjectUrl = null;
  let localSourceNode = null;
  let localVideoGain = null;

  let videoOffsetMs = Number(settings.videoOffset) || 0;
  let syncBaseWallClock = null; // Date.now() at play start
  let syncBaseVideoTime = null; // adapter.getCurrentTime() at play start
  let syncTimer = null;

  // --- YouTube player ---
  let player = null;
  let playerReady = false;

  window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
      height: '100%',
      width: '100%',
      playerVars: {
        rel: 0,
        playsinline: 1,
        modestbranding: 1,
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError,
      },
    });
  };

  function onPlayerReady() {
    playerReady = true;
    els.ytStatus.textContent = 'YouTube-Player: bereit';
    player.setVolume(Number(els.videoVolume.value));
  }

  function onPlayerError(event) {
    // YT error codes: 2 = ungültige Video-ID, 5 = HTML5-Player-Fehler,
    // 100 = Video nicht gefunden/privat, 101/150 = Embedding vom
    // Rechteinhaber deaktiviert. Dieser Fehler ist unabhängig vom
    // "Player nicht bereit"-Fall — der Player läuft hier bereits, nur
    // dieses eine Video lässt sich nicht abspielen.
    const code = event && event.data;
    let message;
    if (code === 101 || code === 150) {
      message = 'Dieses Video kann hier nicht eingebettet werden (vom Rechteinhaber deaktiviert). Über die Karaoke-Suche nach einer einbettbaren Version suchen oder eine lokale Datei nutzen.';
    } else if (code === 100) {
      message = 'Video nicht gefunden oder privat.';
    } else if (code === 2) {
      message = 'Ungültige YouTube-Video-ID.';
    } else {
      message = `YouTube meldet einen Wiedergabefehler (Code ${code}).`;
    }
    console.warn('YT player error', code);
    showToast(message, 'error', 5000);
  }

  function onPlayerStateChange(event) {
    if (mode !== 'youtube') return;
    if (event.data === YT.PlayerState.PLAYING) handlePlaybackStateChange('playing');
    else if (event.data === YT.PlayerState.PAUSED) handlePlaybackStateChange('paused');
    else if (event.data === YT.PlayerState.ENDED) handlePlaybackStateChange('ended');
  }

  const youtubeAdapter = {
    getState() {
      if (!playerReady) return 'unstarted';
      const s = player.getPlayerState();
      if (s === YT.PlayerState.PLAYING) return 'playing';
      if (s === YT.PlayerState.PAUSED) return 'paused';
      if (s === YT.PlayerState.ENDED) return 'ended';
      return 'other';
    },
    getCurrentTime: () => (playerReady ? player.getCurrentTime() : 0),
    seekTo: (t) => { if (playerReady) player.seekTo(Math.max(0, t), true); },
    play: () => { if (playerReady) player.playVideo(); },
    pause: () => { if (playerReady) player.pauseVideo(); },
    setVolume: (v) => { if (playerReady) player.setVolume(v); },
  };

  // --- Local video file ---
  function ensureLocalAudioGraph() {
    const ctx = ensureAudioCtx();
    if (!localSourceNode) {
      localSourceNode = ctx.createMediaElementSource(els.localVideo);
      localVideoGain = ctx.createGain();
      localVideoGain.gain.value = Number(els.videoVolume.value) / 100;
      localSourceNode.connect(localVideoGain);
      localVideoGain.connect(ctx.destination);
    }
  }

  function loadLocalFile(file) {
    if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
    localObjectUrl = URL.createObjectURL(file);
    els.localVideo.src = localObjectUrl;
    els.localFileName.textContent = file.name;
    ensureLocalAudioGraph();
    updatePlaceholder();
    updateTransportButtons();
  }

  els.localFileInput.addEventListener('change', () => {
    const file = els.localFileInput.files[0];
    if (!file) return;
    loadLocalFile(file);
    els.btnLocalQueueAdd.disabled = false;
  });

  els.btnLocalQueueAdd.addEventListener('click', () => {
    const file = els.localFileInput.files[0];
    if (!file) return;
    if (roomCode) {
      showToast('Lokale Dateien können nicht in eine geteilte Session aufgenommen werden (andere Geräte haben keinen Zugriff auf deine Datei).', 'error');
      return;
    }
    queue.push({ id: makeLocalId(), source: 'local', videoId: null, title: file.name, file, addedBy: '' });
    renderQueue();
    showToast(`✓ „${file.name}“ (lokale Datei) zur Warteliste hinzugefügt`);
  });

  els.localVideo.addEventListener('play', () => { if (mode === 'local') handlePlaybackStateChange('playing'); });
  els.localVideo.addEventListener('pause', () => { if (mode === 'local') handlePlaybackStateChange('paused'); });
  els.localVideo.addEventListener('ended', () => { if (mode === 'local') handlePlaybackStateChange('ended'); });

  const localAdapter = {
    getState: () => (!els.localVideo.src ? 'unstarted' : els.localVideo.ended ? 'ended' : els.localVideo.paused ? 'paused' : 'playing'),
    getCurrentTime: () => els.localVideo.currentTime || 0,
    seekTo: (t) => { els.localVideo.currentTime = Math.max(0, t); },
    play: () => { ensureAudioCtx(); els.localVideo.play().catch((e) => console.warn('Lokale Wiedergabe fehlgeschlagen:', e)); },
    pause: () => els.localVideo.pause(),
    setVolume: (v) => { if (localVideoGain) localVideoGain.gain.value = v / 100; },
  };

  function getActiveAdapter() {
    return mode === 'youtube' ? youtubeAdapter : localAdapter;
  }

  function hasActiveContent() {
    return mode === 'youtube' ? ytVideoLoaded : !!els.localVideo.src;
  }

  function updatePlaceholder() {
    els.videoPlaceholder.style.display = hasActiveContent() ? 'none' : 'flex';
  }

  function updateTransportButtons() {
    const has = hasActiveContent();
    els.btnPlayPause.disabled = !has;
    els.btnRestart.disabled = !has;
  }

  function handlePlaybackStateChange(state) {
    if (state === 'playing') {
      els.btnPlayPause.textContent = '⏸ Pause';
      syncBaseWallClock = Date.now();
      syncBaseVideoTime = getActiveAdapter().getCurrentTime();
      startSyncLoop();
    } else if (state === 'paused') {
      els.btnPlayPause.textContent = '▶ Play';
      stopSyncLoop();
    } else if (state === 'ended') {
      els.btnPlayPause.textContent = '▶ Play';
      stopSyncLoop();
      if (mode === 'youtube' && queue.length > 0) playNextInQueue();
    }
  }

  function startSyncLoop() {
    stopSyncLoop();
    let lastCorrectionAt = 0;
    syncTimer = setInterval(() => {
      const adapter = getActiveAdapter();
      if (adapter.getState() !== 'playing') return;
      const elapsedSec = (Date.now() - syncBaseWallClock) / 1000;
      const targetSec = syncBaseVideoTime + elapsedSec + videoOffsetMs / 1000;
      const actualSec = adapter.getCurrentTime();
      const drift = targetSec - actualSec;
      const now = Date.now();
      // Only correct on drift beyond ~350ms, and at most once every 2s — a
      // tighter threshold/cooldown caused visible stutter from YouTube
      // re-buffering on every small, mostly-harmless correction seek.
      if (Math.abs(drift) > 0.35 && now - lastCorrectionAt > 2000) {
        adapter.seekTo(targetSec);
        lastCorrectionAt = now;
      }
    }, 500);
  }

  function stopSyncLoop() {
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
  }

  function setMode(newMode) {
    if (mode === newMode) return;
    getActiveAdapter().pause();
    stopSyncLoop();
    mode = newMode;

    els.tabYoutube.classList.toggle('active', mode === 'youtube');
    els.tabLocal.classList.toggle('active', mode === 'local');
    els.youtubeControls.classList.toggle('hidden', mode !== 'youtube');
    els.localControls.classList.toggle('hidden', mode !== 'local');
    els.playerEl.classList.toggle('hidden', mode !== 'youtube');
    els.localVideo.classList.toggle('hidden', mode !== 'local');

    els.btnPlayPause.textContent = '▶ Play';
    updatePlaceholder();
    updateTransportButtons();
  }

  els.tabYoutube.addEventListener('click', () => setMode('youtube'));
  els.tabLocal.addEventListener('click', () => setMode('local'));

  let lastLoadRequest = null; // { idOrUrl, onLoaded } — used by the "Erneut versuchen" retry button

  function showPlayerError() {
    els.playerErrorBanner.classList.remove('hidden');
    els.videoPlaceholder.style.display = 'none';
  }

  function hidePlayerError() {
    els.playerErrorBanner.classList.add('hidden');
    updatePlaceholder();
  }

  function loadVideo(idOrUrl, opts) {
    const options = opts || {};
    const attempt = options.attempt || 0;
    if (attempt === 0) {
      lastLoadRequest = { idOrUrl, onLoaded: options.onLoaded };
      hidePlayerError();
    }
    const id = extractVideoId(idOrUrl);
    if (!id) {
      alert('Konnte keine gültige YouTube-Video-ID aus der Eingabe lesen.');
      return false;
    }
    if (!playerReady) {
      // The YT IFrame API can take a moment after page load to finish
      // initializing (it fetches extra resources from youtube.com, and on a
      // slow connection or first cold load that can take longer than a few
      // seconds). Retry quietly for up to ~8s before showing anything.
      if (attempt < 40) {
        setTimeout(() => loadVideo(idOrUrl, { attempt: attempt + 1, onLoaded: options.onLoaded }), 200);
      } else {
        showPlayerError();
      }
      return false;
    }
    player.loadVideoById(id);
    player.setVolume(Number(els.videoVolume.value));
    ytVideoLoaded = true;
    updatePlaceholder();
    updateTransportButtons();
    if (options.onLoaded) options.onLoaded();
    return true;
  }

  els.btnRetryPlayer.addEventListener('click', () => {
    hidePlayerError();
    if (lastLoadRequest) loadVideo(lastLoadRequest.idOrUrl, { onLoaded: lastLoadRequest.onLoaded });
  });

  els.btnLoad.addEventListener('click', () => loadVideo(els.videoUrl.value));
  els.videoUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadVideo(els.videoUrl.value);
  });

  els.btnPlayPause.addEventListener('click', () => {
    const adapter = getActiveAdapter();
    if (!hasActiveContent()) return;
    if (adapter.getState() === 'playing') adapter.pause();
    else adapter.play();
  });

  els.btnRestart.addEventListener('click', () => {
    const adapter = getActiveAdapter();
    if (!hasActiveContent()) return;
    adapter.seekTo(0);
    adapter.play();
  });

  // ---------------------------------------------------------------------
  // YouTube search (Data API v3) — only ever shows embeddable videos
  // ---------------------------------------------------------------------
  let nextPageToken = null;
  let lastSearchQuery = '';

  function hasApiKey() {
    return !!settings.youtubeApiKey;
  }

  function updateApiKeyUi() {
    const has = hasApiKey();
    els.apiKeyRow.classList.toggle('hidden', has);
    els.btnApiKeyChange.classList.toggle('hidden', !has);
    els.btnApiKeyRemove.classList.toggle('hidden', !has);
    els.apiKeyStatus.classList.toggle('hidden', !has);
  }

  function decodeHtmlEntities(str) {
    const txt = document.createElement('textarea');
    txt.innerHTML = str;
    return txt.value;
  }

  els.btnSaveApiKey.addEventListener('click', () => {
    const key = els.apiKeyInput.value.trim();
    if (!key) return;
    settings.youtubeApiKey = key;
    saveSettings({ youtubeApiKey: key });
    els.apiKeyInput.value = '';
    updateApiKeyUi();
    els.searchStatus.textContent = 'API-Key gespeichert.';
    els.searchStatus.style.color = 'var(--ok)';
  });

  els.btnApiKeyChange.addEventListener('click', () => {
    els.apiKeyRow.classList.remove('hidden');
    els.btnApiKeyChange.classList.add('hidden');
  });

  els.btnApiKeyRemove.addEventListener('click', () => {
    if (!confirm('API-Key wirklich entfernen? Die Karaoke-Suche funktioniert danach nicht mehr, bis ein neuer Key hinterlegt wird.')) return;
    settings.youtubeApiKey = '';
    saveSettings({ youtubeApiKey: '' });
    updateApiKeyUi();
    els.searchStatus.textContent = 'API-Key entfernt.';
    els.searchStatus.style.color = 'var(--text-dim)';
  });

  els.btnApiKeyHelp.addEventListener('click', () => {
    els.helpModal.classList.remove('hidden');
    const target = document.getElementById('help-api-key');
    if (target) target.scrollIntoView({ block: 'start' });
  });

  function renderSearchResults(items) {
    items.forEach((item) => {
      const videoId = item.id && item.id.videoId;
      if (!videoId) return;
      const thumbs = item.snippet.thumbnails || {};
      const thumbUrl = (thumbs.medium || thumbs.default || {}).url || '';
      const title = decodeHtmlEntities(item.snippet.title || '');

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'search-result';

      const img = document.createElement('img');
      img.src = thumbUrl;
      img.alt = '';
      img.loading = 'lazy';

      const titleEl = document.createElement('span');
      titleEl.className = 'sr-title';
      titleEl.textContent = title;

      const channelEl = document.createElement('span');
      channelEl.className = 'sr-channel';
      channelEl.textContent = decodeHtmlEntities(item.snippet.channelTitle || '');

      const addBtn = document.createElement('span');
      addBtn.className = 'sr-add-btn';
      addBtn.textContent = '+ Warteliste';
      addBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        addToQueue(videoId, title);
        card.classList.add('added');
        setTimeout(() => card.classList.remove('added'), 600);
      });

      card.appendChild(img);
      card.appendChild(titleEl);
      card.appendChild(channelEl);
      card.appendChild(addBtn);

      card.addEventListener('click', () => {
        if (document.body.classList.contains('join-mode')) {
          addToQueue(videoId, title);
          card.classList.add('added');
          setTimeout(() => card.classList.remove('added'), 600);
        } else {
          els.videoUrl.value = videoId;
          loadVideo(videoId);
        }
      });

      els.searchResults.appendChild(card);
    });
  }

  async function runSearch(query, pageToken) {
    if (!hasApiKey()) {
      els.searchStatus.textContent = 'Bitte zuerst einen YouTube-API-Key hinterlegen (siehe unten).';
      els.searchStatus.style.color = 'var(--danger)';
      els.apiKeyRow.classList.remove('hidden');
      return;
    }

    els.searchStatus.textContent = 'Suche läuft…';
    els.searchStatus.style.color = 'var(--text-dim)';
    els.btnSearch.disabled = true;
    els.btnSearchMore.disabled = true;

    try {
      const params = new URLSearchParams({
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: '12',
        // The API's own filters — only videos that can actually be embedded
        // and played outside youtube.com ever show up in the results.
        videoEmbeddable: 'true',
        videoSyndicated: 'true',
        safeSearch: 'moderate',
        key: settings.youtubeApiKey,
      });
      if (pageToken) params.set('pageToken', pageToken);

      const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error((data && data.error && data.error.message) || `HTTP ${resp.status}`);
      }

      if (!pageToken) els.searchResults.innerHTML = '';
      renderSearchResults(data.items || []);
      nextPageToken = data.nextPageToken || null;
      els.btnSearchMore.classList.toggle('hidden', !nextPageToken);

      const totalShown = els.searchResults.children.length;
      if (totalShown === 0) {
        els.searchStatus.textContent = 'Keine einbettbaren Videos gefunden. Anderen Suchbegriff versuchen.';
        els.searchStatus.style.color = 'var(--text-dim)';
        els.searchResultsHeader.classList.add('hidden');
        els.searchResults.classList.add('hidden');
      } else {
        els.searchStatus.textContent = `${totalShown} einbettbare(s) Video(s) gefunden.`;
        els.searchStatus.style.color = 'var(--ok)';
        els.searchResultsHeader.classList.remove('hidden');
        els.searchResults.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
      els.searchStatus.textContent = 'Fehler bei der Suche: ' + err.message;
      els.searchStatus.style.color = 'var(--danger)';
    } finally {
      els.btnSearch.disabled = false;
      els.btnSearchMore.disabled = false;
    }
  }

  els.btnSearch.addEventListener('click', () => {
    const q = els.searchQuery.value.trim();
    if (!q) return;
    lastSearchQuery = q;
    runSearch(q, null);
  });
  els.searchQuery.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.btnSearch.click();
  });
  els.btnSearchMore.addEventListener('click', () => {
    if (nextPageToken) runSearch(lastSearchQuery, nextPageToken);
  });
  els.btnSearchClose.addEventListener('click', () => {
    els.searchResults.classList.add('hidden');
    els.searchResultsHeader.classList.add('hidden');
    els.btnSearchMore.classList.add('hidden');
    els.searchStatus.textContent = '';
  });

  updateApiKeyUi();

  // ---------------------------------------------------------------------
  // Queue — items are {id, source: 'youtube'|'local', videoId, title,
  // addedBy, file?}. When a shared session is active, the room's Durable
  // Object is the source of truth for 'youtube' items and every mutation
  // round-trips through it; 'local' items (a File only this browser has)
  // never leave this device and can't be added while a session is active.
  // ---------------------------------------------------------------------
  const queue = [];

  function makeLocalId() {
    return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function persistLocalQueue() {
    // Only meaningful outside a shared session — while a room is active,
    // its Durable Object is the source of truth and gets polled back in
    // anyway; local-only items (source 'local', a File this browser holds)
    // can't be serialized to localStorage in any useful way.
    if (roomCode) return;
    const persistable = queue.filter((it) => it.source !== 'local')
      .map((it) => ({ videoId: it.videoId, title: it.title, addedBy: it.addedBy || '' }));
    saveSettings({ localQueue: persistable });
  }

  function renderQueue() {
    els.queueList.innerHTML = '';
    queue.forEach((item, idx) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      const icon = item.source === 'local' ? '💾 ' : '';
      label.textContent = `${idx + 1}. ${icon}${item.title || item.videoId}`;
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '✕';
      removeBtn.title = 'Entfernen';
      removeBtn.addEventListener('click', () => {
        queue.splice(idx, 1);
        renderQueue();
        if (roomCode) removeQueueItemFromRoom(item.id);
      });
      li.appendChild(label);
      li.appendChild(removeBtn);
      els.queueList.appendChild(li);
    });
    els.btnQueueNext.disabled = queue.length === 0;
    persistLocalQueue();
  }

  async function playNextInQueue() {
    if (queue.length === 0) return;
    const next = queue.shift();
    renderQueue();
    if (next.source === 'local' && next.file) {
      setMode('local');
      loadLocalFile(next.file);
      setTimeout(() => els.localVideo.play().catch(() => {}), 100);
    } else {
      loadVideo(next.videoId, {
        onLoaded: () => setTimeout(() => player && player.playVideo && player.playVideo(), 200),
      });
    }

    const shouldClear = els.clearPlayedFromQueue ? els.clearPlayedFromQueue.checked : true;
    if (next.source === 'local') {
      if (!shouldClear) { queue.push(next); renderQueue(); }
      return; // local-file items never touch the room
    }
    if (roomCode) {
      if (shouldClear) {
        removeQueueItemFromRoom(next.id);
      } else {
        // No "reorder" endpoint on the room API — remove + re-add lands it
        // at the back, reusing the existing add/remove round-trip instead
        // of a new one.
        await removeQueueItemFromRoom(next.id);
        await pushQueueItemToRoom({ videoId: next.videoId, title: next.title, addedBy: next.addedBy || '' });
      }
    } else if (!shouldClear) {
      queue.push(next);
      renderQueue();
    }
  }

  async function addToQueue(idOrUrl, titleOverride) {
    const videoId = extractVideoId(idOrUrl);
    if (!videoId) {
      alert('Konnte keine gültige YouTube-Video-ID aus der Eingabe lesen.');
      return;
    }
    const title = titleOverride || idOrUrl;
    let success = true;
    if (roomCode) {
      success = await pushQueueItemToRoom({ videoId, title, addedBy: '' });
    } else {
      queue.push({ id: makeLocalId(), source: 'youtube', videoId, title, addedBy: '' });
      renderQueue();
    }
    if (success) showToast(`✓ „${title}“ zur Warteliste hinzugefügt`);
  }

  els.btnQueueAdd.addEventListener('click', () => {
    const val = els.queueUrl.value.trim();
    if (!val) return;
    els.queueUrl.value = '';
    addToQueue(val);
  });
  els.queueUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.btnQueueAdd.click();
  });
  els.btnQueueNext.addEventListener('click', playNextInQueue);

  // ---------------------------------------------------------------------
  // Shared session (Cloudflare Worker + Durable Object per room code).
  // Lets other devices join via a short code / link and add songs to the
  // same queue. Polling-based — good enough for a party queue, no need
  // for WebSockets.
  // ---------------------------------------------------------------------
  const ROOM_API_BASE = 'https://singstar-karaoke-room.andreas-stetter73.workers.dev';

  let roomCode = settings.roomCode || null;
  let roomPollTimer = null;

  function getJoinCodeFromUrl() {
    const c = new URLSearchParams(location.search).get('join');
    return c ? c.toUpperCase() : null;
  }

  function applyRemoteQueue(remoteItems) {
    queue.length = 0;
    remoteItems.forEach((it) => queue.push(it));
    renderQueue();
  }

  function getJoinUrl() {
    return `${location.origin}${location.pathname}?join=${roomCode}`;
  }

  function renderSessionQr() {
    if (!els.sessionQr) return;
    els.sessionQr.innerHTML = '';
    if (typeof QRCode === 'undefined') return; // CDN blocked/offline — code/link still work
    new QRCode(els.sessionQr, {
      text: getJoinUrl(),
      width: 116,
      height: 116,
      colorDark: '#0a0512',
      colorLight: '#ffffff',
    });
  }

  function enterActiveSessionUi() {
    els.sessionStartRow.classList.add('hidden');
    els.sessionActiveRow.classList.remove('hidden');
    els.sessionCode.textContent = roomCode;
    renderSessionQr();
  }

  async function fetchRoomState() {
    if (!roomCode) return;
    try {
      const resp = await fetch(`${ROOM_API_BASE}/api/rooms/${roomCode}/queue`);
      if (!resp.ok) return;
      const data = await resp.json();
      applyRemoteQueue(data.queue || []);
      if (data.apiKey && data.apiKey !== settings.youtubeApiKey) {
        settings.youtubeApiKey = data.apiKey;
        saveSettings({ youtubeApiKey: data.apiKey });
        updateApiKeyUi();
      }
    } catch (e) {
      // transient network errors: ignore, next poll retries
    }
  }

  function startRoomPolling() {
    stopRoomPolling();
    fetchRoomState();
    roomPollTimer = setInterval(fetchRoomState, 3000);
  }

  function stopRoomPolling() {
    if (roomPollTimer) {
      clearInterval(roomPollTimer);
      roomPollTimer = null;
    }
  }

  async function pushQueueItemToRoom(item) {
    if (!roomCode) return false;
    try {
      const resp = await fetch(`${ROOM_API_BASE}/api/rooms/${roomCode}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: item.videoId, title: item.title || '', addedBy: item.addedBy || '' }),
      });
      const data = await resp.json();
      if (resp.ok) {
        applyRemoteQueue(data.queue || []);
        return true;
      }
      els.sessionStatus.textContent = 'Fehler: ' + (data.error || `HTTP ${resp.status}`);
      els.sessionStatus.style.color = 'var(--danger)';
      return false;
    } catch (e) {
      els.sessionStatus.textContent = 'Song konnte nicht synchronisiert werden (Netzwerkfehler).';
      els.sessionStatus.style.color = 'var(--danger)';
      return false;
    }
  }

  async function removeQueueItemFromRoom(itemId) {
    if (!roomCode) return;
    try {
      const resp = await fetch(`${ROOM_API_BASE}/api/rooms/${roomCode}/queue/${itemId}`, { method: 'DELETE' });
      const data = await resp.json();
      if (resp.ok) applyRemoteQueue(data.queue || []);
    } catch (e) {
      console.warn('Konnte Song nicht aus der Session entfernen:', e);
    }
  }

  async function pushApiKeyToRoom(apiKey) {
    if (!roomCode || !apiKey) return;
    try {
      await fetch(`${ROOM_API_BASE}/api/rooms/${roomCode}/apikey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
    } catch (e) {
      console.warn('Konnte API-Key nicht mit Session teilen:', e);
    }
  }

  async function startSession() {
    els.btnSessionStart.disabled = true;
    els.sessionStatus.textContent = 'Session wird erstellt…';
    els.sessionStatus.style.color = 'var(--text-dim)';
    try {
      const resp = await fetch(`${ROOM_API_BASE}/api/rooms`, { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

      // Local-file queue items are a browser-local File object — they can't
      // be transmitted to the room, so they're dropped here (and never sent
      // to pushQueueItemToRoom, which only accepts a youtube videoId).
      const localFileCount = queue.filter((it) => it.source === 'local').length;
      const localSnapshot = queue.filter((it) => it.source !== 'local').map((it) => ({ ...it }));
      roomCode = data.code;
      saveSettings({ roomCode });
      enterActiveSessionUi();
      startRoomPolling();
      startMicsHostPolling();

      if (hasApiKey()) await pushApiKeyToRoom(settings.youtubeApiKey);
      for (const item of localSnapshot) {
        await pushQueueItemToRoom(item);
      }

      els.sessionStatus.textContent = 'Session aktiv.';
      els.sessionStatus.style.color = 'var(--ok)';
      if (localFileCount > 0) {
        showToast(`${localFileCount} lokale Datei(en) aus der Warteliste entfernt (in Sessions nicht unterstützt).`, 'error');
      }
    } catch (err) {
      els.sessionStatus.textContent = 'Fehler beim Erstellen der Session: ' + err.message;
      els.sessionStatus.style.color = 'var(--danger)';
    } finally {
      els.btnSessionStart.disabled = false;
    }
  }

  function leaveSession() {
    stopRoomPolling();
    stopMicsHostPolling();
    if (phoneSender) stopUsingPhoneAsMic(true);
    roomCode = null;
    saveSettings({ roomCode: null });
    els.sessionStartRow.classList.remove('hidden');
    els.sessionActiveRow.classList.add('hidden');
    els.sessionStatus.textContent = '';
    if (document.body.classList.contains('join-mode')) {
      const url = new URL(location.href);
      url.searchParams.delete('join');
      location.href = url.toString();
    }
  }

  function joinRoomFromUrl(code) {
    roomCode = code;
    saveSettings({ roomCode: code });
    document.body.classList.add('join-mode');
    enterActiveSessionUi();
    startRoomPolling();
  }

  els.btnSessionStart.addEventListener('click', startSession);
  els.btnLeaveSession.addEventListener('click', leaveSession);
  els.btnCopyLink.addEventListener('click', async () => {
    const url = getJoinUrl();
    try {
      if (navigator.share) {
        await navigator.share({ title: 'SingStar Web Karaoke – Session beitreten', url });
      } else {
        await navigator.clipboard.writeText(url);
        els.sessionStatus.textContent = 'Link kopiert!';
        els.sessionStatus.style.color = 'var(--ok)';
      }
    } catch (e) {
      // user cancelled the share sheet or clipboard access was blocked — no-op
    }
  });

  // ---------------------------------------------------------------------
  // Video mixer controls
  // ---------------------------------------------------------------------
  els.videoVolume.addEventListener('input', () => {
    const v = Number(els.videoVolume.value);
    els.videoVolumeVal.textContent = v;
    youtubeAdapter.setVolume(v);
    localAdapter.setVolume(v);
    saveSettings({ videoVolume: v });
  });

  els.videoOffset.addEventListener('input', () => {
    videoOffsetMs = Number(els.videoOffset.value);
    els.videoOffsetVal.textContent = videoOffsetMs;
    saveSettings({ videoOffset: videoOffsetMs });
  });

  // ---------------------------------------------------------------------
  // Web Audio mic mixer
  // ---------------------------------------------------------------------
  let micStream = null;
  let sourceNode = null;
  let splitterNode = null;
  let mergerNode = null;

  const chain = {
    1: { gain: null, delay: null, analyser: null, muteGain: null },
    2: { gain: null, delay: null, analyser: null, muteGain: null },
  };
  let masterGainNode = null;

  let vuAnimHandle = null;

  async function listAudioInputDevices(preselectId) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      els.micDeviceSelect.innerHTML = '';
      inputs.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Mikrofon ${i + 1}`;
        els.micDeviceSelect.appendChild(opt);
      });
      if (preselectId) {
        const match = inputs.find((d) => d.deviceId === preselectId);
        if (match) els.micDeviceSelect.value = preselectId;
      }
    } catch (e) {
      console.warn('Konnte Audiogeräte nicht auflisten:', e);
    }
  }

  async function startMicEngine() {
    try {
      // Request permission first so device labels become available, then
      // rebuild the device list and (re)open the stream on the chosen device.
      const tmpStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmpStream.getTracks().forEach((t) => t.stop());
      await listAudioInputDevices(settings.micDeviceId);

      const deviceId = els.micDeviceSelect.value || undefined;
      const constraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: { ideal: 2 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      };
      micStream = await navigator.mediaDevices.getUserMedia(constraints);

      const ctx = ensureAudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();

      buildAudioGraph();

      els.micStatus.textContent = 'Mikrofone aktiv.';
      els.micStatus.style.color = 'var(--ok)';
      els.audioStatus.textContent = `Audio-Engine: aktiv (${audioCtx.sampleRate} Hz)`;
      saveSettings({ micDeviceId: deviceId || null });

      startVuLoop();
    } catch (err) {
      console.error(err);
      els.micStatus.textContent = 'Fehler beim Zugriff auf das Mikrofon: ' + err.message;
      els.micStatus.style.color = 'var(--danger)';
    }
  }

  function disconnectAudioGraph() {
    [sourceNode, splitterNode, mergerNode, masterGainNode].forEach((n) => {
      if (n) try { n.disconnect(); } catch (e) { /* noop */ }
    });
    [1, 2].forEach((ch) => {
      const c = chain[ch];
      [c.gain, c.delay, c.analyser, c.muteGain].forEach((n) => {
        if (n) try { n.disconnect(); } catch (e) { /* noop */ }
      });
    });
  }

  function buildAudioGraph() {
    disconnectAudioGraph();

    sourceNode = audioCtx.createMediaStreamSource(micStream);
    const trackSettingsList = micStream.getAudioTracks().map((t) => t.getSettings());
    const channelCount = trackSettingsList[0] && trackSettingsList[0].channelCount ? trackSettingsList[0].channelCount : 1;
    const useStereoSplit = els.stereoSplit.checked && channelCount >= 2;

    masterGainNode = audioCtx.createGain();
    masterGainNode.gain.value = Number(els.masterMicGain.value) / 100;
    masterGainNode.connect(audioCtx.destination);

    function buildChannelChain(ch, inputNode) {
      const c = chain[ch];
      c.gain = audioCtx.createGain();
      c.gain.gain.value = Number(els[`mic${ch}Gain`].value) / 100;

      c.delay = audioCtx.createDelay(1.0);
      c.delay.delayTime.value = Number(els[`mic${ch}Delay`].value) / 1000;

      c.muteGain = audioCtx.createGain();
      c.muteGain.gain.value = els[`mic${ch}Mute`].checked ? 0 : 1;

      c.analyser = audioCtx.createAnalyser();
      c.analyser.fftSize = 256;
      c.analyser.smoothingTimeConstant = 0.6;

      inputNode.connect(c.gain);
      c.gain.connect(c.delay);
      c.delay.connect(c.muteGain);
      c.muteGain.connect(c.analyser);
      c.analyser.connect(masterGainNode);
    }

    if (useStereoSplit) {
      splitterNode = audioCtx.createChannelSplitter(2);
      sourceNode.connect(splitterNode);
      buildChannelChain(1, splitterFanout(splitterNode, 0));
      buildChannelChain(2, splitterFanout(splitterNode, 1));
    } else {
      // Mono device, or user disabled splitting: feed the same signal to both
      // channel strips so a single mic can still be gained/delayed independently
      // if desired, but by default only Mic 1 carries the signal.
      buildChannelChain(1, sourceNode);
      chain[2].gain && chain[2].gain.disconnect();
      // Mic 2 chain stays built but muted at 0 input by leaving it unconnected
      // from a source; give it a silent path so analyser doesn't error.
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      sourceNode.connect(silentGain);
      buildChannelChain(2, silentGain);
    }
  }

  // ChannelSplitterNode exposes each channel on its own output index; wrap
  // that in a tiny passthrough so downstream .connect() calls read naturally.
  function splitterFanout(splitter, outputIndex) {
    return {
      connect(dest) {
        splitter.connect(dest, outputIndex);
        return dest;
      },
    };
  }

  els.btnMicStart.addEventListener('click', startMicEngine);

  els.micDeviceSelect.addEventListener('change', () => {
    if (micStream) startMicEngine();
  });

  els.stereoSplit.addEventListener('change', () => {
    if (audioCtx && micStream) buildAudioGraph();
    saveSettings({ stereoSplit: els.stereoSplit.checked });
  });

  function bindMicControl(ch) {
    els[`mic${ch}Gain`].addEventListener('input', () => {
      const v = Number(els[`mic${ch}Gain`].value);
      els[`mic${ch}GainVal`].textContent = v;
      if (chain[ch].gain) chain[ch].gain.gain.value = v / 100;
      saveSettings({ [`mic${ch}Gain`]: v });
    });
    els[`mic${ch}Delay`].addEventListener('input', () => {
      const v = Number(els[`mic${ch}Delay`].value);
      els[`mic${ch}DelayVal`].textContent = v;
      if (chain[ch].delay) chain[ch].delay.delayTime.value = v / 1000;
      saveSettings({ [`mic${ch}Delay`]: v });
    });
    els[`mic${ch}Mute`].addEventListener('change', () => {
      const muted = els[`mic${ch}Mute`].checked;
      if (chain[ch].muteGain) chain[ch].muteGain.gain.value = muted ? 0 : 1;
      saveSettings({ [`mic${ch}Mute`]: muted });
    });
  }
  bindMicControl(1);
  bindMicControl(2);

  els.masterMicGain.addEventListener('input', () => {
    const v = Number(els.masterMicGain.value);
    els.masterMicGainVal.textContent = v;
    if (masterGainNode) masterGainNode.gain.value = v / 100;
    saveSettings({ masterMicGain: v });
  });

  navigator.mediaDevices && navigator.mediaDevices.addEventListener &&
    navigator.mediaDevices.addEventListener('devicechange', () => listAudioInputDevices());

  // ---------------------------------------------------------------------
  // Phone-as-wireless-mic (WebRTC). Signaling is plain HTTP polling through
  // the same room Worker used for the queue — connection setup takes a
  // couple of seconds, but once connected, audio flows directly between the
  // phone and the host over WebRTC, not through the Worker.
  //
  // Host side: polls /mics, answers new offers, and mixes each incoming
  // MediaStream through the same gain -> delay -> mute -> analyser chain
  // used for the local mics, straight into audioCtx.destination.
  // Phone side: grabs its own mic, creates an offer, and polls for the
  // host's answer + ICE candidates.
  // ---------------------------------------------------------------------
  const MIC_SLOTS = ['1', '2', '3', '4'];
  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

  const phoneMics = {}; // slot -> { pc, label, connected, appliedIce, chainNodes, gainVal, delayVal, muted, vuCanvas }
  let micsPollTimer = null;
  let phoneSender = null; // { pc, stream, slot, statusTimer }

  function disconnectPhoneMic(slot, notifyServer) {
    const entry = phoneMics[slot];
    if (!entry) return;
    try { entry.pc.close(); } catch (e) { /* noop */ }
    if (entry.chainNodes) {
      Object.values(entry.chainNodes).forEach((n) => {
        try { n.disconnect(); } catch (e) { /* noop */ }
      });
    }
    if (entry.decoyAudioEl) {
      try {
        entry.decoyAudioEl.pause();
        entry.decoyAudioEl.srcObject = null;
        entry.decoyAudioEl.remove();
      } catch (e) { /* noop */ }
    }
    delete phoneMics[slot];
    renderPhoneMics();
    if (notifyServer && roomCode) {
      fetch(`${ROOM_API_BASE}/api/rooms/${roomCode}/mics/${slot}/leave`, { method: 'POST' }).catch(() => {});
    }
  }

  async function answerPhoneMic(slot, offerSdp, label) {
    const ctx = ensureAudioCtx();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry = {
      // Phone mics sit close to the host's speakers far more often than a
      // handheld USB mic does, so they default to a lower gain — 100% is a
      // much shorter fuse away from feedback than for the local mics.
      pc, label: label || `Mikro ${slot}`, connected: false, appliedIce: new Set(),
      chainNodes: null, gainVal: 70, delayVal: 0, muted: false, vuCanvas: null,
    };
    phoneMics[slot] = entry;
    renderPhoneMics();

    pc.ontrack = (event) => {
      const stream = event.streams[0];

      // Some browsers (notably iOS/mobile) never actually decode a remote
      // WebRTC audio track's frames unless something plays it via a real
      // <audio>/<video> element — createMediaStreamSource() alone can end
      // up reading a track that's technically "live" but delivers silence.
      // Muted so this never produces its own audible/duplicate output;
      // Web Audio below handles the real, controllable output.
      const decoyAudioEl = document.createElement('audio');
      decoyAudioEl.autoplay = true;
      decoyAudioEl.muted = true;
      decoyAudioEl.playsInline = true;
      decoyAudioEl.srcObject = stream;
      decoyAudioEl.style.display = 'none';
      document.body.appendChild(decoyAudioEl);
      decoyAudioEl.play().catch(() => {});
      entry.decoyAudioEl = decoyAudioEl;

      // Ask the browser to keep as little playout buffer as it can get
      // away with — trades a bit of resilience against network jitter for
      // lower end-to-end latency, a reasonable trade on a home/party WiFi.
      // Chrome-only and experimental, so feature-detected.
      event.receiver && 'playoutDelayHint' in event.receiver && (event.receiver.playoutDelayHint = 0);

      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = entry.gainVal / 100;
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = entry.delayVal / 1000;
      const muteGain = ctx.createGain();
      muteGain.gain.value = entry.muted ? 0 : 1;
      // Acts as a limiter against feedback runaway: a phone mic picking up
      // the host's own speakers and feeding that back in is an acoustic
      // loop no software can fully remove, but capping how loud any single
      // pass through it can get keeps a buildup from screaming instead of
      // just eliminating it outright.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -18;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(gain);
      gain.connect(delay);
      delay.connect(muteGain);
      muteGain.connect(limiter);
      limiter.connect(analyser);
      analyser.connect(ctx.destination);
      entry.chainNodes = { source, gain, delay, muteGain, limiter, analyser };
      startVuLoop();
    };

    pc.onconnectionstatechange = () => {
      if (!phoneMics[slot]) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        disconnectPhoneMic(slot, true);
        return;
      }
      entry.connected = pc.connectionState === 'connected';
      renderPhoneMics();
    };

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      fetch(`${ROOM_API_BASE}/api/rooms/${roomCode}/mics/${slot}/ice-from-host`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }),
      }).catch(() => {});
    };

    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await fetch(`${ROOM_API_BASE}/api/rooms/${roomCode}/mics/${slot}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: answer.sdp }),
      });
    } catch (e) {
      console.warn('Handy-Mikro Verbindungsaufbau fehlgeschlagen:', e);
      disconnectPhoneMic(slot, true);
    }
  }

  function applyPhoneIce(slot, candidates) {
    const entry = phoneMics[slot];
    if (!entry) return;
    (candidates || []).forEach((c) => {
      const key = JSON.stringify(c);
      if (!entry.appliedIce.has(key)) {
        entry.appliedIce.add(key);
        entry.pc.addIceCandidate(c).catch(() => {});
      }
    });
  }

  async function pollMics() {
    if (!roomCode) return;
    try {
      const resp = await fetch(`${ROOM_API_BASE}/api/rooms/${roomCode}/mics`);
      if (!resp.ok) return;
      const data = await resp.json();
      const mics = data.mics || {};
      MIC_SLOTS.forEach((slot) => {
        const remote = mics[slot];
        if (!remote) return;
        if (remote.taken && remote.offer && !phoneMics[slot]) {
          answerPhoneMic(slot, remote.offer, remote.label);
        } else if (!remote.taken && phoneMics[slot]) {
          disconnectPhoneMic(slot, false);
        } else if (remote.taken && phoneMics[slot]) {
          applyPhoneIce(slot, remote.iceFromPhone);
        }
      });
    } catch (e) {
      // transient network errors: ignore, next poll retries
    }
  }

  function startMicsHostPolling() {
    stopMicsHostPolling();
    pollMics();
    micsPollTimer = setInterval(pollMics, 2000);
    renderPhoneMics();
  }

  function stopMicsHostPolling() {
    if (micsPollTimer) {
      clearInterval(micsPollTimer);
      micsPollTimer = null;
    }
    MIC_SLOTS.forEach((slot) => disconnectPhoneMic(slot, false));
    renderPhoneMics();
  }

  function renderPhoneMics() {
    if (!els.phoneMicsList) return;
    els.phoneMicsList.innerHTML = '';
    MIC_SLOTS.forEach((slot) => {
      const entry = phoneMics[slot];
      if (!entry) return;

      const col = document.createElement('div');
      col.className = 'mic-col';

      const h3 = document.createElement('h3');
      h3.textContent = entry.label + ' ';
      const tag = document.createElement('span');
      tag.className = 'ch-tag';
      tag.textContent = entry.connected ? 'verbunden' : 'verbindet…';
      h3.appendChild(tag);
      col.appendChild(h3);

      const canvas = document.createElement('canvas');
      canvas.className = 'vu-meter';
      canvas.width = 220;
      canvas.height = 14;
      col.appendChild(canvas);
      entry.vuCanvas = canvas;

      const gainRow = document.createElement('div');
      gainRow.className = 'mixer-row';
      const gainLabel = document.createElement('label');
      gainLabel.textContent = 'Lautstärke';
      const gainInput = document.createElement('input');
      gainInput.type = 'range';
      gainInput.min = '0';
      gainInput.max = '200';
      gainInput.value = String(entry.gainVal);
      const gainVal = document.createElement('span');
      gainVal.className = 'val';
      gainVal.textContent = String(entry.gainVal);
      gainInput.addEventListener('input', () => {
        const v = Number(gainInput.value);
        gainVal.textContent = String(v);
        entry.gainVal = v;
        if (entry.chainNodes) entry.chainNodes.gain.gain.value = v / 100;
      });
      gainRow.append(gainLabel, gainInput, gainVal);
      col.appendChild(gainRow);

      const delayRow = document.createElement('div');
      delayRow.className = 'mixer-row';
      const delayLabel = document.createElement('label');
      delayLabel.textContent = 'Delay (ms)';
      const delayInput = document.createElement('input');
      delayInput.type = 'range';
      delayInput.min = '0';
      delayInput.max = '500';
      delayInput.step = '5';
      delayInput.value = String(entry.delayVal);
      const delayVal = document.createElement('span');
      delayVal.className = 'val';
      delayVal.textContent = String(entry.delayVal);
      delayInput.addEventListener('input', () => {
        const v = Number(delayInput.value);
        delayVal.textContent = String(v);
        entry.delayVal = v;
        if (entry.chainNodes) entry.chainNodes.delay.delayTime.value = v / 1000;
      });
      delayRow.append(delayLabel, delayInput, delayVal);
      col.appendChild(delayRow);

      const muteRow = document.createElement('div');
      muteRow.className = 'mixer-row checkbox-row';
      const muteLabel = document.createElement('label');
      const muteCb = document.createElement('input');
      muteCb.type = 'checkbox';
      muteCb.checked = entry.muted;
      muteCb.addEventListener('change', () => {
        entry.muted = muteCb.checked;
        if (entry.chainNodes) entry.chainNodes.muteGain.gain.value = entry.muted ? 0 : 1;
      });
      muteLabel.appendChild(muteCb);
      muteLabel.append(' Stumm');
      muteRow.appendChild(muteLabel);
      col.appendChild(muteRow);

      const disconnectBtn = document.createElement('button');
      disconnectBtn.type = 'button';
      disconnectBtn.className = 'btn small ghost';
      disconnectBtn.textContent = 'Trennen';
      disconnectBtn.addEventListener('click', () => disconnectPhoneMic(slot, true));
      col.appendChild(disconnectBtn);

      els.phoneMicsList.appendChild(col);
    });
    if (els.phoneMicsHint) {
      els.phoneMicsHint.classList.toggle('hidden', !!roomCode);
    }
  }

  // --- Phone side: use this device's own mic as a wireless sender ---
  async function startUsingPhoneAsMic() {
    if (!roomCode) return;
    els.btnUsePhoneAsMic.disabled = true;
    els.phoneMicStatus.textContent = 'Verbinde…';
    els.phoneMicStatus.style.color = 'var(--text-dim)';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      // Local monitoring only — connected to an analyser so the phone can
      // see its own mic level, never to a destination (would echo back the
      // singer's own voice through the phone's speaker).
      const monitorCtx = ensureAudioCtx();
      const monitorSource = monitorCtx.createMediaStreamSource(stream);
      const monitorAnalyser = monitorCtx.createAnalyser();
      monitorAnalyser.fftSize = 256;
      monitorAnalyser.smoothingTimeConstant = 0.6;
      monitorSource.connect(monitorAnalyser);

      const joinResp = await fetch(`${ROOM_API_BASE}/api/rooms/${roomCode}/mics/join`, { method: 'POST' });
      const joinData = await joinResp.json();
      if (!joinResp.ok) throw new Error(joinData.error || `HTTP ${joinResp.status}`);
      const slot = joinData.slot;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        fetch(`${ROOM_API_BASE}/api/rooms/${roomCode}/mics/${slot}/ice-from-phone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }),
        }).catch(() => {});
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          els.phoneMicStatus.textContent = `✓ Als Mikro verbunden (Platz ${slot})`;
          els.phoneMicStatus.style.color = 'var(--ok)';
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          els.phoneMicStatus.textContent = 'Verbindung verloren.';
          els.phoneMicStatus.style.color = 'var(--danger)';
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await fetch(`${ROOM_API_BASE}/api/rooms/${roomCode}/mics/${slot}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: offer.sdp, label: '' }),
      });

      const appliedIce = new Set();
      const statusTimer = setInterval(async () => {
        if (!phoneSender) { clearInterval(statusTimer); return; }
        try {
          const resp = await fetch(`${ROOM_API_BASE}/api/rooms/${roomCode}/mics/${slot}/status`);
          const data = await resp.json();
          if (!data.taken) {
            stopUsingPhoneAsMic(false);
            return;
          }
          if (data.answer && pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription({ type: 'answer', sdp: data.answer });
          }
          (data.iceFromHost || []).forEach((c) => {
            const key = JSON.stringify(c);
            if (!appliedIce.has(key)) {
              appliedIce.add(key);
              pc.addIceCandidate(c).catch(() => {});
            }
          });
        } catch (e) {
          // transient — retry next tick
        }
      }, 1200);

      phoneSender = { pc, stream, slot, statusTimer, analyser: monitorAnalyser };
      els.btnUsePhoneAsMic.classList.add('hidden');
      els.phoneMicActive.classList.remove('hidden');
      startVuLoop();
    } catch (err) {
      els.phoneMicStatus.textContent = 'Fehler: ' + err.message;
      els.phoneMicStatus.style.color = 'var(--danger)';
      els.btnUsePhoneAsMic.disabled = false;
    }
  }

  function stopUsingPhoneAsMic(notifyServer) {
    if (!phoneSender) return;
    const { pc, stream, slot, statusTimer } = phoneSender;
    clearInterval(statusTimer);
    try { pc.close(); } catch (e) { /* noop */ }
    stream.getTracks().forEach((t) => t.stop());
    if (notifyServer !== false && roomCode) {
      fetch(`${ROOM_API_BASE}/api/rooms/${roomCode}/mics/${slot}/leave`, { method: 'POST' }).catch(() => {});
    }
    phoneSender = null;
    els.btnUsePhoneAsMic.classList.remove('hidden');
    els.btnUsePhoneAsMic.disabled = false;
    els.phoneMicActive.classList.add('hidden');
    els.phoneMicStatus.textContent = '';
  }

  els.btnUsePhoneAsMic.addEventListener('click', startUsingPhoneAsMic);
  els.btnStopPhoneAsMic.addEventListener('click', () => stopUsingPhoneAsMic(true));

  // ---------------------------------------------------------------------
  // VU meters
  // ---------------------------------------------------------------------
  function getAudioLevel(analyser) {
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return Math.min(1, (sum / data.length) / 130);
  }

  function drawVu(canvas, analyser) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!analyser) return 0;
    const level = getAudioLevel(analyser);

    const barWidth = w * level;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#35e08a');
    grad.addColorStop(0.7, '#ffd23f');
    grad.addColorStop(1, '#ff5c5c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, barWidth, h);
    return level;
  }

  function startVuLoop() {
    if (vuAnimHandle) return; // already running — one shared loop draws whatever exists
    const loop = () => {
      drawVu(els.vu1, chain[1].analyser);
      drawVu(els.vu2, chain[2].analyser);
      MIC_SLOTS.forEach((slot) => {
        const entry = phoneMics[slot];
        if (entry && entry.vuCanvas && entry.chainNodes) drawVu(entry.vuCanvas, entry.chainNodes.analyser);
      });
      if (phoneSender && phoneSender.analyser && els.phoneMicVu) {
        const level = drawVu(els.phoneMicVu, phoneSender.analyser);
        if (els.phoneMicIcon) els.phoneMicIcon.style.setProperty('--level', level.toFixed(2));
      }
      vuAnimHandle = requestAnimationFrame(loop);
    };
    loop();
  }

  // ---------------------------------------------------------------------
  // Help + settings modals, stage mode
  // ---------------------------------------------------------------------
  els.btnHelp.addEventListener('click', () => els.helpModal.classList.remove('hidden'));
  els.btnHelpClose.addEventListener('click', () => els.helpModal.classList.add('hidden'));
  els.helpModal.addEventListener('click', (e) => {
    if (e.target === els.helpModal) els.helpModal.classList.add('hidden');
  });

  function openSettings() {
    els.settingsModal.classList.remove('hidden');
  }
  els.btnSettings.addEventListener('click', openSettings);
  els.btnSettingsClose.addEventListener('click', () => els.settingsModal.classList.add('hidden'));
  els.settingsModal.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) els.settingsModal.classList.add('hidden');
  });
  els.btnOpenApiKeySettings.addEventListener('click', openSettings);

  // "Bühnenmodus" always (re-)enters fullscreen — pressing ESC only exits
  // native fullscreen, it doesn't touch the stage-mode layout, so clicking
  // the button again just re-requests fullscreen instead of leaving stage
  // mode. "Menü" (only visible while in stage mode) is the explicit way
  // back to the normal view.
  els.btnStage.addEventListener('click', () => {
    document.body.classList.add('stage-mode');
    const wrap = document.querySelector('.video-wrap');
    if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => {});
  });

  els.btnMenu.addEventListener('click', () => {
    document.body.classList.remove('stage-mode');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  });

  // ---------------------------------------------------------------------
  // Restore persisted settings into the UI on load
  // ---------------------------------------------------------------------
  function restoreUi() {
    if (settings.videoVolume !== undefined) {
      els.videoVolume.value = settings.videoVolume;
      els.videoVolumeVal.textContent = settings.videoVolume;
    }
    if (settings.videoOffset !== undefined) {
      els.videoOffset.value = settings.videoOffset;
      els.videoOffsetVal.textContent = settings.videoOffset;
      videoOffsetMs = Number(settings.videoOffset);
    }
    if (settings.mic1Gain !== undefined) { els.mic1Gain.value = settings.mic1Gain; els.mic1GainVal.textContent = settings.mic1Gain; }
    if (settings.mic2Gain !== undefined) { els.mic2Gain.value = settings.mic2Gain; els.mic2GainVal.textContent = settings.mic2Gain; }
    if (settings.mic1Delay !== undefined) { els.mic1Delay.value = settings.mic1Delay; els.mic1DelayVal.textContent = settings.mic1Delay; }
    if (settings.mic2Delay !== undefined) { els.mic2Delay.value = settings.mic2Delay; els.mic2DelayVal.textContent = settings.mic2Delay; }
    if (settings.masterMicGain !== undefined) { els.masterMicGain.value = settings.masterMicGain; els.masterMicGainVal.textContent = settings.masterMicGain; }
    if (settings.mic1Mute !== undefined) els.mic1Mute.checked = settings.mic1Mute;
    if (settings.mic2Mute !== undefined) els.mic2Mute.checked = settings.mic2Mute;
    if (settings.stereoSplit !== undefined) els.stereoSplit.checked = settings.stereoSplit;
    if (settings.clearPlayedFromQueue !== undefined) els.clearPlayedFromQueue.checked = settings.clearPlayedFromQueue;
  }

  els.clearPlayedFromQueue.addEventListener('change', () => {
    saveSettings({ clearPlayedFromQueue: els.clearPlayedFromQueue.checked });
  });

  function exportQueue() {
    const exportable = queue.filter((it) => it.source !== 'local')
      .map((it) => ({ videoId: it.videoId, title: it.title }));
    const localCount = queue.length - exportable.length;
    if (exportable.length === 0) {
      showToast('Warteliste ist leer (lokale Dateien lassen sich nicht exportieren).', 'error');
      return;
    }
    const blob = new Blob([JSON.stringify({ items: exportable }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `singstar-warteliste-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`✓ ${exportable.length} Song(s) exportiert${localCount > 0 ? ` (${localCount} lokale Datei(en) ausgelassen)` : ''}`);
  }

  async function importQueueFromFile(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : null;
      if (!items) throw new Error('Unbekanntes Dateiformat');
      let count = 0;
      for (const it of items) {
        const videoId = it && typeof it.videoId === 'string' ? it.videoId : (typeof it === 'string' ? extractVideoId(it) : null);
        if (!videoId) continue;
        await addToQueue(videoId, (it && it.title) || videoId);
        count++;
      }
      if (count === 0) throw new Error('Keine gültigen Einträge gefunden');
      showToast(`✓ ${count} Song(s) importiert`);
    } catch (err) {
      showToast('Import fehlgeschlagen: ' + err.message, 'error');
    }
  }

  els.btnQueueExport.addEventListener('click', exportQueue);
  els.queueImportInput.addEventListener('change', () => {
    const file = els.queueImportInput.files[0];
    els.queueImportInput.value = '';
    if (file) importQueueFromFile(file);
  });

  restoreUi();

  const urlJoinCode = getJoinCodeFromUrl();

  // Restore a locally-saved queue (skipped once a room becomes active —
  // its Durable Object takes over as the source of truth).
  if (!urlJoinCode && !settings.roomCode && Array.isArray(settings.localQueue)) {
    settings.localQueue.forEach((it) => {
      if (it && typeof it.videoId === 'string') {
        queue.push({ id: makeLocalId(), source: 'youtube', videoId: it.videoId, title: it.title || it.videoId, addedBy: it.addedBy || '' });
      }
    });
  }

  renderQueue();
  listAudioInputDevices();
  updatePlaceholder();
  updateTransportButtons();

  if (urlJoinCode) {
    joinRoomFromUrl(urlJoinCode);
  } else if (settings.roomCode) {
    roomCode = settings.roomCode;
    enterActiveSessionUi();
    startRoomPolling();
    startMicsHostPolling();
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    els.micStatus.textContent = 'Dieser Browser unterstützt keinen Mikrofonzugriff (getUserMedia fehlt).';
    els.micStatus.style.color = 'var(--danger)';
    els.btnMicStart.disabled = true;
  }

  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    els.micStatus.textContent = 'Hinweis: Mikrofonzugriff benötigt HTTPS oder localhost.';
  }
})();
