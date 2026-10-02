"""Layer 1: stochastic traffic demand.

Everything random is drawn *up front* from a seed, so every controller faces
exactly the same exogenous arrivals (seed_fixed = seed_reactive = seed_PP).

    mu_K(t)          demand profile (constant intensity or Gaussian peaks)
    Z(t) ~ Beta      bounded demand variability, K(t) = K_min + Z (K_max - K_min)
    pi_hat_{i,m}(t)  turning proportions with a sigmoid time-varying shift, normalised
    A_{i,m}(t) ~ Poisson(q_i * K(t) * pi_hat_{i,m}(t) * M_i(t) * dt)
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .config import WEATHER_FACTORS, SimConfig
from .network import MOVES, Network
from .scenarios import Scenario

K_MIN = 0.05
K_MAX = 1.0
BLOCK_S = 30            # Beta draws are made per block and interpolated between blocks


@dataclass
class DemandTable:
    """Pre-generated, controller-independent demand."""

    entry_links: list[str]
    arrivals: np.ndarray        # int16  [T, E, 3]  A_{i,m}(t)
    lam: np.ndarray             # float32 [T, E, 3] expected rates (what controllers may know)
    K: np.ndarray               # float32 [T]
    ped_calls: np.ndarray       # bool    [T, X]
    crosswalks: list[str]
    seed: int

    @property
    def total_arrivals(self) -> int:
        return int(self.arrivals.sum())


def demand_profile(t: float, scenario: Scenario, intensity: float) -> float:
    """mu_K(t): mean of the demand intensity at time t (clipped to [K_MIN, K_MAX])."""
    mu = intensity
    for pk in scenario.peaks:
        mu += pk["amp"] * math.exp(-((t - pk["mu"]) ** 2) / (2.0 * pk["sigma"] ** 2))
    return min(K_MAX, max(K_MIN, mu))


def sigmoid_turns(base: tuple[float, float, float], delta: tuple[float, float, float],
                  t: float, t_switch: float, k: float) -> tuple[float, float, float]:
    """pi(t) = pi_base + dpi / (1 + exp(-k (t - t_switch))), then normalised to sum 1."""
    s = 1.0 / (1.0 + math.exp(-k * (t - t_switch)))
    raw = [max(1e-4, b + d * s) for b, d in zip(base, delta)]
    tot = sum(raw)
    return (raw[0] / tot, raw[1] / tot, raw[2] / tot)


def generate_demand(net: Network, cfg: SimConfig, scenario: Scenario) -> DemandTable:
    T = cfg.duration + cfg.warmup        # warm-up steps get demand too (t_rel = idx - warmup)
    ss = np.random.SeedSequence(cfg.seed)
    rng_z, rng_a, rng_p = (np.random.default_rng(s) for s in ss.spawn(3))

    r_v, r_s, r_dem = WEATHER_FACTORS[cfg.weather]
    intensity = cfg.intensity if cfg.intensity is not None else scenario.intensity

    # --- K(t): Beta-distributed variation around mu_K(t), drawn per block --------------
    n_blocks = T // BLOCK_S + 2
    z = np.empty(n_blocks)
    for b in range(n_blocks):
        mu_k = demand_profile(b * BLOCK_S, scenario, intensity)
        mu_z = min(0.98, max(0.02, (mu_k - K_MIN) / (K_MAX - K_MIN)))
        z[b] = rng_z.beta(mu_z * scenario.phi, (1.0 - mu_z) * scenario.phi)
    block_k = K_MIN + z * (K_MAX - K_MIN)
    tt = np.arange(T) / BLOCK_S
    K = np.interp(tt, np.arange(n_blocks), block_k).astype(np.float32)

    # --- Poisson arrivals per entry movement --------------------------------------------
    entry = [lk for lk in net.links.values() if lk.kind == "entry"]
    entry_ids = [lk.id for lk in entry]
    E = len(entry)
    lam = np.zeros((T, E, 3), dtype=np.float32)
    for e, lk in enumerate(entry):
        shifts = [ts for ts in scenario.turn_shifts if ts.link == lk.id]
        surges = [sg for sg in scenario.surges if lk.id in sg.links]
        for t in range(T):
            mult = 1.0
            for sg in surges:
                mult *= sg.multiplier(t)
            pi = lk.turn_base
            for ts in shifts:
                pi = sigmoid_turns(pi, ts.delta, t, ts.t_switch, ts.k)
            rate = lk.base_volume * float(K[t]) * mult * r_dem
            for m in range(3):
                lam[t, e, m] = rate * pi[m] * net.phys.dt
    arrivals = rng_a.poisson(lam).astype(np.int16)

    # --- pedestrian calls (independent stream, identical across modes) -----------------
    xw = [c.id for nd in net.intersections for c in nd.crosswalks]
    p_call = 1.0 - math.exp(-scenario.ped_rate * net.phys.dt)
    ped = rng_p.random((T, max(1, len(xw)))) < p_call
    return DemandTable(entry_ids, arrivals, lam, K, ped[:, : len(xw)], xw, cfg.seed)


def split_counts(n: int, probs: tuple[float, float, float], acc: list[float]) -> tuple[int, int, int]:
    """Deterministic error-diffusion split of n vehicles over (L, T, R).

    Keeps cumulative flows proportional to ``probs`` without consuming random numbers,
    so internal turning choices never depend on the controller's random stream.
    """
    out = [0, 0, 0]
    for _ in range(n):
        for m in range(3):
            acc[m] += probs[m]
        j = max(range(3), key=lambda m: acc[m])
        out[j] += 1
        acc[j] -= 1.0
    return out[0], out[1], out[2]


__all__ = ["DemandTable", "generate_demand", "demand_profile", "sigmoid_turns", "split_counts", "MOVES"]
