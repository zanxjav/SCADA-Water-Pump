/**
 * ============================================================================
 * SCADA AQUASMART - INDUSTRIAL MQTT CLIENT MODULE
 * Protocol: MQTT over WebSockets (MQTT.js)
 * Purpose: Bridge IoT/ESP32/PLC hardware telemetry with SCADA State Engine
 * ============================================================================
 */

class ScadaMqttManager {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.config = {
            host: 'wss://broker.hivemq.com:8884/mqtt',
            clientId: 'SCADA_AquaSmart_' + Math.random().toString(16).substring(2, 8),
            qos: 1,
            topicTelemetry: 'scada/aquasmart/telemetry',
            topicControl: 'scada/aquasmart/control',
            topicAlarm: 'scada/aquasmart/alarm'
        };
        this.packetCount = { rx: 0, tx: 0 };
    }

    /**
     * Initialize connection with configured broker
     */
    connect(customConfig = {}) {
        this.config = { ...this.config, ...customConfig };

        // Update UI indicator
        this.updateStatusUi('CONNECTING', '#f59e0b');

        try {
            if (typeof mqtt === 'undefined') {
                console.warn('[MQTT] MQTT.js library not loaded. Running in local simulation mode.');
                this.updateStatusUi('SIMULATOR', '#38bdf8');
                return;
            }

            console.log(`[MQTT] Connecting to ${this.config.host} with clientId ${this.config.clientId}...`);

            const options = {
                clientId: this.config.clientId,
                clean: true,
                connectTimeout: 5000,
                reconnectPeriod: 4000,
                keepalive: 30
            };

            this.client = mqtt.connect(this.config.host, options);

            this.client.on('connect', () => {
                this.isConnected = true;
                console.log('[MQTT] Connected successfully to broker.');
                this.updateStatusUi('ONLINE', '#10b981');

                // Subscribe to Telemetry and Alarm topics
                this.client.subscribe(this.config.topicTelemetry, { qos: this.config.qos }, (err) => {
                    if (!err) console.log(`[MQTT] Subscribed to ${this.config.topicTelemetry}`);
                });

                this.client.subscribe(this.config.topicAlarm, { qos: this.config.qos });

                if (window.scadaApp) {
                    window.scadaApp.logEvent('MQTT_CONN', 'MQTT Broker connection established', 'INFO', 'ONLINE');
                }
            });

            this.client.on('message', (topic, payload) => {
                this.packetCount.rx++;
                try {
                    const message = JSON.parse(payload.toString());
                    this.handleIncomingPayload(topic, message);
                } catch (e) {
                    console.error('[MQTT] Failed to parse JSON message:', e);
                }
            });

            this.client.on('error', (err) => {
                console.error('[MQTT] Connection Error:', err);
                this.isConnected = false;
                this.updateStatusUi('ERROR', '#ef4444');
            });

            this.client.on('close', () => {
                this.isConnected = false;
                this.updateStatusUi('STANDALONE SIM', '#38bdf8');
            });

            this.client.on('offline', () => {
                this.isConnected = false;
                this.updateStatusUi('OFFLINE', '#ef4444');
            });

        } catch (error) {
            console.error('[MQTT] Connection initialization exception:', error);
            this.updateStatusUi('STANDALONE SIM', '#38bdf8');
        }
    }

    /**
     * Handle incoming parsed JSON payloads from hardware
     */
    handleIncomingPayload(topic, data) {
        if (!window.scadaApp) return;

        if (topic === this.config.topicTelemetry) {
            // Update SCADA state with hardware values if available
            window.scadaApp.applyHardwareTelemetry(data);
        } else if (topic === this.config.topicAlarm) {
            if (data.alarmText) {
                window.scadaApp.triggerAlarm(data.tag || 'ALM-HW', data.alarmText, data.severity || 'CRITICAL');
            }
        }
    }

    /**
     * Publish supervisory commands (Pump ON/OFF, Setpoints, Valves) to hardware
     */
    publishCommand(commandPayload) {
        if (!this.isConnected || !this.client) {
            // In simulation mode, no hardware publish required
            return;
        }

        try {
            const payloadStr = JSON.stringify({
                ...commandPayload,
                timestamp: new Date().toISOString(),
                sender: 'SCADA_HMI_OPERATOR'
            });

            this.client.publish(this.config.topicControl, payloadStr, { qos: this.config.qos }, (err) => {
                if (err) {
                    console.error('[MQTT] Publish error:', err);
                } else {
                    this.packetCount.tx++;
                }
            });
        } catch (e) {
            console.error('[MQTT] Publish exception:', e);
        }
    }

    /**
     * Disconnect from broker
     */
    disconnect() {
        if (this.client) {
            this.client.end(true);
            this.isConnected = false;
            this.updateStatusUi('DISCONNECTED', '#64748b');
            if (window.scadaApp) {
                window.scadaApp.logEvent('MQTT_DISC', 'MQTT Broker manually disconnected by operator', 'INFO', 'DISCONNECTED');
            }
        }
    }

    /**
     * Connect triggered from Modal Form
     */
    connectFromModal() {
        const host = document.getElementById('mqttHost')?.value.trim();
        const clientId = document.getElementById('mqttClientId')?.value.trim();
        const qos = parseInt(document.getElementById('mqttQos')?.value || '1', 10);
        const topicTelemetry = document.getElementById('mqttTopicTelemetry')?.value.trim();
        const topicControl = document.getElementById('mqttTopicControl')?.value.trim();
        const topicAlarm = document.getElementById('mqttTopicAlarm')?.value.trim();

        this.disconnect();

        this.connect({
            host: host || this.config.host,
            clientId: clientId || this.config.clientId,
            qos: qos,
            topicTelemetry: topicTelemetry || this.config.topicTelemetry,
            topicControl: topicControl || this.config.topicControl,
            topicAlarm: topicAlarm || this.config.topicAlarm
        });

        if (window.scadaApp) {
            window.scadaApp.closeMqttModal();
        }
    }

    /**
     * Helper to update Topbar MQTT status text
     */
    updateStatusUi(statusText, color) {
        const el = document.getElementById('mqttStatusText');
        if (el) {
            el.textContent = statusText;
            el.style.color = color;
        }
    }
}

// Instantiate global MQTT client
window.scadaMqtt = new ScadaMqttManager();
