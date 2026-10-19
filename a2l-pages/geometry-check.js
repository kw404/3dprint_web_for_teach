// Potential overhang check. This is a geometric hint, not a printability guarantee.
export function overhangSummary(positions, floorTolerance = .25) {
  let area = 0, faces = 0, low = Infinity, high = -Infinity;
  for (let i = 0; i < positions.length; i += 9) {
    const ax=positions[i], ay=positions[i+1], az=positions[i+2];
    const ux=positions[i+3]-ax, uy=positions[i+4]-ay, uz=positions[i+5]-az;
    const vx=positions[i+6]-ax, vy=positions[i+7]-ay, vz=positions[i+8]-az;
    const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    const length=Math.hypot(nx,ny,nz), minZ=Math.min(az,positions[i+5],positions[i+8]);
    if(length>1e-9 && nz/length < -Math.SQRT1_2 && minZ>floorTolerance) {
      area+=length/2; faces++; low=Math.min(low,minZ); high=Math.max(high,az,positions[i+5],positions[i+8]);
    }
  }
  return {area,faces,low:faces?low:0,high:faces?high:0,hasOverhang:area>.5};
}
