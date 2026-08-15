/**
 * ============================================================================
 * SCADA WATER PUMP & SMART IRRIGATION SYSTEM - MASTER ENGINE
 * Standards: ISA-101 (High Performance HMI) & ISA-18.2 (Alarm Management)
 * ============================================================================
 */

class ScadaApplication {
    constructor() {
        // SCADA Tag Database (Process Values)
        this.tags = {
            tankLevel: 78.5,           // % (0 - 100)
            tankCapacityLiters: 10000, // Total Tank Volume (Liters)
            soilMoisture: 32.0,        // % VWC (Volumetric Water Content)
            pressure: 2.84,            // Bar
            flowRate: 24.5,            // L/min
            totalWaterDispensed: 142.6,// Liters
            pumpStatus: true,          // true = RUNNING, false = STOPPED
            pumpCurrent: 4.2,          // Amperes (Motor electrical load)
            pumpSpeed: 2850,           // RPM
            valveZoneStatus: true,     // true = OPEN (XV-201)
            valveInletStatus: false,   // true = OPEN (XV-101)
            soilTemp: 25.4,            // °C (TT-201)
            ambientTemp: 29.1,         // °C (TT-202)
            ambientHumidity: 68,       // % RH
            mode: 'AUTO',              // 'AUTO' | 'MANUAL' | 'SCHEDULE'
            estopActive: false,        // Emergency Stop state
            pumpTrip: false,           // Motor thermal overload fault
            audioEnabled: true         // SCADA alarm horn sound
        };

        // Supervisory Setpoints (SP) & Safety Interlocks
        this.setpoints = {
            soilMin: 35,               // Trigger auto-irrigation below this %
            soilTarget: 75,            // Stop auto-irrigation at optimal %
            tankCutoff: 15,            // Safety interlock dry-run cutoff %
            tankRefillTrigger: 30      // Alert to refill reservoir %
        };

        // Active Alarms & Historian Log
        this.activeAlarm = null;
        this.alarmHistory = [];
        this.currentLogFilter = 'ALL';

        // Chart.js Instances
        this.soilChart = null;
        this.tankChart = null;
        this.maxChartPoints = 30;

        // Audio Context (Web Audio API Synthesizer)
        this.audioCtx = null;
        this.alarmOscillator = null;
        this.isAlarmBeeping = false;

        // Initialize application on DOM ready
        this.init();
    }

    init() {
        console.log('[SCADA] Initializing High-Performance SCADA HMI...');

        // 1. Initialize Audio Synthesizer
        this.initAudio();

        // 2. Initialize Real-Time Historical Trends (Chart.js)
        this.initCharts();

        // 3. Setup UI Event Listeners
        this.bindEvents();

        // 4. Start Clock & Heartbeat
        this.startClock();

        // 5. Connect MQTT (starts in simulator fallback if no broker specified)
        if (window.scadaMqtt) {
            window.scadaMqtt.connect();
        }

        // 6. Log System Startup
        this.logEvent('SYS_INIT', 'SCADA System initialized. Operating in AUTO Closed-Loop mode.', 'INFO', 'NOMINAL');

        // 7. Start Master Physics Simulation & Control Loop (1000ms interval)
        this.loopTimer = setInterval(() => this.masterProcessLoop(), 1000);

        // Initial UI Render
        this.renderAll();
    }

