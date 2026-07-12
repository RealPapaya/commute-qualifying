const STORAGE_KEY = 'commute-qualifying-language';

const messages = {
  en: {
    documentTitle: 'Commute Qualifying', language: 'Language', chinese: '中文', english: 'English',
    navRoutes: 'Routes', navEditor: 'Editor', navRun: 'Run', navHistory: 'History',
    homeKicker: 'CITY IN MOTION / 01', homeTitle: 'Turn every commute into a qualifying lap.',
    homeCopy: 'Your streets. Your sectors. A faster line through the everyday.',
    myRoutes: 'My Routes', newRoute: '+ New Route', planAhead: 'Plan ahead',
    planAheadDesc: 'Trace on the map or build from places', gpsRecord: 'GPS record',
    gpsRecordDesc: 'Drive the route and mark it live', routesEmpty: 'No routes yet. Create one, then trace your commute on the map.',
    routeName: 'Route name', trace: '✏️ Trace', traceTitle: 'Click map to add waypoints',
    lights: '🚦 Lights', lightsTitle: 'Click route to mark a traffic light', sectors: '⏱ Sectors',
    sectorsTitle: 'Drag sector boundaries along the route', snapToRoads: 'Snap to roads',
    closedLoop: 'Closed loop (continuous laps)', gpsRecording: 'GPS route recording',
    gpsRecordingCopy: 'Record the route from your current GPS position. Add markers while recording, then stop and save.',
    startGps: 'Start GPS recording', stopGps: 'Stop recording', checkpoint: '+ Checkpoint',
    light: '+ Light', readyRecord: 'Ready to record.', start: 'Start', end: 'End',
    placePlaceholder: 'Enter a street, address, or landmark', addVia: '+ Via point',
    buildRoute: 'Build route from places', undo: '↩ Undo point', clearTrace: 'Clear trace',
    clearLights: 'Clear lights', addSector: '+ Sector', removeSector: '− Sector',
    trackDiagram: '🏁 Track diagram', trackDiagramTitle: 'Show F1-style circuit diagram',
    save: 'Save', backEditor: 'Back to editor', trackDiagramMode: 'Track diagram mode',
    trackDiagramFilters: 'Track diagram filters', sectorColors: 'Sector colors',
    sectorCheckpoints: 'Sector checkpoints', trafficLights: 'Traffic lights',
    followControls: 'Follow location controls', zoomOut: 'Zoom out', follow: '⌖ Follow',
    followTitle: 'Zoom in and follow location', zoomIn: 'Zoom in', backRun: 'Back to Run',
    runTrackFilters: 'Run track diagram filters', runStatus: 'Press ARM, then drive. Timing starts when you cross the start line.',
    offRoute: 'YELLOW FLAG — off route', offRouteCopy: 'You have left the trace. Replan the route, or wait for GPS to return to the track.',
    replan: 'Replan route', waitTrack: 'Wait for track', mapMode: 'Map mode', streetMap: 'Street map',
    cursor: 'Cursor', cursorDot: 'Dot', cursorCar: 'Car 3D', cursorRacecar: 'Race car 3D',
    cursorMotorcycle: 'Motorcycle 3D', armGps: 'ARM GPS', abort: 'Abort', simulate: '▶ Simulate run',
    history: 'Run History & Personal Bests', historyEmpty: 'No completed runs yet.', closeSummary: 'Close summary',
    sectorCount: 'sectors', lightCount: 'lights', run: 'Run', edit: 'Edit', delete: 'Delete',
    deleteRouteConfirm: 'Delete this route and all its runs?', deletedRoute: '(deleted route)',
    summary: 'Summary', simulated: '(sim)', lap: 'Lap',
  },
  zh: {
    documentTitle: '通勤排位賽', language: '語言', chinese: '中文', english: 'English',
    navRoutes: '路線', navEditor: '編輯', navRun: '計時', navHistory: '紀錄',
    homeKicker: '城市動態 / 01', homeTitle: '把每趟通勤，變成你的排位賽。',
    homeCopy: '你的街道、你的分段，在日常之中跑出更快路線。',
    myRoutes: '我的路線', newRoute: '+ 新增路線', planAhead: '事先規劃',
    planAheadDesc: '在地圖上繪製，或以地點建立路線', gpsRecord: 'GPS 記錄',
    gpsRecordDesc: '實際行駛路線並即時標記', routesEmpty: '還沒有路線。先建立一條路線，再繪製你的通勤路徑。',
    routeName: '路線名稱', trace: '✏️ 繪製', traceTitle: '點擊地圖新增途經點',
    lights: '🚦 紅綠燈', lightsTitle: '點擊路線標記紅綠燈', sectors: '⏱ 賽段',
    sectorsTitle: '沿著路線拖曳黃色控制點調整賽段', snapToRoads: '貼合道路',
    closedLoop: '閉環賽道（可連續多圈）', gpsRecording: 'GPS 路線記錄',
    gpsRecordingCopy: '從目前 GPS 位置開始記錄路線。記錄期間可新增標記，完成後停止並儲存。',
    startGps: '開始 GPS 記錄', stopGps: '停止記錄', checkpoint: '+ 檢查點',
    light: '+ 紅綠燈', readyRecord: '準備開始記錄。', start: '起點', end: '終點',
    placePlaceholder: '輸入路名、地址或地標', addVia: '+ 必經點',
    buildRoute: '依地點規劃路線', undo: '↩ 復原途經點', clearTrace: '清除路線',
    clearLights: '清除紅綠燈', addSector: '+ 賽段', removeSector: '− 賽段',
    trackDiagram: '🏁 賽道圖', trackDiagramTitle: '顯示 F1 風格賽道圖',
    save: '儲存', backEditor: '返回編輯', trackDiagramMode: '賽道圖模式',
    trackDiagramFilters: '賽道圖篩選', sectorColors: '賽段顏色',
    sectorCheckpoints: '賽段檢查點', trafficLights: '紅綠燈',
    followControls: '跟隨位置控制', zoomOut: '縮小', follow: '⌖ 跟隨',
    followTitle: '放大並跟隨位置', zoomIn: '放大', backRun: '返回計時',
    runTrackFilters: '計時賽道圖篩選', runStatus: '按下 ARM 後開始行駛。越過起跑線時開始計時。',
    offRoute: '黃旗警示 — 已偏離路線', offRouteCopy: '你已經脫離路線。可以重新規劃，或等待 GPS 回到路線後繼續。',
    replan: '重新規劃路線', waitTrack: '等待回到路線', mapMode: '地圖模式', streetMap: '街道地圖',
    cursor: '游標', cursorDot: '圓點', cursorCar: '汽車 3D', cursorRacecar: '跑車 3D',
    cursorMotorcycle: '機車 3D', armGps: '啟動 GPS', abort: '中止', simulate: '▶ 模擬行駛',
    history: '行駛紀錄與個人最佳成績', historyEmpty: '還沒有完成的行駛紀錄。', closeSummary: '關閉摘要',
    sectorCount: '賽段', lightCount: '紅綠燈', run: '計時', edit: '編輯', delete: '刪除',
    deleteRouteConfirm: '要刪除這條路線與所有行駛紀錄嗎？', deletedRoute: '（已刪除的路線）',
    summary: '摘要', simulated: '（模擬）', lap: '單圈',
  },
};

