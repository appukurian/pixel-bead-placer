# Pixel Art Machine — Firmware Documentation

Grbl_ESP32 firmware configured for a CoreXY bead-placement machine.
Based on [Grbl_ESP32 by Bart Dring](https://github.com/bdring/Grbl_Esp32).

---

## Table of Contents

1. [Overview](#1-overview)
2. [File Structure](#2-file-structure)
3. [Active Machine Configuration — Pixelart.h](#3-active-machine-configuration--pixelarth)
4. [Pin Map](#4-pin-map)
5. [CoreXY Kinematics — CoreXY.cpp](#5-corexy-kinematics--corexypp)
6. [Homing Sequence](#6-homing-sequence)
7. [Default Settings — Defaults.h](#7-default-settings--defaultsh)
8. [Spindle / Bead Feeder Status](#8-spindle--bead-feeder-status)
9. [Serial Communication](#9-serial-communication)
10. [Status Report Format](#10-status-report-format)
11. [Known Issues & Notes](#11-known-issues--notes)
12. [How to Flash](#12-how-to-flash)
13. [Runtime Settings ($$ Commands)](#13-runtime-settings--commands)

---

## 1. Overview

| Property | Value |
|---|---|
| Base firmware | Grbl_ESP32 (Grbl 1.3a) |
| Target hardware | ESP32 dev board |
| Machine type | CoreXY |
| Machine name | `PIXELART_COREXY_TEST` |
| Kinematics file | `Custom/CoreXY.cpp` |
| Active machine file | `src/Machines/Pixelart.h` |
| Baud rate | 115200 |
| Step generation | RMT peripheral (`USE_RMT_STEPS`) |
| Axes used | X, Y only (Z defined but unused) |
| Bluetooth | Enabled |

---

## 2. File Structure

```
Grbl_Esp32/
├── Grbl_Esp32.ino              — Entry point: calls grbl_init() and run_once()
├── data/
│   └── index.html.gz           — Web UI (served from ESP32 flash)
├── Custom/
│   └── CoreXY.cpp              — CoreXY inverse/forward kinematics + custom homing
└── src/
    ├── Machine.h               — Selects the active machine file (points to Pixelart.h)
    ├── MachineCommon.h         — SPI and timer constants, never changes
    ├── Config.h                — Compile-time system config (baud, N_AXIS, USE_RMT, etc.)
    ├── Defaults.h              — Default values for all $$ runtime settings
    ├── Machines/
    │   └── Pixelart.h          ← ACTIVE MACHINE CONFIG — edit this for hardware changes
    ├── Motors/                 — Motor driver classes (Standard, Trinamic, Servo, etc.)
    ├── Spindles/               — Spindle driver classes (PWM, Relay, BESC, Laser, etc.)
    └── WebUI/                  — WiFi/BT web interface
```

**The only files that normally need editing for this machine:**
- `src/Machines/Pixelart.h` — pin assignments, homing config, spindle selection
- `Custom/CoreXY.cpp` — kinematics (only if motion geometry changes)
- `src/Defaults.h` — default values for steps/mm, speeds, travel limits

---

## 3. Active Machine Configuration — Pixelart.h

**File:** `src/Machines/Pixelart.h`

This is the single file that defines the entire hardware mapping for the pixel art machine. It is selected in `src/Machine.h` with `#include "Machines/Pixelart.h"`.

```cpp
#define MACHINE_NAME "PIXELART_COREXY_TEST"
#define CUSTOM_CODE_FILENAME "../Custom/CoreXY.cpp"

// Motor step & direction pins
#define X_STEP_PIN              GPIO_NUM_12
#define X_DIRECTION_PIN         GPIO_NUM_26
#define Y_STEP_PIN              GPIO_NUM_14
#define Y_DIRECTION_PIN         GPIO_NUM_25

// Limit switch pins
#define X_LIMIT_PIN             GPIO_NUM_21
#define Y_LIMIT_PIN             GPIO_NUM_4

// Stepper enable (active LOW)
#define STEPPERS_DISABLE_PIN    GPIO_NUM_13

// Homing
#define DEFAULT_HOMING_ENABLE          1
#define DEFAULT_HOMING_CYCLE_1         bit(X_AXIS)   // cycle 1 = home X
#define DEFAULT_HOMING_CYCLE_2         bit(Y_AXIS)   // cycle 2 = home Y
#define DEFAULT_HOMING_DIR_MASK        (bit(X_AXIS) | bit(Y_AXIS))  // both home negative
#define DEFAULT_HOMING_DEBOUNCE_DELAY  250  // ms
#define DEFAULT_HOMING_PULLOFF         3.0  // mm

// Limits
#define DEFAULT_SOFT_LIMIT_ENABLE  0  // disabled
#define DEFAULT_HARD_LIMIT_ENABLE  1  // enabled

// Spindle — NOT YET DEFINED (bead feeders not wired)
// #define SPINDLE_TYPE          SpindleType::BESC
// #define SPINDLE_OUTPUT_PIN    GPIO_NUM_17
// #define SPINDLE_ENABLE_PIN    GPIO_NUM_22
```

---

## 4. Pin Map

| GPIO | Function | Direction | Notes |
|---|---|---|---|
| GPIO 12 | X_STEP | Output | Step pulse for motor A |
| GPIO 26 | X_DIRECTION | Output | Direction for motor A |
| GPIO 14 | Y_STEP | Output | Step pulse for motor B |
| GPIO 25 | Y_DIRECTION | Output | Direction for motor B |
| GPIO 21 | X_LIMIT | Input | X axis limit switch (homed to this) |
| GPIO 4  | Y_LIMIT | Input | Y axis limit switch (homed to this) |
| GPIO 13 | STEPPERS_DISABLE | Output | Active LOW — pull LOW to enable drivers |

**Limit switch logic:**
- `DEFAULT_INVERT_LIMIT_PINS = 1` (set in Defaults.h)
- Switches are treated as **normally closed (NC)** — pin reads HIGH when switch is open, LOW when triggered
- If using normally open (NO) switches, set `$5=0`

**Spindle / Feeder pins — NOT YET ASSIGNED:**
The following are commented out in Pixelart.h and must be defined before bead feeders will work:
```cpp
// #define SPINDLE_TYPE        SpindleType::BESC   (or PWM, Relay, etc.)
// #define SPINDLE_OUTPUT_PIN  GPIO_NUM_17
// #define SPINDLE_ENABLE_PIN  GPIO_NUM_22
```

---

## 5. CoreXY Kinematics — CoreXY.cpp

**File:** `Custom/CoreXY.cpp`

### Motor-to-Cartesian Mapping

In CoreXY, both physical motors drive both X and Y cartesian movement:

```
Motor A steps = X_cartesian + Y_cartesian
Motor B steps = X_cartesian - Y_cartesian
```

Inverse (motors → cartesian):
```
X_cartesian = 0.5 × (Motor_A + Motor_B)
Y_cartesian = 0.5 × (Motor_A - Motor_B)
```

This is implemented in `transform_cartesian_to_motors()` and `motors_to_cartesian()`.

**Consequence:** For pure X movement, both motors run at equal speed in the same direction. For pure Y movement, both motors run at equal speed in opposite directions. Any single motor failure will cause diagonal drift, not total failure.

### geometry_factor

Set to `1.0` (standard CoreXY). Not a midTbot variant.

### Homing Constraint

CoreXY **requires each axis to be homed in a separate cycle** — you cannot home X and Y simultaneously because the motor-to-cartesian transform means simultaneous X and Y moves require coordinated motor motion. The firmware enforces this:

```cpp
// CoreXY Multi axis homing cycles not allowed.
if (numberOfSetBits(homing_cycle[cycle]->get()) > 1) {
    // error!
}
```

This is why `Pixelart.h` defines:
```cpp
#define DEFAULT_HOMING_CYCLE_1  bit(X_AXIS)   // X homes first
#define DEFAULT_HOMING_CYCLE_2  bit(Y_AXIS)   // Y homes second
```

### Homing Motor Motion

When homing X axis: both motors move in the **same direction** (X_cart moves, Y_cart=0)
When homing Y axis: both motors move in **opposite directions** (X_cart=0, Y_cart moves)

After homing, the system position is set based on the homing direction mask and pull-off distance.

---

## 6. Homing Sequence

Full `$H` execution order:

```
1. Check cycles — error if any cycle has >1 axis (CoreXY limitation)
2. Cycle 1: Home X axis
   a. Both motors move in negative X direction (seek rate: 2000 mm/min)
   b. X limit switch (GPIO 21) triggers
   c. Motors stop, debounce 250ms
   d. Pull off 3mm
   e. Slow approach (feed rate: 200 mm/min)
   f. X limit triggers again → X position locked
3. Cycle 2: Home Y axis
   a. Both motors move in negative Y direction (motors go opposite ways)
   b. Y limit switch (GPIO 4) triggers
   c. Motors stop, debounce 250ms
   d. Pull off 3mm
   e. Slow approach
   f. Y limit triggers → Y position locked
4. Set cartesian position to (pulloff, pulloff) = (3.0, 3.0) mm
5. Sync GCode parser and planner positions
```

**ALARM:9** = `HomingFailApproach` — the axis travelled the full `max_travel × 1.1` distance without triggering the limit switch.

**Causes of ALARM:9 on Y:**
- Y limit switch (GPIO 4) not wired or not triggering
- Homing direction wrong — Y axis moving away from switch (`$23` value)
- Max travel too small — machine reaches travel limit before reaching switch (`$131`)
- Switch type mismatch — NC vs NO (`$5=1` means NC expected)

**Diagnostic:** Send `?` while manually pressing the Y limit switch. Look for `Pn:Y` in the response. If it doesn't appear, the switch is not registering.

---

## 7. Default Settings — Defaults.h

These are the **compiled-in defaults**. They are used when the ESP32 flash is cleared or `$RST=*` is sent. Runtime values can differ (shown by `$$`).

| Setting | Parameter | Value | Unit |
|---|---|---|---|
| `$0` | Step pulse time | 3 | µs |
| `$1` | Stepper idle lock time | 250 | ms |
| `$2` | Step invert mask | 0 | bitmask |
| `$3` | Direction invert mask | 0 | bitmask |
| `$4` | Invert step enable | 0 | boolean |
| `$5` | Invert limit pins | **1** | boolean (NC switches) |
| `$10` | Status report mask | 1 | bitmask |
| `$20` | Soft limits | 0 | disabled |
| `$21` | Hard limits | **1** | enabled |
| `$22` | Homing enable | **1** | enabled |
| `$23` | Homing dir mask | **3** (both axes negative) | bitmask |
| `$24` | Homing feed rate | 200 | mm/min |
| `$25` | Homing seek rate | 2000 | mm/min |
| `$26` | Homing debounce | 250 | ms |
| `$27` | Homing pull-off | **3.0** | mm |
| `$30` | Spindle max RPM | 1000 | RPM |
| `$31` | Spindle min RPM | 0 | RPM |
| `$100` | X steps/mm | 100.0 | steps/mm |
| `$101` | Y steps/mm | 100.0 | steps/mm |
| `$110` | X max rate | 1000 | mm/min |
| `$111` | Y max rate | 1000 | mm/min |
| `$120` | X acceleration | 200 | mm/s² |
| `$121` | Y acceleration | 200 | mm/s² |
| `$130` | X max travel | 300 | mm |
| `$131` | Y max travel | 300 | mm |

**Bold values are set or overridden in Pixelart.h** — the rest come from Defaults.h.

> Steps/mm (100.0) and max travel (300 mm) are generic defaults. These must be calibrated and updated via `$100`, `$101`, `$130`, `$131` for the actual machine hardware.

---

## 8. Spindle / Bead Feeder Status

**Current state: NOT IMPLEMENTED**

The spindle section in `Pixelart.h` is entirely commented out:

```cpp
// #define SPINDLE_TYPE            SpindleType::BESC
// #define SPINDLE_OUTPUT_PIN      GPIO_NUM_17
// #define SPINDLE_ENABLE_PIN      GPIO_NUM_22
```

Because no `SPINDLE_TYPE` is defined, the firmware defaults to `SpindleType::NONE` (from Defaults.h):

```cpp
#ifndef SPINDLE_TYPE
#    define SPINDLE_TYPE SpindleType::NONE
#endif
```

**What this means:**
- `M3 S100`, `M4 S100`, and `M5` commands are **accepted** by the GRBL parser and return `ok`
- **No GPIO pin is toggled** — nothing happens in hardware
- The bead feeders are not yet connected to any output

**What needs to be done to enable feeders:**

The browser app uses:
- `M3 S100` → Black bead feeder ON
- `M4 S100` → White bead feeder ON
- `M5`      → All feeders OFF

To wire this up in the firmware, uncomment and configure in `Pixelart.h`:

```cpp
// Option 1: PWM spindle (variable speed motor/servo)
#define SPINDLE_TYPE        SpindleType::PWM
#define SPINDLE_OUTPUT_PIN  GPIO_NUM_17   // PWM signal for feeder A (black, M3)
#define SPINDLE_ENABLE_PIN  GPIO_NUM_22   // enable pin

// Option 2: Relay spindle (on/off only)
#define SPINDLE_TYPE        SpindleType::RELAY
#define SPINDLE_OUTPUT_PIN  GPIO_NUM_17   // relay trigger for feeder A
```

For two separate feeders (black and white), a custom spindle class or the UserOutput pins will be needed, since standard GRBL spindle only drives one output direction and uses M3/M4 for CW/CCW. The `UserOutput` module (`src/UserOutput.cpp`) provides `M62`/`M63` for additional digital outputs and may be used for a second feeder.

---

## 9. Serial Communication

| Parameter | Value |
|---|---|
| Baud rate | 115200 |
| Defined in | `src/Config.h` → `#define BAUD_RATE 115200` |
| Protocol | GRBL 1.1 (text, newline-terminated) |
| Bluetooth | Also available (enabled in Config.h) |

On boot, the firmware sends:
```
Grbl 1.3a ['$' for help]
```

If previously in ALARM state it may also send:
```
[MSG:'$H'|'$X' to unlock]
```

---

## 10. Status Report Format

The firmware sends `MPos` (machine position) **not** `WPos` (work position), along with `WCO` (work coordinate offset):

```
<Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>
<Run|MPos:10.500,25.000,0.000|FS:3000,0>
<Alarm:9|MPos:0.000,0.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>
```

**Work position can be calculated as:**
```
WPos = MPos + WCO
```

**Important for the browser app:** The app currently parses `WPos:` from the status report. Since the firmware sends `MPos:`, the position display will not update. The app needs to be updated to parse `MPos:` (or `WPos:` if WCO offset is applied).

### Status field meanings

| Field | Meaning |
|---|---|
| `Idle` | No motion, ready for commands |
| `Run` | Executing motion |
| `Hold:0` | Feed hold in progress (decelerating) |
| `Hold:1` | Feed hold complete (stopped) |
| `Jog` | Executing a jog move |
| `Alarm:N` | Alarm state — machine locked. Send `$X` to clear |
| `Home` | Homing cycle in progress |
| `MPos:x,y,z` | Machine position in mm |
| `WCO:x,y,z` | Work coordinate offset |
| `FS:feed,spindle` | Current feed rate (mm/min) and spindle speed |
| `Pn:XY` | Active input pins (X = X limit active, Y = Y limit active) |

---

## 11. Known Issues & Notes

### Issue 1: Y axis homing fails (ALARM:9)

**Symptom:** X homes correctly, Y does not move or triggers ALARM:9.

**Diagnosis steps:**
1. Send `$$` — check `$22` (homing enable), `$23` (homing direction), `$131` (Y max travel)
2. Send `?` while manually pressing Y limit switch — check for `Pn:Y` in response
3. If `Pn:Y` does not appear: switch wiring or GPIO 4 issue
4. If `Pn:Y` appears but homing still fails: direction or travel distance issue

**Quick fix attempt:** `$22=3` then `$H` (ensures both axes are in homing cycle)

### Issue 2: Position display not updating in browser app

**Cause:** Firmware sends `MPos:` but app parses `WPos:`. The regex `/WPos:([-\d.]+),([-\d.]+)/` will never match.

**Fix needed in script.js:** Update `parseGrblStatus()` to also match `MPos:`:
```javascript
const pos = s.match(/[WM]Pos:([-\d.]+),([-\d.]+)/);
```

### Issue 3: Bead feeders not connected

**Cause:** `SPINDLE_TYPE` is commented out in Pixelart.h. M3/M4/M5 return `ok` but do nothing.

**Fix:** Define spindle type and output pin in Pixelart.h and reflash.

### Issue 4: Garbled bytes on initial connect

**Cause:** ESP32 UART outputs garbage during boot before settling at 115200. Normal behaviour.

**Fix:** None needed — ignore the first line of data on connect.

### Issue 5: Steps/mm not calibrated

**Default value:** 100 steps/mm for both X and Y.

**Action required:** Physically measure actual movement (send `G0 X100`, measure real distance) and update with `$100=<correct_value>` and `$101=<correct_value>`.

---

## 12. How to Flash

1. Install Arduino IDE with ESP32 board support
2. Open `Grbl_Esp32/Grbl_Esp32.ino`
3. Ensure `src/Machine.h` includes `Machines/Pixelart.h` (already set)
4. Select board: **ESP32 Dev Module** (or matching board)
5. Select correct COM port
6. Click Upload
7. After flash, open Serial Monitor at 115200 baud
8. Should see: `Grbl 1.3a ['$' for help]`

**After first flash or after `$RST=*`:** All settings revert to the compiled-in defaults from `Defaults.h` and `Pixelart.h`. Re-apply any calibrated values (`$100`, `$101`, `$130`, `$131`, etc.).

---

## 13. Runtime Settings ($$ Commands)

Send `$$` in the serial terminal to see all current runtime settings. Key settings to verify and calibrate:

```
$5=1        Limit pins inverted (1 = NC switches) ← set in Defaults.h
$21=1       Hard limits enabled
$22=1       Homing enabled
$23=3       Homing direction (3 = both X and Y home negative)
$24=200     Homing feed rate (mm/min) — slow approach
$25=2000    Homing seek rate (mm/min) — fast initial move
$26=250     Homing debounce (ms)
$27=3       Homing pull-off (mm) ← set in Pixelart.h

$100=???    X steps/mm — MUST BE CALIBRATED
$101=???    Y steps/mm — MUST BE CALIBRATED
$110=1000   X max rate (mm/min)
$111=1000   Y max rate (mm/min)
$120=200    X acceleration (mm/s²)
$121=200    Y acceleration (mm/s²)
$130=300    X max travel (mm) — update to actual bed size
$131=300    Y max travel (mm) — update to actual bed size
```

**To set a value:** `$100=142.857` (example for a 1.8° stepper, 16 microsteps, GT2 belt, 20-tooth pulley)

**Formula for steps/mm:**
```
steps/mm = (motor_steps_per_rev × microsteps) / (pulley_teeth × belt_pitch_mm)

Example: 200 steps/rev × 16 microsteps / (20 teeth × 2mm pitch) = 80 steps/mm
```
