/*
 * ======================================================================================
 * AERO-SAT ONE - ESP32 DEDICATED SENSOR TELEMETRY FIRMWARE
 * ======================================================================================
 * Hardware Sensors Included:
 *   1. ESP32 Dev Board (Wi-Fi Access Point & High-Speed REST API Web Server)
 *   2. GPS Module (NEO-6M -> HardwareSerial 2: GPIO 16 RX / GPIO 17 TX)
 *   3. Waterproof Temperature Sensor (DS18B20 OneWire -> GPIO 4 with 4.7kΩ pull-up)
 *   4. Rain / Moisture Drop Sensor (Analog ADC1 -> GPIO 34) 
 *   5. Tilt Sensor (SW-520D Digital -> GPIO 18)
 *   6. LDR Light Sensor (Analog ADC1 -> GPIO 35)
 *   7. Voltage Sensor (0-25V Divider -> GPIO 32)
 *
 * Ground Station Link:
 *   - Wi-Fi AP: "AERO-SAT-AP" (Password: "satellite123")
 *   - Ground Station Endpoint: http://192.168.4.1/telemetry
 *   - Direct CORS enabled for web browser dashboard
 * ======================================================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <TinyGPS++.h>

// --------------------------------------------------------------------------------------
// 1. PIN DEFINITIONS (ALL ANALOG ON ADC1 TO PREVENT WI-FI ADC CONFLICTS)
// --------------------------------------------------------------------------------------

// Waterproof DS18B20 Temperature Sensor (OneWire Digital Bus)
#define ONE_WIRE_BUS_PIN     4    // GPIO 4 (Requires 4.7kΩ pull-up resistor to 3.3V)

// Tilt Sensor (SW-520D Ball Tilt Switch Digital Output)
#define TILT_SENSOR_PIN      18   // GPIO 18 (Digital input with internal pullup)

// Analog Sensors (ESP32 ADC1 Pins - Safe with Wi-Fi)
#define RAIN_ANALOG_PIN      34   // GPIO 34 (ADC1_CH6 - Rain drop sensor AO)
#define LDR_ANALOG_PIN       35   // GPIO 35 (ADC1_CH7 - Photoresistor AO)
#define VOLTAGE_ANALOG_PIN   32   // GPIO 32 (ADC1_CH4 - 0-25V Voltage sensor S)

// GPS Module (NEO-6M Serial UART on HardwareSerial 2)
#define GPS_RX_PIN           16   // GPIO 16 (ESP32 RX2 <- GPS TX)
#define GPS_TX_PIN           17   // GPIO 17 (ESP32 TX2 -> GPS RX)

// --------------------------------------------------------------------------------------
// 2. CONFIGURATION & CONSTANTS
// --------------------------------------------------------------------------------------

// Wi-Fi Soft Access Point Credentials
const char* ap_ssid     = "AERO-SAT-AP";
const char* ap_password = "satellite123";

// Voltage Sensor Calibration Factor
// Standard 0-25V sensor uses R1=30kΩ and R2=7.5kΩ -> Divider ratio = (30+7.5)/7.5 = 5.0
const float VOLTAGE_DIVIDER_RATIO = 5.0;
const float ADC_REF_VOLTAGE       = 3.3;

// --------------------------------------------------------------------------------------
// 3. OBJECT INSTANCES
// --------------------------------------------------------------------------------------

WebServer server(80);
OneWire oneWire(ONE_WIRE_BUS_PIN);
DallasTemperature tempSensor(&oneWire);
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// --------------------------------------------------------------------------------------
// 4. TELEMETRY STATE VARIABLES
// --------------------------------------------------------------------------------------

// Temperature
float temperatureC = 25.0;

// Rain Sensor
int rainRaw = 3800;       // 4095 = bone dry, ~1000 = heavy water
int rainPercent = 0;      // 0% to 100%

// LDR Light Sensor
int ldrRaw = 2000;        // 0 to 4095
int ldrLux = 500;         // Calculated Lux (0 to 1000)

// Voltage & Battery
float batteryVoltage = 4.10;
int batteryPercent = 90;

// Tilt Sensor & Attitude
int tiltState = 0;        // 0 = Level, 1 = Tilted
String tiltStatus = "LEVEL";
float pitchAngle = 0.0;
float rollAngle = 0.0;
int headingDeg = 142;

// GPS Coordinates & Status
double gpsLat = 12.971598;
double gpsLon = 77.594562;
float gpsAlt = 920.0;
float gpsSpeed = 0.0;
int gpsSats = 0;

// --------------------------------------------------------------------------------------
// 5. SENSOR ACQUISITION LOGIC
// --------------------------------------------------------------------------------------

void readSensors() {
  // --- A. Waterproof Temperature (DS18B20) ---
  tempSensor.requestTemperatures();
  float readTemp = tempSensor.getTempCByIndex(0);
  if (readTemp > -50.0 && readTemp < 125.0 && readTemp != DEVICE_DISCONNECTED_C) {
    temperatureC = readTemp;
  }

  // --- B. Rain Sensor (Analog) ---
  rainRaw = analogRead(RAIN_ANALOG_PIN);
  // Invert and map: 4095 (Dry) -> 0%, 1000 (Submerged) -> 100%
  rainPercent = map(constrain(rainRaw, 1000, 4095), 4095, 1000, 0, 100);

  // --- C. LDR Light Sensor (Analog) ---
  ldrRaw = analogRead(LDR_ANALOG_PIN);
  ldrLux = map(constrain(ldrRaw, 0, 4095), 0, 4095, 0, 1000);

  // --- D. Voltage Sensor (Analog 0-25V Module) ---
  int voltAdc = analogRead(VOLTAGE_ANALOG_PIN);
  float pinVoltage = (voltAdc / 4095.0) * ADC_REF_VOLTAGE;
  batteryVoltage = pinVoltage * VOLTAGE_DIVIDER_RATIO;
  
  // Estimate battery percentage for standard Li-Ion / 1S-2S pack or 5V rail
  // (Assuming single 1S LiPo: 3.2V = 0%, 4.2V = 100%. Adjust thresholds for your pack)
  if (batteryVoltage >= 3.0 && batteryVoltage <= 4.3) {
    batteryPercent = map(constrain((int)(batteryVoltage * 100), 320, 420), 320, 420, 0, 100);
  } else if (batteryVoltage > 4.3) {
    // For 2S or 9V/12V batteries, simple proportional clamp
    batteryPercent = constrain((int)((batteryVoltage / 12.6) * 100), 0, 100);
  } else {
    batteryPercent = constrain((int)((batteryVoltage / 4.2) * 100), 0, 100);
  }

  // --- E. Tilt Sensor (Digital SW-520D) ---
  // When upright/level, switch is open (HIGH with pull-up). When tilted, switch closes (LOW).
  int rawTilt = digitalRead(TILT_SENSOR_PIN);
  if (rawTilt == LOW) {
    tiltState = 1;
    tiltStatus = "TILTED";
    pitchAngle = 38.5; // Visually reflects tilt in ground HUD
    rollAngle = 14.2;
  } else {
    tiltState = 0;
    tiltStatus = "LEVEL";
    pitchAngle = 0.0;
    rollAngle = 0.0;
  }

  // --- F. GPS NMEA Parser (NEO-6M UART) ---
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  if (gps.location.isValid()) {
    gpsLat = gps.location.lat();
    gpsLon = gps.location.lng();
    gpsAlt = gps.altitude.meters();
    gpsSpeed = gps.speed.kmph();
    gpsSats = gps.satellites.value();
  }
}

// --------------------------------------------------------------------------------------
// 6. REST API & TELEMETRY JSON DISPATCHER (CORS ENABLED)
// --------------------------------------------------------------------------------------

void sendCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
}

void handleTelemetryJson() {
  sendCorsHeaders();

  // Construct comprehensive JSON telemetry response for the dashboard
  String json = "{";
  json += "\"temp\":" + String(temperatureC, 1) + ",";
  json += "\"rain\":" + String(rainPercent) + ",";
  json += "\"rainRaw\":" + String(rainRaw) + ",";
  json += "\"ldr\":" + String(ldrLux) + ",";
  json += "\"ldrRaw\":" + String(ldrRaw) + ",";
  json += "\"voltage\":" + String(batteryVoltage, 2) + ",";
  json += "\"battery\":" + String(batteryPercent) + ",";
  json += "\"tilt\":" + String(tiltState) + ",";
  json += "\"tiltStatus\":\"" + tiltStatus + "\",";
  json += "\"heading\":" + String(headingDeg) + ",";
  json += "\"pitch\":" + String(pitchAngle, 1) + ",";
  json += "\"roll\":" + String(rollAngle, 1) + ",";
  json += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  json += "\"gps\":{";
  json += "\"lat\":" + String(gpsLat, 6) + ",";
  json += "\"lon\":" + String(gpsLon, 6) + ",";
  json += "\"alt\":" + String(gpsAlt, 1) + ",";
  json += "\"speed\":" + String(gpsSpeed, 1) + ",";
  json += "\"sats\":" + String(gpsSats);
  json += "}";
  json += "}";

  server.send(200, "application/json", json);
}

// --------------------------------------------------------------------------------------
// 7. SETUP & MAIN LOOP
// --------------------------------------------------------------------------------------

void setup() {
  // Serial Debug Monitor
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[BOOT] Starting AERO-SAT Dedicated Sensor Hub...");

  // Initialize GPS UART (Serial2 on GPIO 16 RX, GPIO 17 TX)
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  // Initialize Tilt Sensor Pin with Internal Pull-Up
  pinMode(TILT_SENSOR_PIN, INPUT_PULLUP);

  // Initialize Analog Pins
  pinMode(RAIN_ANALOG_PIN, INPUT);
  pinMode(LDR_ANALOG_PIN, INPUT);
  pinMode(VOLTAGE_ANALOG_PIN, INPUT);

  // Initialize DS18B20 Waterproof Temperature Sensor
  tempSensor.begin();
  tempSensor.setResolution(10); // 10-bit resolution for faster conversion

  // Start Wi-Fi Soft Access Point
  WiFi.mode(WIFI_AP);
  WiFi.softAP(ap_ssid, ap_password);
  IPAddress ip = WiFi.softAPIP();

  Serial.println("[WIFI] Access Point Started: " + String(ap_ssid));
  Serial.print("[WIFI] Satellite IP Address: http://");
  Serial.println(ip);
  Serial.println("[LINK] Telemetry JSON Endpoint: http://" + ip.toString() + "/telemetry");

  // Web Server Routing
  server.on("/telemetry", HTTP_GET, handleTelemetryJson);
  server.on("/telemetry", HTTP_OPTIONS, []() {
    sendCorsHeaders();
    server.send(204);
  });

  server.onNotFound([]() {
    sendCorsHeaders();
    server.send(404, "text/plain", "Endpoint not found");
  });

  server.begin();
  Serial.println("[STATUS] Web Server running. Awaiting dashboard connections...");
}

unsigned long lastSensorRead = 0;

void loop() {
  // Handle incoming HTTP client requests from website dashboard
  server.handleClient();

  // Read sensors every 200 milliseconds
  if (millis() - lastSensorRead >= 200) {
    readSensors();
    lastSensorRead = millis();
  }
}