    // =========================================================================
    // 1. AUDIO SYNTHESIZER (WEB AUDIO API - NO EXTERNAL ASSETS NEEDED)
    // =========================================================================
    initAudio() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.audioCtx = new AudioContext();
            }
        } catch (e) {
            console.warn('[AUDIO] Web Audio API not supported:', e);
        }
    }

    playUiBeep(freq = 800, type = 'sine', duration = 0.08) {
        if (!this.tags.audioEnabled || !this.audioCtx) return;
        try {
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();

            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);

            gain.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);

            osc.connect(gain);
            gain.connect(this.audioCtx.destination);

            osc.start();
            osc.stop(this.audioCtx.currentTime + duration);
        } catch (e) {
            // Audio policy prevent
        }
    }

    startAlarmHorn() {
        if (!this.tags.audioEnabled || !this.audioCtx || this.isAlarmBeeping) return;
        this.isAlarmBeeping = true;

        const beepCycle = () => {
            if (!this.isAlarmBeeping || !this.activeAlarm || this.activeAlarm.acked) {
                this.isAlarmBeeping = false;
                return;
            }
            this.playUiBeep(880, 'sawtooth', 0.25);
            setTimeout(() => {
                if (this.isAlarmBeeping && this.activeAlarm && !this.activeAlarm.acked) {
                    this.playUiBeep(660, 'sawtooth', 0.25);
                }
            }, 300);

            setTimeout(beepCycle, 1200);
        };
        beepCycle();
    }

    stopAlarmHorn() {
        this.isAlarmBeeping = false;
    }

    // =========================================================================
    // 2. MASTER PROCESS & CONTROL LOOP (1 SECOND TICK)
    // =========================================================================
    masterProcessLoop() {
        // A. Natural Environment Physics (Soil Drying / Evaporation)
        const evaporationRate = 0.06 + (this.tags.ambientTemp > 28 ? 0.04 : 0);
        if (!this.tags.pumpStatus || !this.tags.valveZoneStatus) {
            if (this.tags.soilMoisture > 10) {
                this.tags.soilMoisture = Math.max(10, +(this.tags.soilMoisture - evaporationRate).toFixed(2));
            }
        }

        // B. Active Water Refill Valve XV-101 Physics
        if (this.tags.valveInletStatus) {
            if (this.tags.tankLevel < 100) {
                this.tags.tankLevel = Math.min(100, +(this.tags.tankLevel + 0.8).toFixed(1));
            }
        }

        // C. Evaluate Safety Interlocks (ISA-18.2 Interlock Matrix)
        let dryRunInterlockTripped = false;

        if (this.tags.tankLevel <= this.setpoints.tankCutoff) {
            dryRunInterlockTripped = true;
            if (this.tags.pumpStatus) {
                this.tags.pumpStatus = false;
                this.tags.valveZoneStatus = false;
                this.triggerAlarm(
                    'ALM-101',
                    `DRY-RUN INTERLOCK: Reservoir Tank Level (${this.tags.tankLevel}%) <= Cutoff (${this.setpoints.tankCutoff}%). Pump Inhibited!`,
                    'CRITICAL'
                );
            }
        }

        if (this.tags.estopActive) {
            this.tags.pumpStatus = false;
            this.tags.valveZoneStatus = false;
        }

        if (this.tags.pumpTrip) {
            this.tags.pumpStatus = false;
            this.tags.valveZoneStatus = false;
        }

        // D. Automatic Closed-Loop Irrigation Logic (Mode: AUTO)
        if (this.tags.mode === 'AUTO' && !this.tags.estopActive && !this.tags.pumpTrip && !dryRunInterlockTripped) {
            // Trigger Irrigation if Soil Moisture is below minimum setpoint
            if (this.tags.soilMoisture <= this.setpoints.soilMin) {
                if (!this.tags.pumpStatus) {
                    this.tags.pumpStatus = true;
                    this.tags.valveZoneStatus = true;
                    this.logEvent('AUTO_START', `Soil moisture (${this.tags.soilMoisture}%) <= SP (${this.setpoints.soilMin}%). Auto irrigation initiated.`, 'INFO', 'ACTIVE');
                    this.playUiBeep(1000, 'sine', 0.15);
                }
            }
            // Stop Irrigation once Soil Moisture reaches optimal target
            else if (this.tags.soilMoisture >= this.setpoints.soilTarget) {
                if (this.tags.pumpStatus) {
                    this.tags.pumpStatus = false;
                    this.tags.valveZoneStatus = false;
                    this.logEvent('AUTO_STOP', `Soil moisture reached target optimal (${this.tags.soilMoisture}%). Auto irrigation completed.`, 'INFO', 'OPTIMAL');
                    this.playUiBeep(600, 'sine', 0.15);
                }
            }
        }

        // E. Active Irrigation Dynamics (Pump Running + Valve Open)
        if (this.tags.pumpStatus && this.tags.valveZoneStatus && !this.tags.estopActive && !this.tags.pumpTrip) {
            // Line hydraulics
            this.tags.pressure = +(2.80 + (Math.random() * 0.12 - 0.06)).toFixed(2);
            this.tags.flowRate = +(24.2 + (Math.random() * 0.8 - 0.4)).toFixed(1);
            this.tags.pumpCurrent = +(4.2 + (Math.random() * 0.2 - 0.1)).toFixed(1);
            this.tags.pumpSpeed = 2850;

            // Soil Moisture Infiltration
            this.tags.soilMoisture = Math.min(100, +(this.tags.soilMoisture + 1.25).toFixed(1));

            // Tank Level Drawdown
            if (this.tags.tankLevel > 0) {
                this.tags.tankLevel = Math.max(0, +(this.tags.tankLevel - 0.22).toFixed(2));
            }

            // Accumulate water usage
            const dispensedPerSec = this.tags.flowRate / 60;
            this.tags.totalWaterDispensed = +(this.tags.totalWaterDispensed + dispensedPerSec).toFixed(1);
        } else {
            // Idle hydraulics decay
            this.tags.pressure = 0.0;
            this.tags.flowRate = 0.0;
            this.tags.pumpCurrent = 0.0;
            this.tags.pumpSpeed = 0;
        }

        // F. Auto-clear alarms if conditions return to normal
        if (this.activeAlarm && this.activeAlarm.tag === 'ALM-101' && this.tags.tankLevel > this.setpoints.tankCutoff + 3) {
            this.clearActiveAlarm('Auto-cleared: Water level restored above safety threshold.');
        }

        // G. Update UI & Trends
        this.renderAll();
        this.updateTrends();
    }

    // =========================================================================
    // 3. UI RENDERING & P&ID SYNOPTIC GRAPHICS
    // =========================================================================
    renderAll() {
        // 1. KPI Cards
        const elTank = document.getElementById('kpiTankLevel');
        if (elTank) elTank.textContent = this.tags.tankLevel.toFixed(1);

        const elLiters = document.getElementById('kpiTankLiters');
        if (elLiters) {
            const liters = Math.round((this.tags.tankLevel / 100) * this.tags.tankCapacityLiters);
            elLiters.textContent = liters.toLocaleString();
        }

        const elSoil = document.getElementById('kpiSoilMoisture');
        if (elSoil) elSoil.textContent = this.tags.soilMoisture.toFixed(1);

        const elPressure = document.getElementById('kpiPressure');
        if (elPressure) elPressure.textContent = this.tags.pressure.toFixed(2);

        const elFlow = document.getElementById('kpiFlowRate');
        if (elFlow) elFlow.textContent = this.tags.flowRate.toFixed(1);

        const elTotalWater = document.getElementById('kpiTotalWater');
        if (elTotalWater) elTotalWater.textContent = this.tags.totalWaterDispensed.toFixed(1);

        const elPumpState = document.getElementById('kpiPumpState');
        const elPumpStatePill = document.getElementById('pumpStatePill');
        if (elPumpState && elPumpStatePill) {
            if (this.tags.estopActive) {
                elPumpState.textContent = 'E-STOPPED';
                elPumpState.style.color = '#ef4444';
                elPumpStatePill.textContent = 'TRIPPED';
                elPumpStatePill.className = 'status-pill danger';
            } else if (this.tags.pumpTrip) {
                elPumpState.textContent = 'OVERLOAD TRIP';
                elPumpState.style.color = '#ef4444';
                elPumpStatePill.textContent = 'FAULT';
                elPumpStatePill.className = 'status-pill danger';
            } else if (this.tags.pumpStatus) {
                elPumpState.textContent = 'RUNNING';
                elPumpState.style.color = '#10b981';
                elPumpStatePill.textContent = 'ACTIVE';
                elPumpStatePill.className = 'status-pill good';
            } else {
                elPumpState.textContent = 'STANDBY';
                elPumpState.style.color = '#94a3b8';
                elPumpStatePill.textContent = 'OFF';
                elPumpStatePill.className = 'status-pill info';
            }
        }

        const elPumpCurrent = document.getElementById('kpiPumpCurrent');
        if (elPumpCurrent) elPumpCurrent.textContent = this.tags.pumpCurrent.toFixed(1);

        const elSoilTemp = document.getElementById('kpiSoilTemp');
        if (elSoilTemp) elSoilTemp.textContent = this.tags.soilTemp.toFixed(1);

        // Status Pills
        const elTankPill = document.getElementById('tankLevelPill');
        if (elTankPill) {
            if (this.tags.tankLevel <= this.setpoints.tankCutoff) {
                elTankPill.textContent = 'CRITICAL LOW';
                elTankPill.className = 'status-pill danger';
            } else if (this.tags.tankLevel <= this.setpoints.tankRefillTrigger) {
                elTankPill.textContent = 'LOW LEVEL';
                elTankPill.className = 'status-pill warn';
            } else {
                elTankPill.textContent = 'NORMAL';
                elTankPill.className = 'status-pill good';
            }
        }

        const elSoilPill = document.getElementById('soilMoisturePill');
        if (elSoilPill) {
            if (this.tags.soilMoisture <= this.setpoints.soilMin) {
                elSoilPill.textContent = 'DRY (IRRIG)';
                elSoilPill.className = 'status-pill warn';
            } else if (this.tags.soilMoisture >= this.setpoints.soilTarget) {
                elSoilPill.textContent = 'OPTIMAL WET';
                elSoilPill.className = 'status-pill good';
            } else {
                elSoilPill.textContent = 'BALANCED';
                elSoilPill.className = 'status-pill good';
            }
        }

        // 2. Control Pane Decisions & Logic Box
        const elLogicStatus = document.getElementById('logicStatusText');
        const elLogicReason = document.getElementById('logicReasonText');
        const elLogicInterlock = document.getElementById('logicInterlockText');

        if (elLogicStatus && elLogicReason && elLogicInterlock) {
            if (this.tags.estopActive) {
                elLogicStatus.textContent = 'EMERGENCY STOPPED';
                elLogicStatus.style.color = '#ef4444';
                elLogicReason.textContent = 'Operator triggered emergency lockout.';
            } else if (this.tags.pumpTrip) {
                elLogicStatus.textContent = 'MOTOR THERMAL FAULT';
                elLogicStatus.style.color = '#ef4444';
                elLogicReason.textContent = 'Motor thermal overload trip.';
            } else if (this.tags.tankLevel <= this.setpoints.tankCutoff) {
                elLogicStatus.textContent = 'INTERLOCK INHIBITED';
                elLogicStatus.style.color = '#ef4444';
                elLogicReason.textContent = `Tank level (${this.tags.tankLevel.toFixed(1)}%) <= Min Cutoff (${this.setpoints.tankCutoff}%).`;
            } else if (this.tags.mode === 'AUTO') {
                if (this.tags.pumpStatus) {
                    elLogicStatus.textContent = 'AUTO - IRRIGATING';
                    elLogicStatus.style.color = '#10b981';
                    elLogicReason.textContent = `Soil (${this.tags.soilMoisture.toFixed(1)}%) < Setpoint (${this.setpoints.soilMin}%).`;
                } else {
                    elLogicStatus.textContent = 'AUTO - STANDBY';
                    elLogicStatus.style.color = '#38bdf8';
                    elLogicReason.textContent = `Soil (${this.tags.soilMoisture.toFixed(1)}%) is within nominal bounds.`;
                }
            } else if (this.tags.mode === 'MANUAL') {
                elLogicStatus.textContent = 'MANUAL OVERRIDE';
                elLogicStatus.style.color = '#f59e0b';
                elLogicReason.textContent = 'Operator manual control active.';
            } else {
                elLogicStatus.textContent = 'SCHEDULED MODE';
                elLogicStatus.style.color = '#0284c7';
                elLogicReason.textContent = 'Irrigation timer sequence active.';
            }

            if (this.tags.tankLevel <= this.setpoints.tankCutoff) {
                elLogicInterlock.textContent = 'TRIPPED (LOW TANK)';
                elLogicInterlock.style.color = '#ef4444';
            } else {
                elLogicInterlock.textContent = 'OK (PERMISSIVE)';
                elLogicInterlock.style.color = '#10b981';
            }
        }

        // Toggle Switch Sync
        const elTogglePump = document.getElementById('togglePumpManual');
        if (elTogglePump && document.activeElement !== elTogglePump) {
            elTogglePump.checked = this.tags.pumpStatus;
            elTogglePump.disabled = (this.tags.mode === 'AUTO' || this.tags.estopActive);
        }

        const elToggleValveZone = document.getElementById('toggleValveZone');
        if (elToggleValveZone && document.activeElement !== elToggleValveZone) {
            elToggleValveZone.checked = this.tags.valveZoneStatus;
            elToggleValveZone.disabled = (this.tags.mode === 'AUTO' || this.tags.estopActive);
        }

        const elToggleValveInlet = document.getElementById('toggleValveInlet');
        if (elToggleValveInlet && document.activeElement !== elToggleValveInlet) {
            elToggleValveInlet.checked = this.tags.valveInletStatus;
        }

        // 3. SVG P&ID Dynamic MIMIC Updates
        this.renderSvgPid();
    }

    renderSvgPid() {
        // Tank Water Fill SVG (Tank height = 288px max, 0% = height 0, 100% = height 288)
        const elSvgWater = document.getElementById('svgTankWaterFill');
        const elSvgWave = document.getElementById('svgTankWave');
        if (elSvgWater && elSvgWave) {
            const maxFillHeight = 280;
            const fillHeight = (this.tags.tankLevel / 100) * maxFillHeight;
            const topY = 294 - fillHeight; // 294 is base bottom in SVG group

            elSvgWater.setAttribute('height', Math.max(0, fillHeight));
            elSvgWater.setAttribute('y', topY);

            elSvgWave.setAttribute('d', `M 6 ${topY} Q 43 ${topY - 5}, 80 ${topY} T 154 ${topY}`);
        }

        // Pipe Flow Animation CSS classes
        const elFlowInlet = document.getElementById('flowInlet');
        if (elFlowInlet) {
            elFlowInlet.className.baseVal = this.tags.valveInletStatus ? 'pipe-fluid-active' : 'pipe-fluid-inactive';
        }

        const isDischarging = (this.tags.pumpStatus && this.tags.valveZoneStatus && !this.tags.estopActive && !this.tags.pumpTrip);

        const elFlowSuction = document.getElementById('flowSuction');
        if (elFlowSuction) {
            elFlowSuction.className.baseVal = isDischarging ? 'pipe-fluid-active' : 'pipe-fluid-inactive';
        }

        const elFlowDischarge = document.getElementById('flowDischarge');
        if (elFlowDischarge) {
            elFlowDischarge.className.baseVal = isDischarging ? 'pipe-fluid-active' : 'pipe-fluid-inactive';
        }

        const elFlowHeader = document.getElementById('flowHeader');
        if (elFlowHeader) {
            elFlowHeader.className.baseVal = isDischarging ? 'pipe-fluid-active' : 'pipe-fluid-inactive';
        }

        // Pump Rotor & LED
        const elPumpGroup = document.getElementById('pumpGroup');
        const elPumpLed = document.getElementById('svgPumpLed');
        if (elPumpGroup && elPumpLed) {
            if (this.tags.estopActive || this.tags.pumpTrip) {
                elPumpGroup.className.baseVal = '';
                elPumpLed.setAttribute('fill', '#ef4444');
            } else if (this.tags.pumpStatus) {
                elPumpGroup.className.baseVal = 'pump-running';
                elPumpLed.setAttribute('fill', '#10b981');
            } else {
                elPumpGroup.className.baseVal = '';
                elPumpLed.setAttribute('fill', '#64748b');
            }
        }

        // Solenoid Valves
        const elValveInlet = document.getElementById('valveInletGroup');
        if (elValveInlet) {
            elValveInlet.className.baseVal = this.tags.valveInletStatus ? 'valve-open' : 'valve-closed';
        }

        const elValveZone = document.getElementById('valveZoneGroup');
        if (elValveZone) {
            elValveZone.className.baseVal = this.tags.valveZoneStatus ? 'valve-open' : 'valve-closed';
        }

        // Sprinkler Nozzle Spray Mist
        const elSprayers = document.getElementById('sprayEmittersGroup');
        if (elSprayers) {
            elSprayers.className.baseVal = isDischarging ? 'spray-active' : '';
        }

        // Plant perkiness & Leaf colors based on Soil Moisture
        const soilGroup = document.getElementById('soilZoneGroup');
        if (soilGroup) {
            const plants = soilGroup.querySelectorAll('g[transform*="translate("]');
            plants.forEach(p => {
                if (p.querySelector('.plant-leaf')) {
                    if (this.tags.soilMoisture < 25) {
                        p.className.baseVal = 'plant-thirsty';
                    } else if (this.tags.soilMoisture > 80) {
                        p.className.baseVal = 'plant-saturated';
                    } else {
                        p.className.baseVal = 'plant-optimal';
                    }
                }
            });
        }
    }

    // =========================================================================
    // 4. REAL-TIME TRENDS (CHART.JS CONFIGURATION)
    // =========================================================================
    initCharts() {
        const initialLabels = Array.from({ length: 15 }, (_, i) => `${15 - i}s ago`);
        const initialSoilData = Array.from({ length: 15 }, () => 32.0);
        const initialPumpData = Array.from({ length: 15 }, () => 1);
        const initialTankData = Array.from({ length: 15 }, () => 78.5);
        const initialFlowData = Array.from({ length: 15 }, () => 24.5);

        // Chart 1: Soil Moisture & Pump Digital Status
        const ctxSoil = document.getElementById('soilTrendChart')?.getContext('2d');
        if (ctxSoil) {
            this.soilChart = new Chart(ctxSoil, {
                type: 'line',
                data: {
                    labels: initialLabels,
                    datasets: [
                        {
                            label: 'Soil Moisture (% VWC)',
                            data: initialSoilData,
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.12)',
                            fill: true,
                            tension: 0.35,
                            borderWidth: 2.5,
                            pointRadius: 0,
                            pointHoverRadius: 5,
                            yAxisID: 'y'
                        },
                        {
                            label: 'Pump State (1=ON, 0=OFF)',
                            data: initialPumpData,
                            borderColor: '#38bdf8',
                            borderDash: [4, 4],
                            stepped: true,
                            borderWidth: 2,
                            pointRadius: 0,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: '#0f172a',
                            titleColor: '#38bdf8',
                            bodyColor: '#f8fafc',
                            borderColor: '#334155',
                            borderWidth: 1
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(51, 65, 85, 0.25)' },
                            ticks: { color: '#64748b', font: { size: 10 } }
                        },
                        y: {
                            min: 0,
                            max: 100,
                            grid: { color: 'rgba(51, 65, 85, 0.25)' },
                            ticks: { color: '#10b981', font: { family: 'Orbitron', size: 10 } },
                            title: { display: true, text: 'Moisture (%)', color: '#10b981' }
                        },
                        y1: {
                            min: 0,
                            max: 1.2,
                            position: 'right',
                            grid: { drawOnChartArea: false },
                            ticks: {
                                color: '#38bdf8',
                                stepSize: 1,
                                callback: val => (val === 1 ? 'RUN' : (val === 0 ? 'STOP' : ''))
                            }
                        }
                    }
                }
            });
        }

        // Chart 2: Tank Level & Flow Rate
        const ctxTank = document.getElementById('tankTrendChart')?.getContext('2d');
        if (ctxTank) {
            this.tankChart = new Chart(ctxTank, {
                type: 'line',
                data: {
                    labels: initialLabels,
                    datasets: [
                        {
                            label: 'Tank Level (%)',
                            data: initialTankData,
                            borderColor: '#0284c7',
                            backgroundColor: 'rgba(2, 132, 199, 0.12)',
                            fill: true,
                            tension: 0.35,
                            borderWidth: 2.5,
                            pointRadius: 0,
                            yAxisID: 'y'
                        },
                        {
                            label: 'Flow Rate (L/min)',
                            data: initialFlowData,
                            borderColor: '#f59e0b',
                            borderWidth: 2,
                            tension: 0.2,
                            pointRadius: 0,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: '#0f172a',
                            titleColor: '#38bdf8',
                            bodyColor: '#f8fafc',
                            borderColor: '#334155',
                            borderWidth: 1
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(51, 65, 85, 0.25)' },
                            ticks: { color: '#64748b', font: { size: 10 } }
                        },
                        y: {
                            min: 0,
                            max: 100,
                            grid: { color: 'rgba(51, 65, 85, 0.25)' },
                            ticks: { color: '#0284c7', font: { family: 'Orbitron', size: 10 } },
                            title: { display: true, text: 'Level (%)', color: '#0284c7' }
                        },
                        y1: {
                            min: 0,
                            max: 40,
                            position: 'right',
                            grid: { drawOnChartArea: false },
                            ticks: { color: '#f59e0b', font: { family: 'Orbitron', size: 10 } },
                            title: { display: true, text: 'Flow (L/min)', color: '#f59e0b' }
                        }
                    }
                }
            });
        }
    }

    updateTrends() {
        const timeLabel = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        if (this.soilChart) {
            const dataSoil = this.soilChart.data.datasets[0].data;
            const dataPump = this.soilChart.data.datasets[1].data;
            const labels = this.soilChart.data.labels;

            labels.push(timeLabel);
            dataSoil.push(this.tags.soilMoisture);
            dataPump.push(this.tags.pumpStatus ? 1 : 0);

            if (labels.length > this.maxChartPoints) {
                labels.shift();
                dataSoil.shift();
                dataPump.shift();
            }
            this.soilChart.update('none');
        }

        if (this.tankChart) {
            const dataTank = this.tankChart.data.datasets[0].data;
            const dataFlow = this.tankChart.data.datasets[1].data;
            const labels = this.tankChart.data.labels;

            labels.push(timeLabel);
            dataTank.push(this.tags.tankLevel);
            dataFlow.push(this.tags.flowRate);

            if (labels.length > this.maxChartPoints) {
                labels.shift();
                dataTank.shift();
                dataFlow.shift();
            }
            this.tankChart.update('none');
        }
    }

    // =========================================================================
    // 5. ISA-18.2 ALARM & EVENT MANAGEMENT
    // =========================================================================
    triggerAlarm(tag, message, severity = 'CRITICAL') {
        const now = new Date().toLocaleTimeString('id-ID');
        this.activeAlarm = {
            id: 'ALM_' + Date.now(),
            tag: tag,
            message: message,
            severity: severity,
            timestamp: now,
            acked: false
        };

        // Update Alarm Banner
        const banner = document.getElementById('activeAlarmBanner');
        const badge = document.getElementById('alarmBadge');
        const msg = document.getElementById('alarmBannerMessage');

        if (banner && badge && msg) {
            badge.textContent = `${severity} ALARM`;
            msg.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>[${tag}] ${message}</span>`;
            banner.classList.add('active');
        }

        // Start Sound Horn
        this.startAlarmHorn();

        // Log into Historian Table
        this.logEvent(tag, message, severity, 'ACTIVE');
    }

    acknowledgeAlarm() {
        if (!this.activeAlarm) return;
        this.activeAlarm.acked = true;
        this.stopAlarmHorn();

        const badge = document.getElementById('alarmBadge');
        if (badge) {
            badge.textContent = 'ACKNOWLEDGED';
            badge.style.background = '#f59e0b';
        }

        this.playUiBeep(1200, 'sine', 0.1);
        this.logEvent(this.activeAlarm.tag, `Alarm acknowledged by operator.`, 'ACTION', 'ACKNOWLEDGED');
    }

    silenceAlarm() {
        this.stopAlarmHorn();
        this.playUiBeep(600, 'sine', 0.08);
    }

    clearActiveAlarm(clearReason = '') {
        if (!this.activeAlarm) return;

        const tag = this.activeAlarm.tag;
        this.activeAlarm = null;
        this.stopAlarmHorn();

        const banner = document.getElementById('activeAlarmBanner');
        if (banner) {
            banner.classList.remove('active');
        }

        this.logEvent(tag, `Alarm condition cleared. ${clearReason}`, 'INFO', 'CLEARED');
    }

    logEvent(tag, message, severity = 'INFO', valueState = 'NOMINAL') {
        const timestamp = new Date().toLocaleTimeString('id-ID', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 2
        });

        const entry = {
            id: Date.now() + Math.random(),
            timestamp: timestamp,
            tag: tag,
            severity: severity,
            message: message,
            valueState: valueState,
            status: 'LOGGED'
        };

        this.alarmHistory.unshift(entry);
        if (this.alarmHistory.length > 100) {
            this.alarmHistory.pop();
        }

        this.renderEventLogTable();
    }

    renderEventLogTable() {
        const tbody = document.getElementById('eventLogTableBody');
        if (!tbody) return;

        let filtered = this.alarmHistory;
        if (this.currentLogFilter === 'CRITICAL') {
            filtered = this.alarmHistory.filter(e => e.severity === 'CRITICAL');
        } else if (this.currentLogFilter === 'WARNING') {
            filtered = this.alarmHistory.filter(e => e.severity === 'WARNING');
        } else if (this.currentLogFilter === 'ACTION') {
            filtered = this.alarmHistory.filter(e => e.severity === 'ACTION');
        }

        tbody.innerHTML = filtered.map(item => {
            let sevClass = 'severity-info';
            if (item.severity === 'CRITICAL') sevClass = 'severity-critical';
            else if (item.severity === 'WARNING') sevClass = 'severity-warning';
            else if (item.severity === 'ACTION') sevClass = 'severity-normal';

            return `
                <tr>
                    <td style="font-family: var(--font-mono); color: #94a3b8;">${item.timestamp}</td>
                    <td><strong style="color: var(--telemetry-cyan); font-family: var(--font-mono);">${item.tag}</strong></td>
                    <td><span class="severity-pill ${sevClass}">${item.severity}</span></td>
                    <td>${item.message}</td>
                    <td style="font-family: var(--font-mono); font-weight: 600;">${item.valueState}</td>
                    <td><span style="color: #64748b; font-size: 0.72rem;">OK</span></td>
                </tr>
            `;
        }).join('');
    }

    filterLogs(filterType) {
        this.currentLogFilter = filterType;
        document.querySelectorAll('.filter-tag-btn').forEach(btn => {
            btn.classList.toggle('active', btn.textContent.includes(filterType) || (filterType === 'ALL' && btn.textContent.includes('ALL')));
        });
        this.renderEventLogTable();
        this.playUiBeep(900, 'sine', 0.05);
    }

    clearLogTable() {
        this.alarmHistory = [];
        this.renderEventLogTable();
        this.playUiBeep(400, 'sine', 0.1);
    }

    exportLogCsv() {
        if (this.alarmHistory.length === 0) {
            alert('No log entries to export.');
            return;
        }

        let csv = 'Timestamp,Tag ID,Severity,Message,State\n';
        this.alarmHistory.forEach(row => {
            csv += `"${row.timestamp}","${row.tag}","${row.severity}","${row.message.replace(/"/g, '""')}","${row.valueState}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `SCADA_SOE_LOG_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        this.playUiBeep(1200, 'sine', 0.1);
    }

    // =========================================================================
    // 6. OPERATOR CONTROLS & MANUAL ACTIONS
    // =========================================================================
    setControlMode(mode) {
        this.tags.mode = mode;
        this.playUiBeep(1000, 'sine', 0.08);

        // Update Button UI
        document.getElementById('btnModeAuto')?.classList.toggle('active', mode === 'AUTO');
        document.getElementById('btnModeManual')?.classList.toggle('active', mode === 'MANUAL');
        document.getElementById('btnModeSchedule')?.classList.toggle('active', mode === 'SCHEDULE');

        const badge = document.getElementById('currentModeBadge');
        if (badge) {
            badge.textContent = mode + (mode === 'AUTO' ? '-IRRIG' : '');
            badge.style.color = (mode === 'AUTO' ? '#a855f7' : (mode === 'MANUAL' ? '#f59e0b' : '#38bdf8'));
        }

        this.logEvent('MODE_CHG', `Operator changed SCADA control mode to ${mode}`, 'ACTION', mode);

        if (window.scadaMqtt) {
            window.scadaMqtt.publishCommand({ action: 'SET_MODE', mode: mode });
        }

        this.renderAll();
    }

    handleManualPumpToggle(isChecked) {
        if (this.tags.estopActive) {
            alert('Cannot start pump while EMERGENCY STOP is active!');
            this.renderAll();
            return;
        }

        if (isChecked && this.tags.tankLevel <= this.setpoints.tankCutoff) {
            alert('Interlock Active: Reservoir water level too low to start pump safely!');
            this.renderAll();
            return;
        }

        this.tags.pumpStatus = isChecked;
        this.playUiBeep(isChecked ? 1100 : 500, 'sine', 0.1);
        this.logEvent('P-101', `Operator manually toggled Pump P-101 to ${isChecked ? 'ON' : 'OFF'}`, 'ACTION', isChecked ? 'RUNNING' : 'STOPPED');

        if (window.scadaMqtt) {
            window.scadaMqtt.publishCommand({ action: 'PUMP_OVERRIDE', state: isChecked });
        }
        this.renderAll();
    }

    handleManualValveToggle(valveType, isChecked) {
        if (valveType === 'zone') {
            this.tags.valveZoneStatus = isChecked;
            this.logEvent('XV-201', `Operator toggled Zone Irrigation Valve XV-201 ${isChecked ? 'OPEN' : 'CLOSED'}`, 'ACTION', isChecked ? 'OPEN' : 'CLOSED');
        } else if (valveType === 'inlet') {
            this.tags.valveInletStatus = isChecked;
            this.logEvent('XV-101', `Operator toggled Refill Valve XV-101 ${isChecked ? 'OPEN' : 'CLOSED'}`, 'ACTION', isChecked ? 'OPEN' : 'CLOSED');
        }
        this.playUiBeep(800, 'sine', 0.08);
        this.renderAll();
    }

    toggleEmergencyStop() {
        this.tags.estopActive = !this.tags.estopActive;
        const btn = document.getElementById('btnEstop');

        if (this.tags.estopActive) {
            this.tags.pumpStatus = false;
            this.tags.valveZoneStatus = false;
            if (btn) btn.classList.add('tripped');
            this.triggerAlarm('E-STOP', 'EMERGENCY STOP BUTTON ENGAGED! All actuators locked in fail-safe state.', 'CRITICAL');
        } else {
            if (btn) btn.classList.remove('tripped');
            this.clearActiveAlarm('Emergency stop released by operator.');
            this.logEvent('E-STOP', 'Emergency stop reset by operator.', 'ACTION', 'RELEASED');
        }
        this.renderAll();
    }

    updateSetpoint(spName, val) {
        const num = parseFloat(val);
        if (spName === 'soilMin') {
            this.setpoints.soilMin = num;
            const el = document.getElementById('spSoilMinVal');
            if (el) el.textContent = num + ' %';
        } else if (spName === 'soilTarget') {
            this.setpoints.soilTarget = num;
            const el = document.getElementById('spSoilTargetVal');
            if (el) el.textContent = num + ' %';
        } else if (spName === 'tankCutoff') {
            this.setpoints.tankCutoff = num;
            const el = document.getElementById('spTankCutoffVal');
            if (el) el.textContent = num + ' %';
        }
    }

    // =========================================================================
    // 7. DEMO SCENARIO SIMULATORS (TESTING SUITE)
    // =========================================================================
    simulateDrySoil() {
        this.tags.soilMoisture = 19.5;
        this.logEvent('SIM_TEST', 'Applied test scenario: DRY SOIL (<20%). Auto-irrigation should trigger.', 'WARNING', 'DRY_SOIL');
        this.playUiBeep(1200, 'triangle', 0.2);
        this.renderAll();
    }

    simulateLowTank() {
        this.tags.tankLevel = 9.8;
        this.logEvent('SIM_TEST', 'Applied test scenario: LOW RESERVOIR TANK (<10%). Dry-run interlock test.', 'WARNING', 'LOW_TANK');
        this.playUiBeep(440, 'sawtooth', 0.25);
        this.renderAll();
    }

    simulateRain() {
        this.tags.soilMoisture = 86.0;
        this.tags.tankLevel = Math.min(100, this.tags.tankLevel + 15);
        this.logEvent('SIM_TEST', 'Applied test scenario: NATURAL RAIN. Soil moisture saturated, tank replenished.', 'INFO', 'RAIN_EVENT');
        this.playUiBeep(900, 'sine', 0.15);
        this.renderAll();
    }

    simulateRefillTank() {
        this.tags.valveInletStatus = true;
        this.logEvent('SIM_TEST', 'Refill valve XV-101 opened for tank replenishment.', 'INFO', 'REFILLING');
        this.playUiBeep(800, 'sine', 0.1);
        this.renderAll();
    }

    simulatePumpTrip() {
        this.tags.pumpTrip = !this.tags.pumpTrip;
        if (this.tags.pumpTrip) {
            this.tags.pumpStatus = false;
            this.triggerAlarm('P-101', 'PUMP MOTOR THERMAL OVERLOAD RELAY TRIPPED! Motor isolated.', 'CRITICAL');
        } else {
            this.clearActiveAlarm('Pump thermal overload relay reset.');
            this.logEvent('P-101', 'Pump overload relay reset.', 'ACTION', 'RESET');
        }
        this.renderAll();
    }

    resetBaseline() {
        this.tags.tankLevel = 78.5;
        this.tags.soilMoisture = 32.0;
        this.tags.pressure = 2.84;
        this.tags.flowRate = 24.5;
        this.tags.pumpStatus = true;
        this.tags.valveZoneStatus = true;
        this.tags.valveInletStatus = false;
        this.tags.estopActive = false;
        this.tags.pumpTrip = false;
        this.tags.mode = 'AUTO';

        const btnEstop = document.getElementById('btnEstop');
        if (btnEstop) btnEstop.classList.remove('tripped');

        this.clearActiveAlarm('System baseline reset to normal.');
        this.logEvent('SIM_TEST', 'SCADA parameters restored to normal baseline.', 'INFO', 'BASELINE_RESET');
        this.playUiBeep(1000, 'sine', 0.15);
        this.renderAll();
    }

    // =========================================================================
    // 8. TELEMETRY INGESTION FROM MQTT HARDWARE
    // =========================================================================
    applyHardwareTelemetry(hwData) {
        if (typeof hwData.tankLevel === 'number') this.tags.tankLevel = hwData.tankLevel;
        if (typeof hwData.soilMoisture === 'number') this.tags.soilMoisture = hwData.soilMoisture;
        if (typeof hwData.pressure === 'number') this.tags.pressure = hwData.pressure;
        if (typeof hwData.flowRate === 'number') this.tags.flowRate = hwData.flowRate;
        if (typeof hwData.soilTemp === 'number') this.tags.soilTemp = hwData.soilTemp;
        if (typeof hwData.pumpStatus === 'boolean') this.tags.pumpStatus = hwData.pumpStatus;

        this.renderAll();
    }

    // =========================================================================
    // 9. EVENT LISTENERS & CLOCK
    // =========================================================================
    bindEvents() {
        // Sound toggle
        document.getElementById('btnSoundToggle')?.addEventListener('click', () => {
            this.tags.audioEnabled = !this.tags.audioEnabled;
            const soundIcon = document.getElementById('soundIcon');
            const soundText = document.getElementById('soundText');
            if (soundIcon && soundText) {
                soundIcon.className = this.tags.audioEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
                soundText.textContent = this.tags.audioEnabled ? 'Audio: ON' : 'Audio: MUTE';
            }
            this.playUiBeep(1000, 'sine', 0.05);
        });

        // Alarm Ack & Silence
        document.getElementById('btnAckAlarm')?.addEventListener('click', () => this.acknowledgeAlarm());
        document.getElementById('btnSilenceAlarm')?.addEventListener('click', () => this.silenceAlarm());

        // Simulator buttons
        document.getElementById('btnSimDrySoil')?.addEventListener('click', () => this.simulateDrySoil());
        document.getElementById('btnSimLowTank')?.addEventListener('click', () => this.simulateLowTank());
        document.getElementById('btnSimRain')?.addEventListener('click', () => this.simulateRain());
        document.getElementById('btnSimRefillTank')?.addEventListener('click', () => this.simulateRefillTank());
        document.getElementById('btnSimPumpTrip')?.addEventListener('click', () => this.simulatePumpTrip());
        document.getElementById('btnSimReset')?.addEventListener('click', () => this.resetBaseline());

        // Fullscreen Toggle
        document.getElementById('btnFullscreen')?.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        });

        // MQTT Modal
        document.getElementById('btnMqttSettings')?.addEventListener('click', () => {
            document.getElementById('mqttModal')?.classList.add('open');
        });
    }

    closeMqttModal() {
        document.getElementById('mqttModal')?.classList.remove('open');
    }

    startClock() {
        const clockEl = document.getElementById('scadaClock');
        const update = () => {
            if (clockEl) {
                const now = new Date();
                clockEl.textContent = now.toLocaleTimeString('id-ID', { hour12: false }) + ' WIB';
            }
        };
        update();
        setInterval(update, 1000);
    }
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
    window.scadaApp = new ScadaApplication();
});
