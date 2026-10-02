"""Pydantic request models (validation lives here, simulation code trusts its inputs)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .config import MODES, WEATHER_FACTORS, validate_weights
from .runner import RunRequest


class DispatchIn(BaseModel):
    enabled: bool = True
    origin: str | None = None
    destination: str | None = None
    etype: Literal["ambulance", "fire", "police"] | None = None
    priority: Literal["routine", "urgent", "critical"] | None = None
    t: float | None = Field(default=None, ge=0, le=900)


class PointIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    name: str | None = Field(default=None, max_length=60)


class PointsOptions(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    main_lanes: int = Field(default=3, ge=2, le=5)       # includes the left-turn bay
    side_lanes: int = Field(default=2, ge=1, le=4)
    main_speed_kmh: float | None = Field(default=None, ge=10, le=100)
    side_speed_kmh: float | None = Field(default=None, ge=10, le=80)
    entry_length: float = Field(default=230.0, ge=80, le=600)
    side_length: float = Field(default=190.0, ge=80, le=500)
    boundary_names: dict[str, str] = Field(default_factory=dict)
    boundary_kinds: dict[str, str] = Field(default_factory=dict)


class NetworkSpecIn(BaseModel):
    type: Literal["demo", "points"] = "demo"
    n: int = Field(default=3, ge=1, le=5)
    points: list[PointIn] = Field(default_factory=list, max_length=5)
    options: PointsOptions = Field(default_factory=PointsOptions)

    @field_validator("points")
    @classmethod
    def _need_points(cls, v, info):
        if info.data.get("type") == "points" and not v:
            raise ValueError("a points network needs 1-5 points")
        return v

    def to_spec(self) -> dict:
        if self.type == "demo":
            return {"type": "demo", "n": self.n}
        return {"type": "points", "points": [p.model_dump() for p in self.points],
                "options": self.options.model_dump()}


class PedCallIn(BaseModel):
    t: int = Field(ge=0, le=900)
    crosswalk: str


class RunIn(BaseModel):
    scenario_id: str = "rush_hour_ambulance"
    seed: int = Field(default=7, ge=0, le=2**31 - 1)
    modes: list[Literal["fixed", "reactive", "prioritypulse"]] = Field(default_factory=lambda: list(MODES))
    duration: int | None = Field(default=None, ge=120, le=900)
    intensity: float | None = Field(default=None, ge=0.1, le=1.0)
    weather: str | None = None
    school_zone: bool | None = None
    dispatch: DispatchIn | None = None
    network: NetworkSpecIn | None = None
    ped_calls: list[PedCallIn] = Field(default_factory=list, max_length=50)
    weights: dict[str, float] | None = None
    fixed_offsets: Literal["progression", "none"] | None = None
    include_frames: bool = True

    @field_validator("weather")
    @classmethod
    def _weather(cls, v):
        if v is not None and v not in WEATHER_FACTORS:
            raise ValueError(f"weather must be one of {sorted(WEATHER_FACTORS)}")
        return v

    @field_validator("weights")
    @classmethod
    def _weights(cls, v):
        return None if v is None else validate_weights(v)

    @field_validator("modes")
    @classmethod
    def _modes(cls, v):
        if not v:
            raise ValueError("choose at least one mode")
        return list(dict.fromkeys(v))

    def to_request(self) -> RunRequest:
        return RunRequest(
            scenario_id=self.scenario_id, seed=self.seed, modes=tuple(self.modes), duration=self.duration,
            intensity=self.intensity, weather=self.weather, school_zone=self.school_zone,
            dispatch=None if self.dispatch is None else self.dispatch.model_dump(exclude_none=True),
            network=None if self.network is None else self.network.to_spec(),
            ped_calls=[(p.t, p.crosswalk) for p in self.ped_calls] or None,
            weights=self.weights, fixed_offsets=self.fixed_offsets, include_frames=self.include_frames,
        )


class FromPointsIn(BaseModel):
    points: list[PointIn] = Field(min_length=1, max_length=5)
    options: PointsOptions = Field(default_factory=PointsOptions)
    enrich: bool = False


class EnrichIn(BaseModel):
    points: list[PointIn] = Field(min_length=1, max_length=5)
