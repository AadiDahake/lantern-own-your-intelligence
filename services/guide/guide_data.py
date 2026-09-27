"""Training and evaluation data for the Lantern guide model, built from the compiler's fixtures.

Each PostHog session in `packages/capability/test/fixtures/sessions.json` is one visitor on
NovaAir's seat map. The session gets the reward the compiler's offline reward model gives it
(`gradeFor` in `packages/capability/test/fake-model.ts`, ported rule for rule): `completion`,
`coherence` and `total`, each 1 to 5. A session with a high reward becomes a walk, and every
press in the walk is one decision: the goal and the page controls go in, the control the visitor
pressed next comes out.

The split is by session, never by row, so no decision of a held-out session is in training.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "packages" / "capability" / "test" / "fixtures" / "sessions.json"

SYSTEM = (
    "You are Lantern Guide. You light the next control a visitor should press to reach their goal "
    "on the page in front of them. Answer with JSON only: "
    '{"action": "press", "id": "<control id>"}, or {"action": "done"} when the goal is reached.'
)
HELP_LINKS = ["baggage-allowance", "check-in", "changes-and-refunds", "seat-selection-fees"]
MIN_TOTAL = 4
HOLDOUT_SHARE = 4  # one session in four is an unseen task
MAX_CONTROLS = 40


@dataclass
class Reward:
    completion: int
    coherence: int
    total: int

    @property
    def scalar(self) -> float:
        """One number for the optimizer, 0 to 1. The two axes stay apart everywhere else."""
        return 0.7 * (self.completion - 1) / 4 + 0.3 * (self.coherence - 1) / 4


@dataclass
class Decision:
    session_id: str
    goal: str
    prompt: dict
    target_id: str
    target_kind: str
    reward: Reward
    controls: list[dict] = field(default_factory=list)

    def messages(self) -> list[dict]:
        return [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": json.dumps(self.prompt, ensure_ascii=False)},
        ]

    def answer(self) -> str:
        return json.dumps({"action": "press", "id": self.target_id})


def load_sessions(path: Path = FIXTURES) -> list[dict]:
    return json.loads(path.read_text())


def grade(session: dict) -> Reward:
    """The fixture grader's rule on the raw steps (see the module docstring)."""
    steps = session["steps"]
    events = [s["event"] for s in steps]
    opened = next((s["props"] for s in steps if s["event"] == "seat_map_opened"), {})
    party = int(opened.get("party_size", 0))
    selections = events.count("seat_selected")
    refusals = events.count("seat_selection_rejected")
    confirms = [s["props"] for s in steps if s["event"] == "seat_assignment_confirmed"]
    help_only = bool(steps) and all(e == "help_article_viewed" for e in events)
    together = any(c.get("same_row") and c.get("contiguous") for c in confirms)

    if help_only:
        completion = 3
    elif confirms and (party <= 1 or together):
        completion = 5
    elif confirms or selections > 0:
        completion = 2
    else:
        completion = 1
    backtracks = refusals + max(0, selections - max(1, party))
    coherence = 5 if backtracks == 0 else 4 if backtracks == 1 else 3 if backtracks <= 3 else 2
    if completion == 1:
        coherence = 2
    if help_only:
        coherence = 5
    total = completion if completion >= 3 else min(completion, coherence)
    return Reward(completion, coherence, total)


def is_heldout(session_id: str) -> bool:
    return int(hashlib.sha256(session_id.encode()).hexdigest(), 16) % HOLDOUT_SHARE == 0


GOALS_PARTY = [
    "Seat my party of {n} together on flight {f}.",
    "How do I get all {n} of us next to each other on {f}?",
    "We are {n} travellers on {f}. Put us in seats side by side.",
    "I want my family of {n} to sit together on flight {f}.",
    "Move the {n} people on my booking to seats together on {f}.",
]
GOALS_ONE = [
    "Change my seat on flight {f}.",
    "How do I pick a different seat on {f}?",
    "Move me to another seat on flight {f}.",
]


def goal_for(session: dict, party: int, flight: str) -> str:
    pick = int(hashlib.sha256(session["session_id"].encode()).hexdigest(), 16)
    if party >= 2:
        return GOALS_PARTY[pick % len(GOALS_PARTY)].format(n=party, f=flight)
    return GOALS_ONE[pick % len(GOALS_ONE)].format(f=flight)


def _seat_key(seat: str) -> tuple[int, str]:
    match = re.match(r"(\d+)([A-Z])", seat)
    return (int(match.group(1)), match.group(2)) if match else (0, seat)


