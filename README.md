# Pixel Bead Placer — CoreXY

A browser-based pixel art editor that streams G-code over USB serial to a CoreXY machine running grbl_esp32, which physically places beads on a configurable bed one at a time.

---

## Table of Contents

1. [Project Purpose](#1-project-purpose)
2. [System Architecture](#2-system-architecture)
3. [Interface Layout](#3-interface-layout)
4. [Left Sidebar — Settings & Tools](#4-left-sidebar--settings--tools)
5. [Canvas Area — Preview](#5-canvas-area--preview)
6. [Right Panel — Machine Control](#6-right-panel--machine-control)
7. [Pre-run Checklist Flow](#7-pre-run-checklist-flow)
8. [USB Serial Communication Protocol](#8-usb-serial-communication-protocol)
9. [GRBL Command Reference](#9-grbl-command-reference)
10. [G-code Program Structure](#10-g-code-program-structure)
11. [Bead Feeder Control](#11-bead-feeder-control)
12. [Coordinate System](#12-coordinate-system)
13. [Grid & Spacing Model](#13-grid--spacing-model)
14. [Image Import](#14-image-import)
15. [SVG Export](#15-svg-export)
16. [Firmware Requirements (ESP32 / grbl_esp32)](#16-firmware-requirements-esp32--grbl_esp32)
17. [Hardware Summary](#17-hardware-summary)
18. [File Structure](#18-file-structure)
19. [Settings Reference](#19-settings-reference)
20. [Changelog](#20-changelog)

---

## 1. Project Purpose

The operator designs a black-and-white pixel image in a browser. The browser app converts it to a grid of bead positions, then streams G-code commands one-by-one over USB serial to a CoreXY robot. The robot moves its end-effector to each position and drops a bead (black or white) using motorised feeders, assembling the physical pixel art on a flat tray.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Browser (Chrome / Edge)                │
│                                                         │
│  Left sidebar   │   Canvas preview   │  Machine panel   │
│  (settings)     │   (grid, rulers)   │  (serial ctrl)   │
│                                                         │
│         Web Serial API (USB CDC, 115200 baud)           │
└──────────────────────────┬──────────────────────────────┘
                           │ USB
                           ▼
              ┌────────────────────────┐
              │   ESP32 dev board      │
              │   grbl_esp32 firmware  │
              │   (GRBL 1.1 protocol)  │
              └────────────┬───────────┘
                           │ Step/Dir signals
                           ▼
              ┌────────────────────────┐
              │   CoreXY motion system │
              │   + 2 bead feeders     │
              │   + limit switches     │
              └────────────────────────┘
```

**Communication path:** Browser → Web Serial API → USB CDC → ESP32 UART0 → grbl_esp32

**Data format:** Plain ASCII text, newline-terminated (`\n`). No binary framing, no checksum.

---

## 3. Interface Layout

The app is a single-page HTML application with three columns inside a full-viewport layout:

```
┌──────────────────────────────────────────────────────────────────────┐
│  HEADER: title + "Generate & Download GCode" button                   │
├──────────────┬───────────────────────────────┬───────────────────────┤
│  LEFT PANEL  │        CANVAS AREA            │    RIGHT PANEL        │
│  224 px      │        flex: 1 (scrollable)   │    262 px             │
│              │                               │                       │
│  • Bed/Bead  │  Y ruler │ Grid preview       │  • Serial connect     │
│    Setup     │  (left)  │ (bead circles)     │  • Pre-run checklist  │
│              │          │                    │  • Machine state      │
│  • Bead      │          │ X ruler (bottom)   │  • Jog controls       │
│    Count     │                               │  • Print job          │
│              │                               │  • Terminal           │
│  • Colors    │                               │                       │
│              │                               │                       │
│  • Tools     │                               │                       │
│              │                               │                       │
│  • Machine   │                               │                       │
│    Settings  │                               │                       │
│              │                               │                       │
│  • Actions   │                               │                       │
└──────────────┴───────────────────────────────┴───────────────────────┘
```

---

## 4. Left Sidebar — Settings & Tools

### 4.1 Bed & Bead Setup

Inputs that define the physical machine and the design grid. All are numbers in mm.

| Field | HTML ID | Default | Description |
|---|---|---|---|
| Bed width | `#bed-w` | 400 | Machine bed width in mm |
| Bed height | `#bed-h` | 400 | Machine bed height in mm |
| Bead size | `#bead-diameter` | 6 | Physical bead diameter in mm |
| Gap | `#bead-gap` | 1 | Edge-to-edge clearance between beads in mm |
| Spacing (read-only) | `#spacing-val` | 7 | Auto-computed: diameter + gap |

Click **Apply Grid** to commit these values. The canvas will render and all design tools unlock. If a design already exists and values change, the user is asked to confirm clearing it.

### 4.2 Bead Count (shown after Apply Grid)

Live stats displayed in `#grid-info`:
- Grid: cols × rows
- Total beads
- Black bead count
- White bead count

A warning banner appears if total > 40,000 beads (large G-code file).

### 4.3 Colors

Three `<input type="color">` pickers, all live (no Apply needed):

| Picker | HTML ID | Default | Controls |
|---|---|---|---|
| Black bead | `#color-black` | `#1a1a1a` | Fill color of black bead circles on canvas |
| White bead | `#color-white` | `#f0f0f0` | Fill color of white bead circles on canvas |
| Space | `#color-space` | `#999999` | Background between beads |

### 4.4 Tools (locked until Apply Grid)

- **Pen** (`data-tool="pen"`) — click/drag to place black beads
- **Eraser** (`data-tool="eraser"`) — click/drag to place white beads (remove black)
- **Show Path** (`#btn-path`) — toggles the snake path overlay on the canvas

### 4.5 Machine Settings

These values feed directly into G-code generation and the machine panel:

| Field | HTML ID | Default | Description |
|---|---|---|---|
| Origin X | `#origin-x` | 0 | X offset added to all G-code positions |
| Origin Y | `#origin-y` | 0 | Y offset added to all G-code positions |
| Move speed | `#move-speed` | 800 | Feed rate for positioning moves in mm/min |
| Dwell time | `#dwell-time` | 300 | `G4 P` value in ms; wait after each bead drop |
| Black bead | `#black-bead-side` | Left | Which side of the dropper dispenses black beads |
| White bead | `#white-bead-side` | Right | Which side of the dropper dispenses white beads |

### 4.6 Actions (locked until Apply Grid)

- **Import Image** (`#btn-import`) — opens a file picker; image is luminance-thresholded to black/white and mapped to the grid
- **Download SVG** (`#btn-svg`) — saves a physically accurate SVG of the current design
- **Clear All** (`#btn-clear`) — resets all beads to white (after user confirm)

The header button **Generate & Download GCode** (`#btn-gcode`) saves the current design as a `.gcode` file.

---

## 5. Canvas Area — Preview

### 5.1 Coordinate System

The canvas uses a **Y-up coordinate system** matching standard machine/CAD conventions:

- **(0, 0) is at the bottom-left** corner of the bed
- **X increases to the right**
- **Y increases upward**
- Row 0 in the grid array = bottom-most row on screen = smallest Y in G-code
- Row N-1 in the grid array = top-most row on screen = largest Y in G-code

### 5.2 Canvas Layout

```
Canvas pixel layout:

 y=0 ──────────────────────────────────────
      │  Y ruler  │     Grid area          │
      │  (44 px)  │  (cols × cellPx wide)  │
      │           │                        │
      │  Y=max    │  row N-1 (top)         │
      │  at top   │                        │
      │  Y=0      │  row 0 (bottom)        │
      │  at btm   │                        │
 y=rows*cellPx ──┼────────────────────────┤
      │  corner   │     X ruler            │
      │  "mm"     │  (canvas width wide)   │
 y=canvas.height ─────────────────────────
      │← RULER_PX→│←── cols × cellPx ─────│
```

- `RULER_PX = 44` px — width of Y ruler strip (also height of X ruler strip)
- `cellPx = clamp(floor(680 / cols), 5, 40)` — pixels per bead cell

### 5.3 Rulers

- **Y ruler** (left, 44 px wide): tick marks at every `rulerLabelStep()` rows; labels show Y in mm; small ▶/◀ arrows show snake-path travel direction per row
- **X ruler** (bottom, 44 px tall): tick marks at every `rulerLabelStep()` cols; labels show X in mm
- **Corner square** at bottom-left: labelled "mm"
- Tick density adapts to zoom level — minimum 45 px between major tick labels

### 5.4 Grid Rendering

Each bead is a filled circle:

```
radiusPx = (beadDiameterMm / beadSpacingMm) × cellPx × 0.5
```

Bead at grid position (col, row):
```
canvas_x = RULER_PX + col × cellPx + cellPx / 2
canvas_y = (rows - 1 - row) × cellPx + cellPx / 2
```

Background (space between beads) = `colorSpace`; black bead = `colorBlack`; white bead = `colorWhite`.

### 5.5 Snake Path Overlay

When **Show Path** is active, a semi-transparent red line traces the full travel sequence:
- Even rows (0, 2, 4…): left → right
- Odd rows (1, 3, 5…): right → left
- Arrowheads at the start of every labelled row

---

## 6. Right Panel — Machine Control

All machine interaction is in the right panel (262 px wide). It is always visible regardless of grid state.

### 6.1 Serial Connection

- **Connect USB** button (`#btn-serial-connect`) — calls `navigator.serial.requestPort()` and opens at 115200 baud
- Status indicator: green dot = connected, dark dot = disconnected
- On connect: all machine buttons enable; status is polled after 1.2 s
- On disconnect: all buttons disable; running job is aborted; cmdQueue is flushed

### 6.2 Pre-run Checklist

Seven items. Each has a state: `pending` (○), `busy` (…), `done` (✓). Items 2–6 have action buttons that become enabled once connected.

| # | ID | Label | Action | How it completes |
|---|---|---|---|---|
| 1 | `#chk-connect` | Connect to machine | (automatic) | Ticks on USB connect |
| 2 | `#chk-home` | Home axes (limit switches) | Run $H | Sends `$H`, waits for `ok` |
| 3 | `#chk-origin` | Move to origin X/Y | Go | Sends `G21 G90 G0 X{ox} Y{oy}`, waits for `ok` |
| 4 | `#chk-testx` | Test X axis movement | Test | Jogs X+ then X−, user confirms |
| 5 | `#chk-testy` | Test Y axis movement | Test | Jogs Y+ then Y−, user confirms |
| 6 | `#chk-testbead` | Test bead drop | Test | Moves to slot 1 → drops black bead → moves to slot 2 → drops white bead; user confirms each |
| 7 | `#chk-ready` | Ready to print | (automatic) | Ticks when items 1–6 all done |

When **Run** is clicked and the checklist is not fully complete, the user is shown a warning and can proceed anyway.

### 6.3 Machine State

Polled by sending `?` to GRBL. The response (`<...>` status report) is parsed silently (not shown in terminal) and updates:

| Display | ID | Source |
|---|---|---|
| Status | `#mc-status` | First field of status report (e.g. `Idle`, `Run`, `Alarm`) |
| X position | `#mc-pos-x` | `WPos:x,...` parsed from status report |
| Y position | `#mc-pos-y` | `WPos:x,y,...` parsed from status report |

The `?` button (`#btn-poll`) manually triggers a poll.

### 6.4 Jog Controls

3×3 directional pad. All jog commands use GRBL jogging (`$J=`) in relative mode:

```
$J=G91 G21 X{±step} F{feed}
$J=G91 G21 Y{±step} F{feed}
```

- **Step size** (`#jog-step`): 1 / 5 / 10 / 50 mm
- **Feed rate** (`#jog-feed`): slow=1000, med=3000, fast=6000 mm/min
- **⌂ button** (`#jog-center`): sends `G0 X{originX} Y{originY} F3000` — returns to user-defined origin
- All jog buttons disabled during a running or paused job

### 6.5 Print Job

- **▶ Run** (`#btn-run-gcode`) — builds G-code from current grid state via `buildGcodeLines()`, then streams lines one-by-one
- **⏸ Pause** — sets `jobPaused = true`; current line finishes; no new lines sent; button changes to **▶ Resume**
- **■ Stop** — sets job state to stopped; sends `!` (feed hold) then `\x18` (soft reset) 250 ms later
- Progress bar and `Line N / total (N%)` counter update after each line sent
- Run button enabled when: serial connected AND grid is ready (`gridReady = true`)

### 6.6 Terminal

- Colour-coded log of all serial traffic:
  - `← ` green — data received from machine (RX)
  - `→ ` blue — data sent to machine (TX)
  - `# ` grey — system messages from the browser app
  - `✗ ` red — errors
- GRBL status reports (`<...>`) are parsed silently and do **not** appear in the terminal (to avoid flooding during a job)
- Manual command input (`#serial-cmd`) — type any GRBL command and press Enter or Send
- **Clear** button wipes the terminal log
- Capped at 600 lines (oldest lines removed automatically)

---

## 7. Pre-run Checklist Flow

The expected sequence before every print run:

```
Step 1: Connect USB
  → User clicks "Connect USB"
  → Browser opens port picker dialog
  → Port opens at 115200 baud
  → App waits 1.2 s, sends ?
  → chk-connect ticks ✓

Step 2: Home axes
  → User clicks "Run $H"
  → App sends:  $H\n
  → GRBL runs homing cycle (moves to limit switches)
  → GRBL replies: ok
  → chk-home ticks ✓
  → App sends ? to refresh position display
  (If ALARM state, user must send $X in terminal first)

Step 3: Move to origin
  → User clicks "Go"
  → App sends:  G21\n   (mm mode)
                G90\n   (absolute)
                G0 X{originX} Y{originY} F3000\n
  → GRBL replies: ok, ok, ok
  → chk-origin ticks ✓
  → App sends ? to refresh position display

Step 4: Test X axis
  → User clicks "Test"
  → App sends:  $J=G91 G21 X{step} F{feed}\n
  → GRBL replies: ok
  → App sends:  $J=G91 G21 X{-step} F{feed}\n
  → GRBL replies: ok
  → Browser shows confirm dialog: "Did the machine move correctly in X?"
  → User clicks OK → chk-testx ticks ✓
  → User clicks Cancel → item stays pending, can retry

Step 5: Test Y axis
  → Same as step 4 but Y direction

Step 6: Test bead drop
  → User clicks "Test"
  → App sends:  G1 X{slot1X} Y{slot1Y} F{speed}\n   (move to first bead slot)
  → GRBL replies: ok
  → App sends:  G4 P0\n                               (full stop)
  → App sends:  M3 S{BLACK}\n                         (drop black bead)
  → App sends:  G4 P{dwellMs}\n                       (dwell)
  → App sends:  M3 S60\n                              (rest)
  → Browser shows confirm: "Did a BLACK bead drop?" → OK to continue
  → App sends:  G1 X{slot2X} Y{slot2Y} F{speed}\n   (move to next slot)
  → Same sequence for white bead
  → Both confirmed → chk-testbead ticks ✓

Step 7: Ready to print
  → Auto-ticks when all 6 above are ✓

Step 8: Run
  → User clicks ▶ Run
  → App builds G-code from current grid
  → Streams line-by-line (see §8.3)
```

---

## 8. USB Serial Communication Protocol

### 8.1 Physical Layer

| Parameter | Value |
|---|---|
| Interface | USB CDC (virtual COM port) |
| Baud rate | 115200 |
| Data bits | 8 |
| Stop bits | 1 |
| Parity | None |
| Flow control | None (software flow control via GRBL `ok` responses) |
| Browser API | Web Serial API (Chrome ≥ 89, Edge ≥ 89) |

### 8.2 Message Format

All messages are plain ASCII terminated by `\n` (LF, `0x0A`). GRBL may send `\r\n` — the app strips `\r` before processing.

**Browser → Machine (TX):**  each command is a single line followed by `\n`

**Machine → Browser (RX):**  GRBL sends one response per command received

### 8.3 Flow Control — ok Gating

The app uses strict single-command flow control:

```
Browser sends line 1 ──→ Machine
                     ←── ok
Browser sends line 2 ──→ Machine
                     ←── ok
...
```

Only one line is in flight at any time. The next line is sent only after `ok` is received for the previous one. This prevents GRBL's 128-byte RX buffer from overflowing.

**Implementation:**
- `sendCmd(cmd)` — returns a Promise that resolves on `ok`, rejects on `error:N` or `ALARM:N`
- `sendRaw(cmd)` — fire-and-forget (used for `?`, `!`, `\x18` which don't follow the ok protocol)
- During a job, incoming `ok` triggers `sendNextJobLine()`
- During interactive use (checklist, jog, terminal), `ok` resolves the top entry in `cmdQueue[]`

### 8.4 Response Types

| Response | When sent | App behaviour |
|---|---|---|
| `ok` | After any valid command executes | Advances job queue or resolves cmdQueue promise |
| `error:N` | Invalid command or parameter | Logs to terminal; pauses job if running |
| `ALARM:N` | Machine alarm (limit hit, homing fail, etc.) | Logs to terminal; stops job; cmdQueue rejected |
| `<State\|WPos:x,y,z\|...>` | Response to `?` status request | Parsed silently; updates status display |
| `[MSG:...]` | Informational messages (e.g. homing) | Shown in terminal |
| `Grbl N.N ...` | Welcome message on connect/reset | Shown in terminal |
| `$` settings replies | Response to `$$` | Shown in terminal |

### 8.5 Special Real-time Commands

These are single-byte commands sent without `\n`. They are processed by GRBL immediately, bypassing the command buffer:

| Byte | Command | Effect |
|---|---|---|
| `?` | Status request | GRBL sends `<State\|WPos:x,y,z\|...>` immediately |
| `!` | Feed hold | Machine decelerates to stop; state → `Hold` |
| `~` | Cycle start / resume | Resumes from Hold |
| `\x18` (Ctrl-X) | Soft reset | Resets GRBL; clears alarms; machine state lost |

The Stop button sends `!` then `\x18` after 250 ms.

### 8.6 Status Report Format

GRBL sends a status report in response to `?`:

```
<Idle|WPos:10.500,25.000,0.000|FS:0,0>
<Run|WPos:10.500,25.000,0.000|FS:3000,0>
<Alarm:9|WPos:0.000,0.000,0.000|FS:0,0>
<Hold:0|WPos:10.500,25.000,0.000|FS:0,0>
```

Fields:
- **State**: `Idle`, `Run`, `Hold:0`, `Hold:1`, `Jog`, `Alarm:N`, `Door:N`, `Check`, `Home`, `Sleep`
- **WPos**: Work position X, Y, Z in mm (after applying work coordinate offset)
- **FS**: Feed rate (mm/min), Spindle speed (RPM)

The app parses `WPos` with:
```
/WPos:([-\d.]+),([-\d.]+)/
```

### 8.7 Homing Response Sequence

After `$H` is sent, GRBL typically responds:

```
[MSG:Caution: Unlocked]      ← if previously in ALARM
ok                            ← homing complete; machine now at (0,0,0)
```

Or on failure:
```
ALARM:9                       ← homing failed (limit switch not triggered)
```

If machine is in ALARM before homing, send `$X` first to unlock, then `$H`.

### 8.8 Jog Command Format

```
$J=G91 G21 X10 F3000\n
```

- `$J=` — jog prefix (GRBL 1.1+)
- `G91` — relative positioning for this move
- `G21` — mm units
- `X10` or `Y-5` — axis and distance
- `F3000` — feed rate in mm/min

GRBL responds with `ok` when the jog completes or is cancelled. Sending another `$J` while jogging cancels the current jog and starts the new one.

---

## 9. GRBL Command Reference

All commands used by this application:

| Command | Description | Expected Response |
|---|---|---|
| `?` | Request status report | `<State\|WPos:...>` (no `ok`) |
| `$H` | Run homing cycle | `ok` (after homing completes) |
| `$X` | Clear ALARM state (unlock) | `ok` |
| `$J=G91 G21 X{n} F{f}` | Jog X relative | `ok` |
| `$J=G91 G21 Y{n} F{f}` | Jog Y relative | `ok` |
| `G21` | Set units to mm | `ok` |
| `G90` | Absolute positioning mode | `ok` |
| `G28` | Go to pre-defined home position | `ok` |
| `G1 X{x} Y{y} F{f}` | Controlled linear move to position | `ok` |
| `G4 P0` | Flush planner — ensure machine fully stopped | `ok` |
| `G4 P{ms}` | Dwell for N milliseconds | `ok` (after dwell) |
| `M3 S110` | Servo → Left bead | `ok` |
| `M3 S22` | Servo → Right bead | `ok` |
| `M3 S60` | Servo → Rest (neutral) | `ok` |
| `M30` | End of program | `ok` |
| `!` | Feed hold (real-time, no `\n`) | (machine decelerates) |
| `\x18` | Soft reset (real-time, no `\n`) | `Grbl N.N ...` welcome |

---

## 10. G-code Program Structure

The full G-code program generated by `buildGcodeLines()`:

```gcode
; Pixel Bead Placer — GCode
; Firmware      : grbl_esp32 (GRBL 1.1 compatible)
; Bed size      : 400 x 400 mm
; Bead diameter : 6 mm
; Bead gap      : 1 mm  (edge-to-edge clearance)
; Bead spacing  : 7 mm  (center-to-center = diameter + gap)
; Grid          : 57 x 57  (3,249 beads)
; Black beads   : 1420
; White beads   : 1829
; Origin        : X0 Y0 mm
; Dwell/bead    : 300 ms
; Generated     : 2024-01-15T10:23:00.000Z
;
; Servo control (GPIO 27, 50Hz PWM):
;   M3 S110  →  Left  bead
;   M3 S22   →  Right bead
;   M3 S60   →  Rest (neutral)
;   BLACK bead = left side (M3 S110)
;   WHITE bead = right side (M3 S22)

G21            ← mm units
G90            ← absolute positioning
M3 S60         ← servo to rest before homing
G28            ← home all axes (machine goes to 0,0,0)

; Row 0  (L→R)
G1 X3.50 Y3.50 F800    ← controlled move to slot
G4 P0                  ← full stop before drop
M3 S110                ← drop black bead (left side)
G4 P0.300              ← dwell 300 ms
M3 S60                 ← servo back to rest

G1 X10.50 Y3.50 F800
G4 P0
M3 S22                 ← drop white bead (right side)
G4 P0.300
M3 S60
...

; Row 1  (R→L)
...

G28          ← return to home
M30          ← end of program
```

**Streaming rule:** Comment lines (starting with `;`) and blank lines are skipped when streaming. Only executable lines are sent to the machine. Each executable line waits for `ok` before the next is sent.

---

## 11. Bead Dropper Control

A single servo on GPIO 27 dispenses beads by rotating left or right from a neutral rest position. All control is via `M3 S{value}` — no M4 or M5 used.

### Calibrated S values

| Command | Action |
|---|---|
| `M3 S110` | Servo → Left position |
| `M3 S22` | Servo → Right position |
| `M3 S60` | Servo → Rest (neutral) |

### Bead side assignment

The user configures which physical side holds each bead colour in the Machine Settings panel. The generated S values adjust accordingly:

| User setting | Black bead command | White bead command |
|---|---|---|
| Black=Left, White=Right | `M3 S110` | `M3 S22` |
| Black=Right, White=Left | `M3 S22` | `M3 S110` |

### Per-bead drop sequence

Every bead — regardless of colour — follows this exact sequence:

```
G1 X{x} Y{y} F{speed}   ← controlled move to bead slot
G4 P0                    ← flush planner; full stop
M3 S{BLACK or WHITE}     ← rotate servo to drop bead
G4 P{dwell}              ← wait for bead to fall
M3 S60                   ← return servo to rest
```

`G4 P0` before the servo command guarantees the machine has fully decelerated and stopped before any bead is released, preventing mis-drops at speed.

**Startup:** `M3 S60` is sent before `G28` so the servo is always in the rest position before homing begins.

**Dwell (`G4 P{ms}`):** Default 300 ms, configurable 10–9999 ms.

**Move speed:** Default 800 mm/min (`G1 F800`), configurable 100–5000 mm/min.

---

## 12. Coordinate System

### 12.1 Machine Coordinates

- Machine home (after `$H`): X=0, Y=0
- X increases in one direction across the bed
- Y increases in the other direction across the bed (perpendicular to X in a CoreXY frame, but motion is coupled)
- Z is not used (the end-effector height is fixed)

### 12.2 G-code Bead Coordinates

For bead at grid position (col, row):

```
X_mm = originX + col × beadSpacingMm + beadSpacingMm / 2
Y_mm = originY + row × beadSpacingMm + beadSpacingMm / 2
```

- `originX`, `originY` — user-defined offset from machine home (default 0, 0)
- `beadSpacingMm` = bead diameter + gap
- `+ beadSpacingMm / 2` — centres the end-effector on the bead position

Row 0 = lowest Y value = front of bed = starts bottom-left in preview.

### 12.3 Snake Path

```
Row 0:  col 0 → col 1 → ... → col N-1    (left to right,  even rows)
Row 1:  col N-1 → ... → col 1 → col 0   (right to left,  odd rows)
Row 2:  col 0 → col 1 → ... → col N-1   (left to right,  even rows)
...
```

This minimises total travel distance by avoiding retracing the X axis at the end of each row.

### 12.4 Preview vs Machine Coordinates

The canvas preview matches the machine coordinate system exactly:
- (0,0) = bottom-left of canvas grid = machine origin (0+offset, 0+offset)
- Y increases upward in the preview (flipped from screen Y)
- X ruler at bottom, Y ruler at left

---

## 13. Grid & Spacing Model

```
beadSpacingMm = beadDiameterMm + beadGapMm

cols = floor(bedWidthMm  / beadSpacingMm)
rows = floor(bedHeightMm / beadSpacingMm)
```

Example: 400×400 mm bed, 6 mm bead, 1 mm gap:
- spacing = 7 mm
- cols = floor(400/7) = 57
- rows = floor(400/7) = 57
- total = 3,249 beads

The gap is edge-to-edge clearance — the physical space between adjacent bead edges. Center-to-center pitch equals diameter + gap.

Canvas cell size: `cellPx = clamp(floor(680 / cols), 5, 40)`

Circle radius on canvas: `radiusPx = (beadDiameterMm / beadSpacingMm) × cellPx × 0.5`

---

## 14. Image Import

1. User selects any image file (JPEG, PNG, GIF, WebP, etc.)
2. Image is drawn to an offscreen canvas scaled to `cols × rows`
3. Each pixel's luminance is computed:
   ```
   luma = 0.299 × R + 0.587 × G + 0.114 × B
   ```
4. `luma < 128` → black bead (`grid[r][c] = 1`)
5. `luma ≥ 128` → white bead (`grid[r][c] = 0`)
6. The result replaces the current design; stats and canvas update immediately

The offscreen canvas uses `fillStyle = '#ffffff'` before drawing to ensure transparent pixels map to white.

---

## 15. SVG Export — Laser Cut Template

The **Download SVG** button generates a laser-cutting template for the physical base plate.

### Purpose

The SVG is used to laser-cut the bead holder plate — a flat sheet with a hole at every bead position. The operator places this plate on the machine bed; the CoreXY end-effector drops beads through the holes into the tray below.

### Format

- **No fills** — outlines only (`fill="none"`)
- **Stroke colour: red** (`stroke="red"`) — standard colour used by laser cutter software to identify cut paths
- **Stroke width: 0.1 mm** (`stroke-width="0.1"`) — hairline cut line
- **Bed border** — one rectangle at the outer edge of the plate
- **Bead holes** — one circle per bead position, all identical regardless of black/white color in the design
- **File name:** `bead_plate_lasercut.svg`

### Example output

```xml
<svg xmlns="http://www.w3.org/2000/svg"
     width="400mm" height="400mm"
     viewBox="0 0 400 400">
  <g fill="none" stroke="red" stroke-width="0.1">
    <rect x="0" y="0" width="400" height="400"/>  <!-- bed border -->
    <circle cx="3.500" cy="3.500" r="3"/>          <!-- bead hole -->
    <circle cx="10.500" cy="3.500" r="3"/>
    ...
  </g>
</svg>
```

### Geometry

- `cx = col × beadSpacingMm + beadSpacingMm / 2`
- `cy = row × beadSpacingMm + beadSpacingMm / 2`
- `r  = beadDiameterMm / 2`
- All values in mm; SVG `width`/`height` set in mm so scale is 1:1 physical

Note: SVG Y-axis is top-down (row 0 at top). This does not affect the laser cut result since the plate is physically symmetric.

---

## 16. Firmware Requirements (ESP32 / grbl_esp32)

Any firmware flashed to the ESP32 must satisfy these requirements for the browser app to work correctly.

### 16.1 Protocol

- **GRBL 1.1 compatible** — the app assumes standard GRBL 1.1 command and response format
- **USB CDC serial** at **115200 baud**, 8N1
- Send a welcome string on boot: `Grbl N.N ['$' for help]` — this lets the app detect connection
- Respond `ok` (lowercase, alone on a line) after every successfully received and queued command
- Respond `error:N` for invalid commands (N = GRBL error code)
- Respond `ALARM:N` for alarm conditions

### 16.2 Commands the Firmware Must Handle

| Command | Required behaviour |
|---|---|
| `?` | Immediately respond with `<State\|WPos:x,y,z\|FS:feed,spindle>` without consuming an `ok` slot |
| `$H` | Run homing cycle using limit switches; respond `ok` when complete |
| `$X` | Clear alarm state; respond `ok` |
| `G21` | Set internal units to mm; respond `ok` |
| `G90` | Set absolute positioning mode; respond `ok` |
| `G28` | Move to stored home position (or machine zero); respond `ok` |
| `G0 X{x} Y{y} F{f}` | Rapid linear move to absolute position; respond `ok` when move completes |
| `G4 P{ms}` | Dwell for specified milliseconds; respond `ok` after dwell |
| `M3 S110` | Servo to left position; respond `ok` |
| `M3 S22` | Servo to right position; respond `ok` |
| `M3 S60` | Servo to rest (neutral); respond `ok` |
| `M30` | End of program; respond `ok` |
| `$J=G91 G21 X{n} F{f}` | Execute relative jog move; respond `ok` |
| `!` | Feed hold (real-time byte, no `ok` sent) |
| `\x18` | Soft reset (real-time byte; re-send welcome string) |

### 16.3 Spindle → Servo Mapping

The ESP32 firmware maps GRBL spindle S-values to PWM pulse widths on GPIO 27 (50 Hz BESC output):

```
M3 S110  →  Left  position  (drops left bead)
M3 S22   →  Right position  (drops right bead)
M3 S60   →  Rest  position  (neutral — no bead dropped)
```

Firmware type: `SPINDLE_TYPE = BESC`, output pin: `GPIO_NUM_27`. The S-value maps linearly to pulse width within the configured min/max range.

### 16.4 Homing

- Limit switches must be connected to the ESP32 inputs configured in grbl_esp32 settings
- `$H` triggers the homing cycle: machine moves toward limit switches at homing speed, backs off, and sets machine position to (0, 0, 0)
- After homing, `WPos` in status reports should read `0.000, 0.000, 0.000`
- Homing direction and speed are configured via GRBL `$` settings (e.g. `$23`, `$24`, `$25`)

### 16.5 Position Reporting

The `?` status response must include work position (`WPos`):
```
<Idle|WPos:10.500,25.000,0.000|FS:3000,100>
```

The app parses only X and Y from `WPos`. Z is ignored. `MPos` (machine position) can also be used if WPos is not available — update the regex in `parseGrblStatus()` accordingly.

### 16.6 GRBL Settings (recommended starting values)

Configure via `$$` command in the GRBL terminal:

| Setting | Parameter | Recommended |
|---|---|---|
| `$0` | Step pulse time (µs) | 10 |
| `$1` | Step idle delay (ms) | 25 |
| `$2` | Step port invert mask | depends on wiring |
| `$3` | Direction port invert | depends on wiring |
| `$4` | Step enable invert | 0 |
| `$20` | Soft limits enable | 1 |
| `$21` | Hard limits enable | 1 |
| `$22` | Homing cycle enable | 1 |
| `$23` | Homing direction invert | depends on wiring |
| `$24` | Homing feed rate (mm/min) | 25 |
| `$25` | Homing seek rate (mm/min) | 500 |
| `$27` | Homing pull-off (mm) | 1 |
| `$100` | X steps/mm | calibrate to hardware |
| `$101` | Y steps/mm | calibrate to hardware |
| `$110` | X max rate (mm/min) | e.g. 5000 |
| `$111` | Y max rate (mm/min) | e.g. 5000 |
| `$120` | X acceleration (mm/s²) | e.g. 200 |
| `$121` | Y acceleration (mm/s²) | e.g. 200 |
| `$130` | X max travel (mm) | = bed width |
| `$131` | Y max travel (mm) | = bed height |

---

## 17. Hardware Summary

| Component | Specification |
|---|---|
| Controller | ESP32 (any variant with USB CDC or USB-UART bridge) |
| Firmware | grbl_esp32 (GRBL 1.1 compatible) |
| Motion | CoreXY kinematics |
| Motors | 2× stepper (X/Y combined for CoreXY) |
| Drivers | Any GRBL-compatible stepper driver (e.g. DRV8825, TMC2208) |
| Limit switches | Min X, Min Y (or Max, depending on homing direction) |
| Bead dropper | 1× servo on GPIO 27 (50 Hz PWM) — left/right/rest positions |
| - Left position | `M3 S110` |
| - Right position | `M3 S22` |
| - Rest (neutral) | `M3 S60` |
| Bed | Flat tray, configurable size (default 400×400 mm) |
| Bead size | 6 mm diameter (default), 1 mm gap, 7 mm pitch |
| Host | PC/Mac/Linux running Chrome or Edge (Web Serial API) |

---

## 18. File Structure

```
pixel_art/
├── index.html    — Full page structure: left sidebar, canvas, right machine panel
├── style.css     — All styles (dark theme, sidebar, canvas, machine panel, terminal)
├── script.js     — All application logic:
│                   • Grid state and rendering
│                   • Ruler and snake path drawing
│                   • Mouse drawing (pen/eraser)
│                   • Image import and SVG export
│                   • buildGcodeLines() — G-code builder (shared)
│                   • G-code download
│                   • Web Serial API connect/disconnect/read loop
│                   • GRBL protocol handling (ok/error/alarm/status)
│                   • Checklist step handlers
│                   • Jog controls
│                   • Job streaming (sendNextJobLine, pause, stop)
│                   • Terminal logging
└── README.md     — This file
```

---

## 19. Settings Reference

### Design Settings

| Setting | HTML ID | Default | Min | Max | Step | Unit |
|---|---|---|---|---|---|---|
| Bed width | `#bed-w` | 400 | 10 | 2000 | 10 | mm |
| Bed height | `#bed-h` | 400 | 10 | 2000 | 10 | mm |
| Bead diameter | `#bead-diameter` | 6 | 0.5 | 200 | 0.5 | mm |
| Bead gap | `#bead-gap` | 1 | 0.1 | 50 | 0.1 | mm |
| Spacing | `#spacing-val` | 7 | — | — | — | mm (computed) |

### Machine Settings

| Setting | HTML ID | Default | Min | Max | Step | Unit |
|---|---|---|---|---|---|---|
| Origin X | `#origin-x` | 0 | −9999 | 9999 | 1 | mm |
| Origin Y | `#origin-y` | 0 | −9999 | 9999 | 1 | mm |
| Move speed | `#move-speed` | 800 | 100 | 5000 | 100 | mm/min |
| Dwell time | `#dwell-time` | 300 | 10 | 9999 | 10 | ms |
| Black bead side | `#black-bead-side` | Left | — | — | — | Left / Right |
| White bead side | `#white-bead-side` | Right | — | — | — | Left / Right |

### Jog Settings (machine panel)

| Setting | HTML ID | Options | Default |
|---|---|---|---|
| Step size | `#jog-step` | 1, 5, 10, 50 mm | 10 mm |
| Feed rate | `#jog-feed` | 1000, 3000, 6000 mm/min | 3000 (med) |

---

## 20. Changelog

### v10 — Calibrated servo, configurable bead sides, controlled motion

#### Machine / G-code
- **Calibrated S values** — replaced theoretical values with physically tested positions:
  - `M3 S110` → Left bead
  - `M3 S22`  → Right bead
  - `M3 S60`  → Rest (neutral)
- **Configurable bead sides** — new "Black bead" and "White bead" dropdowns let user assign which physical side holds each colour; GCode S-values update automatically
- **Startup rest** — `M3 S60` now sent before `G28` so servo is always in rest position before homing
- **Controlled moves** — positioning changed from rapid `G0` to feed-rate-controlled `G1`; default 800 mm/min, configurable 100–5000 mm/min
- **Full stop before drop** — `G4 P0` inserted after every move to flush the GRBL planner and guarantee machine is fully stopped before servo fires; eliminates mid-motion mis-drops
- **Bead drop test moves to separate slots** — test now drives to slot 1 (first bead position) for black drop, then to slot 2 (next slot, one spacing away) for white drop; both beads land in their own grid holes

#### UI — Machine Settings
- **Move speed input** — new `#move-speed` field (default 800 mm/min, 100–5000 range) controls feed rate for all positioning moves and bead test moves
- **Black bead side / White bead side** — two select dropdowns (`Left` / `Right`) determine which servo direction maps to each colour

#### Previous v10 additions (from earlier sessions)
- **Servo bead dropper** — end-effector servo on GPIO 27 replaces dual-feeder spindle model; M4/M5 removed
- **Per-bead servo cycle** — `G1 → G4 P0 → M3 S{val} → G4 P{dwell} → M3 S60`
- **G4 dwell fixed** — correctly sends `G4 P0.300` (300 ms) not `G4 P300` (300 s)
- **Skip bead drop test** — "Skip" button in checklist
- **Auto machine state poll** — Idle/Run/Alarm + position every 2 s
- **Time estimation** — est. time shown before job; elapsed/ETA during job
- **Terminal copy button**, MPos parser, split status fix

---

### v9 — SVG export changed to laser-cut template

- **Outlines only** — removed all fills; SVG now has `fill="none"` throughout
- **Red stroke** — all paths use `stroke="red"` (standard laser-cut colour)
- **0.1 mm stroke width** — hairline weight suitable for laser cutter cut paths
- **Bed border added** — outer rectangle at exact bed dimensions marks the plate boundary
- **All holes identical** — every bead position gets a circle regardless of black/white; the SVG is a cutting template, not a colour preview
- **File renamed** — downloads as `bead_plate_lasercut.svg` to clarify its purpose

### v8 — USB Serial machine control panel

- **Web Serial API** — browser connects directly to ESP32 via USB (Chrome/Edge ≥ 89)
- **Right panel** — 262 px panel added to the right of the canvas with all machine controls
- **Pre-run checklist** — 7-step sequential verification process before every print
- **Homing** — `$H` command with `ok`-gated response; ALARM unlock hint shown on failure
- **Origin move** — `G21 G90 G0 X Y` sequence driven by sidebar Origin X/Y values
- **X/Y axis tests** — relative jogs with browser confirm dialog for user verification
- **Bead drop test** — `M3 S100 → G4 P{dwell} → M5` sequence with user confirm
- **Machine state display** — parsed from GRBL `<WPos:...>` status reports
- **Jog pad** — 3×3 directional pad with configurable step and feed; ⌂ goes to origin
- **G-code streaming** — `ok`-gated line-by-line send from `buildGcodeLines()`
- **Pause / Resume / Stop** — pause after current line; stop sends `!` + `\x18`
- **Progress tracking** — bar and `line N / total (N%)` counter
- **Terminal** — colour-coded RX/TX/system/error log; manual send; 600-line cap
- **`buildGcodeLines()`** — refactored shared function used by both download and streamer

### v7 — X ruler moved to bottom

- X ruler relocated to bottom of canvas; both axes now meet at bottom-left corner
- Canvas layout: grid at y=0, X ruler below grid, Y ruler on left; origin corner at bottom-left
- All grid Y pixel coordinates updated (no top offset); `cellFromEvent()` updated accordingly

### v6 — Y-up coordinate system (origin at bottom-left)

- Origin moved to bottom-left: preview matches standard machine/CAD coordinates
- (0,0) is at front-left corner; Y increases upward
- Y ruler flipped: 0 at bottom, max at top
- Row direction arrows updated: row 0 (▶ L→R) visually at bottom
- Path overlay corrected: snake path draws from bottom upward
- G-code coordinates unchanged (were already correct)

### v5 — Rulers, path direction overlay, SVG export

- X/Y axis rulers with mm scale; tick density adapts to zoom level
- Row direction arrows (▶/◀) in Y ruler showing snake-path travel direction per row
- Show Path toggle: overlays full snake path with arrowheads
- SVG download: physically accurate (`width="Nmm"`), circles at real mm coordinates

### v4 — Gap-based spacing model + live spacing display

- Gap input replaces manual spacing: user sets edge-to-edge clearance (default 1 mm)
- Spacing auto-computed: `diameter + gap`; shown live before Apply Grid
- G-code header now logs diameter, gap, and spacing separately

### v3 — Separate files + bead spacing/diameter split

- Refactored into `index.html`, `style.css`, `script.js`
- Bead spacing (center-to-center pitch) and bead diameter split into separate inputs
- Accurate circle sizing: `radiusPx = (diameter / spacing) × cellPx / 2`

### v2 — Two-phase UX + circles + color pickers + origin

- Two-phase workflow: setup → Apply Grid → design tools unlock
- Configurable bed size
- Beads rendered as circles (not squares)
- Live bead count stats
- Color pickers for black bead, white bead, space
- Origin X/Y inputs offset all G-code coordinates

### v1 — Initial version

- Grid canvas with pen and eraser tools
- Configurable bead size and dwell time
- Image import with luminance thresholding
- G-code generation with snake path and dual feeder control
