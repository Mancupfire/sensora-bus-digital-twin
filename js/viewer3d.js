// three.js viewer for the bus cabin.
// Geometry: display surfaces triangulated from the CFD boundary face centres (visual aid only; see manifest
// display_mesh), falling back to the decimated face-centre point clouds if the mesh asset is missing.
// Field: one slice plane textured from stored CFD / prediction values, optional 3D cloud and flow arrows.
// Compare mode renders the same scene into several scissor viewports with ONE shared camera.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { cfdToWorld, worldToCfd, UP } from './frame.js';

const GROUP_STYLE = {
  cabin_shell: { color: 0x7d8fa9, size: 0.012, opacity: 0.35, layer: 'cabin_shell' },
  seats: { color: 0x8a6d5a, size: 0.014, opacity: 0.6, layer: 'seats' },
  occupant_skin: { color: 0xf3b07c, size: 0.012, opacity: 0.85, layer: 'occupants' },
  occupant_mouth: { color: 0xff5d5d, size: 0.02, opacity: 1, layer: 'occupants' },
  hvac_supply: { color: 0x22d3ee, size: 0.02, opacity: 1, layer: 'hvac' },
  hvac_return: { color: 0xa78bfa, size: 0.02, opacity: 1, layer: 'hvac' },
  leak_outlet: { color: 0xfacc15, size: 0.02, opacity: 1, layer: 'hvac' },
};
// Group (from the USD prim path /World/Bus/<group>/...) -> UI layer toggle
const GROUP_LAYER = { 'Geometry/Shell': 'body', 'Geometry/Windows': 'body', 'Geometry/Doors': 'body', 'Geometry/Floor': 'floor',
  'Geometry/Seats': 'seats', 'Geometry/Occupants': 'occupants', 'HVAC/Supply': 'hvac', 'HVAC/Return': 'hvac', 'HVAC/Leaks': 'hvac' };

