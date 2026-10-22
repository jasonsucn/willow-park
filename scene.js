/* Willow Park — procedural landscape, reflected water and living light. */
(function () {
  'use strict';
  const T = window.THREE;
  if (!T) { window.ParkBootError = '三维渲染库未能加载'; return; }
  const TAU = Math.PI * 2;
  let seed = 128394;
  const rand = (a = 0, b = 1) => { seed = (seed * 1664525 + 1013904223) >>> 0; return a + (seed / 4294967296) * (b - a); };
  const clamp = T.MathUtils.clamp;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lakeRadius = a => 1 + .038 * Math.sin(a * 3) + .025 * Math.cos(a * 5);
  const lakeMetric = (x, z) => { const a = Math.atan2(z / 17, x / 26); return Math.hypot(x / 26, z / 17) / lakeRadius(a); };
  const groundHeight = (x, z) => {
    const r = lakeMetric(x, z);
    const hillside = smooth(1.55, 3.2, r) * (1.2 + Math.sin(x * .08) * 1.1 + Math.cos(z * .1) * .9);
    return -.95 + smooth(.91, 1.055, r) * 1.33 + hillside + smooth(1.4, 1.8, r) * Math.sin(x * .38) * Math.cos(z * .3) * .18;
  };
  const pathPoint = (a, lane = 0) => new T.Vector3(Math.cos(a) * (32.2 + lane), .44, Math.sin(a) * (23.5 + lane));
  const materials = {};
  const materialCache = new Map();
  const mat = (color, roughness = .8, metalness = 0) => { const key=color+':'+roughness+':'+metalness; if(!materialCache.has(key))materialCache.set(key,new T.MeshStandardMaterial({ color, roughness, metalness })); return materialCache.get(key); };
  let scene, camera, renderer, sun, hemi, water, mirrorCamera, reflectionTarget, reflectionMatrix;
  let life, time = 0, timeOfDay = .38, targetDay = .38, last = 0, running = true;
  let container, width = 0, height = 0, pixelRatio = 1, lastReflect = 0;
  let mode = 'overview', transition = null, pointer = null, moved = false, frame = 0;
  let autoOrbit = false;
  const target = new T.Vector3(-4, 1.5, 0), desiredTarget = target.clone();
  const orbit = { theta: .62, phi: .91, radius: 92, dTheta: 0, dPhi: 0 };
  const clouds = [], windGroups = [], butterflies = [], ducks = [], birds = [], particles = [];
  const ripples = Array.from({ length: 10 }, () => new T.Vector4(1000, 1000, -100, 0));
  const interactive = [], lanternMaterials = [], animatedFlowers = [];
  let grassBatch, reflectionEnabled = true, reflectionCount = 0, lowQuality = false;
  const actorBatches = [];
  const dummy = new T.Object3D(), clock = new T.Clock();
  function mesh(geometry, material, parent, x = 0, y = 0, z = 0) {
    const m = new T.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; (parent || scene).add(m); return m;
  }
  function sphere(parent, x, y, z, sx, sy, sz, material, detail = 1) {
    const m = mesh(new T.IcosahedronGeometry(1, detail), material, parent, x, y, z); m.scale.set(sx, sy, sz); return m;
  }
  function box(parent, x, y, z, sx, sy, sz, material) { return mesh(new T.BoxGeometry(sx, sy, sz), material, parent, x, y, z); }
  function cylinder(parent, a, b, r1, r2, material, segments = 10) {
    const d = new T.Vector3().subVectors(b, a);
    const m = mesh(new T.CylinderGeometry(r2, r1, d.length(), segments), material, parent);
    m.position.copy(a).add(b).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); return m;
  }
  function curveTube(points, radius, material, parent = scene, segments = 36) {
    return mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), segments, radius, 6, false), material, parent);
  }
  function texture(type) {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const ctx = c.getContext('2d');
    if (type === 'grass') {
      ctx.fillStyle = '#8eac69'; ctx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 27000; i++) { const v = Math.floor(rand(90, 150)); ctx.fillStyle = `rgba(${v - 20},${v + 25},${v - 50},${rand(.08, .25)})`; ctx.fillRect(rand(0, 512), rand(0, 512), rand(.5, 2), rand(1, 4)); }
    } else if (type === 'stone') {
      ctx.fillStyle = '#ded8c5'; ctx.fillRect(0, 0, 512, 512);
      for (let y = 0; y < 512; y += 64) for (let x = -128; x < 512; x += 128) {
        const xx = x + ((y / 64) % 2) * 64;
        const v = Math.floor(rand(201, 225)); ctx.fillStyle = `rgb(${v + 6},${v + 2},${v - 14})`; ctx.fillRect(xx + 1.5, y + 1.5, 125, 61);
        ctx.strokeStyle = 'rgba(255,255,244,.45)'; ctx.strokeRect(xx + 2.5, y + 2.5, 123, 59);
      }
      for (let i = 0; i < 12000; i++) { ctx.fillStyle = `rgba(89,83,64,${rand(.02, .09)})`; ctx.fillRect(rand(0, 512), rand(0, 512), 1, 1); }
    } else {
      ctx.fillStyle = '#9c7651'; ctx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 2400; i++) { ctx.strokeStyle = `rgba(${Math.floor(rand(70, 140))},79,40,.16)`; const x = rand(0, 512); ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + rand(-10, 10), 150, x + rand(-10, 10), 350, x + rand(-5, 5), 512); ctx.stroke(); }
    }
    const tex = new T.CanvasTexture(c); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8; return tex;
  }
  function terrain() {
    const g = new T.PlaneGeometry(165, 146, lowQuality ? 96 : 180, lowQuality ? 84 : 160); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, colors = [], color = new T.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), r = lakeMetric(x, z); pos.setY(i, groundHeight(x, z));
      color.set(r < 1.05 ? '#b8b68b' : '#c5d49c');
      color.lerp(new T.Color('#a6bc7d'), smooth(1.2, 3, r) * .4 + Math.sin(x * .1) * Math.cos(z * .13) * .05);
      colors.push(color.r, color.g, color.b);
    }
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); g.computeVertexNormals();
    const grassTex = texture('grass'); grassTex.repeat.set(28, 25);
    mesh(g, new T.MeshStandardMaterial({ map: grassTex, vertexColors: true, roughness: 1 }), scene).castShadow = false;
    const pathMat = mat('#ffffff'); pathMat.map = texture('stone'); pathMat.map.repeat.set(1, 1); materials.path = pathMat;
    // A continuous, individually UV-mapped promenade.
    const p = [], uv = [], indices = []; const n = 360;
    for (let i = 0; i <= n; i++) {
      const a = i / n * TAU;
      for (let j = 0; j < 2; j++) {
        const lane = j === 0 ? -1.65 : 1.65;
        const point = pathPoint(a, lane); p.push(point.x, point.y, point.z); uv.push(i / n * 58, j * 1.7);
      }
      if (i < n) { const k = i * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const pg = new T.BufferGeometry(); pg.setAttribute('position', new T.Float32BufferAttribute(p, 3)); pg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); pg.setIndex(indices); pg.computeVertexNormals();
    mesh(pg, pathMat, scene).castShadow = false;
    // Stone edging around both sides of the walk.
    const edgeMat = mat('#d2d0b9'), stoneGeo = new T.BoxGeometry(.73, .18, .22);
    const edging = new T.InstancedMesh(stoneGeo, edgeMat, 500);
    for (let i = 0; i < 500; i++) { const a = (i % 250) / 250 * TAU; const pt = pathPoint(a, i < 250 ? -1.8 : 1.8); dummy.position.set(pt.x, .48, pt.z); dummy.rotation.set(0, -Math.atan2(-Math.sin(a) * 32, Math.cos(a) * 23), 0); dummy.updateMatrix(); edging.setMatrixAt(i, dummy.matrix); }
    edging.receiveShadow = true; scene.add(edging);
    // A warm stone plaza and a winding entrance.
    const plaza = mesh(new T.CircleGeometry(7, 64), pathMat, scene, 27, .47, 17); plaza.rotation.x = -Math.PI / 2;
    const entry = [new T.Vector3(29, .45, 21), new T.Vector3(38, .46, 31), new T.Vector3(43, .6, 48), new T.Vector3(40, .9, 66)];
    ribbon(entry, 3.4, pathMat);
    // Barely visible distant hills replace the hard horizon.
    const hillColors = ['#a9b9a0', '#bec9b2', '#cbd3be'];
    for (let j = 2; j >= 0; j--) for (let i = 0; i < 9; i++) { const x = -130 + i * 34; sphere(scene, x, -12 + j * 2, -90 - j * 27, 39, 18 + rand(0, 12), 23, mat(hillColors[j]), 2).castShadow = false; }
  }
  function ribbon(points, halfWidth, material) {
    const curve = new T.CatmullRomCurve3(points), ps = [], uvs = [], idx = [];
    for (let i = 0; i <= 120; i++) { const t = i / 120, p = curve.getPoint(t), tangent = curve.getTangent(t); const normal = new T.Vector3(-tangent.z, 0, tangent.x).normalize();
      for (let j = 0; j < 2; j++) { const v = p.clone().addScaledVector(normal, j ? halfWidth : -halfWidth); ps.push(v.x, v.y, v.z); uvs.push(t * 20, j * 2); }
      if (i < 120) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(ps, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals(); mesh(g, material).castShadow = false;
  }
  function buildWater() {
    reflectionTarget = new T.WebGLRenderTarget(lowQuality ? 384 : 768, lowQuality ? 384 : 768, { type: T.HalfFloatType, depthBuffer: true });
    reflectionMatrix = new T.Matrix4(); mirrorCamera = new T.PerspectiveCamera();
    const vs = `varying vec3 vWorld; varying vec4 vReflection; uniform mat4 reflectionMatrix; uniform float time; void main(){vec4 world=modelMatrix*vec4(position,1.); vWorld=world.xyz; vReflection=reflectionMatrix*world; gl_Position=projectionMatrix*viewMatrix*world;}`;
    const fs = `precision highp float;
      uniform sampler2D reflectionMap; uniform float time; uniform vec3 sunDirection; uniform vec3 waterColor; uniform vec3 sunColor; uniform float night; uniform vec4 ripples[10];
      varying vec3 vWorld; varying vec4 vReflection;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      float height(vec2 p){float t=time;float h=sin(p.x*1.5+p.y*.8+t*.9)*.022+sin(p.y*2.8-p.x*.9-t*1.2)*.014; h+=sin(p.x*7.1+p.y*4.7+t*1.8)*.004; h+=noise(p*1.9+vec2(t*.13,t*.09))*.035;return h;}
      void main(){
        vec2 p=vWorld.xz; float e=.055; float h=height(p); vec2 grad=vec2(height(p+vec2(e,0))-h,height(p+vec2(0,e))-h)/e;
        float ring=0.;
        for(int i=0;i<10;i++){float age=time-ripples[i].z; if(age>0.&&age<5.){float d=distance(p,ripples[i].xy);float wave=sin(d*7.-age*8.)*exp(-pow(d-age*1.7,2.)*1.4)*exp(-age*.65)*ripples[i].w;ring+=wave;grad+=normalize(p-ripples[i].xy+vec2(.001))*wave*.13;}}
        vec3 n=normalize(vec3(-grad.x*1.3,1.,-grad.y*1.3)); vec3 eye=normalize(cameraPosition-vWorld);
        float fresnel=.15+.77*pow(1.-max(dot(eye,n),0.),3.8);
        vec2 uv=vReflection.xy/vReflection.w+grad*.018;
        vec3 reflection=texture2D(reflectionMap,clamp(uv,vec2(.003),vec2(.997))).rgb;
        vec3 deep=waterColor; float caustic=pow(max(0.,1.-abs(sin(p.x*2.3+time*.4+sin(p.y*2.2)*.6)*sin(p.y*2.8-time*.35))),12.);
        vec3 base=deep+vec3(.045,.073,.035)*caustic;
        float metric=length(p/vec2(26.,17.)); float shore=1.-smoothstep(.88,1.02,metric);
        base=mix(vec3(.25,.43,.30),base,shore);
        vec3 color=mix(base,reflection,fresnel*.72);
        vec3 reflectedSun=reflect(-normalize(sunDirection),n); float spec=pow(max(dot(reflectedSun,eye),0.),200.);
        float glint=pow(max(dot(reflectedSun,eye),0.),38.)*pow(noise(p*24.+time*.5),5.);
        color+=sunColor*(spec*.9+glint*2.2)*(1.-night*.7);
        float edge=smoothstep(.95,1.015,metric); float foam=(sin(p.x*8.+p.y*6.+time*.8)*.5+.5)*edge*.09;
        color+=vec3(.63,.72,.56)*(foam+max(ring,0.)*.2); gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
    const pts = []; for (let i = 0; i < 192; i++) { const a = i / 192 * TAU, r = lakeRadius(a); pts.push(new T.Vector2(Math.cos(a) * 26 * r, -Math.sin(a) * 17 * r)); }
    const shape = new T.Shape(pts), geo = new T.ShapeGeometry(shape, 64); geo.rotateX(-Math.PI / 2);
    const waterMat = new T.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: { reflectionMap: { value: reflectionTarget.texture }, reflectionMatrix: { value: reflectionMatrix }, time: { value: 0 }, sunDirection: { value: new T.Vector3(-.5, .8, -.3) }, waterColor: { value: new T.Color('#3b9f91') }, sunColor: { value: new T.Color('#fff3bd') }, night: { value: 0 }, ripples: { value: ripples } }, side: T.DoubleSide });
    water = mesh(geo, waterMat, scene, 0, .2, 0); water.castShadow = false; water.receiveShadow = false; water.name = '湖面';
    // Individual sun-bleached pebbles and larger shoreline rocks.
    const rockMat = mat('#b7b8a1'), rockGeo = new T.DodecahedronGeometry(1, lowQuality ? 0 : 1), count = 390;
    const rocks = new T.InstancedMesh(rockGeo, rockMat, count);
    for (let i = 0; i < count; i++) { const a = rand(0, TAU), r = lakeRadius(a) * rand(.99, 1.045), x = Math.cos(a) * 26 * r, z = Math.sin(a) * 17 * r, s = rand(.14, .52); dummy.position.set(x, groundHeight(x, z) + .06, z); dummy.rotation.set(rand(0, 3), rand(0, 6), rand(0, 3)); dummy.scale.set(s * rand(1, 2), s * .65, s); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix); }
    rocks.castShadow = rocks.receiveShadow = true; scene.add(rocks);
    // Water lilies with layered petals.
    const padMat = mat('#477c50', .55), stemMat = mat('#4d7b3c'), petalMats = [mat('#f5e6e4'), mat('#e4acb3')];
    for (let i = 0; i < 26; i++) {
      const x = rand(-20, -9), z = rand(6, 11); if (lakeMetric(x, z) > .88) continue;
      const pad = mesh(new T.CircleGeometry(rand(.35, .65), 28, .25, TAU - .35), padMat, scene, x, .24, z); pad.rotation.x = -Math.PI / 2; pad.rotation.z = rand(0, 6); pad.castShadow = false;
      if (i % 3 === 0) { const flower = new T.Group(); flower.position.set(x, .29, z); scene.add(flower);
        for (let k = 0; k < 9; k++) { const a = k / 9 * TAU; const p = sphere(flower, Math.cos(a) * .12, .05, Math.sin(a) * .12, .11, .045, .22, petalMats[k % 2], 1); p.rotation.y = -a + Math.PI / 2; p.rotation.x = -.3; }
        sphere(flower, 0, .1, 0, .09, .07, .09, mat('#e9bd60')); animatedFlowers.push(flower);
      }
    }
    // Reeds cluster at protected corners of the lake.
    const reedMat = mat('#6c8b45'), seedMat = mat('#816244');
    for (let i = 0; i < 95; i++) { const a = rand(3.3, 4.4), r = rand(.96, 1.035) * lakeRadius(a), x = Math.cos(a) * 26 * r, z = Math.sin(a) * 17 * r, h = rand(.6, 1.45), y = groundHeight(x, z); cylinder(scene, new T.Vector3(x, y, z), new T.Vector3(x + .07, y + h, z), .025, .012, reedMat, 4); if (i % 3 === 0) cylinder(scene, new T.Vector3(x + .07, y + h * .8, z), new T.Vector3(x + .07, y + h + .14, z), .055, .045, seedMat, 6); }
  }
  function buildPavilion() {
    const g = new T.Group(); g.position.set(-7, .1, -3); g.rotation.y = Math.PI / 6; scene.add(g);
    const stone = mat('#e3ded0'), dark = mat('#4e6653'), wood = mat('#987654'), roofMat = mat('#566b5d'), roofRim = mat('#bdad82'), cream = mat('#eee5ca');
    materials.wood = wood; materials.dark = dark;
    const foundation = mesh(new T.CylinderGeometry(4.65, 4.9, .55, 6), stone, g, 0, .45, 0);
    mesh(new T.CylinderGeometry(4.4, 4.65, .25, 6), cream, g, 0, .85, 0);
    mesh(new T.CylinderGeometry(4.25, 4.25, .12, 6), stone, g, 0, 1.03, 0);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + Math.PI / 6, x = Math.cos(a) * 3.55, z = Math.sin(a) * 3.55;
      mesh(new T.CylinderGeometry(.16, .2, 4, 12), cream, g, x, 3.05, z);
      mesh(new T.CylinderGeometry(.29, .27, .2, 12), stone, g, x, 1.2, z);
      mesh(new T.CylinderGeometry(.31, .22, .19, 12), roofRim, g, x, 4.94, z);
      const a2 = (i + 1) / 6 * TAU + Math.PI / 6, x2 = Math.cos(a2) * 3.55, z2 = Math.sin(a2) * 3.55;
      cylinder(g, new T.Vector3(x, 4.87, z), new T.Vector3(x2, 4.87, z2), .14, .14, dark, 8);
      if (i !== 1 && i !== 2) { cylinder(g, new T.Vector3(x, 2.1, z), new T.Vector3(x2, 2.1, z2), .07, .07, cream); cylinder(g, new T.Vector3(x, 1.35, z), new T.Vector3(x2, 1.35, z2), .06, .06, cream);
        for (let j = 1; j < 7; j++) { const t = j / 7; cylinder(g, new T.Vector3(T.MathUtils.lerp(x, x2, t), 1.35, T.MathUtils.lerp(z, z2, t)), new T.Vector3(T.MathUtils.lerp(x, x2, t), 2.1, T.MathUtils.lerp(z, z2, t)), .036, .036, cream, 6); }
        const bench = box(g, (x + x2) * .42, 1.58, (z + z2) * .42, 3.1, .14, .55, wood); bench.rotation.y = -a - Math.PI / 6;
      }
      // Curved braces under the roof.
      const mid = new T.Vector3((x + x2) / 2, 4.88, (z + z2) / 2);
      curveTube([new T.Vector3(x, 4.05, z), new T.Vector3(x * .9 + mid.x * .1, 4.6, z * .9 + mid.z * .1), mid], .07, cream, g, 12);
    }
    // Layered pagoda roof, tiled by six radial arrays.
    mesh(new T.ConeGeometry(5.45, 2.25, 6), roofMat, g, 0, 6.18, 0).rotation.y = Math.PI / 6;
    mesh(new T.CylinderGeometry(5.5, 5.5, .16, 6), roofRim, g, 0, 5.05, 0).rotation.y = Math.PI / 6;
    const tileGeo = new T.CylinderGeometry(.058, .058, .48, 5), tileMat = mat('#71816b');
    for (let face = 0; face < 6; face++) {
      const a = face / 6 * TAU;
      for (let row = 0; row < 7; row++) { const f = (row + .5) / 7, r = 5 * (1 - f), count = Math.max(2, Math.floor((1 - f) * 15));
        for (let col = 0; col < count; col++) { const tangent = (col / (count - 1 || 1) - .5) * r * .95; const tile = mesh(tileGeo, tileMat, g, Math.cos(a) * r + Math.cos(a + Math.PI / 2) * tangent, 5.12 + f * 2.12, Math.sin(a) * r + Math.sin(a + Math.PI / 2) * tangent); tile.rotation.set(0, -a, Math.PI / 2 - .43); tile.castShadow = false; }
      }
      curveTube([new T.Vector3(Math.cos(a) * 5.35, 5.15, Math.sin(a) * 5.35), new T.Vector3(Math.cos(a) * 2.3, 6.2, Math.sin(a) * 2.3), new T.Vector3(0, 7.33, 0)], .065, roofRim, g);
    }
    mesh(new T.ConeGeometry(.36, .6, 8), roofRim, g, 0, 7.5, 0); sphere(g, 0, 7.86, 0, .14, .2, .14, roofRim, 2);
    const glow = new T.MeshStandardMaterial({ color: '#f7e6b5', emissive: '#ffbf59', emissiveIntensity: .1, roughness: .4 }); lanternMaterials.push(glow);
    mesh(new T.CylinderGeometry(.32, .25, .65, 8), glow, g, 0, 4.2, 0);
    const lamp = new T.PointLight('#ffc370', 0, 12, 2); lamp.position.set(-7, 4, -3); scene.add(lamp); lanternMaterials.push(lamp);
    // Curving timber bridge from the left shore to the island pavilion.
    bridge(new T.Vector3(-28, .5, 3), new T.Vector3(-10.8, 1, -1.5), 2.4);
    // A lower stepping jetty on the opposite bank.
    const jetty = new T.Group(); jetty.position.set(21.7, .5, 7.7); jetty.rotation.y = -.75; scene.add(jetty);
    for (let j = 0; j < 18; j++) box(jetty, 0, .06, j * .32, 3.1, .17, .29, wood);
    for (const x of [-1.6, 1.6]) for (const z of [0, 2.8, 5.7]) { mesh(new T.CylinderGeometry(.1, .14, 2.2, 10), dark, jetty, x, -.1, z); sphere(jetty, x, 1.04, z, .14, .1, .14, roofRim, 1); }
  }
  function bridge(start, end, width) {
    const group = new T.Group(); scene.add(group);
    const stone = mat('#dfd9c3'), wood = mat('#a88459'), rail = mat('#ebe3c8');
    const delta = end.clone().sub(start), length = delta.length(), direction = delta.clone().normalize(), side = new T.Vector3(-direction.z, 0, direction.x);
    const get = (t, s = 0, h = 0) => start.clone().lerp(end, t).addScaledVector(side, s).add(new T.Vector3(0, Math.sin(t * Math.PI) * 1.65 + h, 0));
    for (let i = 0; i < 48; i++) { const p = get(i / 47); const plank = box(group, p.x, p.y, p.z, width, .17, length / 47 + .015, wood); plank.rotation.y = Math.atan2(direction.x, direction.z); plank.rotation.x = -(Math.cos(i / 47 * Math.PI) * 1.65 * Math.PI / length); }
    for (const s of [-width / 2, width / 2]) {
      const pts = [], lower = [];
      for (let i = 0; i <= 12; i++) { const p = get(i / 12, s); cylinder(group, p, p.clone().add(new T.Vector3(0, 1.15, 0)), .07, .06, rail, 8); sphere(group, p.x, p.y + 1.17, p.z, .1, .09, .1, rail, 1); pts.push(get(i / 12, s, 1.1)); lower.push(get(i / 12, s, .35));
        if (i < 12) { cylinder(group, get(i / 12, s, .38), get((i + 1) / 12, s, 1.07), .032, .032, rail, 5); cylinder(group, get(i / 12, s, 1.07), get((i + 1) / 12, s, .38), .032, .032, rail, 5); }
      }
      curveTube(pts, .075, rail, group, 72); curveTube(lower, .04, rail, group, 72);
      for (const t of [.16, .5, .84]) { const p = get(t, s); cylinder(group, new T.Vector3(p.x, -1.1, p.z), p, .13, .11, stone); }
    }
  }
  function buildTrees() {
    const bark = mat('#78634b'), branchMat = mat('#887357'), foliageMats = ['#667f42', '#7e944c', '#91a756', '#a1af5f', '#52764a'].map(c => mat(c));
    materials.windTime = { value: 0 };
    foliageMats.forEach(material => { material.onBeforeCompile = shader => { shader.uniforms.parkWindTime = materials.windTime; shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float parkWindTime;').replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.x += sin(parkWindTime * .65 + instanceMatrix[3].x * .24 + instanceMatrix[3].z * .18) * .07;\n#endif'); }; });
    const foliageGeo = new T.IcosahedronGeometry(1, lowQuality ? 0 : 2);
    const batches = foliageMats.map(m => ({ mesh: new T.InstancedMesh(foliageGeo, m, 3000), n: 0 }));
    const addLeaf = (x, y, z, sx, sy, sz, ci) => { const b = batches[ci % batches.length]; dummy.position.set(x, y, z); dummy.rotation.set(rand(0, 3), rand(0, 6), rand(0, 3)); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); b.mesh.setMatrixAt(b.n++, dummy.matrix); };
    function tree(x, z, scale = 1, type = 'round') {
      const y = groundHeight(x, z), h = rand(6, 9) * scale, trunk = rand(.25, .44) * scale;
      cylinder(scene, new T.Vector3(x, y, z), new T.Vector3(x + .15 * scale, y + h * .74, z), trunk, trunk * .43, bark, 9);
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + rand(0, .4), ey = y + h * rand(.65, .92), ex = x + Math.cos(a) * 1.6 * scale, ez = z + Math.sin(a) * 1.6 * scale;
        cylinder(scene, new T.Vector3(x, y + h * .42, z), new T.Vector3(ex, ey, ez), trunk * .44, .06 * scale, branchMat, 7);
      }
      const c = Math.floor(rand(0, 5));
      if (type === 'cypress') {
        for (let i = 0; i < 22; i++) { const f = i / 22, a = i * 2.4, r = Math.sin(f * Math.PI) * 1.1 * scale; addLeaf(x + Math.cos(a) * r * .4, y + 2 * scale + f * h, z + Math.sin(a) * r * .4, r + .28 * scale, .75 * scale, r + .3 * scale, c); }
      } else {
        const max = type === 'willow' ? 70 : 42;
        for (let i = 0; i < max; i++) { const a = rand(0, TAU), r = Math.sqrt(rand(0, 1)) * 3.4 * scale, yy = y + h * .78 + rand(-1.3, 1.9) * scale - r * .09, s = rand(.6, 1.15) * scale;
          addLeaf(x + Math.cos(a) * r, yy, z + Math.sin(a) * r, s * 1.3, s * .85, s, (c + Math.floor(rand(0, 2))) % 5);
        }
        if (type === 'willow') {
          for (let i = 0; i < 28; i++) { const a = i / 28 * TAU, rr = rand(2, 3.8) * scale, rootY = y + h * .74; const pts = [], sx = x + Math.cos(a) * rr, sz = z + Math.sin(a) * rr;
            for (let j = 0; j <= 6; j++) pts.push(new T.Vector3(sx + Math.cos(a) * j * .025 * scale, rootY - j * .6 * scale, sz + Math.sin(a) * j * .025 * scale));
            curveTube(pts, .018 * scale, foliageMats[1], scene, 12);
            for (let j = 0; j < 12; j++) addLeaf(sx + (j % 2 ? .1 : -.1) * scale, rootY - j * .3 * scale, sz, .17 * scale, .29 * scale, .065 * scale, (i % 2) + 1);
          }
        }
      }
      // Roots and a tiny moss skirt.
      for (let j = 0; j < 4; j++) { const a = j / 4 * TAU; cylinder(scene, new T.Vector3(x, y + .15, z), new T.Vector3(x + Math.cos(a) * trunk * 2, y, z + Math.sin(a) * trunk * 2), trunk * .35, .03, bark, 6); }
    }
    // Deliberately spaced specimen trees keep the lake open to view.
    const specimens = [[-36,13,1.3,'willow'],[31,-9,1.2,'willow'],[-24,-22,1.25,'willow'],[36,22,.95,'round'],[-40,-4,1.25,'round'],[-13,-31,1.15,'round'],[11,-28,1.1,'round'],[28,-26,1.2,'round'],[-30,30,.88,'round'],[4,35,.86,'round'],[45,5,1.2,'round'],[45,31,.9,'round'],[22,34,.7,'round']];
    specimens.forEach(s => tree(...s));
    for (let i = 0; i < 51; i++) { const a = rand(Math.PI, TAU + .4), r = rand(1.65, 2.55), x = Math.cos(a) * 32 * r, z = Math.sin(a) * 24 * r; tree(x, z, rand(.65, 1.25), i % 5 === 0 ? 'cypress' : 'round'); }
    for (const b of batches) { b.mesh.count = b.n; b.mesh.instanceMatrix.needsUpdate = true; b.mesh.castShadow = true; b.mesh.receiveShadow = true; scene.add(b.mesh); }
    // Cherry blossom near the garden.
    const cherry = new T.Group(); cherry.position.set(40, groundHeight(40, -10), -10); scene.add(cherry);
    cylinder(cherry, new T.Vector3(0,0,0), new T.Vector3(0,5.2,0), .26,.11,bark);
    const pink = mat('#dcb7b7'), pinkLight = mat('#efd3c9');
    for (let i = 0; i < 32; i++) { const a = rand(0,TAU), r=rand(0,3.2); sphere(cherry,Math.cos(a)*r,5+rand(-.6,1.4),Math.sin(a)*r,rand(.6,1.25),rand(.55,1),rand(.6,1.25),i%3?pink:pinkLight,1); }
  }
  function buildGardens() {
    const flowerPositions = [], leafPositions = [], palette = ['#f2d27a','#ecb5a2','#ddd5e6','#f5eee0','#af91bd','#e5a7b2'];
    const flowers = palette.map(c => ({ material: mat(c), instances: [] }));
    const green = mat('#789548'), flowerGeo = lowQuality ? new T.IcosahedronGeometry(1, 0) : new T.SphereGeometry(1, 6, 4), grassGeo = new T.ConeGeometry(.045, .6, 3);
    const stems = [], grass = [];
    const beds = [[20,28,5.6,2.5],[29,-21,5,2.5],[-24,21,4,2.4],[-10,29,5,2],[41,14,2.5,6],[-38,-14,4,3]];
    beds.forEach(([x,z,rx,rz],bi) => {
      const ring = []; for(let i=0;i<=80;i++){const a=i/80*TAU;ring.push(new T.Vector3(x+Math.cos(a)*rx,.55,z+Math.sin(a)*rz));}curveTube(ring,.12,mat('#c7c6aa'),scene,80);
      const soil = mesh(new T.CircleGeometry(1,48),mat('#6e7750'),scene,x,.46,z); soil.rotation.x=-Math.PI/2;soil.scale.set(rx,rz,1); soil.castShadow=false;
      for(let i=0;i<(lowQuality?110:240);i++) {const a=rand(0,TAU),r=Math.sqrt(rand(0,1)),xx=x+Math.cos(a)*rx*r,zz=z+Math.sin(a)*rz*r,hh=rand(.35,.85),ss=rand(.09,.16); const ci=(bi+Math.floor(rand(0,3)))%palette.length;
        flowers[ci].instances.push([xx,.5+hh,zz,ss]); stems.push([xx,.5+hh/2,zz,.018,hh,.018]);
        for(let k=0;k<2;k++) leafPositions.push([xx+(k?-.09:.09),.65+hh*.2,zz,.14,.05,.07]);
      }
    });
    // Blossoms have five petals and a bright central heart, all instanced.
    const centerData=[];
    flowers.forEach(({material,instances})=>{const m=new T.InstancedMesh(flowerGeo,material,instances.length*5);let n=0;instances.forEach(([x,y,z,s])=>{for(let k=0;k<5;k++){const a=k/5*TAU;dummy.position.set(x+Math.cos(a)*s*.65,y,z+Math.sin(a)*s*.65);dummy.rotation.set(.15,a,0);dummy.scale.set(s*.7,s*.3,s*.65);dummy.updateMatrix();m.setMatrixAt(n++,dummy.matrix);}centerData.push([x,y+.015,z,s*.35,s*.25,s*.35]);});m.receiveShadow=true;scene.add(m);});
    function batchBox(data,geometry,material,shadows=false){const m=new T.InstancedMesh(geometry,material,data.length);data.forEach((v,i)=>{dummy.position.set(v[0],v[1],v[2]);dummy.rotation.set(0,0,0);dummy.scale.set(v[3],v[4],v[5]);dummy.updateMatrix();m.setMatrixAt(i,dummy.matrix);});m.castShadow=shadows;m.receiveShadow=true;scene.add(m);return m;}
    batchBox(stems,new T.BoxGeometry(1,1,1),green);
    batchBox(leafPositions,flowerGeo,mat('#799755'));
    batchBox(centerData,flowerGeo,mat('#f1ce69'));
    // Fine grass only outside the promenade, never floating over the lake.
    for(let i=0;i<(lowQuality?2800:6500);i++){const x=rand(-65,65),z=rand(-52,50),r=lakeMetric(x,z);const pa=Math.atan2(z/23.5,x/32.2),dist=Math.hypot(x/32.2,z/23.5);if(r<1.1||Math.abs(dist-1)<.09||(x>25&&z>17&&z<55&&x<47))continue;grass.push([x,groundHeight(x,z)+.14,z,rand(.7,1.4),rand(.5,1.3),rand(.7,1.4)]);}
    grassBatch=batchBox(grass,grassGeo,mat('#91a860'));
    // Rounded, clipped bushes.
    const bush=mat('#708c4b');for(let i=0;i<65;i++){const a=rand(0,TAU),r=rand(1.46,1.72),x=Math.cos(a)*32*r,z=Math.sin(a)*24*r; sphere(scene,x,groundHeight(x,z)+.6,z,rand(.8,1.8),rand(.6,1.1),rand(.7,1.4),bush,1);}
    // Floating butterflies around the garden.
    const butterflyMat=[new T.MeshBasicMaterial({color:'#f5d18b',side:T.DoubleSide}),new T.MeshBasicMaterial({color:'#dfaece',side:T.DoubleSide})];
    for(let i=0;i<16;i++){const g=new T.Group(),left=mesh(new T.CircleGeometry(.15,8),butterflyMat[i%2],g,-.12,0,0),right=mesh(new T.CircleGeometry(.15,8),butterflyMat[i%2],g,.12,0,0);scene.add(g);butterflies.push({g,left,right,phase:rand(0,6),x:rand(17,27),z:rand(24,31)});}
  }
  function buildFurniture() {
    const wood = mat('#a17d52'), metal = mat('#4c6454'), cream = mat('#e8e1c7');
    function bench(a) {
      const pos=pathPoint(a,3.5),g=new T.Group();g.position.copy(pos);g.rotation.y=-a-Math.PI/2;scene.add(g);
      const pad=mesh(new T.BoxGeometry(3.9,.1,2.4),materials.path,g,0,.01,0);pad.receiveShadow=true;
      for(let i=0;i<5;i++)box(g,0,.73,-.48+i*.21,3,.12,.17,wood);
      for(let i=0;i<3;i++)box(g,0,1.1+i*.2,-.6,3,.14,.11,wood);
      for(const x of [-1.15,1.15]){box(g,x,.37,0,.11,.72,.9,metal);box(g,x,1.02,-.58,.1,1.02,.1,metal);curveTube([new T.Vector3(x,.73,.45),new T.Vector3(x,1.08,.45),new T.Vector3(x,1.12,-.52)],.045,metal,g,12);}
      interactive.push({object:g,label:'坐一会儿，让风替你翻页。'});
    }
    [0.35,1.17,1.95,2.82,3.55,4.65,5.55].forEach(bench);
    function lamp(a) {
      const p=pathPoint(a,2.45); const g=new T.Group();g.position.copy(p);scene.add(g);
      mesh(new T.CylinderGeometry(.055,.095,3.7,8),metal,g,0,1.85,0);mesh(new T.CylinderGeometry(.18,.23,.18,8),metal,g,0,.09,0);
      const luminous=new T.MeshStandardMaterial({color:'#fff0c4',emissive:'#ffd38a',emissiveIntensity:.05,roughness:.35});lanternMaterials.push(luminous);
      mesh(new T.CylinderGeometry(.26,.18,.55,6),luminous,g,0,3.9,0);mesh(new T.ConeGeometry(.4,.27,6),metal,g,0,4.3,0);
      for(let k=0;k<6;k++){const aa=k/6*TAU;cylinder(g,new T.Vector3(Math.cos(aa)*.2,3.6,Math.sin(aa)*.2),new T.Vector3(Math.cos(aa)*.27,4.18,Math.sin(aa)*.27),.022,.022,metal,4);}
    }
    for(let i=0;i<15;i++)lamp(i/15*TAU);
    // Park signs with genuine lettering, rendered into a local canvas texture.
    function sign(text,sub,x,z,rot) {
      const c=document.createElement('canvas');c.width=512;c.height=256;const ctx=c.getContext('2d');ctx.fillStyle='#405d45';ctx.fillRect(0,0,512,256);ctx.strokeStyle='#b7c4a2';ctx.lineWidth=2;ctx.strokeRect(14,14,484,228);ctx.fillStyle='#f3efdb';ctx.textAlign='center';ctx.font='38px Microsoft YaHei';ctx.fillText(text,256,111);ctx.font='15px sans-serif';ctx.fillStyle='#bdc8a8';ctx.fillText(sub,256,159);
      const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;const g=new T.Group();g.position.set(x,.4,z);g.rotation.y=rot;scene.add(g);box(g,0,1.2,0,.12,2.4,.12,wood);box(g,0,2.1,0,2.9,1.45,.12,wood);mesh(new T.PlaneGeometry(2.8,1.4),new T.MeshStandardMaterial({map:tex,roughness:.8}),g,0,2.1,.068);
    }
    sign('晴湾公园','W I L L O W   P A R K',30.5,22.5,.4);sign('湖心亭  ←','THE LAKESIDE PAVILION',-28,7,1.2);
    // Picnic setting: textile, wicker basket, book and fruit.
    const picnic=new T.Group();picnic.position.set(12,groundHeight(12,34)+.03,34);picnic.rotation.y=.3;scene.add(picnic);
    box(picnic,0,.02,0,3.5,.045,2.6,mat('#ded5b3'));
    for(let i=0;i<12;i++){box(picnic,-1.65+i*.3,.047,0,.07,.007,2.6,mat('#f5edda'));}for(let i=0;i<9;i++)box(picnic,0,.048,-1.2+i*.3,3.5,.008,.07,mat('#c0c6a2'));
    box(picnic,-.8,.3,-.5,.85,.5,.55,mat('#aa8657'));curveTube([new T.Vector3(-1.1,.55,-.5),new T.Vector3(-.8,1,-.5),new T.Vector3(-.5,.55,-.5)],.045,wood,picnic,14);
    const book=box(picnic,.5,.08,.5,.65,.08,.85,mat('#92a4a0'));book.rotation.y=.3;box(picnic,.5,.13,.5,.6,.015,.8,cream);
    for(let i=0;i<3;i++)sphere(picnic,.3+i*.2,.13,-.5,.12,.12,.12,mat(i%2?'#c1a159':'#bd7e57'),2);
    // Small stone drinking fountain at the main plaza.
    mesh(new T.CylinderGeometry(.45,.65,1.1,12),cream,scene,29,.95,15);
    mesh(new T.CylinderGeometry(.72,.45,.2,18),cream,scene,29,1.57,15);
    mesh(new T.CylinderGeometry(.6,.6,.035,24),mat('#56958b',.25),scene,29,1.68,15);
  }
  function buildAnimals() {
    const white=mat('#eeebdb'),beak=mat('#ca9d4b'),brown=mat('#8b7860'),dark=mat('#354c43');
    for(let i=0;i<7;i++) {
      const g=new T.Group();scene.add(g);const female=i%3===0;
      sphere(g,0,.2,0,.63,.31,.35,female?brown:white,2);sphere(g,.46,.5,0,.23,.25,.21,female?brown:mat('#50775d'),2);
      const bill=mesh(new T.ConeGeometry(.11,.37,5),beak,g,.72,.46,0);bill.rotation.z=-Math.PI/2;
      sphere(g,.55,.57,.17,.028,.03,.03,dark,1);sphere(g,.55,.57,-.17,.028,.03,.03,dark,1);
      sphere(g,-.12,.34,.24,.38,.12,.1,female?mat('#9f886b'):mat('#d7d8c7'),1);sphere(g,-.12,.34,-.24,.38,.12,.1,female?brown:white,1);
      const tail=mesh(new T.ConeGeometry(.22,.35,5),white,g,-.56,.28,0);tail.rotation.z=.9;
      ducks.push({g,phase:rand(0,6),radius:rand(4,9),speed:rand(.018,.035),center:new T.Vector2(6,3),lastRipple:0});
    }
    const wingMat=new T.MeshStandardMaterial({color:'#f7f3e6',side:T.DoubleSide,roughness:.9});
    const wingShape=new T.Shape();wingShape.moveTo(0,0);wingShape.quadraticCurveTo(.4,.18,1.2,-.1);wingShape.quadraticCurveTo(.65,-.15,0,-.05);const wingGeo=new T.ShapeGeometry(wingShape);
    for(let i=0;i<12;i++){const g=new T.Group(),l=mesh(wingGeo,wingMat,g),r=mesh(wingGeo,wingMat,g);l.rotation.x=-Math.PI/2;r.rotation.set(-Math.PI/2,Math.PI,0);sphere(g,0,0,0,.23,.12,.1,white,1);scene.add(g);birds.push({g,l,r,phase:rand(0,6),radius:rand(24,44),height:rand(14,24)});}
    // Pollen suspended in the sunlight.
    const positions=new Float32Array(210*3);for(let i=0;i<210;i++){positions[i*3]=rand(-45,45);positions[i*3+1]=rand(.5,12);positions[i*3+2]=rand(-35,35);particles.push({x:positions[i*3],y:positions[i*3+1],z:positions[i*3+2],phase:rand(0,6)});}
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(positions,3));const pollen=new T.Points(geo,new T.PointsMaterial({color:'#fff3d0',size:.075,transparent:true,opacity:.6,depthWrite:false}));pollen.name='pollen';scene.add(pollen);
  }
  function sky() {
    const skymat=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,uniforms:{top:{value:new T.Color('#b6cfd0')},bottom:{value:new T.Color('#edf0dc')}},vertexShader:'varying vec3 vPos; void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 vPos;uniform vec3 top;uniform vec3 bottom;void main(){float h=normalize(vPos).y;gl_FragColor=vec4(mix(bottom,top,smoothstep(-.05,.9,h)),1.); #include <colorspace_fragment> }'.replace(' #include','\n#include')});
    const s=mesh(new T.SphereGeometry(400,32,20),skymat);s.castShadow=s.receiveShadow=false;materials.sky=skymat;
    const cloudMat=mat('#f5f3e6');
    for(let i=0;i<9;i++){const g=new T.Group();g.position.set(rand(-130,130),rand(40,65),rand(-125,-65));scene.add(g);for(let j=0;j<5;j++)sphere(g,j*3.8,rand(-.4,1.1),rand(-1,1),rand(3,6),rand(1.3,2.3),rand(2,4),cloudMat,2).castShadow=false;clouds.push(g);}
  }
  function optimizeStaticScene() {
    scene.updateMatrixWorld(true);
    const excluded = new Set([water, ...windGroups.map(v => v.group), ...butterflies.map(v => v.g), ...ducks.map(v => v.g), ...birds.map(v => v.g), ...animatedFlowers, ...interactive.map(v => v.object)]);
    const groups = new Map();
    function visit(object) {
      if (excluded.has(object)) return;
      if (object.isMesh && !object.isInstancedMesh && !Array.isArray(object.material) && !object.material.isShaderMaterial) {
        const key = object.material.uuid + ':' + object.castShadow + ':' + object.receiveShadow;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(object);
      }
      object.children.forEach(visit);
    }
    visit(scene);
    const vector = new T.Vector3(), normal = new T.Vector3(), normalMatrix = new T.Matrix3();
    let combined = 0;
    for (const meshes of groups.values()) {
      if (meshes.length < 2) continue;
      const positions = [], normals = [], uvs = [], colors = [], indices = [];
      let offset = 0;
      for (const object of meshes) {
        const geometry = object.geometry, p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv, c = geometry.attributes.color;
        normalMatrix.getNormalMatrix(object.matrixWorld);
        for (let i = 0; i < p.count; i++) {
          vector.fromBufferAttribute(p, i).applyMatrix4(object.matrixWorld); positions.push(vector.x, vector.y, vector.z);
          if (n) normal.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize(); else normal.set(0, 1, 0);
          normals.push(normal.x, normal.y, normal.z); uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0); colors.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
        }
        if (geometry.index) for (let i = 0; i < geometry.index.count; i++) indices.push(geometry.index.getX(i) + offset);
        else for (let i = 0; i < p.count; i++) indices.push(i + offset);
        offset += p.count;
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(normals, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); g.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); g.setIndex(indices); g.computeBoundingSphere();
      const merged = new T.Mesh(g, meshes[0].material); merged.castShadow = meshes[0].castShadow; merged.receiveShadow = meshes[0].receiveShadow; merged.name = '静态合批'; scene.add(merged);
      meshes.forEach(m => m.removeFromParent()); combined += meshes.length - 1;
    }
    window.ParkStaticBatches = combined;
  }
  function buildActorBatches() {
    const roots = [scene.getObjectByName('willow-park-life'), ...ducks.map(v => v.g), ...birds.map(v => v.g), ...butterflies.map(v => v.g), ...animatedFlowers].filter(Boolean);
    const groups = new Map();
    roots.forEach(root => root.traverse(object => {
      if (!object.isMesh || object.isInstancedMesh || object.material.map) return;
      const basic = object.material.isMeshBasicMaterial;
      const key = object.geometry.type + JSON.stringify(object.geometry.parameters) + ':' + basic + ':' + Math.round((object.material.roughness || .8) * 2);
      if (!groups.has(key)) groups.set(key, { geometry: object.geometry, basic, roughness: object.material.roughness || .8, sources: [] });
      groups.get(key).sources.push(object); object.layers.set(31);
    }));
    for (const group of groups.values()) {
      const material = group.basic ? new T.MeshBasicMaterial({ color: '#ffffff', side: T.DoubleSide }) : new T.MeshStandardMaterial({ color: '#ffffff', roughness: group.roughness });
      const batch = new T.InstancedMesh(group.geometry, material, group.sources.length); batch.castShadow = !group.basic; batch.receiveShadow = !group.basic; batch.frustumCulled = false;
      group.sources.forEach((source, i) => batch.setColorAt(i, source.material.color));
      scene.add(batch); actorBatches.push({ batch, sources: group.sources });
    }
    updateActorBatches();
  }
  function updateActorBatches() {
    scene.updateMatrixWorld(true);
    const invisible = new T.Matrix4().makeScale(0, 0, 0);
    actorBatches.forEach(({ batch, sources }) => {
      sources.forEach((source, i) => { let visible = source.visible; for (let parent = source.parent; visible && parent; parent = parent.parent) visible = parent.visible; batch.setMatrixAt(i, visible ? source.matrixWorld : invisible); });
      batch.instanceMatrix.needsUpdate = true;
    });
  }
  function updateLight(value) {
    const evening=smooth(.6,1,value),morning=1-smooth(0,.35,value);
    const a=T.MathUtils.lerp(1.12,.22,evening);sun.position.set(-35,Math.sin(a)*85,-22+evening*50);
    sun.color.set('#fff3d1').lerp(new T.Color('#ffc588'),evening*.8);sun.intensity=2.65-evening*.85;
    hemi.intensity=1.65-evening*.55;hemi.color.set('#d7e6eb').lerp(new T.Color('#c7c5de'),evening*.6);
    scene.fog.color.set('#e2e9d3').lerp(new T.Color('#e7d4ba'),evening*.7);
    renderer.setClearColor(scene.fog.color);renderer.toneMappingExposure=1.03-evening*.04;
    materials.sky.uniforms.top.value.set('#b6cfd0').lerp(new T.Color('#d7bcb5'),evening*.75);
    materials.sky.uniforms.bottom.value.set('#edf0dc').lerp(new T.Color('#f5d9af'),evening*.8);
    water.material.uniforms.waterColor.value.set('#3b9f91').lerp(new T.Color('#658e82'),evening*.55);
    water.material.uniforms.sunDirection.value.copy(sun.position).normalize();water.material.uniforms.night.value=evening*.4;
    lanternMaterials.forEach(m=>{if(m.isLight)m.intensity=evening*15;else m.emissiveIntensity=.03+evening*1.5;});
  }
  function reflect() {
    const worldPos=camera.position.clone(),look=target.clone();
    mirrorCamera.copy(camera);mirrorCamera.position.set(worldPos.x,.4-worldPos.y,worldPos.z);look.y=.4-look.y;mirrorCamera.up.set(0,-1,0);mirrorCamera.lookAt(look);mirrorCamera.updateMatrixWorld();mirrorCamera.updateProjectionMatrix();
    // Oblique clipping plane removes submerged geometry from the mirror image.
    const clipPlane=new T.Plane(new T.Vector3(0,1,0),-.19);clipPlane.applyMatrix4(mirrorCamera.matrixWorldInverse);
    const clip=new T.Vector4(clipPlane.normal.x,clipPlane.normal.y,clipPlane.normal.z,clipPlane.constant),q=new T.Vector4(),projection=mirrorCamera.projectionMatrix.elements;
    q.x=(Math.sign(clip.x)+projection[8])/projection[0];q.y=(Math.sign(clip.y)+projection[9])/projection[5];q.z=-1;q.w=(1+projection[10])/projection[14];clip.multiplyScalar(2/clip.dot(q));projection[2]=clip.x;projection[6]=clip.y;projection[10]=clip.z+1;projection[14]=clip.w;
    reflectionMatrix.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);reflectionMatrix.multiply(mirrorCamera.projectionMatrix);reflectionMatrix.multiply(mirrorCamera.matrixWorldInverse);
    water.visible=false;const current=renderer.getRenderTarget();const shadow=renderer.shadowMap.autoUpdate, shadowUpdate=renderer.shadowMap.needsUpdate;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;renderer.setRenderTarget(reflectionTarget);renderer.clear();renderer.render(scene,mirrorCamera);renderer.setRenderTarget(current);renderer.shadowMap.autoUpdate=shadow;renderer.shadowMap.needsUpdate=shadowUpdate;water.visible=true;reflectionCount++;
  }
  function setView(name) {
    mode=name; autoOrbit=false;
    const presets={overview:{theta:.62,phi:.91,radius:92,target:new T.Vector3(-4,1.5,0)},pavilion:{theta:.7,phi:1.06,radius:37,target:new T.Vector3(-7,2,-3)},garden:{theta:.4,phi:1.04,radius:31,target:new T.Vector3(21,1.6,27)}};
    if(name==='dog'){transition=null;desiredTarget.copy(life?life.dog.position:new T.Vector3(20,1,17));orbit.radius=22;orbit.phi=1.16;return;}
    const p=presets[name]||presets.overview;let theta=p.theta;while(theta-orbit.theta>Math.PI)theta-=TAU;while(theta-orbit.theta<-Math.PI)theta+=TAU;
    transition={start:time,duration:2.4,from:{theta:orbit.theta,phi:orbit.phi,radius:orbit.radius,target:target.clone()},to:{...p,theta}};
  }
  function addRipple(x,z,strength=1) { const r=ripples.reduce((old,r)=>r.z<old.z?r:old,ripples[0]);r.set(x,z,time,strength); }
  function bindControls() {
    const el=renderer.domElement;
    const activePointers=new Map();let pinchDistance=0;
    el.addEventListener('pointerdown',e=>{if(e.button!==0&&e.pointerType!=='touch')return;try{el.setPointerCapture(e.pointerId);}catch(_){}activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});pointer={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,id:e.pointerId};moved=false;transition=null;if(activePointers.size===2){const p=[...activePointers.values()];pinchDistance=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);}});
    el.addEventListener('pointermove',e=>{if(!activePointers.has(e.pointerId))return;activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(activePointers.size===2){const p=[...activePointers.values()],dist=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);orbit.radius=clamp(orbit.radius*pinchDistance/Math.max(dist,1),12,145);pinchDistance=dist;moved=true;return;}if(!pointer)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;orbit.theta-=dx*.004;orbit.phi=clamp(orbit.phi-dy*.003,.28,1.43);orbit.dTheta=-dx*.0007;orbit.dPhi=-dy*.0004;pointer.x=e.clientX;pointer.y=e.clientY;if(Math.hypot(e.clientX-pointer.startX,e.clientY-pointer.startY)>5)moved=true;});
    function release(e){activePointers.delete(e.pointerId);if(pointer&&!moved&&activePointers.size===0){const rect=el.getBoundingClientRect(),p=new T.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),ray=new T.Raycaster();ray.setFromCamera(p,camera);const hit=ray.intersectObject(water);if(hit.length){addRipple(hit[0].point.x,hit[0].point.z,1.3);window.dispatchEvent(new CustomEvent('park-ripple'));}else{const objects=interactive.map(i=>i.object),hits=ray.intersectObjects(objects,true);if(hits.length){const item=interactive.find(i=>i.object===hits[0].object.parent);if(item)window.dispatchEvent(new CustomEvent('park-message',{detail:item.label}));}}}pointer=null;}
    el.addEventListener('pointerup',release);el.addEventListener('pointercancel',e=>{activePointers.delete(e.pointerId);pointer=null;});
    el.addEventListener('wheel',e=>{e.preventDefault();transition=null;orbit.radius=clamp(orbit.radius*Math.exp(e.deltaY*.001),12,145);},{passive:false});
    el.addEventListener('contextmenu',e=>e.preventDefault());
    window.addEventListener('keydown',e=>{if(/INPUT|BUTTON|TEXTAREA/.test(document.activeElement.tagName)||document.querySelector('dialog[open]'))return;const amount=.065;if(e.key==='ArrowLeft')orbit.theta+=amount;else if(e.key==='ArrowRight')orbit.theta-=amount;else if(e.key==='ArrowUp')orbit.phi=clamp(orbit.phi-.05,.28,1.43);else if(e.key==='ArrowDown')orbit.phi=clamp(orbit.phi+.05,.28,1.43);else if(e.key==='+'||e.key==='=')orbit.radius=clamp(orbit.radius*.9,12,145);else if(e.key==='-')orbit.radius=clamp(orbit.radius*1.1,12,145);else return;e.preventDefault();transition=null;});
    window.addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{running=!document.hidden;if(running){last=performance.now();clock.getDelta();}});
  }
  function resize() { width=container.clientWidth;height=container.clientHeight;camera.aspect=width/height;camera.updateProjectionMatrix();pixelRatio=Math.min(devicePixelRatio||1,lowQuality ? .7 : width<700?1.6:1.65);renderer.setPixelRatio(pixelRatio);renderer.setSize(width,height); }
  function animate(now) {
    requestAnimationFrame(animate); if(!running)return;
    const realDt=(now-(last||now))/1000; const dt=Math.min(realDt,.08);last=now;time+=dt;frame++;
    if(materials.windTime)materials.windTime.value=time;
    if(frame===35&&realDt>.055){pixelRatio=Math.min(pixelRatio,realDt>.12?.85:1.15);renderer.setPixelRatio(pixelRatio);renderer.setSize(width,height);reflectionTarget.setSize(lowQuality?256:512,lowQuality?256:512);}
    if(frame%(lowQuality?15:5)===0)renderer.shadowMap.needsUpdate=true;
    if(life)life.update(time,dt);
    if(transition){const f=clamp((time-transition.start)/transition.duration,0,1),s=f*f*(3-2*f);orbit.theta=T.MathUtils.lerp(transition.from.theta,transition.to.theta,s);orbit.phi=T.MathUtils.lerp(transition.from.phi,transition.to.phi,s);orbit.radius=T.MathUtils.lerp(transition.from.radius,transition.to.radius,s);target.copy(transition.from.target).lerp(transition.to.target,s);if(f>=1)transition=null;}
    else if(mode==='dog'&&life){desiredTarget.copy(life.dog.position);desiredTarget.y+=1;target.lerp(desiredTarget,1-Math.exp(-dt*2));}
    else if(!pointer){orbit.theta+=orbit.dTheta;orbit.phi=clamp(orbit.phi+orbit.dPhi,.28,1.43);orbit.dTheta*=.91;orbit.dPhi*=.9;}
    camera.position.set(target.x+Math.sin(orbit.theta)*Math.sin(orbit.phi)*orbit.radius,target.y+Math.cos(orbit.phi)*orbit.radius,target.z+Math.cos(orbit.theta)*Math.sin(orbit.phi)*orbit.radius);camera.lookAt(target);camera.updateMatrixWorld();
    if(Math.abs(targetDay-timeOfDay)>.0001){timeOfDay=T.MathUtils.lerp(timeOfDay,targetDay,1-Math.exp(-dt*2));updateLight(timeOfDay);}
    water.material.uniforms.time.value=time;
    windGroups.forEach(({group,phase,strength})=>{group.rotation.x=Math.sin(time*.65+phase)*strength;group.rotation.z=Math.cos(time*.53+phase)*strength;});
    clouds.forEach((g,i)=>{g.position.x+=dt*(.08+i*.006);if(g.position.x>170)g.position.x=-170;});
    butterflies.forEach(b=>{b.g.position.set(b.x+Math.sin(time*.6+b.phase)*2,1.5+Math.sin(time*1.2+b.phase)*.5,b.z+Math.cos(time*.5+b.phase)*1.5);b.g.rotation.y=time*.4+b.phase;b.left.rotation.y=Math.sin(time*13+b.phase)*.8;b.right.rotation.y=-Math.sin(time*13+b.phase)*.8;});
    ducks.forEach((d,i)=>{const a=time*d.speed+d.phase;d.g.position.set(d.center.x+Math.cos(a)*d.radius,.22+Math.sin(time*2+i)*.025,d.center.y+Math.sin(a)*d.radius*.45);d.g.rotation.y=Math.atan2(Math.sin(a),Math.cos(a)*.45);if(time-d.lastRipple>1.6){d.lastRipple=time+i*.015;addRipple(d.g.position.x-.4,d.g.position.z,.15);}});
    birds.forEach(b=>{const a=time*.035+b.phase;b.g.position.set(Math.cos(a)*b.radius,b.height+Math.sin(time*.3+b.phase),Math.sin(a)*b.radius*.7-15);b.g.rotation.y=-a;b.l.rotation.y=Math.sin(time*3.4+b.phase)*.35;b.r.rotation.y=Math.PI-Math.sin(time*3.4+b.phase)*.35;});
    const pollen=scene.getObjectByName('pollen');if(pollen){const p=pollen.geometry.attributes.position;particles.forEach((v,i)=>{p.setXYZ(i,v.x+Math.sin(time*.16+v.phase)*1.5,v.y+Math.sin(time*.3+v.phase)*.4,v.z+Math.cos(time*.11+v.phase));});p.needsUpdate=true;}
    animatedFlowers.forEach((g,i)=>g.position.y=.29+Math.sin(time*.8+i)*.015);
    updateActorBatches();
    // Reflect at 24 Hz; the full-resolution surface keeps flowing at display rate.
    if(reflectionEnabled&&(time-lastReflect>(lowQuality ? .15 : 1/24)||reflectionCount<2)){reflect();lastReflect=time;}
    renderer.render(scene,camera);
    if(frame===3){document.getElementById('loading-progress').style.width='100%';setTimeout(()=>document.getElementById('loading').classList.add('loaded'),450);window.dispatchEvent(new CustomEvent('park-ready'));}
  }
  function progress(value,message){document.getElementById('loading-progress').style.width=value+'%';document.getElementById('loading-message').textContent=message;}
  async function init() {
    try {
      container=document.getElementById('scene');scene=new T.Scene();scene.fog=new T.FogExp2('#e2e9d3',.0048);
      renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
      const gl=renderer.getContext(), debug=gl.getExtension('WEBGL_debug_renderer_info'); const deviceName=debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '';
      lowQuality=/swiftshader|llvmpipe|software/i.test(deviceName); window.ParkGraphicsDevice=deviceName;
      renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;container.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','公园三维画布：拖动旋转、滚轮缩放、点击水面');renderer.domElement.tabIndex=0;
      camera=new T.PerspectiveCamera(43,1,.3,650);resize();
      sun=new T.DirectionalLight('#fff3d1',2.65);sun.position.set(-35,75,-22);sun.castShadow=true;sun.shadow.mapSize.set(lowQuality?1024:2048,lowQuality?1024:2048);sun.shadow.camera.left=-65;sun.shadow.camera.right=65;sun.shadow.camera.top=60;sun.shadow.camera.bottom=-60;sun.shadow.camera.near=1;sun.shadow.camera.far=200;sun.shadow.bias=-.0003;sun.shadow.normalBias=.08;sun.shadow.radius=2;scene.add(sun);
      hemi=new T.HemisphereLight('#d7e6eb','#8b9869',1.65);scene.add(hemi);scene.add(new T.AmbientLight('#f4e6c8',.15));
      progress(15,'正在铺开一片绿意…');await new Promise(r=>setTimeout(r,20));terrain();sky();
      progress(30,'让阳光落进湖水…');await new Promise(r=>setTimeout(r,20));buildWater();buildPavilion();
      progress(52,'树木与花朵正在醒来…');await new Promise(r=>setTimeout(r,20));buildTrees();buildGardens();
      progress(75,'布置每一处停留的风景…');await new Promise(r=>setTimeout(r,20));buildFurniture();buildAnimals();
      optimizeStaticScene();
      if(window.ParkLife)life=window.ParkLife.create(T,scene,{rand,pathPoint});
      buildActorBatches();
      progress(90,'小狗已经等不及出门了…');updateLight(timeOfDay);bindControls();window.ParkScene={setView,setTime:v=>{targetDay=clamp(v,0,1);},addRipple,renderer,scene,camera,get dog(){return life&&life.dog;},getStats:()=>({objects:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,reflections:reflectionCount,time,mode,people:life?life.peopleCount:0,ripples:ripples.filter(r=>time-r.z<5).length}),reset:()=>setView('overview')};
      requestAnimationFrame(animate);
    } catch(error) {console.error('[Willow Park]',error);window.ParkBootError=error.message;document.getElementById('error-screen').hidden=false;document.getElementById('loading').classList.add('loaded');}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
