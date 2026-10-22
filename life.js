/* Willow Park life: plain script, no assets or dependencies beyond the supplied THREE.
 * const life = ParkLife.create(THREE, scene, { rand, pathPoint });
 * life.update(elapsedSeconds, deltaSeconds); // Both arguments are in seconds.
 * pathPoint(angle, lane) returns a THREE.Vector3 including the ground height.
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var EPSILON = 0.004;

  function create(THREE, scene, options) {
    options = options || {};
    if (!THREE || !scene || typeof scene.add !== 'function') {
      throw new TypeError('ParkLife.create requires THREE and a scene.');
    }
    if (typeof options.pathPoint !== 'function') {
      throw new TypeError('ParkLife.create requires options.pathPoint(angle, lane).');
    }

    var pathPoint = options.pathPoint;
    var rand = typeof options.rand === 'function' ? options.rand : function (a, b) {
      return a + Math.random() * (b - a);
    };
    var population = new THREE.Group();
    population.name = 'willow-park-life';
    scene.add(population);

    // All actors share these small geometries and the color-keyed material palette.
    var geometry = {
      round: new THREE.SphereGeometry(1, 14, 10),
      detail: new THREE.SphereGeometry(1, 10, 8),
      box: new THREE.BoxGeometry(1, 1, 1),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
      coat: new THREE.CylinderGeometry(1, 0.85, 1, 12),
      brim: new THREE.CylinderGeometry(1, 1, 1, 24),
      hair: new THREE.SphereGeometry(1, 14, 8, 0, TAU, 0, Math.PI / 2),
      ear: new THREE.ConeGeometry(1, 1, 3),
      ring: new THREE.TorusGeometry(1, 0.10, 6, 20)
    };
    var materials = Object.create(null);
    var meshCount = 0;
    var up = new THREE.Vector3(0, 1, 0);
    var leashFrom = new THREE.Vector3();
    var leashTo = new THREE.Vector3();
    var leashDirection = new THREE.Vector3();

    function material(color, roughness) {
      var rough = roughness === undefined ? 0.82 : roughness;
      var key = color + ':' + rough;
      if (!materials[key]) {
        materials[key] = new THREE.MeshStandardMaterial({
          color: color,
          roughness: rough,
          metalness: 0
        });
      }
      return materials[key];
    }

    var cream = material('#f6edda');
    var sole = material('#ddd2bc');
    var dark = material('#302b29', 0.53);
    var eyeWhite = material('#fff7e7', 0.46);
    var eyeDark = material('#211e1b', 0.24);
    var lip = material('#986355');
    var brass = material('#bca06a', 0.43);
    var pink = material('#ce8d88', 0.7);

    function group(parent, name, x, y, z) {
      var result = new THREE.Group();
      result.name = name;
      result.position.set(x || 0, y || 0, z || 0);
      parent.add(result);
      return result;
    }

    function mesh(parent, shape, mat, x, y, z, sx, sy, sz) {
      var result = new THREE.Mesh(geometry[shape], mat);
      result.position.set(x, y, z);
      result.scale.set(sx, sy, sz);
      result.castShadow = true;
      result.receiveShadow = true;
      parent.add(result);
      meshCount += 1;
      return result;
    }

    function ball(parent, mat, x, y, z, rx, ry, rz, small) {
      return mesh(parent, small ? 'detail' : 'round', mat, x, y, z, rx, ry, rz);
    }

    function box(parent, mat, x, y, z, w, h, d) {
      return mesh(parent, 'box', mat, x, y, z, w, h, d);
    }

    function cylinder(parent, mat, x, y, z, radiusX, height, radiusZ, shape) {
      return mesh(parent, shape || 'cylinder', mat, x, y, z, radiusX, height, radiusZ);
    }

    function buildPerson(profile, index) {
      var root = group(population, 'park-person-' + (index + 1));
      root.userData.kind = 'person';
      root.userData.outfit = profile.style;
      var body = group(root, 'walking-body');
      var skin = material(profile.skin);
      var coat = material(profile.coat);
      var trousers = material(profile.trousers);
      var hairMat = material(profile.hair);
      var shoeMat = material(profile.shoes || '#5b4b40', 0.67);
      var accent = material(profile.accent);
      var arms = [];
      var legs = [];
      var head = group(body, 'head', 0, 2.36, 0);
      var bag = null;

      ball(body, trousers, 0, 1.22, 0, 0.28, 0.14, 0.20);
      cylinder(body, coat, 0, 1.64, 0, 0.33, 0.80, 0.225, 'coat');
      cylinder(body, skin, 0, 2.095, 0, 0.086, 0.19, 0.082);
      box(body, cream, 0, 1.86, 0.217, 0.205, 0.35, 0.035);
      var collarLeft = box(body, coat, -0.07, 2.005, 0.236, 0.11, 0.15, 0.028);
      collarLeft.rotation.z = 0.43;
      var collarRight = box(body, coat, 0.07, 2.005, 0.236, 0.11, 0.15, 0.028);
      collarRight.rotation.z = -0.43;
      box(body, accent, 0.012, 1.62, 0.226, 0.022, 0.53, 0.024);
      for (var button = 0; button < 3; button += 1) {
        ball(body, brass, 0.035, 1.78 - button * 0.15, 0.243, 0.018, 0.018, 0.014, true);
      }
      box(body, accent, -0.185, 1.48, 0.193, 0.13, 0.036, 0.029).rotation.z = -0.08;
      box(body, accent, 0.185, 1.48, 0.193, 0.13, 0.036, 0.029).rotation.z = 0.08;
      box(body, material('#685342'), 0, 1.27, 0, 0.49, 0.05, 0.355);
      box(body, brass, 0, 1.27, 0.188, 0.07, 0.047, 0.025);

      for (var side = -1; side <= 1; side += 2) {
        var hip = group(body, side < 0 ? 'left-hip' : 'right-hip', side * 0.145, 1.20, 0);
        cylinder(hip, trousers, 0, -0.26, 0, 0.118, 0.52, 0.118);
        var knee = group(hip, 'knee', 0, -0.52, 0);
        cylinder(knee, trousers, 0, -0.245, 0, 0.093, 0.49, 0.105);
        cylinder(knee, accent, 0, -0.49, 0, 0.096, 0.055, 0.108);
        ball(knee, shoeMat, 0, -0.57, 0.065, 0.12, 0.105, 0.225);
        box(knee, sole, 0, -0.638, 0.066, 0.227, 0.038, 0.355);
        legs.push({ hip: hip, knee: knee, side: side });

        var shoulder = group(body, side < 0 ? 'left-shoulder' : 'right-shoulder', side * 0.345, 1.965, 0);
        cylinder(shoulder, coat, 0, -0.205, 0, 0.112, 0.41, 0.116);
        var elbow = group(shoulder, 'elbow', 0, -0.41, 0);
        cylinder(elbow, coat, 0, -0.16, 0, 0.084, 0.32, 0.087);
        cylinder(elbow, cream, 0, -0.323, 0, 0.086, 0.05, 0.089);
        var hand = group(elbow, 'hand', 0, -0.405, 0.008);
        ball(hand, skin, 0, 0, 0, 0.078, 0.105, 0.071, true);
        ball(hand, skin, -side * 0.059, 0.014, 0.041, 0.032, 0.056, 0.032, true);
        arms.push({ shoulder: shoulder, elbow: elbow, hand: hand, side: side });
      }

      ball(head, skin, 0, 0, 0, 0.225, 0.30, 0.205);
      ball(head, skin, -0.226, -0.018, 0, 0.047, 0.074, 0.045, true);
      ball(head, skin, 0.226, -0.018, 0, 0.047, 0.074, 0.045, true);
      ball(head, skin, 0, -0.02, 0.207, 0.045, 0.055, 0.059, true);
      for (var faceSide = -1; faceSide <= 1; faceSide += 2) {
        ball(head, eyeWhite, faceSide * 0.091, 0.049, 0.185, 0.037, 0.032, 0.024, true);
        ball(head, eyeDark, faceSide * 0.091, 0.048, 0.207, 0.018, 0.021, 0.012, true);
        box(head, hairMat, faceSide * 0.091, 0.106, 0.188, 0.071, 0.014, 0.016).rotation.z = -faceSide * 0.08;
      }
      box(head, lip, 0, -0.131, 0.183, 0.074, 0.012, 0.018);
      mesh(head, 'hair', hairMat, 0, 0.145, -0.008, 0.239, 0.20, 0.225);
      ball(head, hairMat, -0.087, 0.187, 0.151, 0.104, 0.095, 0.067, true).rotation.z = -0.24;
      ball(head, hairMat, 0.091, 0.197, 0.144, 0.104, 0.084, 0.071, true).rotation.z = 0.24;

      if (profile.hairstyle === 'bob') {
        ball(head, hairMat, 0, -0.015, -0.11, 0.247, 0.267, 0.145);
      } else if (profile.hairstyle === 'bun') {
        ball(head, hairMat, 0, 0.14, -0.246, 0.125, 0.13, 0.125);
        cylinder(head, accent, 0, 0.14, -0.25, 0.13, 0.035, 0.13).rotation.x = Math.PI / 2;
      } else if (profile.hairstyle === 'ponytail') {
        ball(head, hairMat, 0, 0.12, -0.25, 0.097, 0.12, 0.105);
        ball(head, hairMat, 0, -0.045, -0.29, 0.09, 0.22, 0.09).rotation.x = -0.28;
      } else if (profile.hairstyle === 'curly') {
        for (var curl = 0; curl < 4; curl += 1) {
          var curlAngle = curl * Math.PI / 2 + 0.4;
          ball(head, hairMat, Math.cos(curlAngle) * 0.16, 0.25, Math.sin(curlAngle) * 0.11,
            0.098, 0.105, 0.095, true);
        }
      }

      if (profile.hat === 'sunhat') {
        cylinder(head, cream, 0, 0.285, 0, 0.37, 0.037, 0.315, 'brim');
        cylinder(head, cream, 0, 0.39, -0.015, 0.22, 0.19, 0.205, 'coat');
        cylinder(head, accent, 0, 0.329, -0.015, 0.224, 0.045, 0.209);
      } else if (profile.hat === 'cap') {
        mesh(head, 'hair', accent, 0, 0.205, 0, 0.252, 0.19, 0.237);
        ball(head, accent, 0, 0.215, 0.237, 0.24, 0.026, 0.185);
      }

      if (profile.glasses) {
        for (var frameSide = -1; frameSide <= 1; frameSide += 2) {
          mesh(head, 'ring', dark, frameSide * 0.091, 0.05, 0.222, 0.066, 0.058, 0.066);
        }
        box(head, dark, 0, 0.058, 0.224, 0.058, 0.012, 0.012);
      }

      if (profile.scarf) {
        cylinder(body, accent, 0, 2.055, 0, 0.142, 0.105, 0.13);
        box(body, accent, -0.086, 1.875, 0.245, 0.095, 0.31, 0.035).rotation.z = -0.13;
        box(body, accent, 0.048, 1.91, 0.253, 0.075, 0.25, 0.035).rotation.z = 0.1;
      }

      if (profile.bag === 'satchel') {
        box(body, material('#796148'), 0.035, 1.65, 0.25, 0.04, 0.84, 0.026).rotation.z = -0.55;
        bag = group(body, 'satchel', 0.33, 1.18, 0.065);
        ball(bag, accent, 0, 0, 0, 0.19, 0.22, 0.11);
        box(bag, accent, 0, 0.065, 0.104, 0.30, 0.20, 0.028);
        box(bag, brass, 0, -0.005, 0.126, 0.048, 0.045, 0.012);
      } else if (profile.bag === 'backpack') {
        bag = group(body, 'backpack', 0, 1.68, -0.30);
        ball(bag, accent, 0, 0, 0, 0.265, 0.31, 0.12);
        box(bag, accent, 0, -0.08, -0.105, 0.32, 0.19, 0.05);
        box(body, accent, -0.21, 1.8, 0.194, 0.046, 0.47, 0.035).rotation.z = -0.08;
        box(body, accent, 0.21, 1.8, 0.194, 0.046, 0.47, 0.035).rotation.z = 0.08;
      }

      // The unscaled hatless height is about 2.71; each profile stays adult-sized.
      var nominalHeight = profile.hat === 'sunhat' ? 2.845 : (profile.hat === 'cap' ? 2.755 : 2.715);
      var personScale = profile.height / nominalHeight;
      root.scale.setScalar(personScale);
      return {
        root: root, body: body, head: head, arms: arms, legs: legs, bag: bag,
        angle: profile.angle, lane: profile.lane, dir: profile.dir,
        speed: profile.speed, metric: 28, phase: rand(0, TAU),
        stride: rand(0.91, 1.06), height: profile.height,
        walkerWithDog: !!profile.walkerWithDog
      };
    }

    var profiles = [
      { style: 'sage coat and straw hat', skin: '#dfaf8f', coat: '#8e9d7c', trousers: '#e6dcc8', hair: '#66503d', accent: '#927253', hairstyle: 'bob', hat: 'sunhat', bag: 'satchel', height: 2.81, angle: 0.40, lane: -0.50, dir: 1, speed: 0.38 },
      { style: 'blue overshirt and terracotta scarf', skin: '#b77e5b', coat: '#688797', trousers: '#bca786', hair: '#352c27', accent: '#bf795c', hairstyle: 'curly', scarf: true, height: 2.94, angle: 0.43, lane: 0.48, dir: 1, speed: 0.38 },
      { style: 'rose cardigan and round glasses', skin: '#edc6a3', coat: '#b67f82', trousers: '#756c64', hair: '#aaa197', accent: '#dbc5a0', hairstyle: 'bun', glasses: true, height: 2.63, angle: 1.64, lane: -0.35, dir: -1, speed: 0.29 },
      { style: 'ochre jacket with canvas shoulder bag', skin: '#a26e50', coat: '#bc9459', trousers: '#65747a', hair: '#352d28', accent: '#78876b', hairstyle: 'short', bag: 'satchel', height: 2.88, angle: 2.25, lane: -0.35, dir: 1, speed: 0.34, walkerWithDog: true },
      { style: 'oatmeal knit and burgundy scarf', skin: '#e5b999', coat: '#cfbfa6', trousers: '#687265', hair: '#c2b8a8', accent: '#9f6865', hairstyle: 'short', scarf: true, glasses: true, height: 2.79, angle: 2.78, lane: -0.60, dir: -1, speed: 0.27 },
      { style: 'dusty blue cap and walking backpack', skin: '#ca906b', coat: '#8b9fa6', trousers: '#827363', hair: '#574339', accent: '#b68d63', hairstyle: 'short', hat: 'cap', bag: 'backpack', height: 2.97, angle: 3.83, lane: 0.45, dir: -1, speed: 0.42 },
      { style: 'terracotta jacket and ponytail', skin: '#e4b395', coat: '#b97961', trousers: '#d8cbb5', hair: '#564131', accent: '#d3b56d', hairstyle: 'ponytail', bag: 'satchel', height: 2.73, angle: 4.63, lane: -0.30, dir: 1, speed: 0.36 },
      { style: 'olive field jacket and charcoal trousers', skin: '#966044', coat: '#77846c', trousers: '#676461', hair: '#332b26', accent: '#a9906a', hairstyle: 'curly', bag: 'backpack', height: 2.91, angle: 5.58, lane: 0.55, dir: -1, speed: 0.32 }
    ];
    var people = profiles.map(buildPerson);

    function buildDog(config) {
      var root = group(population, config.name);
      root.userData.kind = 'dog';
      var body = group(root, 'dog-body');
      var fur = material(config.fur);
      var light = material(config.light || '#f4ead5');
      var innerEar = material(config.inner || '#b87965');
      var collarMat = material(config.collar);
      var detailed = !!config.detailed;
      var legs = [];

      ball(body, fur, 0, 0.405, -0.08, 0.265, 0.225, 0.59);
      ball(body, light, 0, 0.385, 0.355, 0.231, 0.205, 0.18);
      ball(body, light, 0, 0.265, -0.035, 0.205, 0.085, 0.43);
      if (detailed) {
        ball(body, light, 0, 0.445, -0.56, 0.204, 0.16, 0.12);
      }

      for (var row = 0; row < 2; row += 1) {
        for (var side = -1; side <= 1; side += 2) {
          var leg = group(body, (row ? 'rear' : 'front') + (side < 0 ? '-left-paw' : '-right-paw'), side * 0.192, 0.325, row ? -0.445 : 0.345);
          ball(leg, fur, 0, -0.083, 0, 0.082, 0.139, 0.09);
          ball(leg, light, 0, -0.226, 0.035, 0.087, 0.066, 0.119);
          legs.push({ joint: leg, phase: (row + (side < 0 ? 0 : 1)) % 2 * Math.PI });
        }
      }

      var head = group(body, 'dog-head', 0, 0.525, 0.475);
      ball(head, fur, 0, 0, 0, 0.247, 0.225, 0.245);
      ball(head, light, -0.085, -0.085, 0.222, 0.112, 0.087, 0.13);
      ball(head, light, 0.085, -0.085, 0.222, 0.112, 0.087, 0.13);
      ball(head, dark, 0, -0.134, 0.245, 0.104, 0.037, 0.09, true);
      ball(head, light, 0, -0.167, 0.214, 0.135, 0.033, 0.123, true);
      ball(head, eyeDark, 0, -0.044, 0.344, 0.065, 0.046, 0.034, true);
      ball(head, light, 0, 0.092, 0.203, 0.062, 0.15, 0.029);
      var tongue = ball(head, pink, 0.009, -0.165, 0.318, 0.045, 0.019, 0.078, true);
      tongue.rotation.z = -0.12;

      for (var eyeSide = -1; eyeSide <= 1; eyeSide += 2) {
        ball(head, eyeWhite, eyeSide * 0.164, 0.045, 0.173, 0.047, 0.054, 0.026, true);
        ball(head, eyeDark, eyeSide * 0.162, 0.043, 0.196, 0.028, 0.035, 0.02, true);
        if (detailed) {
          ball(head, eyeWhite, eyeSide * 0.156 - 0.006, 0.055, 0.214, 0.01, 0.012, 0.006, true);
          ball(head, light, eyeSide * 0.168, 0.125, 0.15, 0.06, 0.027, 0.026, true);
          ball(head, light, eyeSide * 0.221, -0.11, 0.054, 0.062, 0.096, 0.119, true);
        }
        if (config.floppy) {
          var floppyEar = ball(head, fur, eyeSide * 0.237, -0.01, -0.018, 0.09, 0.19, 0.079);
          floppyEar.rotation.z = eyeSide * 0.23;
        } else {
          var ear = mesh(head, 'ear', fur, eyeSide * 0.185, 0.244, -0.005, 0.143, 0.304, 0.095);
          ear.rotation.z = -eyeSide * 0.14;
          ear.rotation.y = Math.PI / 6;
          var earInset = mesh(head, 'ear', innerEar, eyeSide * 0.185, 0.246, 0.055, 0.086, 0.204, 0.024);
          earInset.rotation.z = -eyeSide * 0.14;
          earInset.rotation.y = Math.PI / 6;
        }
      }

      var tail = group(body, 'wagging-tail', 0, 0.48, -0.635);
      ball(tail, fur, 0, 0.07, -0.12, 0.064, 0.075, 0.18).rotation.x = 0.18;
      ball(tail, light, 0, 0.095, -0.273, 0.052, 0.059, 0.077);
      mesh(body, 'ring', collarMat, 0, 0.445, 0.347, 0.246, 0.235, 0.246);
      var tag = ball(body, brass, 0, 0.253, 0.427, 0.041, 0.047, 0.016, true);
      root.scale.setScalar(config.scale || 1);
      return {
        root: root, body: body, head: head, tongue: tongue, tail: tail, tag: tag,
        legs: legs, angle: config.angle, lane: config.lane, dir: config.dir || 1,
        metric: 28, phase: rand(0, TAU), speed: config.speed || 0.7,
        owner: config.owner || null, main: detailed
      };
    }

    var mainDog = buildDog({
      name: 'park-corgi', fur: '#c58a4c', light: '#f5ecd9', collar: '#708e88',
      detailed: true, angle: 0.9, lane: 0.22, dir: 1, scale: 1
    });
    var companionDog = buildDog({
      name: 'park-chestnut-companion', fur: '#926449', light: '#e7d8bc', collar: '#a4675e',
      floppy: true, angle: people[3].angle + 0.028, lane: 0.65, dir: 1,
      scale: 0.77, owner: people[3]
    });
    var smallDog = buildDog({
      name: 'park-little-cream-dog', fur: '#d7c8a6', light: '#f7efdc', collar: '#859879',
      angle: 5.17, lane: 0.25, dir: -1, scale: 0.70, speed: 0.65
    });
    var dogs = [mainDog, companionDog, smallDog];
    var leash = mesh(population, 'cylinder', material('#6f6253'), 0, 0, 0, 0.012, 1, 0.012);
    leash.name = 'companion-leash';

    function placeAlongPath(actor, delta, speed, laneOffset) {
      actor.angle = (actor.angle + actor.dir * speed * delta / actor.metric) % TAU;
      if (actor.angle < 0) actor.angle += TAU;
      var lane = actor.lane + (laneOffset || 0);
      var point = pathPoint(actor.angle, lane);
      var ahead = pathPoint(actor.angle + EPSILON * actor.dir, lane);
      var dx = ahead.x - point.x;
      var dz = ahead.z - point.z;
      var length = Math.sqrt(dx * dx + dz * dz);
      if (length > 0.000001) {
        actor.metric = length / EPSILON;
        actor.root.rotation.y = Math.atan2(dx, dz);
      }
      actor.root.position.copy(point);
    }

    function animatePerson(person, time, delta) {
      placeAlongPath(person, delta, person.speed, 0);
      person.phase = (person.phase + delta * TAU * person.speed / 0.77) % TAU;
      var phase = person.phase;
      person.body.position.y = 0.016 + (1 - Math.cos(phase * 2)) * 0.014;
      person.body.rotation.z = Math.sin(phase) * 0.018;
      person.body.rotation.y = Math.sin(phase) * 0.028;
      person.head.rotation.y = Math.sin(time * 0.28 + person.angle * 2) * 0.12;
      person.head.rotation.z = Math.sin(time * 0.34 + person.phase) * 0.018;
      for (var i = 0; i < 2; i += 1) {
        var leg = person.legs[i];
        var legPhase = phase + i * Math.PI;
        leg.hip.rotation.x = Math.sin(legPhase) * 0.29 * person.stride;
        leg.knee.rotation.x = -Math.max(0, Math.sin(legPhase)) * 0.32;
        var arm = person.arms[i];
        arm.shoulder.rotation.x = -Math.sin(legPhase) * 0.23;
        arm.shoulder.rotation.z = arm.side * -0.045;
        arm.elbow.rotation.x = -0.12 - Math.max(0, Math.cos(legPhase)) * 0.11;
      }
      if (person.walkerWithDog) {
        person.arms[1].shoulder.rotation.x = -0.28 + Math.sin(phase) * 0.05;
        person.arms[1].shoulder.rotation.z = -0.17;
        person.arms[1].elbow.rotation.x = -0.38;
      }
      if (person.bag) person.bag.rotation.x = Math.sin(phase) * 0.045;
    }

    function smoothstep(a, b, value) {
      var n = Math.max(0, Math.min(1, (value - a) / (b - a)));
      return n * n * (3 - 2 * n);
    }

    function animateDog(dog, time, delta) {
      var cycle = ((time + (dog.main ? 0 : 6.2)) % 23 + 23) % 23;
      var sniff = 0;
      var speed;
      if (dog.owner) {
        dog.angle = dog.owner.angle + dog.owner.dir * 0.028;
        dog.dir = dog.owner.dir;
        speed = dog.owner.speed;
        placeAlongPath(dog, 0, speed, 0);
      } else if (dog.main) {
        // A calm pause has soft approach/exit ramps; t=0 starts a happy little run.
        var settle = smoothstep(5.8, 7.4, cycle);
        var leave = smoothstep(11.6, 13.2, cycle);
        sniff = settle * (1 - leave);
        speed = cycle < 12 ? 1.48 * (1 - settle) : (0.78 + 0.85 * leave);
        if (cycle >= 18) speed = 1.63 - smoothstep(18, 22.5, cycle) * 0.15;
        placeAlongPath(dog, delta, speed, Math.sin(time * 0.58) * 0.21 * (1 - sniff));
      } else {
        sniff = smoothstep(10, 11, cycle) * (1 - smoothstep(14, 15.2, cycle));
        speed = dog.speed * (1 - sniff);
        placeAlongPath(dog, delta, speed, Math.sin(time * 0.33) * 0.10 * (1 - sniff));
      }
      dog.phase = (dog.phase + delta * (speed > 0.05 ? 5.5 + speed * 5.2 : 0)) % TAU;
      var running = Math.min(1, speed / 1.35);
      var bounce = Math.abs(Math.sin(dog.phase)) * 0.044 * running;
      dog.body.position.y = bounce - sniff * 0.055;
      dog.body.rotation.x = Math.sin(dog.phase * 2) * 0.025 * running;
      dog.body.rotation.z = Math.sin(dog.phase) * 0.025 * running;
      dog.head.position.y = 0.525 - sniff * 0.10;
      dog.head.rotation.x = sniff * 0.81 + Math.sin(dog.phase) * 0.035 * running;
      dog.head.rotation.y = Math.sin(time * (sniff > 0.5 ? 3.0 : 0.65)) * (0.05 + sniff * 0.10);
      dog.head.rotation.z = Math.sin(time * 0.9 + dog.phase * 0.12) * 0.035;
      dog.tail.rotation.y = Math.sin(time * (dog.main ? 12.5 : 9) + dog.phase) * (0.38 + running * 0.20);
      dog.tail.rotation.x = -0.12 + Math.sin(time * 4.6) * 0.07;
      dog.tongue.visible = sniff < 0.65;
      dog.tongue.rotation.x = Math.sin(time * 9) * 0.15 * running;
      dog.tag.rotation.z = Math.sin(dog.phase) * 0.14 * running;
      for (var i = 0; i < dog.legs.length; i += 1) {
        var leg = dog.legs[i];
        leg.joint.rotation.x = Math.sin(dog.phase + leg.phase) * (0.34 + running * 0.32) * (1 - sniff);
      }
      dog.root.rotation.y += Math.sin(time * 2.2) * 0.075 * sniff;
      dog.root.userData.motion = sniff > 0.65 ? 'sniffing' : (speed > 1.0 ? 'running' : 'trotting');
    }

    var lastTime = null;
    function update(time, delta) {
      time = typeof time === 'number' && Number.isFinite(time) ? time : (lastTime === null ? 0 : lastTime);
      if (typeof delta !== 'number' || !Number.isFinite(delta)) {
        delta = lastTime === null ? 0 : time - lastTime;
      }
      // Do not jump around the path after a suspended browser tab resumes.
      delta = Math.max(0, Math.min(0.08, delta));
      lastTime = time;
      for (var p = 0; p < people.length; p += 1) animatePerson(people[p], time, delta);
      for (var d = 0; d < dogs.length; d += 1) animateDog(dogs[d], time, delta);

      // Only the two endpoint branches update world matrices for this thin rope.
      people[3].arms[1].hand.getWorldPosition(leashFrom);
      companionDog.tag.getWorldPosition(leashTo);
      leashDirection.subVectors(leashTo, leashFrom);
      var leashLength = leashDirection.length();
      leash.position.copy(leashFrom).add(leashTo).multiplyScalar(0.5);
      if (leashLength > 0.0001) {
        leash.quaternion.setFromUnitVectors(up, leashDirection.multiplyScalar(1 / leashLength));
        leash.scale.set(0.012, leashLength, 0.012);
      }
    }

    population.userData.meshCount = meshCount;
    population.userData.peopleCount = people.length;
    population.userData.dogCount = dogs.length;
    update(0, 0);
    return { update: update, dog: mainDog.root, peopleCount: people.length };
  }

  global.ParkLife = { create: create };
})(window);
