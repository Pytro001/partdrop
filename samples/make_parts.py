"""Generate the PartDrop sample parts as STEP files plus a drawing (nominal sizes and
tolerances) per part. Run with a Python that has build123d (uv venv --python 3.12 .venv; uv pip install build123d):
    .venv/bin/python samples/make_parts.py
"""
import json
from pathlib import Path
from build123d import (BuildPart, BuildSketch, Box, Cylinder, Circle, Rectangle, Locations,
                       PolarLocations, GridLocations, Mode, Plane, Axis, extrude, fillet,
                       chamfer, export_step, Align, Torus, Hole, Wedge, Rot, Pos)

OUT = Path(__file__).parent / "cad"
OUT.mkdir(exist_ok=True)
drawings = {}


def save(name, part, drawing):
    export_step(part, str(OUT / f"{name}.step"))
    bb = part.bounding_box()
    drawing["volume_mm3"] = round(part.volume, 1)
    drawing["bbox_mm"] = [round(bb.size.X, 2), round(bb.size.Y, 2), round(bb.size.Z, 2)]
    drawings[name] = drawing
    print(name, round(part.volume, 1), drawing["bbox_mm"])


# 1. Angle bracket, 6061-T6, machined. 4 mounting holes and a gusset.
with BuildPart() as br:
    Box(60, 40, 6, align=(Align.CENTER, Align.MIN, Align.MIN))                 # base leg
    Box(60, 6, 46, align=(Align.CENTER, Align.MIN, Align.MIN))                 # upright leg
    with Locations((0, 6, 6)):
        Wedge(4, 26, 26, 0, 0, 4, 0, align=(Align.CENTER, Align.MIN, Align.MIN))
    with Locations(Plane.XY.offset(6)):
        with GridLocations(36, 0, 2, 1):
            with Locations((0, 26)):
                Hole(3.3)
    with Locations(Plane.XZ.offset(0)):
        with GridLocations(36, 0, 2, 1):
            with Locations((0, 32)):
                Hole(3.3)
bracket = br.part
save("bracket", bracket, {
    "title": "Angle bracket", "part_no": "PD-BRK-060", "material": "Aluminium 6061-T6",
    "finish": "As machined, deburr all edges", "qty_hint": 50,
    "features": [
        {"id": "L", "name": "Overall length", "nominal": 60.0, "tol": 0.10},
        {"id": "W", "name": "Base depth", "nominal": 40.0, "tol": 0.10},
        {"id": "H", "name": "Overall height", "nominal": 46.0, "tol": 0.10},
        {"id": "T", "name": "Leg thickness", "nominal": 6.0, "tol": 0.05},
        {"id": "D", "name": "Hole diameter (4x)", "nominal": 6.6, "tol": 0.10},
        {"id": "P", "name": "Hole pitch", "nominal": 36.0, "tol": 0.08},
    ],
    "hole_count": 4,
})