export class Viewer3D {
  constructor(host, manifest, opts = {}) {
    this.host = host; this.m = manifest; this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(opts.background ?? 0x0b1529);
    host.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xf1f5ff, 0x30384a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(-4, 6, 9); this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.55); fill.position.set(8, -6, 3); this.scene.add(fill);
    const { lo, hi } = manifest.bbox;
    this.lo = lo; this.hi = hi;
    this.center = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 200);
    this.camera.up.set(...UP);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controls.minDistance = 1.5; this.controls.maxDistance = 30;
    this.controls.addEventListener('change', () => this.render());
    this.look = 'inside';
    this.layers = {}; this.groups = {}; this.meshes = [];
    this.compare = null; // array of {sliceTex, cloudRGB} when compare mode
    this.raycaster = new THREE.Raycaster(); this.raycaster.params.Points.threshold = 0.03;
    this.renderer.domElement.addEventListener('pointerdown', (e) => { this._down = [e.clientX, e.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (this._down && Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]) < 4) this._pick(e);
    });
    this.onRender = null;
    this.setView(opts.initialView || 'oblique');
    new ResizeObserver(() => this.resize()).observe(host);
    const loop = () => { if (this.controls.enableDamping && this.controls.update()) this.render(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ----- cameras.  With an exported USD scene the presets come from /World/Cameras (eye, target, fov);
  // without one (Error explorer) a bbox-based fallback is used.  On narrow screens the eye backs off along the
  // view ray so the whole bus stays in frame.
  setCameras(cams, def) { this.cams = cams; this.defaultCam = def; }
  setView(name) {
    const aspect = Math.max(0.5, (this.host.clientWidth || 4) / (this.host.clientHeight || 3));
    const k = Math.max(1, 1.3 / aspect);
    let eye, tgt, fov = 36;
    const usdName = { oblique: this.defaultCam, reset: this.defaultCam, front: 'Front', side: 'Side', top: 'Top' }[name] || name;
    if (this.cams && this.cams[usdName]) {
      const c = this.cams[usdName]; tgt = cfdToWorld(c.target); const e = cfdToWorld(c.eye);
      eye = e.map((v, i) => tgt[i] + (v - tgt[i]) * k); fov = c.fov_deg || fov;
    } else {
      const c = this.center, L = this.hi[0] - this.lo[0];
      eye = { oblique: [c.x - 1.02 * L * k, c.y + 0.98 * L * k, c.z + 0.56 * L * k], front: [c.x - 1.3 * L * k, c.y + 0.001, c.z + 0.3],
        side: [c.x, c.y + 1.3 * L * k, c.z + 0.5], top: [c.x, c.y - 0.001, c.z + 1.45 * L * k] }[name === 'reset' ? 'oblique' : name];
      tgt = [c.x, c.y, c.z];
      if (!eye) return;
    }
    this.view = name; this.camera.fov = fov;
    this.camera.position.set(...eye);
    this.controls.target.set(...tgt); this.controls.update(); this.render();
  }
  resetCamera() { this.setView(this.opts.initialView || 'oblique'); }

  // ----- geometry
  addGroup(name, xyz) {
    const st = GROUP_STYLE[name] || { color: 0xaaaaaa, size: 0.012, opacity: .5, layer: 'cabin_shell' };
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(xyz, 3));
    const mat = new THREE.PointsMaterial({ color: st.color, size: st.size, transparent: st.opacity < 1, opacity: st.opacity, depthWrite: st.opacity >= 1 });
    const p = new THREE.Points(g, mat); p.userData.layer = st.layer; this.scene.add(p); this.groups[name] = p;
    this.render();
  }
  // buf: data/usd/geometry.bin; scene: data/usd/scene.json (written from the COMPOSED USD stage by export-web).
  // Colours/opacities come from the bound USD material (UsdPreviewSurface diffuseColor / opacity, and the
  // sensora:display:insideOpacity convention); default visibility from UsdGeomImageable visibility.
  addSceneGeometry(buf, scene) {
    const { lo, hi } = scene.geometry.quant_bbox;
    for (const pm of scene.geometry.prims) {
      if (pm.kind !== 'mesh') continue;     // mouths are face-centre point sets; not drawn in the demo
      const look = scene.geometry.looks[pm.look] || { color: '#cccccc', opacity_exterior: 1, opacity_inside: 1 };
      const q = new Int16Array(buf, pm.v_offset, pm.n_verts * 3);
      const pos = new Float32Array(q.length); const p = [0, 0, 0];
      for (let i = 0; i < q.length; i += 3) {
        for (let a = 0; a < 3; a++) p[a] = lo[a] + (q[i + a] / 32767) * (hi[a] - lo[a]);
        const w = cfdToWorld(p); pos[i] = w[0]; pos[i + 1] = w[1]; pos[i + 2] = w[2];
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, pm.i_offset, pm.n_tris * 3), 1));
      const mat = new THREE.MeshLambertMaterial({ color: look.color, side: THREE.DoubleSide, emissive: look.emissive || '#000000', flatShading: true });
      const mesh = new THREE.Mesh(g, mat);
      mesh.userData = { layer: GROUP_LAYER[pm.group] || 'body', role: pm.role, patch: pm.zone, prim: pm.path,
        style: { exterior: look.opacity_exterior, inside: look.opacity_inside }, usdHidden: !pm.visible };
      mesh.renderOrder = look.opacity_exterior < 0.9 ? 3 : (look.opacity_inside < 0.9 ? 2 : 0);
      this.scene.add(mesh); this.meshes.push(mesh);
    }
    this.setLook(this.look);
  }
  // 'inside': ceiling removed, walls and glass faint, so the cabin and the slice are visible.
  // 'exterior': closed, mostly opaque body with see-through glazing.
  setLook(look) {
    this.look = look;
    for (const m of this.meshes) {
      const a = m.userData.style[look]; const mat = m.material;
      mat.opacity = a; mat.transparent = a < 1; mat.depthWrite = a >= 0.9;
      m.userData.lookHidden = a <= 0.001; mat.needsUpdate = true;
    }
    this.applyLayers(); this.render();
  }
  addMarkers(points, color = 0xff4d4d, radius = 0.035, layer = 'occupants') {
    const geo = new THREE.SphereGeometry(radius, 12, 8); const mat = new THREE.MeshBasicMaterial({ color });
    for (const p of points) { const s = new THREE.Mesh(geo, mat); s.position.set(...p); s.userData.layer = layer; this.scene.add(s); }
    this.applyLayers(); this.render();
  }

  // ----- field
  setCloud(xyz, splitArr) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(xyz, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(xyz.length), 3, true));
    const mat = new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, opacity: 0.9 });
    this.cloud = new THREE.Points(g, mat); this.cloud.userData.layer = 'cloud'; this.cloudSplit = splitArr;
    this.scene.add(this.cloud);
  }
  setCloudColors(rgb) { // Uint8Array n*3
    if (!this.cloud) return; const a = this.cloud.geometry.getAttribute('color'); a.array.set(rgb); a.needsUpdate = true; this.render();
  }
  setSlice(slice, canvasTex) {
    if (this.slicePlane) { this.scene.remove(this.slicePlane); this.slicePlane.material.map.dispose(); this.slicePlane.geometry.dispose(); }
    const g = slice.grid; const W = g.nx * g.res, H = g.ny * g.res;
    const tex = this.makeTexture(canvasTex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.5 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    const uc = g.u0 - g.res / 2 + W / 2, vc = g.v0 - g.res / 2 + H / 2;
    const pos = { x: 0, y: 0, z: 0 }; pos[slice.axis] = slice.value; pos[g.u_axis] = uc; pos[g.v_axis] = vc;
    plane.position.set(pos.x, pos.y, pos.z);
    // PlaneGeometry spans local X (u) and Y (v); rotate local axes onto (u_axis, v_axis)
    const ax = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    const U = ax[g.u_axis], V = ax[g.v_axis], N = new THREE.Vector3().crossVectors(U, V);
    plane.setRotationFromMatrix(new THREE.Matrix4().makeBasis(U, V, N));
    plane.userData = { layer: 'slice', slice };
    plane.renderOrder = 1;
    this.slicePlane = plane; this.scene.add(plane); this.applyLayers(); this.render();
  }
  // in-plane arrows of the steady field: segs = Float32Array of [x0,y0,z0,x1,y1,z1,...]
  setArrows(segs) {
    if (this.arrows) { this.scene.remove(this.arrows); this.arrows.geometry.dispose(); this.arrows = null; }
    if (!segs) { this.render(); return; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(segs, 3));
    this.arrows = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
    this.arrows.renderOrder = 5; this.arrows.userData.layer = 'arrows';
    this.scene.add(this.arrows); this.applyLayers(); this.render();
  }
  setProbeMarker(p) {
    if (!this.probeMarker) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
      const ring = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), new THREE.MeshBasicMaterial({ color: 0x0b1529, wireframe: true, depthTest: false }));
      m.add(ring); m.renderOrder = 6; this.scene.add(m); this.probeMarker = m;
    }
    this.probeMarker.visible = !!p; if (p) this.probeMarker.position.set(...cfdToWorld(p));
    this.render();
  }
  // shift the drawn scene horizontally by a fraction of the width (keeps room for an overlay card)
  setShift(fx, fy = 0) { this.shift = fx; this.shiftY = fy; this.render(); }
  setLayerVisible(layer, on) { this.layers[layer] = on; this.applyLayers(); this.render(); }
  applyLayers() {
    this.scene.traverse((o) => { if (o.userData && o.userData.layer) o.visible = this.layers[o.userData.layer] !== false && !o.userData.lookHidden && !o.userData.usdHidden; });
  }
  setCompare(items) { this.compare = items; this.render(); }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.render();
  }
  // world -> CSS pixel position inside host (null when behind the camera)
  project(p) {   // p in the CFD frame
    const v = new THREE.Vector3(...cfdToWorld(p)).project(this.camera);
    if (v.z > 1) return null;
    return [(v.x + 1) / 2 * this.host.clientWidth, (1 - v.y) / 2 * this.host.clientHeight];
  }
  render() {
    const r = this.renderer; const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    if (!this.compare) {
      r.setScissorTest(false); r.setViewport(0, 0, w, h); this.camera.aspect = w / h;
      if (this.shift || this.shiftY) this.camera.setViewOffset(w, h, -(this.shift || 0) * w, (this.shiftY || 0) * h, w, h); else this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix(); r.render(this.scene, this.camera);
      if (this.onRender) this.onRender();
      return;
    }
    const n = this.compare.length; const vw = Math.floor(w / n);
    this.camera.clearViewOffset(); this.camera.aspect = vw / h; this.camera.updateProjectionMatrix(); r.setScissorTest(true);
    for (let i = 0; i < n; i++) {
      const it = this.compare[i];
      if (this.slicePlane && it.sliceTex) { this.slicePlane.material.map = it.sliceTex; }
      if (this.cloud && it.cloudRGB) { const a = this.cloud.geometry.getAttribute('color'); a.array.set(it.cloudRGB); a.needsUpdate = true; }
      r.setViewport(i * vw, 0, vw, h); r.setScissor(i * vw, 0, vw, h); r.render(this.scene, this.camera);
    }
    r.setScissorTest(false);
  }
  makeTexture(canvas) { const t = new THREE.CanvasTexture(canvas); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t; }
  _pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    let x = (e.clientX - rect.left) / rect.width;
    if (this.compare) { const n = this.compare.length; const i = Math.min(n - 1, Math.floor(x * n)); x = x * n - i; }
    const ndc = new THREE.Vector2(x * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = [this.slicePlane, this.cloud].filter((o) => o && o.visible);
    const hits = this.raycaster.intersectObjects(targets, false);
    if (!hits.length || !this.onProbe) return;
    const h = hits[0];
    if (h.object === this.slicePlane) {
      const g = h.object.userData.slice.grid; const q = Math.floor(h.uv.x * g.nx), r = Math.floor(h.uv.y * g.ny);
      this.onProbe({ kind: 'slice', q: Math.min(g.nx - 1, q), r: Math.min(g.ny - 1, r), point: worldToCfd(h.point.toArray()) });
    } else { this.onProbe({ kind: 'cloud', index: h.index, point: worldToCfd(h.point.toArray()) }); }
  }
  screenshot() { this.render(); return this.renderer.domElement.toDataURL('image/png'); }
}
