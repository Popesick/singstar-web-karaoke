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

    videoUrl: document.getElementById('videoUrl'),
    btnLoad: document.getElementById('btnLoad'),
    btnPlayPause: document.getElementById('btnPlayPause'),
    btnRestart: document.getElementById('btnRestart'),
    videoPlaceholder: document.getElementById('videoPlaceholder'),

    searchQuery: document.getElementById('searchQuery'),
    btnSearch: document.getElementById('btnSearch'),
    apiKeyRow: document.getElementById('apiKeyRow'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    btnSaveApiKey: document.getElementById('btnSaveApiKey'),
    btnApiKeyHelp: document.getElementById('btnApiKeyHelp'),
    btnApiKeyChange: document.getElementById('btnApiKeyChange'),
    searchStatus: document.getElementById('searchStatus'),
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

    queueSection: document.getElementById('queueSection'),
    queueUrl: document.getElementById('queueUrl'),
    btnQueueAdd: document.getElementById('btnQueueAdd'),
    btnQueueNext: document.getElementById('btnQueueNext'),
    queueList: document.getElementById('queueList'),

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
  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
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
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

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
      },
    });
  };

  function onPlayerReady() {
    playerReady = true;
    els.ytStatus.textContent = 'YouTube-Player: bereit';
    player.setVolume(Number(els.videoVolume.value));
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

  els.localFileInput.addEventListener('change', () => {
    const file = els.localFileInput.files[0];
    if (!file) return;
    if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
    localObjectUrl = URL.createObjectURL(file);
    els.localVideo.src = localObjectUrl;
    els.localFileName.textContent = file.name;
    ensureLocalAudioGraph();
    updatePlaceholder();
    updateTransportButtons();
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
    syncTimer = setInterval(() => {
      const adapter = getActiveAdapter();
      if (adapter.getState() !== 'playing') return;
      const elapsedSec = (Date.now() - syncBaseWallClock) / 1000;
      const targetSec = syncBaseVideoTime + elapsedSec + videoOffsetMs / 1000;
      const actualSec = adapter.getCurrentTime();
      const drift = targetSec - actualSec;
      // Only correct on drift beyond ~120ms to avoid stutter from constant seeking.
      if (Math.abs(drift) > 0.12) {
        adapter.seekTo(targetSec);
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
    els.queueSection.classList.toggle('hidden', mode !== 'youtube');

    els.btnPlayPause.textContent = '▶ Play';
    updatePlaceholder();
    updateTransportButtons();
  }

  els.tabYoutube.addEventListener('click', () => setMode('youtube'));
  els.tabLocal.addEventListener('click', () => setMode('local'));

  function loadVideo(idOrUrl, opts) {
    const options = opts || {};
    const attempt = options.attempt || 0;
    const id = extractVideoId(idOrUrl);
    if (!id) {
      alert('Konnte keine gültige YouTube-Video-ID aus der Eingabe lesen.');
      return false;
    }
    if (!playerReady) {
      // The YT IFrame API can take a moment after page load to finish
      // initializing (it fetches extra resources from youtube.com). Retry
      // quietly for a few seconds before bothering the user with an alert.
      if (attempt < 16) {
        setTimeout(() => loadVideo(idOrUrl, { attempt: attempt + 1, onLoaded: options.onLoaded }), 200);
      } else {
        alert(
          'YouTube-Player konnte nicht geladen werden.\n\n' +
          'Das liegt fast immer an einem Ad-/Tracking-Blocker im Browser (z.B. uBlock Origin), der das ' +
          'eingebettete YouTube-Player-Script blockiert – auch wenn youtube.com selbst normal funktioniert, ' +
          'da Embed-Player oft separat gefiltert werden.\n\n' +
          'Lösung: Den Blocker für diese Seite deaktivieren bzw. auf die Whitelist setzen, dann die Seite ' +
          'neu laden.'
        );
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
      } else {
        els.searchStatus.textContent = `${totalShown} einbettbare(s) Video(s) gefunden.`;
        els.searchStatus.style.color = 'var(--ok)';
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

  updateApiKeyUi();

  // ---------------------------------------------------------------------
  // Queue — items are {id, videoId, title, addedBy}. When a shared session
  // is active, the room's Durable Object is the source of truth and every
  // mutation round-trips through it; otherwise the queue is purely local.
  // ---------------------------------------------------------------------
  const queue = [];

  function makeLocalId() {
    return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function renderQueue() {
    els.queueList.innerHTML = '';
    queue.forEach((item, idx) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${idx + 1}. ${item.title || item.videoId}`;
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
  }

  function playNextInQueue() {
    if (queue.length === 0) return;
    const next = queue.shift();
    renderQueue();
    loadVideo(next.videoId, {
      onLoaded: () => setTimeout(() => player && player.playVideo && player.playVideo(), 200),
    });
    if (roomCode) removeQueueItemFromRoom(next.id);
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
      queue.push({ id: makeLocalId(), videoId, title, addedBy: '' });
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

      const localSnapshot = queue.map((it) => ({ ...it }));
      roomCode = data.code;
      saveSettings({ roomCode });
      enterActiveSessionUi();
      startRoomPolling();

      if (hasApiKey()) await pushApiKeyToRoom(settings.youtubeApiKey);
      for (const item of localSnapshot) {
        await pushQueueItemToRoom(item);
      }

      els.sessionStatus.textContent = 'Session aktiv.';
      els.sessionStatus.style.color = 'var(--ok)';
    } catch (err) {
      els.sessionStatus.textContent = 'Fehler beim Erstellen der Session: ' + err.message;
      els.sessionStatus.style.color = 'var(--danger)';
    } finally {
      els.btnSessionStart.disabled = false;
    }
  }

  function leaveSession() {
    stopRoomPolling();
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
  // VU meters
  // ---------------------------------------------------------------------
  function drawVu(canvas, analyser) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const level = Math.min(1, (sum / data.length) / 130);

    const barWidth = w * level;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#35e08a');
    grad.addColorStop(0.7, '#ffd23f');
    grad.addColorStop(1, '#ff5c5c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, barWidth, h);
  }

  function startVuLoop() {
    if (vuAnimHandle) cancelAnimationFrame(vuAnimHandle);
    const loop = () => {
      drawVu(els.vu1, chain[1].analyser);
      drawVu(els.vu2, chain[2].analyser);
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
  }

  restoreUi();
  renderQueue();
  listAudioInputDevices();
  updatePlaceholder();
  updateTransportButtons();

  const urlJoinCode = getJoinCodeFromUrl();
  if (urlJoinCode) {
    joinRoomFromUrl(urlJoinCode);
  } else if (settings.roomCode) {
    roomCode = settings.roomCode;
    enterActiveSessionUi();
    startRoomPolling();
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