def decisions_for(session: dict) -> list[Decision]:
    """Every press of a walk after the seat map opens, each with the page as it stood."""
    steps = session["steps"]
    start = next((i for i, s in enumerate(steps) if s["event"] == "seat_map_opened"), None)
    if start is None:
        return []
    opened = steps[start]["props"]
    party = int(opened.get("party_size", 1))
    flight = opened.get("flight_id", "")
    reward = grade(session)
    goal = goal_for(session, party, flight)

    types = {0: "adult"}
    seat_state: dict[str, str] = {}
    for step in steps:
        props = step["props"]
        if step["event"] == "passenger_selected":
            types[props["passenger_index"]] = props["passenger_type"]
        elif step["event"] == "seat_hovered":
            seat_state.setdefault(props["seat"], props.get("state", "available"))
        elif step["event"] == "seat_selected":
            seat_state[props["seat"]] = "available"
        elif step["event"] == "seat_selection_rejected":
            seat_state.setdefault(props["seat"], "restricted")
    for seat in opened.get("current_seats", []):
        seat_state[seat] = "held by your booking"

    # Opaque ids in a per-session shuffled order, so position is never the answer.
    keys = [f"passenger:{i}" for i in range(party)]
    keys += [f"seat:{s}" for s in sorted(seat_state, key=_seat_key)]
    keys += ["confirm"] + [f"help:{slug}" for slug in HELP_LINKS]
    order = keys[:]
    random.Random(session["session_id"]).shuffle(order)
    ids = {key: f"a{n + 1}" for n, key in enumerate(order)}

    active = 0
    chosen: dict[str, int] = {}
    walked: list[str] = []
    out: list[Decision] = []

    def control(key: str) -> dict:
        kind, _, value = key.partition(":")
        if kind == "passenger":
            i = int(value)
            seat = next((s for s, p in chosen.items() if p == i), None)
            entry = {"role": "tab", "name": f"Passenger {i + 1} ({types.get(i, 'adult')})"}
            entry["state"] = ("selected" if i == active else "not selected") + (f", seat {seat}" if seat else "")
            return {"id": ids[key], **entry}
        if kind == "seat":
            state = f"chosen for passenger {chosen[value] + 1}" if value in chosen else seat_state[value]
            return {"id": ids[key], "role": "button", "name": f"Seat {value}", "state": state}
        if kind == "confirm":
            return {"id": ids[key], "role": "button", "name": "Confirm seats"}
        return {"id": ids[key], "role": "link", "name": value.replace("-", " ").capitalize()}

    def decide(key: str, kind: str) -> None:
        controls = [control(k) for k in order][:MAX_CONTROLS]
        prompt = {
            "goal": goal,
            "page": {"route": f"/trips/{opened.get('reservation_code', '')}/seats", "title": "Choose seats | NovaAir"},
            "walked": walked[-8:],
            "controls": controls,
        }
        out.append(Decision(session["session_id"], goal, prompt, ids[key], kind, reward, controls))

    for step in steps[start + 1 :]:
        props = step["props"]
        event = step["event"]
        if event == "passenger_selected":
            key = f"passenger:{props['passenger_index']}"
            decide(key, "passenger")
            active = props["passenger_index"]
            walked.append(control(key)["name"])
        elif event == "seat_selected":
            key = f"seat:{props['seat']}"
            decide(key, "seat")
            for seat, p in list(chosen.items()):
                if p == props.get("passenger_index", active):
                    del chosen[seat]
            chosen[props["seat"]] = props.get("passenger_index", active)
            walked.append(f"Seat {props['seat']}")
        elif event == "seat_selection_rejected":
            walked.append(f"Seat {props['seat']} (refused: {props.get('reason', 'unavailable')})")
        elif event == "seat_assignment_confirmed":
            decide("confirm", "confirm")
            break
    return out


def build(min_total: int = MIN_TOTAL) -> dict:
    """Score every session, keep the high reward walks, split them by session."""
    sessions = load_sessions()
    scored = [(s, grade(s)) for s in sessions]
    kept = [s for s, r in scored if r.total >= min_total]
    train = [d for s in kept if not is_heldout(s["session_id"]) for d in decisions_for(s)]
    heldout = [d for s in kept if is_heldout(s["session_id"]) for d in decisions_for(s)]
    return {
        "sessions": len(sessions),
        "kept": len(kept),
        "train_sessions": len({d.session_id for d in train}),
        "heldout_sessions": len({d.session_id for d in heldout}),
        "train": train,
        "heldout": heldout,
    }


def parse_answer(text: str, controls: list[dict]) -> str | None:
    """The id the model chose, or None when the answer is not JSON or names no control on the page."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    match = re.search(r"\{.*\}", text, flags=re.S)
    if not match:
        return None
    try:
        value = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    chosen = value.get("id") if isinstance(value, dict) else None
    return chosen if any(c["id"] == chosen for c in controls) else None