function normalize(language) {
  return language === 'zh' || language === 'en' ? language : 'en';
}

function savedLanguage() {
  try {
    return normalize(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return 'en';
  }
}

export function getLanguage() {
  return savedLanguage();
}

export function translate(key, language = getLanguage()) {
  return messages[normalize(language)][key] ?? key;
}

export function applyLanguage(language = getLanguage(), documentRef = globalThis.document) {
  if (!documentRef) return normalize(language);
  const next = normalize(language);
  documentRef.documentElement.lang = next === 'zh' ? 'zh-Hant' : 'en';
  documentRef.title = translate('documentTitle', next);
  documentRef.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = translate(element.dataset.i18n, next);
  });
  for (const attribute of ['aria-label', 'title', 'placeholder']) {
    documentRef.querySelectorAll(`[data-i18n-${attribute}]`).forEach(element => {
      element.setAttribute(attribute, translate(element.dataset[`i18n${attribute.replace(/-(.)/g, (_, letter) => letter.toUpperCase())}`], next));
    });
  }
  const select = documentRef.getElementById('language-select');
  if (select) select.value = next;
  return next;
}

export function setLanguage(language, documentRef = globalThis.document) {
  const next = normalize(language);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Language selection remains available for this page even if storage is blocked.
  }
  const applied = applyLanguage(next, documentRef);
  const Event = documentRef?.defaultView?.CustomEvent;
  if (Event) documentRef.dispatchEvent(new Event('languagechange', { detail: { language: next } }));
  return applied;
}

export function initLanguage(documentRef = globalThis.document) {
  const initial = applyLanguage(getLanguage(), documentRef);
  documentRef?.getElementById('language-select')?.addEventListener('change', event => {
    setLanguage(event.target.value, documentRef);
  });
  return initial;
}

if (typeof document !== 'undefined') initLanguage();
