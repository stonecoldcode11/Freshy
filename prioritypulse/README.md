# PriorityPulse

**Predictive emergency-vehicle signal priority — simulated, explained, and checked for safety.**

Every second PriorityPulse predicts how many vehicles will arrive, how long queues will take to clear, when an emergency vehicle will reach each intersection, and whether downstream roads have room. It then chooses the **safest legal** signal action that reduces emergency delay without creating gridlock, unsafe transitions, or unfair delay elsewhere — and tells you *why*.

- **Backend:** Python 3.11+, FastAPI, NumPy — the simulator, the three controllers, the safety monitor, exports.
- **Frontend:** TypeScript, React, Vite — live map, dispatch center, explanations, comparison, report.

| | |
|---|---|
| ![Live view](docs/screenshots/01-live-community.png) | ![Compare](docs/screenshots/02-compare.png) |
| ![Why did it change?](docs/screenshots/03-engineer-why.png) | ![Transit and pedestrians](docs/screenshots/04-school-transit-pedestrians.png) |

> This is a **simulation**. It is not connected to live traffic-signal infrastructure, and the numbers below come from a model with stated assumptions (see [Limitations](#limitations-and-honest-notes)).

## Quick start

Requirements: Python ≥ 3.11, Node ≥ 20.

```bash
cd prioritypulse
make install          # creates backend/.venv, installs Python + npm dependencies
make serve            # builds the frontend and serves everything on http://localhost:8000
```

For development with hot reload, run the two halves separately:

```bash
make backend          # API on :8000        (uvicorn --reload)
make frontend         # UI on :5173         (Vite, proxies /api to :8000)
```

Other targets: `make test` (pytest + vitest + typecheck), `make bench` (reproduce the results table).

Without `make`:

```bash
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
python -m uvicorn app.main:app --port 8000
cd ../frontend && npm install && npm run dev
```

## What you can do in the app

| Feature | Where |
|---|---|
| **Three-mode comparison** — fixed-time vs reactive preemption vs PriorityPulse, identical seeded arrivals | *Compare modes* tab (headline numbers; Engineer View shows every metric) |
| **Emergency dispatch** — type, origin, destination, priority, departure time; live ETA at each intersection, queue ahead, `T_clear`, `T_safe`, "begin preemption in *n* s" | Sidebar *Dispatch center* + *Emergency vehicle* panel |
| **Safe preemption sequence** — green → yellow → all-red → emergency green, never shortcut | *Emergency vehicle* panel stepper, enforced by the signal state machine |
| **Queue heatmap & spillback alert** — storage ratio `Q/C` coloured *and* iconed (✓ ~ ! ✕) with hatching on blocked links | Map legend, *Queue storage & spillback* panel |
| **"Why did it change?"** — every phase change with reasons, safety checks, and the cost `J(a)` of each candidate action | *Why did it change?* panel |
| **Pedestrian-safe mode** — walk + flashing-don't-walk + clearance is a hard constraint; school-zone variant; *Press* button re-runs a what-if | *Pedestrian safety* panel |
| **Real-map simulator** — search/click 1–5 intersections, confirm lanes and speeds, optional OpenStreetMap lookup | Sidebar → *Real location…* |
| **Scenario library** — rush hour, school dismissal, stadium exit, crash diversion, fire dispatch, rain/snow | Sidebar |
| **Corridor green wave** — when each intersection turns green for the vehicle, offsets `θ`, recovery stage afterwards | *Corridor green wave* panel |
| **Fairness monitor** — longest wait per direction against the 60 s soft / 120 s hard thresholds | *Fairness monitor* panel |
| **Report & export** — outcome report, metrics / time-series / decision-log / event CSVs, JSON | *Report & export* tab |
| **Transit priority** — late buses get a soft preference *below* the emergency vehicle | *Transit & school-bus priority* panel (school scenario) |
| **Weather / incidents** — slower speeds and lower discharge; lane closures | Scenarios + *Conditions* |
| **Accessibility** — keyboard shortcuts (press `?`), colour-blind-safe palette with icons/patterns, reduced motion, high contrast, dark theme, screen-reader announcements, a data table behind each line chart | Header |
| **Community / Engineer view** — plain language vs. queues, constraints and controller cost | Header (or press `V`) |

## How it works

```
 scenario + seed ──► demand (Beta · sigmoid · Poisson, drawn once)
                            │  identical arrivals for every mode
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   fixed-time        reactive preemption     PriorityPulse
   (pre-timed)       (detector, ~12 s)       (MPC + proactive trigger)
        └───────────────────┬───────────────────┘
                            ▼
        signal state machine (the only thing that can change a light)
        G → Y → all-red → G′ · min green · pedestrian clearance · conflicts
                            ▼
        queue physics (dt = 1 s):  Q⁺ = Q + A − D,  D = min[Q+A, s_eff, room]·G·B
                            ▼
        metrics + an independent SafetyMonitor that re-audits every transition
```

**Controllers only *request*; the signal machine decides.** Every controller calls `request_switch()`. The state machine refuses anything illegal (before minimum green, during pedestrian clearance, mid-yellow). A separate `SafetyMonitor` re-derives legality from the transition log — it does not trust the controller or the state machine — and the compliance figure you see is its verdict. Unit tests feed it deliberately illegal logs to prove it flags them.

**PriorityPulse each second, per intersection:**

1. *Predict arrivals* — vehicles already in transit on the approach (exact) plus the expected flow.
2. *Emergency trigger* — `t_trigger = ETA − (T_clear + T_safe + T_buffer)`. `T_safe` includes the remaining minimum green, any pedestrian interval still running, yellow and all-red; `T_clear` is the queue ahead divided by the discharge rate (with start-up lost time).
3. *Enumerate candidates* — hold, extend 5/10 s then switch, switch now — and **filter** by the hard constraints: maximum green, spillback guard, anti-starvation, and (while an emergency is approaching) only detours that still leave time to restore the emergency phase.
4. *Roll each survivor forward 24 s* (vectorised NumPy) and score it with `J(a) = w_EV·D_EV + w_Q·ΣQ² + w_D·ΣQΔt + w_S·spillback + w_F·fairness + w_P·pedestrian + w_C·switch`.
5. *Apply only the first action*, then re-plan (receding horizon).

Where each part of the blueprint lives:

| Layer | Code |
|---|---|
| 0 Network, storage `C = ⌊L·n/h_jam⌋`, conflict matrix | `backend/app/network.py`, `geo.py` |
| 1 Beta / sigmoid / Poisson demand, scenarios | `demand.py`, `scenarios.py` |
| 2 Queue physics, departures, spillback block | `simulator.py` |
| 3 Emergency vehicle, ETA, trigger | `vehicles.py`, `controllers/prioritypulse.py` |
| 4 Signal state machine, MPC | `signals.py`, `controllers/mpc.py` |
| 5 Corridor offsets, guard, fairness | `controllers/prioritypulse.py`, `controllers/fixed.py` |
| Metrics, comparison, report | `metrics.py`, `report.py` |

The **Technical model** tab in the app renders the equations (KaTeX) and lists every place this implementation differs from the written blueprint.

## Results

Reproduce with `make bench` (≈ 35 s). Mean over seeds 1–10; every seed gives all three modes the same arrivals, pedestrian calls and warm-up state. All numbers are simulation output, not field measurements.

| Scenario | Mode | EV time (s) | EV stops | Driver delay (s/veh) | Max queue | Spillback episodes | Blocked-link s | Longest wait (s) | Safety |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Rush-Hour Ambulance | Fixed-time | 90.6 | 2.9 | 70.1 | 46.8 | 0.5 | 8 | 104 | 100% |
| Rush-Hour Ambulance | Reactive preemption | 70.5 | 1.8 | 68.8 | 42.8 | 0.1 | 2 | 170 | 100% |
| Rush-Hour Ambulance | **PriorityPulse** | **48.3** | **0.1** | **67.8** | **33.5** | **0.0** | **0** | 111 | 100% |
| School Dismissal | Fixed-time | 109.0 | 3.5 | 64.9 | 29.3 | 0.1 | 3 | 136 | 100% |
| School Dismissal | Reactive preemption | 79.3 | 1.8 | 65.0 | 27.5 | 0.1 | 3 | 180 | 100% |
| School Dismissal | **PriorityPulse** | **54.5** | **0.0** | **63.1** | **24.0** | **0.0** | **0** | 140 | 100% |
| Stadium Exit | Fixed-time | 105.9 | 3.1 | 90.9 | 43.7 | 2.9 | 499 | 104 | 100% |
| Stadium Exit | Reactive preemption | 55.3 | 0.1 | 92.4 | 43.7 | 3.0 | 509 | 129 | 100% |
| Stadium Exit | **PriorityPulse** | **50.8** | **0.0** | **85.5** | 44.4 | **1.5** | **206** | 112 | 100% |
| Crash Diversion | Fixed-time | 253.7 (4 of 10 never arrived) | 18.3 | 88.1 | 78.1 | 4.0 | 350 | 191 | 100% |
| Crash Diversion | Reactive preemption | 119.7 | 24.6 | 88.2 | 76.1 | 5.4 | 282 | 145 | 100% |
| Crash Diversion | **PriorityPulse** | **95.3** | **18.8** | **84.2** | **70.2** | 4.8 | **130** | 158 | 100% |
| Fire Station Dispatch | Fixed-time | 65.2 | 2.3 | 54.6 | 27.3 | 0.0 | 0 | 104 | 100% |
| Fire Station Dispatch | Reactive preemption | 41.0 | 1.2 | 54.1 | 26.7 | 0.0 | 0 | 138 | 100% |
| Fire Station Dispatch | **PriorityPulse** | **29.2** | **0.0** | **51.5** | **20.3** | 0.0 | 0 | 107 | 100% |
| Rain or Snow | Fixed-time | 149.5 | 7.0 | 68.1 | 27.4 | 0.0 | 0 | 105 | 100% |
| Rain or Snow | Reactive preemption | 94.2 | 9.0 | 68.3 | 24.6 | 0.0 | 0 | 150 | 100% |
| Rain or Snow | **PriorityPulse** | **65.8** | **0.6** | 69.7 | **21.2** | 0.0 | 0 | 108 | 100% |

| Scenario | EV time vs fixed | EV time vs reactive | Faster than fixed | Faster than reactive |
|---|---:|---:|---:|---:|
| Rush-Hour Ambulance | 47% faster | 31% faster | 10/10 seeds | 10/10 seeds |
| School Dismissal | 50% faster | 31% faster | 10/10 seeds | 10/10 seeds |
| Stadium Exit | 52% faster | **8% faster** | 10/10 seeds | 8/10 seeds |
| Crash Diversion | 62% faster | 20% faster | 10/10 seeds | 9/10 seeds |
| Fire Station Dispatch | 55% faster | 29% faster | 10/10 seeds | 10/10 seeds |
| Rain or Snow | 56% faster | 30% faster | 10/10 seeds | 10/10 seeds |

**What this does and does not show**

- The emergency vehicle is consistently and substantially faster, with essentially no stops (except in the crash scenario, where the route itself runs through the blocked link). The independent safety audit covered all 180 runs of this benchmark (6 scenarios × 10 seeds × 3 modes, 11,798 signal transitions) and found **zero** illegal transitions and **zero** conflicting greens.
- Driver delay is roughly level to modestly better — PriorityPulse is not buying emergency speed with driver delay — **except in snow, where its average driver delay is ~2% worse than fixed-time** (69.7 vs 68.1 s).
- Against *reactive* preemption the margin is large in most scenarios but only **8% in the stadium scenario** (the detector alone is already fairly effective on an uncongested main street), and 2 of 10 seeds go the other way there.
- Spillback: the guard cuts the time links spend ≥ 85% full by about 60% in the stress scenarios (stadium 499 → 206 s, crash 350 → 130 s versus fixed-time), but it mostly *relocates* the queue upstream rather than preventing it: episodes fall from 2.9 to 1.5 in the stadium scenario but are *not* lower in the crash scenario (4.8 vs 4.0 for fixed-time), and the stadium *maximum queue* is slightly higher (44.4 vs 43.7).
- The 120 s fairness cap is **not** absolute: pedestrian clearance, emergency preemption and the spillback guard outrank it, so PriorityPulse's longest wait exceeds 120 s in the school (140 s) and crash (158 s) scenarios. The baselines exceed it too: reactive preemption reaches 170–180 s in the rush-hour and school scenarios, and fixed-time reaches 191 s in the crash scenario.
- Also measured: the late bus in the school scenario is delayed ≈ 22 s under PriorityPulse versus ≈ 64 s (fixed-time) and ≈ 63 s (reactive), mean of 10 seeds, without slowing the ambulance.

## Project layout

```
prioritypulse/
├── backend/
│   ├── app/
│   │   ├── main.py            FastAPI routes
│   │   ├── runner.py          build → run three modes → compare; in-memory run store
│   │   ├── simulator.py       Layer-2 physics
│   │   ├── signals.py         signal state machine, pedestrian stages, SafetyMonitor
│   │   ├── vehicles.py        emergency vehicle / bus model
│   │   ├── controllers/       fixed.py · reactive.py · prioritypulse.py · mpc.py
│   │   ├── network.py geo.py demand.py scenarios.py metrics.py report.py schemas.py config.py
│   ├── scripts/benchmark.py   reproduces the results table
│   └── tests/                 118 tests (physics, safety, controllers, API)
├── frontend/src/              React + TypeScript (components/, lib/, api.ts, types.ts)
├── docs/screenshots/
└── Makefile
```

## API

| Method & path | Purpose |
|---|---|
| `GET /api/scenarios` · `/api/meta` · `/api/network/demo` | Library, defaults, demo graph |
| `POST /api/runs` | Run one or all modes; returns frames, events, decisions, metrics, comparison |
| `POST /api/network/from-points` | Build a corridor from 1–5 map points (+ optional OSM lookup) |
| `POST /api/osm/enrich` | Lane / speed suggestions (best effort; degrades gracefully offline) |
| `GET /api/runs/{id}/export.csv?kind=metrics\|timeseries\|events\|decisions&mode=…` | CSV exports |
| `GET /api/runs/{id}/report.md` · `report.json` | Outcome report |

Interactive docs at `/docs` when the server is running. Weight overrides on `/api/runs` are validated against hard bounds.

## Testing

```bash
make test
```

- **Backend (pytest):** vehicle conservation every step, discharge ≤ saturation flow, start-up lost time, spillback guard, conflict matrix, signal legality, the safety monitor catching illegal logs, the trigger arithmetic `t_trigger = ETA − (T_clear + T_safe + T_buffer)` checked in every recorded frame, pedestrian-walk-never-overlaps-conflicting-green over whole runs, determinism, API validation.
- **Frontend (vitest + `tsc`):** heat scale, geometry, formatting, validation-error formatting. The UI was also exercised in headless Chromium (keyboard shortcuts, scenario switch, what-if pedestrian press, map-based network build, dark / high-contrast / reduced-motion).

## Limitations and honest notes

- **A model, not reality.** Demand, saturation flows, spacing, signal timing and the vehicle behaviour rules are assumptions; no calibration against field data has been done. Treat comparisons between modes as meaningful and absolute numbers as illustrative.
- **PriorityPulse is told about a call 20 s before departure** (crew turnout); the baselines are not. All modes warm up under the same fixed-time plan so they start from an identical state.
- **Simplified geometry:** one main street, one side street per intersection, protected left turns, four phases. Map-based mode uses your clicked positions and spacing but does not import turn lanes or real signal plans, and uses straight links.
- **Single emergency vehicle** per run; buses are scheduled by the scenario.
- **Idling, not CO₂.** The report states "estimated idling reduction"; an optional CO₂ figure uses an *assumed* 0.7 g per idling vehicle-second, flagged as a scenario parameter.
- Run results are kept in server memory (the 8 most recent) for exports; nothing is persisted.
- Address search and map tiles use OpenStreetMap services from the browser and the optional lane lookup uses Overpass from the server; all are optional and the app works offline without them.
