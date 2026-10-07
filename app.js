/**
 * ======================================================================================
 * AERO-SAT ONE - MISSION CONTROL GROUND STATION JAVASCRIPT
 * Real-time REST Telemetry Stream, 3D Canvas HUD, Leaflet GPS Tracker & Web Audio SFX
 * ======================================================================================
 */

(function () {
  'use strict';

  // --- DEFAULT CONFIGURATION ---
  const DEFAULT_CONFIG = {
    endpoint: 'http://192.168.4.1/telemetry',
    pollIntervalMs: 200,
    audioVolume: 0.7,
    audioEnabled: true,
    tempUnit: 'C', // 'C' or 'F'
    maxHistoryLength: 500,
    chartPoints: 30
  };

  // State
  let config = Object.assign({}, DEFAULT_CONFIG);
  let mode = 'LIVE'; // 'LIVE' or 'SIM'
  let isPolling = false;
  let pollTimer = null;
  let failedConsecutiveAttempts = 0;
  let packetCounter = 0;
  let missionStartTime = Date.now();
  let chartPaused = false;
  let currentFilter = 'ALL';

  // Telemetry buffer for CSV/JSON export
  const telemetryHistory = [];

  // Current Telemetry Snapshot (matches ESP32 JSON schema)
  let currentTelemetry = {
    temp: 25.0,
    rain: 0,
    rainRaw: 3800,
    ldr: 500,
    ldrRaw: 2000,
    voltage: 4.10,
    battery: 90,
    tilt: 0,
    tiltStatus: 'LEVEL',
    heading: 142,
    pitch: 0.0,
    roll: 0.0,
    rssi: -58,
    gps: {
      lat: 12.971598,
      lon: 77.594562,
      alt: 920.0,
      speed: 0.0,
      sats: 0
    }
  };

  // Peak tracking
  let peakTempC = 25.0;

  // Smoothing for Canvas Attitude Indicator
  let smoothPitch = 0.0;
  let smoothRoll = 0.0;
  let smoothHeading = 142;

  // Web Audio Context
  let audioCtx = null;

  // Leaflet Map & GPS Trail
  let leafletMap = null;
  let satMarker = null;
  let satTrailPolyline = null;
  const trailCoordinates = [];

  // Chart.js instance
  let telemetryChart = null;

  // ==========================================================================
  // DOM ELEMENT REFERENCES
  // ==========================================================================
  const el = {
    // Header & Badges
    linkBadge: document.getElementById('link-status-badge'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    btnModeLive: document.getElementById('btn-mode-live'),
    btnModeSim: document.getElementById('btn-mode-sim'),
    metClock: document.getElementById('met-clock'),
    btnAudioToggle: document.getElementById('btn-audio-toggle'),
    iconSoundOn: document.getElementById('icon-sound-on'),
    iconSoundOff: document.getElementById('icon-sound-off'),
    btnOpenSettings: document.getElementById('btn-open-settings'),

    // Quick Link Bar
    dispEndpoint: document.getElementById('disp-endpoint'),
    dispPollRate: document.getElementById('disp-poll-rate'),
    dispPacketCount: document.getElementById('disp-packet-count'),
    dispLatency: document.getElementById('disp-latency'),
    dispRssi: document.getElementById('disp-rssi'),

    // Sensor Cards
    valTemp: document.getElementById('val-temp'),
    gaugeTemp: document.getElementById('gauge-temp'),
    tempBadge: document.getElementById('temp-condition-badge'),
    btnTempUnit: document.getElementById('btn-temp-unit'),
    subTempPeak: document.getElementById('sub-temp-peak'),

    valVoltage: document.getElementById('val-voltage'),
    valBatteryPct: document.getElementById('val-battery-pct'),
    gaugeBattery: document.getElementById('gauge-battery'),
    batteryBadge: document.getElementById('battery-status-badge'),
    subVoltageState: document.getElementById('sub-voltage-state'),

    tiltBadge: document.getElementById('tilt-badge'),
    tiltIndicatorDisc: document.getElementById('tilt-indicator-disc'),
    tiltBall: document.getElementById('tilt-ball'),
    valTiltStatus: document.getElementById('val-tilt-status'),
    valTiltPitch: document.getElementById('val-tilt-pitch'),
    valTiltRoll: document.getElementById('val-tilt-roll'),

    valRain: document.getElementById('val-rain'),
    valRainRaw: document.getElementById('val-rain-raw'),
    gaugeRain: document.getElementById('gauge-rain'),
    rainBadge: document.getElementById('rain-condition-badge'),
    subRainStatus: document.getElementById('sub-rain-status'),

    valLdr: document.getElementById('val-ldr'),
    valLdrRaw: document.getElementById('val-ldr-raw'),
    gaugeLdr: document.getElementById('gauge-ldr'),
    ldrBadge: document.getElementById('ldr-condition-badge'),
    subLdrSolar: document.getElementById('sub-ldr-solar'),

    // HUD & Canvas
    horizonCanvas: document.getElementById('horizon-canvas'),
    hudValHeading: document.getElementById('hud-val-heading'),
    hudValPitch: document.getElementById('hud-val-pitch'),
    hudValRoll: document.getElementById('hud-val-roll'),
    hudCompassTape: document.getElementById('hud-compass-tape'),
    hudTiltAlertBox: document.getElementById('hud-tilt-alert-box'),
    hudAttitudeStatus: document.getElementById('hud-attitude-status'),

    // GPS Map & HUD
    btnRecenterMap: document.getElementById('btn-recenter-map'),
    btnClearTrail: document.getElementById('btn-clear-trail'),
    gpsValLat: document.getElementById('gps-val-lat'),
    gpsValLon: document.getElementById('gps-val-lon'),
    gpsValAlt: document.getElementById('gps-val-alt'),
    gpsValSpd: document.getElementById('gps-val-spd'),
    gpsValSats: document.getElementById('gps-val-sats'),
    gpsFixIndicator: document.getElementById('gps-fix-indicator'),

    // Charts
    chkChartTemp: document.getElementById('chk-chart-temp'),
    chkChartVolt: document.getElementById('chk-chart-volt'),
    chkChartRain: document.getElementById('chk-chart-rain'),
    chkChartLdr: document.getElementById('chk-chart-ldr'),
    btnChartPause: document.getElementById('btn-chart-pause'),

    // Terminal
    consoleStream: document.getElementById('console-stream'),
    logEntryCount: document.getElementById('log-entry-count'),
    btnClearConsole: document.getElementById('btn-clear-console'),
    btnExportCsv: document.getElementById('btn-export-csv'),
    btnExportJson: document.getElementById('btn-export-json'),
    filterBtns: document.querySelectorAll('.filter-btn'),

    // Settings Modal
    settingsModal: document.getElementById('settings-modal'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    inputEndpointUrl: document.getElementById('input-endpoint-url'),
    btnTestPing: document.getElementById('btn-test-ping'),
    inputPollInterval: document.getElementById('input-poll-interval'),
    dispSliderInterval: document.getElementById('disp-slider-interval'),
    inputAudioVolume: document.getElementById('input-audio-volume'),
    dispSliderVolume: document.getElementById('disp-slider-volume'),
    btnSimTriggerTilt: document.getElementById('btn-sim-trigger-tilt'),
    btnSimTriggerRain: document.getElementById('btn-sim-trigger-rain'),
    btnSimTriggerSun: document.getElementById('btn-sim-trigger-sun'),
    btnSimTriggerReset: document.getElementById('btn-sim-trigger-reset'),
    btnResetDefaults: document.getElementById('btn-reset-defaults'),
    btnSaveSettings: document.getElementById('btn-save-settings')
  };

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  function init() {
    loadSavedSettings();
    initWebAudio();
    initLeafletMap();
    initTelemetryChart();
    initHorizonRenderer();
    setupEventListeners();
    startMissionClock();

    logConsole('SYSTEM', 'AERO-SAT ONE Mission Control ready. Connecting to ESP32 telemetry...', 'info');

    // Start Telemetry Downlink Engine
    startPolling();
  }

  // ==========================================================================
  // SETTINGS & STORAGE
  // ==========================================================================
  function loadSavedSettings() {
    try {
      const saved = localStorage.getItem('aero_sat_config');
      if (saved) {
        config = Object.assign({}, DEFAULT_CONFIG, JSON.parse(saved));
      }
    } catch (e) {
      console.warn('Could not read config from localStorage', e);
    }

    if (el.inputEndpointUrl) el.inputEndpointUrl.value = config.endpoint;
    if (el.dispEndpoint) el.dispEndpoint.textContent = config.endpoint;
    if (el.inputPollInterval) el.inputPollInterval.value = config.pollIntervalMs;
    if (el.inputAudioVolume) el.inputAudioVolume.value = Math.round(config.audioVolume * 100);
    updatePollRateDisplay();
  }

  function saveSettings() {
    config.endpoint = el.inputEndpointUrl.value.trim() || DEFAULT_CONFIG.endpoint;
    config.pollIntervalMs = parseInt(el.inputPollInterval.value, 10) || 200;
    config.audioVolume = parseInt(el.inputAudioVolume.value, 10) / 100;

    try {
      localStorage.setItem('aero_sat_config', JSON.stringify(config));
    } catch (e) {
      console.warn('Could not save config to localStorage', e);
    }

    if (el.dispEndpoint) el.dispEndpoint.textContent = config.endpoint;
    updatePollRateDisplay();

    // Restart Polling with new rate & endpoint
    startPolling();
    logConsole('CONFIG', `Settings applied: URL=${config.endpoint}, Rate=${config.pollIntervalMs}ms`, 'info');
  }

  function updatePollRateDisplay() {
    const hz = (1000 / config.pollIntervalMs).toFixed(1);
    if (el.dispPollRate) {
      el.dispPollRate.textContent = `${hz} Hz (${config.pollIntervalMs}ms)`;
    }
    if (el.dispSliderInterval) {
      el.dispSliderInterval.textContent = `${config.pollIntervalMs} ms (${hz} Hz)`;
    }
    if (el.dispSliderVolume) {
      el.dispSliderVolume.textContent = `${Math.round(config.audioVolume * 100)}%`;
    }
  }

  // ==========================================================================
  // WEB AUDIO SYNTHESIZER (ZERO EXTERNAL ASSETS NEEDED)
  // ==========================================================================
  function initWebAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    // Audio context will unlock on first user gesture
    const unlockAudio = () => {
      if (!audioCtx) {
        audioCtx = new AudioContextClass();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };

    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
  }

  let lastChirpTime = 0;
  function playTelemetryChirp() {
    if (!config.audioEnabled || !audioCtx || audioCtx.state !== 'running') return;
    const now = Date.now();
    if (now - lastChirpTime < 400) return; // limit chirp frequency to avoid cacophony
    lastChirpTime = now;

    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.04 * config.audioVolume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.05);
    } catch (e) {
      // Audio playback suppressed
    }
  }

  function playAlertAlarm() {
    if (!config.audioEnabled || !audioCtx || audioCtx.state !== 'running') return;

    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.setValueAtTime(660, audioCtx.currentTime + 0.1);
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.2);

      gain.gain.setValueAtTime(0.08 * config.audioVolume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.36);
    } catch (e) {}
  }

  function playUiClick() {
    if (!config.audioEnabled || !audioCtx || audioCtx.state !== 'running') return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(400, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.05 * config.audioVolume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.02);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.025);
    } catch (e) {}
  }

  // ==========================================================================
  // MISSION ELAPSED TIME (MET) CLOCK
  // ==========================================================================
  function startMissionClock() {
    setInterval(() => {
      const elapsed = Math.floor((Date.now() - missionStartTime) / 1000);
      const hours = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const mins = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      if (el.metClock) {
        el.metClock.textContent = `${hours}:${mins}:${secs}`;
      }
    }, 1000);
  }

  // ==========================================================================
  // TELEMETRY ENGINE & DOWNLINK POLLING
  // ==========================================================================
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    isPolling = true;

    const tick = async () => {
      if (mode === 'LIVE') {
        await fetchHardwareTelemetry();
      } else {
        generateSimulatedTelemetry();
      }
    };

    // First immediate tick
    tick();
    pollTimer = setInterval(tick, config.pollIntervalMs);
  }

  async function fetchHardwareTelemetry() {
    const startTime = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);

    try {
      const response = await fetch(config.endpoint, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const roundTripMs = Math.round(performance.now() - startTime);

      failedConsecutiveAttempts = 0;
      updateConnectionStatus('LINK ESTABLISHED', 'online', roundTripMs);
      handleNewTelemetryPacket(data, roundTripMs);

    } catch (err) {
      clearTimeout(timeoutId);
      failedConsecutiveAttempts++;

      const isAbort = err.name === 'AbortError';
      const errMsg = isAbort ? 'Request Timeout (>1.8s)' : err.message;

      if (failedConsecutiveAttempts >= 4) {
        updateConnectionStatus('OFFLINE / UNREACHABLE', 'error', '--');
        if (failedConsecutiveAttempts === 4) {
          logConsole('NETWORK', `Cannot reach ${config.endpoint}. Please connect to Wi-Fi "AERO-SAT-AP" (Pass: satellite123). Or switch to SIMULATOR mode.`, 'alert');
        }
      } else {
        updateConnectionStatus('CONNECTING...', 'reconnecting', '--');
      }
    }
  }

  function updateConnectionStatus(text, stateClass, latency) {
    if (el.statusText) el.statusText.textContent = text;
    if (el.dispLatency) el.dispLatency.textContent = latency !== '--' ? `${latency} ms` : '-- ms';

    if (el.linkBadge) {
      el.linkBadge.className = `link-status-badge ${stateClass}`;
    }
  }

  // ==========================================================================
  // REALISTIC SIMULATOR ENGINE (FOR DEMO & TESTING WITHOUT ESP32)
  // ==========================================================================
  let simTime = 0;
  let simRainOverride = false;
  let simTiltOverride = false;
  let simEclipseOverride = false;

  function generateSimulatedTelemetry() {
    simTime += (config.pollIntervalMs / 1000);

    // Simulated satellite flight path over Bangalore towards Chennai / Sriharikota
    const baseLat = 12.971598;
    const baseLon = 77.594562;
    const latDrift = Math.sin(simTime * 0.05) * 0.025;
    const lonDrift = (simTime * 0.001) % 0.05;

    // Simulated Temperature (24.5°C ~ 26.5°C with realistic sensor ripple)
    const simulatedTemp = 25.2 + Math.sin(simTime * 0.1) * 1.2 + (Math.random() - 0.5) * 0.2;

    // Rain condition
    let simulatedRainPct = 0;
    let simulatedRainRaw = 3850 + Math.floor((Math.random() - 0.5) * 40);
    if (simRainOverride) {
      simulatedRainPct = 84 + Math.floor(Math.random() * 12);
      simulatedRainRaw = 1350 + Math.floor(Math.random() * 80);
    }

    // Light Sensor
    let simulatedLdrLux = 520 + Math.floor(Math.sin(simTime * 0.2) * 180 + (Math.random() - 0.5) * 20);
    let simulatedLdrRaw = Math.floor((simulatedLdrLux / 1000) * 4095);
    if (simEclipseOverride) {
      simulatedLdrLux = 28;
      simulatedLdrRaw = 115;
    }

    // Voltage (4.15V discharging slowly)
    const simulatedVoltage = Math.max(3.2, 4.12 - (simTime * 0.0002) + (Math.random() - 0.5) * 0.01);
    const simulatedBattery = Math.round(((simulatedVoltage - 3.2) / 1.0) * 100);

    // Tilt SW-520D
    const simulatedTilt = simTiltOverride ? 1 : 0;
    const simulatedTiltStatus = simulatedTilt ? 'TILTED' : 'LEVEL';
    const simulatedPitch = simulatedTilt ? 38.5 : 0.0;
    const simulatedRoll = simulatedTilt ? 14.2 : 0.0;
    const simulatedHeading = (142 + Math.floor(Math.sin(simTime * 0.08) * 12)) % 360;

    const simData = {
      temp: parseFloat(simulatedTemp.toFixed(1)),
      rain: simulatedRainPct,
      rainRaw: simulatedRainRaw,
      ldr: Math.max(0, Math.min(1000, simulatedLdrLux)),
      ldrRaw: simulatedLdrRaw,
      voltage: parseFloat(simulatedVoltage.toFixed(2)),
      battery: Math.max(0, Math.min(100, simulatedBattery)),
      tilt: simulatedTilt,
      tiltStatus: simulatedTiltStatus,
      heading: simulatedHeading,
      pitch: simulatedPitch,
      roll: simulatedRoll,
      rssi: -52 + Math.floor((Math.random() - 0.5) * 6),
      gps: {
        lat: parseFloat((baseLat + latDrift).toFixed(6)),
        lon: parseFloat((baseLon + lonDrift).toFixed(6)),
        alt: parseFloat((920.0 + Math.sin(simTime * 0.1) * 15).toFixed(1)),
        speed: parseFloat((12.4 + Math.cos(simTime * 0.1) * 3).toFixed(1)),
        sats: 9
      }
    };

    updateConnectionStatus('SIMULATOR ACTIVE', 'online', '0.4');
    handleNewTelemetryPacket(simData, 1);
  }

  // ==========================================================================
  // DISPATCH & RENDER TELEMETRY PACKET
  // ==========================================================================
  function handleNewTelemetryPacket(data, pingLatency) {
    packetCounter++;
    currentTelemetry = data;

    // Audio chirp
    playTelemetryChirp();

    // Check for Tilt Alert change
    const wasTilted = el.valTiltStatus.classList.contains('tilted-text');
    const isNowTilted = data.tilt === 1 || data.tiltStatus === 'TILTED';
    if (!wasTilted && isNowTilted) {
      playAlertAlarm();
      logConsole('ALERT', `⚠️ SW-520D TILT SWITCH TRIGGERED! Attitude excursion detected (Pitch: ${data.pitch}°, Roll: ${data.roll}°)`, 'alert');
    }

    // Update Header Quick Stats
    if (el.dispPacketCount) el.dispPacketCount.textContent = packetCounter.toLocaleString();
    if (el.dispRssi) {
      const rssiVal = data.rssi !== undefined ? data.rssi : -60;
      el.dispRssi.textContent = `${rssiVal} dBm`;
    }

    // 1. UPDATE TEMPERATURE CARD
    renderTemperature(data.temp);

    // 2. UPDATE VOLTAGE & BATTERY CARD
    renderVoltage(data.voltage, data.battery);

    // 3. UPDATE TILT SENSOR CARD
    renderTilt(data.tilt, data.tiltStatus, data.pitch, data.roll);

    // 4. UPDATE RAIN / MOISTURE CARD
    renderRain(data.rain, data.rainRaw);

    // 5. UPDATE LDR LIGHT SENSOR CARD
    renderLdr(data.ldr, data.ldrRaw);

    // 6. UPDATE HUD & ATTITUDE DATA
    renderAttitudeHud(data.heading, data.pitch, data.roll, isNowTilted);

    // 7. UPDATE GPS MAP & HUD OVERLAY
    if (data.gps) {
      renderGpsTelemetry(data.gps);
    }

    // 8. UPDATE REAL-TIME CHART
    if (!chartPaused && telemetryChart) {
      updateChartData(data);
    }

    // 9. BUFFER TELEMETRY FOR CSV/JSON EXPORT
    bufferTelemetryHistory(data);
  }

  // ==========================================================================
  // SENSOR CARD RENDERERS
  // ==========================================================================
  function renderTemperature(tempC) {
    if (tempC > peakTempC) peakTempC = tempC;

    let displayVal = tempC.toFixed(1);
    let unitLabel = '°C';
    if (config.tempUnit === 'F') {
      displayVal = ((tempC * 9 / 5) + 32).toFixed(1);
      unitLabel = '°F';
    }

    if (el.valTemp) el.valTemp.innerHTML = `${displayVal}<span class="metric-unit">${unitLabel}</span>`;
    if (el.subTempPeak) {
      const peakDisp = config.tempUnit === 'F' ? ((peakTempC * 9 / 5) + 32).toFixed(1) + '°F' : peakTempC.toFixed(1) + '°C';
      el.subTempPeak.textContent = `Peak: ${peakDisp}`;
    }

    // Percentage of 0 - 60°C range
    const pct = Math.max(0, Math.min(100, (tempC / 60) * 100));
    if (el.gaugeTemp) el.gaugeTemp.style.width = `${pct}%`;

    // Condition Badge
    if (el.tempBadge) {
      if (tempC > 45) {
        el.tempBadge.textContent = 'CRITICAL HOT';
        el.tempBadge.className = 'card-badge badge-red';
      } else if (tempC > 35) {
        el.tempBadge.textContent = 'ELEVATED';
        el.tempBadge.className = 'card-badge';
      } else if (tempC < 0) {
        el.tempBadge.textContent = 'SUB-ZERO';
        el.tempBadge.className = 'card-badge badge-cyan';
      } else {
        el.tempBadge.textContent = 'NOMINAL';
        el.tempBadge.className = 'card-badge badge-green';
      }
    }
  }

  function renderVoltage(voltage, batteryPct) {
    if (el.valVoltage) el.valVoltage.innerHTML = `${voltage.toFixed(2)}<span class="metric-unit">V</span>`;
    if (el.valBatteryPct) el.valBatteryPct.textContent = `${batteryPct}%`;
    if (el.gaugeBattery) {
      el.gaugeBattery.style.width = `${batteryPct}%`;
      if (batteryPct <= 20) {
        el.gaugeBattery.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
      } else if (batteryPct <= 45) {
        el.gaugeBattery.style.background = 'linear-gradient(90deg, #eab308, #ca8a04)';
      } else {
        el.gaugeBattery.style.background = 'linear-gradient(90deg, #22c55e, #10b981)';
      }
    }

    if (el.batteryBadge) {
      if (batteryPct <= 15) {
        el.batteryBadge.textContent = 'LOW VOLTAGE';
        el.batteryBadge.className = 'card-badge badge-red';
      } else {
        el.batteryBadge.textContent = batteryPct > 80 ? 'FULL CHARGE' : 'NOMINAL';
        el.batteryBadge.className = 'card-badge badge-green';
      }
    }

    if (el.subVoltageState) {
      if (voltage > 8.0) {
        el.subVoltageState.textContent = '2S/3S Li-Po Rail';
      } else if (voltage > 4.4) {
        el.subVoltageState.textContent = '5V USB Bus Rail';
      } else {
        el.subVoltageState.textContent = '1S Li-Po Cell Rail';
      }
    }
  }

  function renderTilt(tilt, tiltStatus, pitch, roll) {
    const isTilted = tilt === 1 || tiltStatus === 'TILTED';

    if (el.tiltBadge) {
      el.tiltBadge.textContent = isTilted ? 'TILTED' : 'LEVEL';
      el.tiltBadge.className = isTilted ? 'card-badge badge-red' : 'card-badge badge-green';
    }

    if (el.valTiltStatus) {
      el.valTiltStatus.textContent = isTilted ? 'EXCURSION: TILTED' : 'LEVEL ATTITUDE';
      el.valTiltStatus.className = isTilted ? 'tilt-state-title tilted-text' : 'tilt-state-title';
    }

    if (el.valTiltPitch) el.valTiltPitch.textContent = `${pitch.toFixed(1)}°`;
    if (el.valTiltRoll) el.valTiltRoll.textContent = `${roll.toFixed(1)}°`;

    if (el.tiltBall) {
      if (isTilted) {
        el.tiltBall.classList.add('tilted');
      } else {
        el.tiltBall.classList.remove('tilted');
      }
    }
  }

  function renderRain(rainPct, rainRaw) {
    if (el.valRain) el.valRain.innerHTML = `${rainPct}<span class="metric-unit">%</span>`;
    if (el.valRainRaw) el.valRainRaw.textContent = rainRaw;
    if (el.gaugeRain) el.gaugeRain.style.width = `${rainPct}%`;

    if (el.rainBadge) {
      if (rainPct >= 75) {
        el.rainBadge.textContent = 'SUBMERGED / FLOOD';
        el.rainBadge.className = 'card-badge badge-red';
      } else if (rainPct >= 35) {
        el.rainBadge.textContent = 'RAIN DETECTED';
        el.rainBadge.className = 'card-badge badge-cyan';
      } else if (rainPct > 10) {
        el.rainBadge.textContent = 'MOIST / CONDENSATION';
        el.rainBadge.className = 'card-badge';
      } else {
        el.rainBadge.textContent = 'BONE DRY';
        el.rainBadge.className = 'card-badge badge-green';
      }
    }

    if (el.subRainStatus) {
      el.subRainStatus.textContent = rainPct > 20 ? 'Active Precipitation' : 'Atmosphere Dry';
    }
  }

  function renderLdr(lux, ldrRaw) {
    if (el.valLdr) el.valLdr.innerHTML = `${lux}<span class="metric-unit">lx</span>`;
    if (el.valLdrRaw) el.valLdrRaw.textContent = ldrRaw;
    const ldrPct = Math.max(0, Math.min(100, (lux / 1000) * 100));
    if (el.gaugeLdr) el.gaugeLdr.style.width = `${ldrPct}%`;

    if (el.ldrBadge) {
      if (lux > 750) {
        el.ldrBadge.textContent = 'DIRECT SUNLIGHT';
        el.ldrBadge.className = 'card-badge';
      } else if (lux > 250) {
        el.ldrBadge.textContent = 'DAYLIGHT';
        el.ldrBadge.className = 'card-badge badge-green';
      } else if (lux > 50) {
        el.ldrBadge.textContent = 'TWILIGHT / DUSK';
        el.ldrBadge.className = 'card-badge badge-cyan';
      } else {
        el.ldrBadge.textContent = 'TOTAL DARKNESS';
        el.ldrBadge.className = 'card-badge';
      }
    }

    if (el.subLdrSolar) {
      el.subLdrSolar.textContent = `Irradiance ${Math.round(ldrPct)}%`;
    }
  }

  // ==========================================================================
  // HUD & ARTIFICIAL HORIZON (ATTITUDE DIRECTOR) CANVAS
  // ==========================================================================
  function initHorizonRenderer() {
    const canvas = el.horizonCanvas;
    if (!canvas) return;

    function renderLoop() {
      // Smooth lerp interpolation for 60fps attitude animation
      const lerpFactor = 0.12;
      smoothPitch += (currentTelemetry.pitch - smoothPitch) * lerpFactor;
      smoothRoll += (currentTelemetry.roll - smoothRoll) * lerpFactor;
      smoothHeading += (currentTelemetry.heading - smoothHeading) * lerpFactor;

      drawHorizon(canvas, smoothPitch, smoothRoll);
      requestAnimationFrame(renderLoop);
    }

    requestAnimationFrame(renderLoop);
  }

  function drawHorizon(canvas, pitchDeg, rollDeg) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;

    ctx.clearRect(0, 0, width, height);

    ctx.save();
    // Center point
    ctx.translate(cx, cy);

    // Roll rotation
    const rollRad = (rollDeg * Math.PI) / 180;
    ctx.rotate(-rollRad);

    // Pitch vertical offset (approx 3.2 pixels per degree)
    const pitchOffset = pitchDeg * 3.2;

    // Draw Sky (Upper Half)
    const skyGrad = ctx.createLinearGradient(0, -height, 0, pitchOffset);
    skyGrad.addColorStop(0, '#001f3f');
    skyGrad.addColorStop(1, '#0077b6');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-width * 1.5, -height * 1.5, width * 3, height * 1.5 + pitchOffset);

    // Draw Ground / Terrain (Lower Half)
    const groundGrad = ctx.createLinearGradient(0, pitchOffset, 0, height);
    groundGrad.addColorStop(0, '#9a3412');
    groundGrad.addColorStop(1, '#431407');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(-width * 1.5, pitchOffset, width * 3, height * 1.5 - pitchOffset);

    // Horizon Center Line
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-width, pitchOffset);
    ctx.lineTo(width, pitchOffset);
    ctx.stroke();

    // Pitch Ladder Lines (±10°, ±20°, ±30°)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';

    const ladderSteps = [-30, -20, -10, 10, 20, 30];
    ladderSteps.forEach(deg => {
      const y = pitchOffset - (deg * 3.2);
      const lineWidth = Math.abs(deg) === 20 ? 60 : 40;

      ctx.beginPath();
      // Left bar
      ctx.moveTo(-lineWidth, y);
      ctx.lineTo(-15, y);
      // Right bar
      ctx.moveTo(15, y);
      ctx.lineTo(lineWidth, y);
      ctx.stroke();

      // Degree label
      ctx.fillText(String(Math.abs(deg)), -lineWidth - 10, y + 3);
      ctx.fillText(String(Math.abs(deg)), lineWidth + 10, y + 3);
    });

    ctx.restore();

    // Static Crosshair / Aircraft Wings Reticle
    ctx.save();
    ctx.translate(cx, cy);

    ctx.strokeStyle = '#ffb703';
    ctx.fillStyle = '#ffb703';
    ctx.lineWidth = 3;

    // Aircraft center dot
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Aircraft Wings
    ctx.beginPath();
    ctx.moveTo(-45, 0);
    ctx.lineTo(-12, 0);
    ctx.lineTo(-12, 6);
    ctx.moveTo(12, 6);
    ctx.lineTo(12, 0);
    ctx.lineTo(45, 0);
    ctx.stroke();

    // Roll Bank Angle Scale Arc (Top)
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, cy - 20, -Math.PI * 0.75, -Math.PI * 0.25);
    ctx.stroke();

    // Bank ticks at 0°, ±30°, ±60°
    const bankTicks = [-60, -30, 0, 30, 60];
    bankTicks.forEach(angle => {
      const rad = ((angle - 90) * Math.PI) / 180;
      const r1 = cy - 20;
      const r2 = cy - (angle === 0 ? 30 : 25);
      ctx.beginPath();
      ctx.moveTo(Math.cos(rad) * r1, Math.sin(rad) * r1);
      ctx.lineTo(Math.cos(rad) * r2, Math.sin(rad) * r2);
      ctx.stroke();
    });

    // Bank Pointer Needle
    const pointerRad = ((-rollDeg - 90) * Math.PI) / 180;
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.arc(Math.cos(pointerRad) * (cy - 20), Math.sin(pointerRad) * (cy - 20), 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function renderAttitudeHud(heading, pitch, roll, isTilted) {
    if (el.hudValPitch) el.hudValPitch.textContent = `${pitch.toFixed(1)}°`;
    if (el.hudValRoll) el.hudValRoll.textContent = `${roll.toFixed(1)}°`;

    // Cardinal Heading calculation
    const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const cardIdx = Math.round((heading % 360) / 45) % 8;
    const cardStr = cardinals[cardIdx];

    if (el.hudValHeading) el.hudValHeading.textContent = `${heading}° ${cardStr}`;

    // Compass Tape
    if (el.hudCompassTape) {
      const leftDeg = (heading - 20 + 360) % 360;
      const rightDeg = (heading + 20) % 360;
      el.hudCompassTape.innerHTML = `
        <span class="tape-deg">${leftDeg}°</span>
        <span class="tape-deg needle">▼ ${heading}° (${cardStr})</span>
        <span class="tape-deg">${rightDeg}°</span>
      `;
    }

    // Tilt excursion alert banner
    if (el.hudTiltAlertBox) {
      if (isTilted) {
        el.hudTiltAlertBox.classList.add('visible');
      } else {
        el.hudTiltAlertBox.classList.remove('visible');
      }
    }

    if (el.hudAttitudeStatus) {
      if (isTilted) {
        el.hudAttitudeStatus.textContent = 'ATTITUDE: TILTED';
        el.hudAttitudeStatus.style.color = 'var(--red-alert)';
        el.hudAttitudeStatus.style.borderColor = 'rgba(255, 51, 102, 0.4)';
      } else {
        el.hudAttitudeStatus.textContent = 'ATTITUDE STABLE';
        el.hudAttitudeStatus.style.color = 'var(--green-telemetry)';
        el.hudAttitudeStatus.style.borderColor = 'rgba(0, 255, 157, 0.25)';
      }
    }
  }

  // ==========================================================================
  // GPS MAP & SATELLITE TRACKER (LEAFLET.JS)
  // ==========================================================================
  function initLeafletMap() {
    const mapContainer = document.getElementById('satellite-map');
    if (!mapContainer || typeof L === 'undefined') return;

    // Center on firmware default coords (Bangalore 12.971598, 77.594562)
    const initialCoords = [currentTelemetry.gps.lat, currentTelemetry.gps.lon];

    leafletMap = L.map('satellite-map', {
      zoomControl: false,
      attributionControl: false
    }).setView(initialCoords, 14);

    // Tactical CartoDB Dark Matter tiles (dark futuristic theme)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd'
    }).addTo(leafletMap);

    // Custom Glowing Satellite HTML Marker
    const satIcon = L.divIcon({
      className: 'satellite-map-marker',
      html: `
        <div class="sat-marker-ring">
          <div class="sat-marker-center"></div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    satMarker = L.marker(initialCoords, { icon: satIcon }).addTo(leafletMap);

    // Polyline Flight Path Trail
    trailCoordinates.push(initialCoords);
    satTrailPolyline = L.polyline(trailCoordinates, {
      color: '#00f0ff',
      weight: 2.5,
      opacity: 0.85,
      dashArray: '4, 6'
    }).addTo(leafletMap);

    // Small zoom controls in top-right
    L.control.zoom({ position: 'topright' }).addTo(leafletMap);
  }

  function renderGpsTelemetry(gps) {
    if (el.gpsValLat) el.gpsValLat.textContent = `${gps.lat.toFixed(6)}° ${gps.lat >= 0 ? 'N' : 'S'}`;
    if (el.gpsValLon) el.gpsValLon.textContent = `${gps.lon.toFixed(6)}° ${gps.lon >= 0 ? 'E' : 'W'}`;
    if (el.gpsValAlt) el.gpsValAlt.textContent = `${gps.alt.toFixed(1)} m`;
    if (el.gpsValSpd) el.gpsValSpd.textContent = `${gps.speed.toFixed(1)} km/h`;
    if (el.gpsValSats) el.gpsValSats.textContent = `${gps.sats} LOCKED`;

    if (el.gpsFixIndicator) {
      if (gps.sats >= 4 || gps.speed > 0) {
        el.gpsFixIndicator.textContent = `3D GPS FIX (${gps.sats} SATS)`;
        el.gpsFixIndicator.className = 'gps-fix-pill locked';
      } else {
        el.gpsFixIndicator.textContent = 'ACQUIRING FIX';
        el.gpsFixIndicator.className = 'gps-fix-pill';
      }
    }

    // Update Leaflet marker position & trail
    if (leafletMap && satMarker) {
      const newPos = [gps.lat, gps.lon];
      satMarker.setLatLng(newPos);

      // Append to trail if moved
      const lastPoint = trailCoordinates[trailCoordinates.length - 1];
      if (!lastPoint || (Math.abs(lastPoint[0] - gps.lat) > 0.00005 || Math.abs(lastPoint[1] - gps.lon) > 0.00005)) {
        trailCoordinates.push(newPos);
        if (trailCoordinates.length > 200) trailCoordinates.shift();
        if (satTrailPolyline) satTrailPolyline.setLatLngs(trailCoordinates);
      }
    }
  }

  function recenterMap() {
    if (leafletMap && satMarker) {
      leafletMap.panTo(satMarker.getLatLng(), { animate: true });
    }
  }

  function clearGpsTrail() {
    trailCoordinates.length = 0;
    if (satMarker) {
      const pos = satMarker.getLatLng();
      trailCoordinates.push([pos.lat, pos.lng]);
    }
    if (satTrailPolyline) satTrailPolyline.setLatLngs(trailCoordinates);
    logConsole('GPS', 'Flight trajectory path cleared on tactical map.', 'info');
  }

  // ==========================================================================
  // REAL-TIME CHART.JS MULTI-CHANNEL GRAPHS
  // ==========================================================================
  function initTelemetryChart() {
    const ctx = document.getElementById('telemetry-chart');
    if (!ctx || typeof Chart === 'undefined') return;

    // Generate initial blank labels
    const labels = Array.from({ length: config.chartPoints }, () => '');

    telemetryChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'DS18B20 Temp (°C)',
            data: Array(config.chartPoints).fill(25),
            borderColor: '#00f0ff',
            backgroundColor: 'rgba(0, 240, 255, 0.05)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.35,
            yAxisID: 'y'
          },
          {
            label: 'Battery Bus (V)',
            data: Array(config.chartPoints).fill(4.1),
            borderColor: '#ffd166',
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.35,
            yAxisID: 'y'
          },
          {
            label: 'Rain Moisture (%)',
            data: Array(config.chartPoints).fill(0),
            borderColor: '#38bdf8',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
            yAxisID: 'yPct'
          },
          {
            label: 'LDR Lux / 10',
            data: Array(config.chartPoints).fill(50),
            borderColor: '#fb923c',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
            yAxisID: 'yPct'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(10, 16, 30, 0.95)',
            borderColor: 'rgba(0, 240, 255, 0.3)',
            borderWidth: 1,
            titleFont: { family: 'JetBrains Mono', size: 11 },
            bodyFont: { family: 'JetBrains Mono', size: 10 }
          }
        },
        scales: {
          x: {
            display: false,
            grid: { display: false }
          },
          y: {
            position: 'left',
            min: 0,
            max: 50,
            grid: {
              color: 'rgba(255, 255, 255, 0.04)'
            },
            ticks: {
              color: '#94a3b8',
              font: { family: 'JetBrains Mono', size: 10 }
            }
          },
          yPct: {
            position: 'right',
            min: 0,
            max: 100,
            grid: { display: false },
            ticks: {
              color: '#64748b',
              font: { family: 'JetBrains Mono', size: 10 }
            }
          }
        }
      }
    });
  }

  function updateChartData(data) {
    if (!telemetryChart) return;

    const datasets = telemetryChart.data.datasets;
    // Temp
    datasets[0].data.shift();
    datasets[0].data.push(data.temp);

    // Voltage
    datasets[1].data.shift();
    datasets[1].data.push(data.voltage);

    // Rain
    datasets[2].data.shift();
    datasets[2].data.push(data.rain);

    // LDR Lux / 10 (scale to 0-100)
    datasets[3].data.shift();
    datasets[3].data.push(Math.round(data.ldr / 10));

    // Visibility toggles
    datasets[0].hidden = !el.chkChartTemp.checked;
    datasets[1].hidden = !el.chkChartVolt.checked;
    datasets[2].hidden = !el.chkChartRain.checked;
    datasets[3].hidden = !el.chkChartLdr.checked;

    telemetryChart.update('none'); // 'none' for instantaneous 60fps performance
  }

  // ==========================================================================
  // TELEMETRY CONSOLE & LOGGING ENGINE
  // ==========================================================================
  let totalConsoleEntries = 1;

  function logConsole(source, message, type = 'info') {
    if (!el.consoleStream) return;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;

    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.setAttribute('data-type', type.toUpperCase());

    line.innerHTML = `
      <span class="log-time">[${timeStr}]</span>
      <span class="log-source">[${source}]</span>
      <span class="log-msg">${escapeHtml(message)}</span>
    `;

    // Apply current filter
    if (currentFilter !== 'ALL') {
      const matchFilter = (currentFilter === 'ALERT' && (type === 'alert' || type === 'warn')) ||
                          (currentFilter === 'JSON' && type === 'json') ||
                          (currentFilter === 'GPS' && (source === 'GPS' || type === 'gps'));
      if (!matchFilter) line.style.display = 'none';
    }

    el.consoleStream.appendChild(line);

    // Auto-scroll to bottom
    el.consoleStream.scrollTop = el.consoleStream.scrollHeight;

    totalConsoleEntries++;
    if (el.logEntryCount) {
      el.logEntryCount.textContent = `${totalConsoleEntries} ENTRIES`;
    }

    // Limit DOM node count for high-frequency performance
    if (el.consoleStream.children.length > 300) {
      el.consoleStream.removeChild(el.consoleStream.firstChild);
    }
  }

  function applyLogFilter(filterName) {
    currentFilter = filterName;
    const lines = el.consoleStream.querySelectorAll('.log-line');

    lines.forEach(line => {
      const type = line.className.toLowerCase();
      if (filterName === 'ALL') {
        line.style.display = 'flex';
      } else if (filterName === 'ALERT') {
        line.style.display = (type.includes('alert') || type.includes('warn')) ? 'flex' : 'none';
      } else if (filterName === 'JSON') {
        line.style.display = type.includes('json') ? 'flex' : 'none';
      } else if (filterName === 'GPS') {
        line.style.display = (type.includes('gps') || line.innerHTML.includes('[GPS]')) ? 'flex' : 'none';
      }
    });
  }

  function bufferTelemetryHistory(packet) {
    const entry = Object.assign({ timestamp: new Date().toISOString() }, packet);
    telemetryHistory.push(entry);

    if (telemetryHistory.length > config.maxHistoryLength) {
      telemetryHistory.shift();
    }

    // Periodically post raw JSON snippet to console (every 25 packets)
    if (packetCounter % 25 === 0) {
      logConsole('TELEM', `PKT #${packetCounter}: T=${packet.temp}°C | V=${packet.voltage}V | R=${packet.rain}% | L=${packet.ldr}lx | ATT=${packet.tiltStatus}`, 'json');
    }
  }

  function exportTelemetryCsv() {
    if (telemetryHistory.length === 0) {
      alert('No telemetry packets recorded yet.');
      return;
    }

    const headers = ['Timestamp', 'Temp_C', 'Rain_Pct', 'Rain_Raw', 'LDR_Lux', 'LDR_Raw', 'Voltage_V', 'Battery_Pct', 'Tilt_State', 'Tilt_Status', 'Heading_Deg', 'Pitch_Deg', 'Roll_Deg', 'GPS_Lat', 'GPS_Lon', 'GPS_Alt_m', 'GPS_Speed_kmh', 'GPS_Sats'];
    const rows = telemetryHistory.map(d => [
      d.timestamp,
      d.temp,
      d.rain,
      d.rainRaw,
      d.ldr,
      d.ldrRaw,
      d.voltage,
      d.battery,
      d.tilt,
      `"${d.tiltStatus}"`,
      d.heading,
      d.pitch,
      d.roll,
      d.gps ? d.gps.lat : '',
      d.gps ? d.gps.lon : '',
      d.gps ? d.gps.alt : '',
      d.gps ? d.gps.speed : '',
      d.gps ? d.gps.sats : ''
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadFile(csvContent, `AERO_SAT_TELEMETRY_${Date.now()}.csv`, 'text/csv');
    logConsole('EXPORT', `Exported ${telemetryHistory.length} telemetry records to CSV.`, 'info');
  }

  function exportTelemetryJson() {
    if (telemetryHistory.length === 0) {
      alert('No telemetry packets recorded yet.');
      return;
    }

    const jsonStr = JSON.stringify(telemetryHistory, null, 2);
    downloadFile(jsonStr, `AERO_SAT_DUMP_${Date.now()}.json`, 'application/json');
    logConsole('EXPORT', `Exported full telemetry session dump (${telemetryHistory.length} pkts) to JSON.`, 'info');
  }

  function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ==========================================================================
  // EVENT LISTENERS & USER CONTROLS
  // ==========================================================================
  function setupEventListeners() {
    // Mode Switches
    if (el.btnModeLive) {
      el.btnModeLive.addEventListener('click', () => {
        playUiClick();
        mode = 'LIVE';
        el.btnModeLive.classList.add('active');
        el.btnModeSim.classList.remove('active');
        failedConsecutiveAttempts = 0;
        updateConnectionStatus('CONNECTING...', 'reconnecting', '--');
        logConsole('MODE', 'Switched to LIVE HARDWARE LINK mode (ESP32 REST polling).', 'info');
      });
    }

    if (el.btnModeSim) {
      el.btnModeSim.addEventListener('click', () => {
        playUiClick();
        mode = 'SIM';
        el.btnModeSim.classList.add('active');
        el.btnModeLive.classList.remove('active');
        updateConnectionStatus('SIMULATOR ACTIVE', 'online', '0.4');
        logConsole('MODE', 'Switched to SYNTHETIC SIMULATOR mode.', 'info');
      });
    }

    // Audio Mute Toggle
    if (el.btnAudioToggle) {
      el.btnAudioToggle.addEventListener('click', () => {
        config.audioEnabled = !config.audioEnabled;
        if (config.audioEnabled) {
          el.btnAudioToggle.classList.add('active');
          el.iconSoundOn.classList.remove('hidden');
          el.iconSoundOff.classList.add('hidden');
          playUiClick();
          logConsole('AUDIO', 'Mission audio synthesizer unmuted.', 'info');
        } else {
          el.btnAudioToggle.classList.remove('active');
          el.iconSoundOn.classList.add('hidden');
          el.iconSoundOff.classList.remove('hidden');
          logConsole('AUDIO', 'Mission audio synthesizer muted.', 'info');
        }
      });
    }

    // Temp Unit Toggle (°C / °F)
    if (el.btnTempUnit) {
      el.btnTempUnit.addEventListener('click', () => {
        playUiClick();
        config.tempUnit = config.tempUnit === 'C' ? 'F' : 'C';
        el.btnTempUnit.textContent = config.tempUnit === 'C' ? '°F' : '°C';
        renderTemperature(currentTelemetry.temp);
      });
    }

    // Map Controls
    if (el.btnRecenterMap) {
      el.btnRecenterMap.addEventListener('click', () => {
        playUiClick();
        recenterMap();
      });
    }

    if (el.btnClearTrail) {
      el.btnClearTrail.addEventListener('click', () => {
        playUiClick();
        clearGpsTrail();
      });
    }

    // Chart Pause Toggle
    if (el.btnChartPause) {
      el.btnChartPause.addEventListener('click', () => {
        playUiClick();
        chartPaused = !chartPaused;
        el.btnChartPause.textContent = chartPaused ? 'RESUME PLOT' : 'PAUSE PLOT';
      });
    }

    // Terminal Filters
    if (el.filterBtns) {
      el.filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          playUiClick();
          el.filterBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          applyLogFilter(btn.getAttribute('data-filter'));
        });
      });
    }

    if (el.btnClearConsole) {
      el.btnClearConsole.addEventListener('click', () => {
        playUiClick();
        if (el.consoleStream) el.consoleStream.innerHTML = '';
        totalConsoleEntries = 0;
        if (el.logEntryCount) el.logEntryCount.textContent = '0 ENTRIES';
      });
    }

    // Data Export
    if (el.btnExportCsv) el.btnExportCsv.addEventListener('click', exportTelemetryCsv);
    if (el.btnExportJson) el.btnExportJson.addEventListener('click', exportTelemetryJson);

    // Settings Modal
    if (el.btnOpenSettings) {
      el.btnOpenSettings.addEventListener('click', () => {
        playUiClick();
        if (el.settingsModal) el.settingsModal.showModal();
      });
    }

    if (el.btnCloseSettings) {
      el.btnCloseSettings.addEventListener('click', () => {
        playUiClick();
        if (el.settingsModal) el.settingsModal.close();
      });
    }

    // Close on backdrop click
    if (el.settingsModal) {
      el.settingsModal.addEventListener('click', (e) => {
        if (e.target === el.settingsModal) el.settingsModal.close();
      });
    }

    // Sliders dynamic labels
    if (el.inputPollInterval) {
      el.inputPollInterval.addEventListener('input', () => {
        const val = parseInt(el.inputPollInterval.value, 10);
        const hz = (1000 / val).toFixed(1);
        if (el.dispSliderInterval) el.dispSliderInterval.textContent = `${val} ms (${hz} Hz)`;
      });
    }

    if (el.inputAudioVolume) {
      el.inputAudioVolume.addEventListener('input', () => {
        if (el.dispSliderVolume) el.dispSliderVolume.textContent = `${el.inputAudioVolume.value}%`;
      });
    }

    // Settings Actions
    if (el.btnSaveSettings) {
      el.btnSaveSettings.addEventListener('click', () => {
        playUiClick();
        saveSettings();
        if (el.settingsModal) el.settingsModal.close();
      });
    }

    if (el.btnResetDefaults) {
      el.btnResetDefaults.addEventListener('click', () => {
        playUiClick();
        config = Object.assign({}, DEFAULT_CONFIG);
        loadSavedSettings();
      });
    }

    // Test Ping Button
    if (el.btnTestPing) {
      el.btnTestPing.addEventListener('click', async () => {
        playUiClick();
        const testUrl = el.inputEndpointUrl.value.trim();
        el.btnTestPing.textContent = 'PINGING...';
        try {
          const t0 = performance.now();
          const res = await fetch(testUrl, { method: 'GET', cache: 'no-store' });
          const latency = Math.round(performance.now() - t0);
          if (res.ok) {
            alert(`SUCCESS: ESP32 REST Endpoint responded in ${latency}ms!`);
            logConsole('PING', `ESP32 responded HTTP 200 OK (${latency}ms).`, 'info');
          } else {
            alert(`HTTP Warning: Received status ${res.status}`);
          }
        } catch (e) {
          alert(`PING FAILED: ${e.message}\nEnsure your device is connected to Wi-Fi "AERO-SAT-AP" (Password: satellite123)`);
        } finally {
          el.btnTestPing.textContent = 'TEST PING';
        }
      });
    }

    // Simulation Trigger Scenarios
    if (el.btnSimTriggerTilt) {
      el.btnSimTriggerTilt.addEventListener('click', () => {
        playUiClick();
        simTiltOverride = !simTiltOverride;
        logConsole('SIM', `Triggered Tilt override = ${simTiltOverride ? 'TILTED' : 'LEVEL'}`, 'warn');
      });
    }

    if (el.btnSimTriggerRain) {
      el.btnSimTriggerRain.addEventListener('click', () => {
        playUiClick();
        simRainOverride = !simRainOverride;
        logConsole('SIM', `Triggered Rain storm event = ${simRainOverride ? 'ACTIVE' : 'OFF'}`, 'warn');
      });
    }

    if (el.btnSimTriggerSun) {
      el.btnSimTriggerSun.addEventListener('click', () => {
        playUiClick();
        simEclipseOverride = !simEclipseOverride;
        logConsole('SIM', `Triggered Solar Dusk/Eclipse event = ${simEclipseOverride ? 'ACTIVE' : 'OFF'}`, 'warn');
      });
    }

    if (el.btnSimTriggerReset) {
      el.btnSimTriggerReset.addEventListener('click', () => {
        playUiClick();
        simTiltOverride = false;
        simRainOverride = false;
        simEclipseOverride = false;
        logConsole('SIM', 'Simulator sensor triggers reset to standard orbital pass.', 'info');
      });
    }
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
