# Bake the OldMap's geometry-nodes roll (map_paper.blend) into shape keys and export a GLB.
# The .blend is not modified. Run from the project root:
#   /Applications/Blender.app/Contents/MacOS/Blender -b ../map_paper.blend \
#     --python scripts/bake-map-paper.py -- public/models/map_paper.glb
# The roll curve (one value per frame) goes along as the node's extras: GerScene.updateMap plays it.
import bpy, sys
OUT = sys.argv[sys.argv.index("--") + 1]
STEPS = 20  # shape keys between flat (roll 0) and fully rolled

src = bpy.data.objects["OldMap"]
sc = bpy.context.scene
act = src.animation_data.action
fc = None
for layer in act.layers:
    for strip in layer.strips:
        for cb in strip.channelbags:
            for f in cb.fcurves:
                if "Socket_1" in f.data_path:
                    fc = f
curve = [round(fc.evaluate(f), 5) for f in range(sc.frame_start, sc.frame_end + 1)]
roll_max = max(curve)
print("ROLL max", roll_max, "frames", len(curve))

src.animation_data.action = None  # drive the roll by hand from here
sock = src.modifiers["Roll"].properties.inputs["Socket_1"]  # the "Roll" input of the MapRoll node group

def set_roll(v):
    sock["value"] = v
    src.modifiers["Roll"].node_group.interface_update(bpy.context)
    bpy.context.view_layer.update()

dg = bpy.context.evaluated_depsgraph_get()
set_roll(0.0)
base = bpy.data.meshes.new_from_object(src.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
obj = bpy.data.objects.new("OldMapBaked", base)
sc.collection.objects.link(obj)
obj.matrix_world = src.matrix_world.copy()
obj.shape_key_add(name="Basis")
for k in range(1, STEPS + 1):
    set_roll(roll_max * k / STEPS)
    dg = bpy.context.evaluated_depsgraph_get()
    me = src.evaluated_get(dg).to_mesh()
    assert len(me.vertices) == len(base.vertices)
    sk = obj.shape_key_add(name=f"roll_{k:02d}")
    for i, v in enumerate(me.vertices):
        sk.data[i].co = v.co
    src.evaluated_get(dg).to_mesh_clear()

obj["rollCurve"] = curve
obj["rollMax"] = roll_max
obj["rollSteps"] = STEPS
obj["fps"] = sc.render.fps

bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_extras=True,
    export_morph=True,
    export_morph_normal=True,
    export_animations=False,
    export_yup=True,
    export_image_format="JPEG",
    export_jpeg_quality=85,
    export_draco_mesh_compression_enable=True,
)
print("EXPORTED", OUT)
