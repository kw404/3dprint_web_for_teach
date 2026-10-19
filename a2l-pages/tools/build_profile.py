from pathlib import Path
import json,re
r=Path(__file__).resolve().parent.parent;p=json.loads((r/'a2l-profile.json').read_text())
c={k:([float(x) if re.fullmatch(r'-?\d+(\.\d+)?',str(x)) else x for x in v] if isinstance(v,list) else v) for k,v in p.items()}
c.update(initial_no_support_filament_id=0,initial_filament_id=0,initial_nozzle_id=0,bed_temperature_initial_layer_single=55,hold_chamber_temp_for_flat_print=False,nozzle_diameter_at_nozzle_id=[.4],flush_temperatures=[240],flush_volumetric_speeds=[12],filament_ids=['GFL99'])
dynamic={'first_layer_print_min[0]':'{{MIN_X}}','first_layer_print_min[1]':'{{MIN_Y}}','first_layer_print_size[0]':'{{SIZE_X}}','first_layer_print_size[1]':'{{SIZE_Y}}','max_layer_z + 0.4':'{{END_Z}}'}
def render(t):
 stack=[];active=True;out=[]
 for token in re.split(r'(\{[^}]*\}|\[[A-Za-z_][A-Za-z_0-9]*\])',t):
  if token.startswith('{'):
   e=token[1:-1].strip()
   if e.startswith('if '):
    val=bool(eval(' '.join(e[3:].replace('&&',' and ').replace('||',' or ').split()),{'__builtins__':{}},c)) if active else False
    stack.append((active,val));active=active and val
   elif e=='else':active=stack[-1][0] and not stack[-1][1]
   elif e=='endif':active=stack.pop()[0]
   elif active:
    if e in dynamic:out.append(dynamic[e])
    else:out.append(str(eval(e,{'__builtins__':{}},c)))
  elif active:
   if token.startswith('[') and token.endswith(']'):out.append(str(c[token[1:-1]]))
   else:out.append(token)
 assert not stack
 return ''.join(out)
obj={'start':render(p['machine_start_gcode']),'end':render(p['machine_end_gcode']),'source':'Bambu Studio 02.08.02.61 installed A2L profiles; fixed Generic PLA / Textured PEI / 0.4 mm / tool 0','flushTemperature':240,'flushVolumetricSpeed':12}
(r/'machine-program.json').write_text(json.dumps(obj,ensure_ascii=False,indent=2))
