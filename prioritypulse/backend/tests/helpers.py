from app.config import SimConfig
from app.controllers.fixed import FixedTimeController
from app.controllers.prioritypulse import PriorityPulseController
from app.controllers.reactive import ReactiveController
from app.demand import generate_demand
from app.network import demo_corridor
from app.scenarios import get_scenario
from app.simulator import Simulation

CONTROLLERS = {"fixed": FixedTimeController, "reactive": ReactiveController, "prioritypulse": PriorityPulseController}


def make_sim(mode="fixed", scenario="rush_hour_ambulance", seed=1, duration=300, warmup=60, dispatch=True,
             mutate=None, **cfg_kw):
    sc = get_scenario(scenario)
    if mutate:
        mutate(sc)
    cfg = SimConfig(scenario_id=sc.id, mode=mode, seed=seed, duration=duration, warmup=warmup,
                    intensity=sc.intensity, weather=cfg_kw.get("weather", sc.weather),
                    school_zone=cfg_kw.get("school_zone", sc.school_zone))
    net = demo_corridor(cfg.physics)
    demand = generate_demand(net, cfg, sc)
    return Simulation(net, cfg, sc, CONTROLLERS[mode](), demand=demand, dispatch=dispatch)
