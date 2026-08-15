# SCADA-AQUASMART 💧🌱
### Industrial SCADA Water Storage Monitoring & Smart Automated Irrigation System
**Standard Compliance: ISA-101 (High Performance HMI) & ISA-18.2 (Alarm Management)**

![SCADA AquaSmart HMI](https://img.shields.io/badge/Standard-ISA--101%20HMI-0284c7?style=for-the-badge)
![Alarm Standard](https://img.shields.io/badge/Alarms-ISA--18.2-ef4444?style=for-the-badge)
![Protocol](https://img.shields.io/badge/IoT%20Protocol-MQTT%20WebSockets-10b981?style=for-the-badge)
![Deployment](https://img.shields.io/badge/Hosting-Firebase%20Ready-f59e0b?style=for-the-badge)

---

## 📖 Ringkasan Proyek

**SCADA-AquaSmart** adalah aplikasi Web HMI / SCADA modern berstandar internasional yang dirancang untuk memantau volume air pada tangki penampungan (*water reservoir tank*) serta mengontrol sistem irigasi presisi otomatis berbasis sensor kelembapan tanah tanaman (*soil moisture sensor*).

Sistem ini mengadopsi prinsip desain **ISA-101 High Performance HMI** dengan palet warna kontras tinggi yang ramah untuk pengawasan 24/7 di ruang kendali (*control room*), dilengkapi sistem manajemen alarm **ISA-18.2**, diagram sinoptik P&ID vektor SVG dinamis, grafik tren real-time, dan konektivitas MQTT WebSocket untuk integrasi hardware ESP32 / Arduino / PLC.

---

## ✨ Fitur Unggulan

1. **Diagram Sinoptik P&ID Interaktif (*SVG Vector MIMIC*)**:
   - Tangki Penampungan Air (**TK-101**) dengan visual gelombang air dinamis, sensor level ultrasonik (**LT-101**), dan katup pengisian (**XV-101**).
   - Pompa Sentrifugal Distribusi (**P-101**) dengan putaran impeller simetris murni di tempat, pembacaan beban arus (*Amperes*), dan rpm.
   - Pipa beranimasi partikel alir fluida saat irigasi aktif.
   - Zona Tanaman & Sensor Kelembapan Tanah (**SM-201**) dengan visual tanaman adaptif dan semprotan kabut sprinkler aktif.
2. **Kontrol Otomatis (*Closed-Loop Controller & Safety Interlock*)**:
   - **Mode AUTO**: Penyiraman aktif otomatis saat kelembapan tanah $\le$ 35% dan berhenti otomatis saat mencapai target optimal 75%.
   - **Proteksi Pengaman Kavitasi (*Dry-Run Protection*)**: Pompa otomatis terkunci mati seketika jika air penampungan kritis $\le$ 15%.
   - **Mode MANUAL & SCHEDULE**: Override sakelar aktuator manual dan jadwal berkala.
   - **Tombol Darurat (*EMERGENCY STOP*)**: Lockout fisik semua aktuator.
3. **Alarm & Event Historian Berstandar ISA-18.2**:
   - Banner alarm visual kedip merah + Synthesizer Audio Horn (Web Audio API).
   - Tombol ACK, Silence, dan fitur **Export CSV** untuk data historis kejadian.
4. **Grafik Tren Real-Time (*Chart.js*)**:
   - Tren kelembapan tanah vs status pompa dan level air tangki vs laju debit air.
5. **Dual Mode (Hardware MQTT + Simulator Fisika Bawaan)**:
   - Modul WebSocket MQTT (**MQTT.js**) untuk ESP32/PLC.
   - Toolbar simulator uji skenario cepat (*Dry Soil, Low Tank, Rain, Trip Pump*).

---

## 🚀 Panduan Menjalankan Secara Lokal

1. Clone repositori:
   ```bash
   git clone https://github.com/zanxjav/SCADA-Water-Pump.git
   cd SCADA-Water-Pump
   ```
2. Jalankan lokal web server:
   ```bash
   # Menggunakan Python
   python -m http.server 8080

   # Atau menggunakan Node.js (npx serve)
   npx serve .
   ```
3. Buka browser di `http://localhost:8080`.

---

## 🔥 Panduan Deploy ke Firebase Hosting

Untuk men-deploy web dashboard ini ke Firebase Hosting:

1. **Install Firebase CLI** (jika belum terpasang):
   ```bash
   npm install -g firebase-tools
   ```
2. **Login ke Akun Firebase**:
   ```bash
   firebase login
   ```
3. **Inisialisasi Project Firebase**:
   ```bash
   firebase init hosting
   ```
   - Pilih *Use an existing project* atau *Create a new project*.
   - Saat ditanya *What do you want to use as your public directory?*, ketik `.` (titik untuk root directory) atau arahkan ke folder proyek ini.
   - Saat ditanya *Configure as a single-page app?*, pilih `No` (atau `Yes`).
   - Saat ditanya *Set up automatic builds and deploys with GitHub?*, pilih `No` (opsional).
4. **Deploy ke Hosting**:
   ```bash
   firebase deploy --only hosting
   ```
5. Website SCADA Anda akan langsung live dengan domain `https://<project-id>.web.app`!

---

## 📡 Format Payload MQTT (ESP32 / PLC Integration)

### Topic Telemetri (Subscribe JSON dari Hardware):
**Topic:** `scada/aquasmart/telemetry`
```json
{
  "tankLevel": 78.5,
  "soilMoisture": 32.0,
  "pressure": 2.84,
  "flowRate": 24.5,
  "soilTemp": 25.4,
  "pumpStatus": true
}
```

### Topic Kontrol (Publish JSON ke Aktuator Pompa/Katup):
**Topic:** `scada/aquasmart/control`
```json
{
  "action": "PUMP_OVERRIDE",
  "state": true,
  "sender": "SCADA_HMI_OPERATOR"
}
```

---

## 👤 Author
- **Fauzan SCADA Automation Engineering**
- GitHub: [@zanxjav](https://github.com/zanxjav)
