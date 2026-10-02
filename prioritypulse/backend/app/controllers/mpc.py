"""Receding-horizon prediction model used by PriorityPulse.

For one intersection and a set of candidate signal actions, roll the queue model
forward ``H`` seconds (all candidates at once, vectorised over the candidate axis):

    Q^(k+1) = min[ C, max(0, Q^(k) + A^(k) - D^(k)) ]
    D^(k)   = min[ Q^ + A^, s_eff * dt, room ] * G^(k)

and score each rollout with the cost terms of J(a):

    w_EV D_EV + w_Q sum Q^2 + w_D sum Q^ dt + w_S spillback + w_F fairness
    + w_P pedestrian wait + w_C phase change [+ transit]

The rollout is deliberately simpler than the simulator (no stochastic arrivals,
independent downstream room per movement) — it is a *predictor*, and the
simulator is the plant it is checked against every second.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ..config import ControlWeights

BIG = 1e9
UNSERVED_PENALTY_S = 5.0     # extra seconds charged to a tracked vehicle not served in the horizon


@dataclass
class Candidate:
    """One legal signal action over the horizon."""

    kind: str                    # "hold" | "switch"
    target: int | None           # target phase (None for hold)
    start: int                   # step at which the yellow begins (switch only)
    label: str = ""
    tags: list[str] = field(default_factory=list)


@dataclass
class TrackedVehicle:
    """A priority vehicle approaching this intersection (EV or bus)."""

    mi: int                      # local movement index
    eta: float                   # seconds until it reaches the stop line (free flow)
    thr: int                     # vehicles that may remain ahead
    weight: float
    kind: str = "ev"
    joined: bool = False
    ahead: int = 0


@dataclass
class NodeStatic:
    """Static per-intersection arrays (computed once)."""

    mids: list[int]
    sat: np.ndarray              # [M] veh/s at clear weather
    phase_of: np.ndarray         # [M] int
    own_links: list[int]         # link indices of the approaches
    own_of: np.ndarray           # [M] index into own_links
    down_links: list[int]        # distinct non-exit downstream link indices
    down_of: np.ndarray          # [M] index into down_links, -1 for exits
    n_phases: int


def build_static(sim, ni: int) -> NodeStatic:
    net = sim.net
    nd = net.intersections[ni]
    mids = [m.idx for m in net.movements if m.node == nd.id]
    own, down = [], []
    own_of, down_of = [], []
    for m in mids:
        li = sim.mv_link[m]
        if li not in own:
            own.append(li)
        own_of.append(own.index(li))
        if sim.mv_out_exit[m]:
            down_of.append(-1)
        else:
            oi = sim.mv_out[m]
            if oi not in down:
                down.append(oi)
            down_of.append(down.index(oi))
    return NodeStatic(
        mids=mids,
        sat=np.array([net.movements[m].sat_flow for m in mids], dtype=float),
        phase_of=np.array([net.movements[m].phase for m in mids], dtype=int),
        own_links=own, own_of=np.array(own_of, dtype=int),
        down_links=down, down_of=np.array(down_of, dtype=int), n_phases=len(nd.phases),
    )


# ---------------------------------------------------------------------------
# timeline of signal states for a candidate
# ---------------------------------------------------------------------------

def phase_factors(sig, cand: Candidate, H: int, yellow_factor: float, n_phases: int) -> np.ndarray:
    """F[k, p]: service factor of phase p at step k under candidate ``cand`` (state must be GREEN)."""
    y = int(round(sig.p.yellow))
    r = int(round(sig.p.all_red))
    F = np.zeros((H, n_phases))
    cur = sig.phase
    if cand.kind == "hold" or cand.target is None:
        F[:, cur] = 1.0
        return F
    ks = max(0, cand.start)
    for k in range(H):
        if k < ks:
            F[k, cur] = 1.0
        elif k < ks + y:
            F[k, cur] = yellow_factor
        elif k < ks + y + r:
            pass
        else:
            F[k, cand.target] = 1.0
    return F


# ---------------------------------------------------------------------------
# rollout
# ---------------------------------------------------------------------------

def rollout(
    st: NodeStatic,
    cands: list[Candidate],
    sig,
    *,
    H: int,
    w: ControlWeights,
    Q0: np.ndarray, gel0: np.ndarray, credit0: np.ndarray, wait0: np.ndarray,
    A_hat: np.ndarray,                 # [H, M]
    room: np.ndarray,                  # [M] departures allowed before downstream blocks/fills
    s_eff_full: np.ndarray,            # [M] veh/s incl. weather/incident factors
    tau_startup: float, yellow_factor: float, dt: float,
    own_cap: np.ndarray, own_transit0: np.ndarray, own_cumA: np.ndarray,   # [Lo], [Lo], [H, Lo]
    down_cap: np.ndarray, down_occ0: np.ndarray,                           # [Ld]
    ped_pending: np.ndarray, ped_wait0: np.ndarray, ped_phase: np.ndarray,  # [X]
    tracked: list[TrackedVehicle],
) -> dict[str, Any]:
    C = len(cands)
    M = len(st.mids)
    F = np.stack([phase_factors(sig, c, H, yellow_factor, st.n_phases) for c in cands])   # [C,H,P]
    Fm = F[:, :, st.phase_of]                                                        # [C,H,M]

    Q = np.tile(Q0.astype(float), (C, 1))
    gel = np.tile(gel0.astype(float), (C, 1))
    credit = np.tile(credit0.astype(float), (C, 1))
    wait = np.tile(wait0.astype(float), (C, 1))
    sent = np.zeros((C, M))
    pw = np.tile(ped_wait0.astype(float), (C, 1)) if len(ped_wait0) else np.zeros((C, 0))

    own_onehot = np.eye(len(st.own_links))[st.own_of] if st.own_links else np.zeros((M, 0))          # [M,Lo]
    down_onehot = np.zeros((M, len(st.down_links)))
    for m, d in enumerate(st.down_of):
        if d >= 0:
            down_onehot[m, d] = 1.0

    sum_q2 = np.zeros(C)
    delay = np.zeros(C)
    spill = np.zeros(C)
    fair = np.zeros(C)
    pedc = np.zeros(C)
    served_total = np.zeros(C)

    pv_states = [{"ahead": np.full(C, float(pv.ahead)) if pv.joined else None,
                  "t_pass": np.full(C, np.inf)} for pv in tracked]

    t_fair = w.t_fair
    ped_max = max(1.0, w.ped_wait_max)
    for k in range(H):
        on = Fm[:, k, :]
        active = on > 0
        gel = (gel + dt) * active
        s_eff = s_eff_full * (1.0 - np.exp(-gel / tau_startup)) * on
        credit = (credit + s_eff * dt) * active
        avail = Q + A_hat[k]
        lim = np.floor(credit + 1e-9)
        D = np.minimum(np.minimum(avail, lim), np.maximum(0.0, room - sent))
        credit = np.clip(credit - D, 0.0, 1.0) * active
        Q_before = avail
        Q = avail - D
        sent += D
        served_total += D.sum(axis=1)
        wait = np.where((D > 0) | (Q <= 0), 0.0, wait + dt)

        sum_q2 += (Q ** 2).sum(axis=1)
        delay += Q.sum(axis=1) * dt
        over = np.maximum(0.0, (wait - t_fair) / t_fair)
        fair += (over ** 2).sum(axis=1)

        # spillback risk on own approaches and on the links we feed
        if len(st.own_links):
            own_q = Q @ own_onehot                                           # [C,Lo]
            transit = np.maximum(0.0, own_transit0 - own_cumA[k])            # [Lo]
            ratio = (own_q + transit) / np.maximum(1.0, own_cap)
            spill += (np.minimum(ratio, 1.5) ** w.eta).sum(axis=1)
        if len(st.down_links):
            d_occ = down_occ0 + sent @ down_onehot                           # [C,Ld]
            ratio = d_occ / np.maximum(1.0, down_cap)
            spill += (np.minimum(ratio, 1.5) ** w.eta).sum(axis=1)

        # pedestrians: a pending call is served when its parallel phase is fully green
        if pw.shape[1]:
            green_ped = F[:, k, :][:, ped_phase] >= 0.999                    # [C,X]
            pw = np.where(green_ped | ~ped_pending[None, :], 0.0, pw + dt)
            pedc += ((pw / ped_max) ** 2).sum(axis=1)

        for pv, stt in zip(tracked, pv_states):
            if k < int(math.ceil(pv.eta - 1e-9)):
                continue
            if stt["ahead"] is None:
                stt["ahead"] = Q_before[:, pv.mi].copy()
            stt["ahead"] = np.maximum(0.0, stt["ahead"] - D[:, pv.mi])
            full_green = F[:, k, st.phase_of[pv.mi]] >= 0.999
            ok = full_green & (stt["ahead"] <= pv.thr) & np.isinf(stt["t_pass"])
            stt["t_pass"][ok] = k

    ev_cost = np.zeros(C)
    pv_delay = []
    for pv, stt in zip(tracked, pv_states):
        tp = stt["t_pass"]
        ahead = stt["ahead"] if stt["ahead"] is not None else np.zeros(C)
        unserved = np.maximum(0.0, H - pv.eta) + ahead / max(st.sat[pv.mi], 0.05) + UNSERVED_PENALTY_S
        d_c = np.where(np.isfinite(tp), np.maximum(0.0, tp - pv.eta), unserved)
        pv_delay.append(d_c)
        ev_cost += pv.weight * d_c

    switch_pen = np.array([1.0 if c.kind == "switch" and c.start < H else 0.0 for c in cands])
    terms = {
        "ev": ev_cost,
        "queue": w.w_q * sum_q2,
        "delay": w.w_d * delay,
        "spillback": w.w_s * spill,
        "fairness": w.w_f * fair,
        "pedestrian": w.w_p * pedc,
        "switch": w.w_c * switch_pen,
    }
    total = sum(terms.values())
    return {"total": total, "terms": terms, "served": served_total, "pv_delay": pv_delay,
            "delay_raw": delay, "Q_end": Q}