# 2. Pipe flange, 6061-T6: OD 120, bore 50, raised hub, 6 bolt holes on PCD 95.
with BuildPart() as fl:
    Cylinder(60, 12, align=(Align.CENTER, Align.CENTER, Align.MIN))
    with Locations((0, 0, 12)):
        Cylinder(35, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
    Cylinder(25, 40, mode=Mode.SUBTRACT)
    with Locations(Plane.XY.offset(12)):
        with PolarLocations(47.5, 6):
            Hole(4.5)
    chamfer(fl.edges().filter_by(Axis.Z, reverse=True).group_by(Axis.Z)[-1].sort_by(lambda e: e.radius)[0:1], 1.0)
flange = fl.part
save("flange", flange, {
    "title": "Pipe flange", "part_no": "PD-FLG-120", "material": "Aluminium 6061-T6",
    "finish": "Bore Ra 1.6, rest Ra 3.2", "qty_hint": 10,
    "features": [
        {"id": "OD", "name": "Outside diameter", "nominal": 120.0, "tol": 0.10},
        {"id": "B", "name": "Bore diameter", "nominal": 50.0, "tol": 0.025},
        {"id": "T", "name": "Flange thickness", "nominal": 12.0, "tol": 0.05},
        {"id": "HD", "name": "Hub diameter", "nominal": 70.0, "tol": 0.10},
        {"id": "PCD", "name": "Bolt circle", "nominal": 95.0, "tol": 0.10},
        {"id": "D", "name": "Bolt hole (6x)", "nominal": 9.0, "tol": 0.10},
    ],
    "hole_count": 6,
})

# 3. Rocket injector face, Inconel 718: internal annular manifold feeding 24 orifices, 0.8 mm wall.
with BuildPart() as inj:
    Cylinder(30, 24, align=(Align.CENTER, Align.CENTER, Align.MIN))
    with Locations((0, 0, 24)):
        Cylinder(9, 14, align=(Align.CENTER, Align.CENTER, Align.MIN))          # feed boss
    Cylinder(4, 80, mode=Mode.SUBTRACT)                                           # centre feed
    with Locations((0, 0, 6.5)):                                                  # internal manifold
        Torus(19, 4.2, mode=Mode.SUBTRACT)
    with Locations((0, 0, 6.5)):                                                  # radial feed galleries
        for a in (0, 90, 180, 270):
            with Locations(Rot(0, 0, a)):
                with Locations(Pos(9.5, 0, 0)):
                    Box(15, 2.4, 2.4, mode=Mode.SUBTRACT)
    with Locations(Plane.XY):
        with PolarLocations(19, 24):
            Cylinder(0.5, 4.5, align=(Align.CENTER, Align.CENTER, Align.MIN), mode=Mode.SUBTRACT)
    with Locations(Plane.XY.offset(24)):
        with PolarLocations(24, 8):
            Hole(1.7, 10)
injector = inj.part
save("injector", injector, {
    "title": "Injector face", "part_no": "PD-INJ-060", "material": "Inconel 718",
    "finish": "As printed, face lapped", "qty_hint": 2,
    "features": [
        {"id": "OD", "name": "Body diameter", "nominal": 60.0, "tol": 0.10},
        {"id": "H", "name": "Body height", "nominal": 24.0, "tol": 0.10},
        {"id": "BD", "name": "Feed boss diameter", "nominal": 18.0, "tol": 0.10},
        {"id": "O", "name": "Orifice diameter (24x)", "nominal": 1.0, "tol": 0.05},
        {"id": "W", "name": "Manifold to face wall", "nominal": 2.3, "tol": 0.15},
    ],
    "hole_count": 33,
})

# 4. Sheet metal cover, 1.5 mm 5052: flat with two bent flanges and 4 holes.
t = 1.5
with BuildPart() as sh:
    Box(80, 50, t, align=(Align.CENTER, Align.CENTER, Align.MIN))
    for s in (-1, 1):
        with Locations((s * (40 - t / 2), 0, 0)):
            Box(t, 50, 18, align=(Align.CENTER, Align.CENTER, Align.MIN))
    with Locations(Plane.XY.offset(t)):
        with GridLocations(60, 34, 2, 2):
            Hole(2.1)
        Box(30, 14, 4, mode=Mode.SUBTRACT)
cover = sh.part
save("cover", cover, {
    "title": "Sheet metal cover", "part_no": "PD-CVR-080", "material": "Aluminium 5052-H32, 1.5 mm",
    "finish": "Deburr, no paint", "qty_hint": 25,
    "features": [
        {"id": "L", "name": "Outside width", "nominal": 80.0, "tol": 0.20},
        {"id": "W", "name": "Depth", "nominal": 50.0, "tol": 0.20},
        {"id": "H", "name": "Flange height", "nominal": 18.0, "tol": 0.20},
        {"id": "D", "name": "Hole diameter (4x)", "nominal": 4.2, "tol": 0.10},
    ],
    "hole_count": 4,
})

# Defect variant of the flange for the failing inspection test: one bolt hole missing,
# not part of the sample library (no drawing entry), only used to render a reject photo.
with BuildPart() as fd:
    Cylinder(60, 12, align=(Align.CENTER, Align.CENTER, Align.MIN))
    with Locations((0, 0, 12)):
        Cylinder(35, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
    Cylinder(25, 40, mode=Mode.SUBTRACT)
    with Locations(Plane.XY.offset(12)):
        with PolarLocations(47.5, 6):
            Hole(4.5)
    with Locations((47.5, 0, 12)):
        Cylinder(4.6, 13, align=(Align.CENTER, Align.CENTER, Align.MAX))   # hole 1 never drilled
    with Locations((0, -60, 12)):
        Box(14, 6, 5, mode=Mode.SUBTRACT, align=(Align.CENTER, Align.CENTER, Align.MAX))  # gouge in the rim
export_step(fd.part, str(OUT / "flange_defect.step"))

(Path(__file__).parent / "drawings.json").write_text(json.dumps(drawings, indent=2))
