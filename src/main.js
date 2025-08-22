import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import { createNoise2D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2230);
scene.fog = new THREE.FogExp2(0x5e6a7b, 0.0022);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 8000);
scene.add(camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 60;
controls.maxDistance = 2200;
controls.enabled = false; // enabled after cinematic

const clock = new THREE.Clock();

const hemisphereLight = new THREE.HemisphereLight(0xddeeff, 0x0b1b2b, 0.4);
scene.add(hemisphereLight);

const sunLight = new THREE.DirectionalLight(0xfff0e6, 1.25);
sunLight.position.set(-600, 800, 400);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 4000;
sunLight.shadow.camera.left = -1500;
sunLight.shadow.camera.right = 1500;
sunLight.shadow.camera.top = 1500;
sunLight.shadow.camera.bottom = -1500;
scene.add(sunLight);

const noise2D = createNoise2D();

const world = {
	terrain: null,
	terrainSize: 3000,
	terrainSegments: 256,
	plateauRadius: 260,
	plateauHeight: 0,
	castleGroup: new THREE.Group(),
	patrols: [],
	cannons: [],
	projectiles: [],
	citizens: null,
	citizenStates: [],
	horses: [],
	clouds: new THREE.Group(),
};
scene.add(world.castleGroup);
scene.add(world.clouds);

function fractalNoise(x, y, octaves, lacunarity, gain, scale = 1.0) {
	let amplitude = 1.0;
	let frequency = 1.0;
	let sum = 0.0;
	for (let i = 0; i < octaves; i += 1) {
		sum += amplitude * noise2D(x * frequency / scale, y * frequency / scale);
		frequency *= lacunarity;
		amplitude *= gain;
	}
	return sum;
}

function getTerrainHeight(x, z) {
	const r = Math.sqrt(x * x + z * z);
	const base = 350 * Math.exp(-Math.pow(r / 1600, 2));
	const ridges = 160 * Math.abs(fractalNoise(x + 100, z + 200, 4, 2.2, 0.52, 600));
	const details = 40 * fractalNoise(x - 300, z - 500, 3, 2.0, 0.55, 180);
	let h = base + ridges + details;
	const plateauR = world.plateauRadius;
	const plateauCenterR = Math.max(0, (plateauR - r) / plateauR);
	if (plateauCenterR > 0) {
		const target = world.plateauHeight;
		h = THREE.MathUtils.lerp(h, target, Math.pow(plateauCenterR, 2.5));
	}
	return h;
}

function buildTerrain() {
	const size = world.terrainSize;
	const seg = world.terrainSegments;
	const geometry = new THREE.PlaneGeometry(size, size, seg, seg);
	geometry.rotateX(-Math.PI / 2);

	// Seed plateau height by sampling center
	world.plateauHeight = 420;

	const pos = geometry.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const z = pos.getZ(i);
		const y = getTerrainHeight(x, z);
		pos.setY(i, y);
	}
	geometry.computeVertexNormals();

	const grass = new THREE.Color(0x6e8c6f);
	const rock = new THREE.Color(0x7a7f86);
	const snow = new THREE.Color(0xe6eef2);
	const colors = [];
	for (let i = 0; i < pos.count; i++) {
		const y = pos.getY(i);
		const t = THREE.MathUtils.clamp((y - 280) / 350, 0, 1);
		const c = new THREE.Color();
		if (t < 0.5) {
			c.lerpColors(grass, rock, t / 0.5);
		} else {
			c.lerpColors(rock, snow, (t - 0.5) / 0.5);
		}
		colors.push(c.r, c.g, c.b);
	}
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

	const material = new THREE.MeshStandardMaterial({
		vertexColors: true,
		roughness: 0.95,
		metalness: 0.0,
		fog: true,
	});
	const terrain = new THREE.Mesh(geometry, material);
	terrain.receiveShadow = true;
	scene.add(terrain);
	world.terrain = terrain;
}

function createCloudTexture(size = 256) {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d');
	const gradient = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.2, size * 0.5, size * 0.5, size * 0.5);
	gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
	gradient.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, size, size);
	const texture = new THREE.CanvasTexture(canvas);
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	return texture;
}

function buildClouds() {
	const texture = createCloudTexture(256);
	const cloudMaterial = new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true, opacity: 0.75 });
	const count = 60;
	for (let i = 0; i < count; i++) {
		const sprite = new THREE.Sprite(cloudMaterial.clone());
		const r = 1200 + Math.random() * 1200;
		const a = Math.random() * Math.PI * 2;
		sprite.position.set(Math.cos(a) * r, 700 + Math.random() * 280, Math.sin(a) * r);
		sprite.scale.setScalar(200 + Math.random() * 500);
		world.clouds.add(sprite);
	}
}

function makeBattlements(length, width, height, count) {
	const battlement = new THREE.BoxGeometry(width, height, width);
	const material = new THREE.MeshStandardMaterial({ color: 0xb5b8bf, roughness: 0.85 });
	const mesh = new THREE.InstancedMesh(battlement, material, count);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	const dummy = new THREE.Object3D();
	for (let i = 0; i < count; i++) {
		const t = i / (count - 1);
		dummy.position.set(-length / 2 + t * length, 0, 0);
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);
	}
	return mesh;
}

function buildCastle() {
	const group = world.castleGroup;
	const wallColor = new THREE.Color(0xb5b8bf);
	const darkStone = new THREE.Color(0x9aa0a7);
	const wallHeight = 36;
	const wallThickness = 18;
	const castleHalf = 160;
	const courtyardPadding = 8;
	const yBase = world.plateauHeight + 6;
	group.position.set(0, 0, 0);

	const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9 });
	const floorMat = new THREE.MeshStandardMaterial({ color: 0x9aa78f, roughness: 0.95 });
	const roofMat = new THREE.MeshStandardMaterial({ color: darkStone, roughness: 0.9 });

	const courtyard = new THREE.Mesh(new THREE.BoxGeometry(castleHalf * 2 - courtyardPadding * 2, 2, castleHalf * 2 - courtyardPadding * 2), floorMat);
	courtyard.position.set(0, yBase - 1, 0);
	courtyard.receiveShadow = true;
	group.add(courtyard);

	const walls = [];
	function makeWall(length) {
		const geo = new THREE.BoxGeometry(length, wallHeight, wallThickness);
		const mesh = new THREE.Mesh(geo, wallMat);
		mesh.castShadow = true; mesh.receiveShadow = true;
		return mesh;
	}

	const north = makeWall(castleHalf * 2);
	north.position.set(0, yBase + wallHeight / 2, -castleHalf);
	group.add(north); walls.push(north);

	const south = makeWall(castleHalf * 2);
	south.position.set(0, yBase + wallHeight / 2, castleHalf);
	group.add(south); walls.push(south);

	const east = makeWall(castleHalf * 2);
	east.rotation.y = Math.PI / 2;
	east.position.set(castleHalf, yBase + wallHeight / 2, 0);
	group.add(east); walls.push(east);

	const west = makeWall(castleHalf * 2);
	west.rotation.y = Math.PI / 2;
	west.position.set(-castleHalf, yBase + wallHeight / 2, 0);
	group.add(west); walls.push(west);

	for (const w of walls) {
		const battlementsTop = makeBattlements((w.geometry.parameters.width || w.geometry.parameters.depth), 6, 10, 18);
		battlementsTop.position.copy(w.position);
		if (w === east || w === west) {
			battlementsTop.rotation.y = Math.PI / 2;
		}
		battlementsTop.position.y = yBase + wallHeight + 5;
		group.add(battlementsTop);
	}

	function makeTower(radiusTop, height) {
		const geo = new THREE.CylinderGeometry(radiusTop, radiusTop * 1.05, height, 16);
		const mesh = new THREE.Mesh(geo, wallMat);
		mesh.castShadow = true; mesh.receiveShadow = true;
		return mesh;
	}
	const towerHeight = 60;
	const towerOffset = castleHalf + wallThickness * 0.5 - 2;
	const towerPositions = [
		new THREE.Vector3(-towerOffset, yBase + towerHeight / 2, -towerOffset),
		new THREE.Vector3(towerOffset, yBase + towerHeight / 2, -towerOffset),
		new THREE.Vector3(-towerOffset, yBase + towerHeight / 2, towerOffset),
		new THREE.Vector3(towerOffset, yBase + towerHeight / 2, towerOffset),
	];
	for (const p of towerPositions) {
		const t = makeTower(22, towerHeight);
		t.position.copy(p);
		group.add(t);
		const crown = makeBattlements(Math.PI * 2 * 22, 6, 10, 14);
		crown.position.set(p.x, p.y + towerHeight / 2 + 8, p.z);
		group.add(crown);
	}

	const keep = new THREE.Mesh(new THREE.BoxGeometry(100, 120, 80), roofMat);
	keep.position.set(0, yBase + 60, 0);
	keep.castShadow = true; keep.receiveShadow = true;
	group.add(keep);

	const gateWidth = 60;
	const gate = new THREE.Mesh(new THREE.BoxGeometry(gateWidth, wallHeight - 6, wallThickness + 2), wallMat);
	gate.position.set(0, yBase + (wallHeight - 6) / 2, -castleHalf);
	group.add(gate);

	const gateBanner = new THREE.Mesh(new THREE.PlaneGeometry(24, 40), new THREE.MeshStandardMaterial({ color: 0xd23434, side: THREE.DoubleSide }));
	gateBanner.position.set(0, yBase + wallHeight + 20, -castleHalf - wallThickness / 2 - 0.1);
	gateBanner.rotation.y = Math.PI;
	group.add(gateBanner);

	buildPatrols({ wallHeight, half: castleHalf, yBase });
	buildCannons({ wallHeight, half: castleHalf, yBase });
	buildCourtyardLife({ yBase, half: castleHalf });
}

function buildPatrols({ wallHeight, half, yBase }) {
	const patrolCount = 10;
	for (let i = 0; i < patrolCount; i++) {
		const body = new THREE.Group();
		const baseMat = new THREE.MeshStandardMaterial({ color: 0x3c4a57, roughness: 0.9 });
		const accentMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a7, roughness: 0.9 });
		const torso = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 3), baseMat);
		torso.castShadow = true; torso.receiveShadow = true;
		const head = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 12), accentMat);
		head.position.y = 6;
		const leg = new THREE.Mesh(new THREE.BoxGeometry(1.5, 5, 1.5), accentMat);
		leg.position.y = -6.5;
		body.add(torso);
		body.add(head);
		body.add(leg);
		body.position.set(0, yBase + wallHeight + 2, -half + 4);
		body.userData.t = Math.random();
		body.userData.speed = 0.02 + Math.random() * 0.02;
		scene.add(body);
		world.patrols.push(body);
	}
}

function updatePatrols(dt, params) {
	const { wallHeight, half, yBase } = params;
	const y = yBase + wallHeight + 2;
	for (const p of world.patrols) {
		let t = p.userData.t + p.userData.speed * dt;
		t = t % 1.0;
		p.userData.t = t;
		const perim = half * 8;
		const d = t * perim;
		let x = 0, z = 0, rot = 0;
		if (d < half * 2) {
			x = -half + d; z = -half; rot = 0;
		} else if (d < half * 4) {
			x = half; z = -half + (d - half * 2); rot = Math.PI / 2;
		} else if (d < half * 6) {
			x = half - (d - half * 4); z = half; rot = Math.PI;
		} else {
			x = -half; z = half - (d - half * 6); rot = -Math.PI / 2;
		}
		p.position.set(x, y, z);
		p.rotation.y = rot;
	}
}

function buildCannons({ wallHeight, half, yBase }) {
	const cannonMat = new THREE.MeshStandardMaterial({ color: 0x44474d, roughness: 0.8, metalness: 0.2 });
	function makeCannon() {
		const group = new THREE.Group();
		const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 18, 12), cannonMat);
		barrel.rotation.z = Math.PI / 2;
		barrel.position.x = 7;
		barrel.castShadow = true; barrel.receiveShadow = true;
		const base = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), cannonMat);
		base.castShadow = true; base.receiveShadow = true;
		group.add(base);
		group.add(barrel);
		group.userData.barrel = barrel;
		return group;
	}
	const positions = [
		new THREE.Vector3(-half, yBase + wallHeight + 1, -half),
		new THREE.Vector3(half, yBase + wallHeight + 1, -half),
		new THREE.Vector3(-half, yBase + wallHeight + 1, half),
		new THREE.Vector3(half, yBase + wallHeight + 1, half),
		new THREE.Vector3(0, yBase + wallHeight + 1, -half),
		new THREE.Vector3(0, yBase + wallHeight + 1, half),
		new THREE.Vector3(-half, yBase + wallHeight + 1, 0),
		new THREE.Vector3(half, yBase + wallHeight + 1, 0),
	];
	for (const pos of positions) {
		const cannon = makeCannon();
		cannon.position.copy(pos);
		scene.add(cannon);
		cannon.userData.cooldown = 1 + Math.random() * 2.5;
		cannon.userData.time = Math.random() * cannon.userData.cooldown;
		world.cannons.push(cannon);
	}
}

function fireCannon(cannon) {
	const barrel = cannon.userData.barrel;
	const muzzleWorld = new THREE.Vector3();
	barrel.updateWorldMatrix(true, false);
	muzzleWorld.setFromMatrixPosition(barrel.matrixWorld);
	const dir = new THREE.Vector3(1, 0.26, 0).applyQuaternion(barrel.getWorldQuaternion(new THREE.Quaternion())).normalize();
	const speed = 180 + Math.random() * 80;
	const vel = dir.multiplyScalar(speed);
	const proj = new THREE.Mesh(new THREE.SphereGeometry(1.8, 10, 10), new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.7, metalness: 0.1 }))
	proj.position.copy(muzzleWorld);
	proj.castShadow = true; proj.receiveShadow = true;
	proj.userData.velocity = vel;
	proj.userData.life = 12;
	scene.add(proj);
	world.projectiles.push(proj);
	const flash = new THREE.PointLight(0xffe1a8, 2.5, 60, 2);
	flash.position.copy(muzzleWorld);
	scene.add(flash);
	setTimeout(() => { scene.remove(flash); }, 120);
}

function getGroundHeightAt(x, z) {
	return getTerrainHeight(x, z);
}

function updateProjectiles(dt) {
	const gravity = new THREE.Vector3(0, -60, 0);
	for (let i = world.projectiles.length - 1; i >= 0; i--) {
		const p = world.projectiles[i];
		p.userData.velocity.addScaledVector(gravity, dt);
		p.position.addScaledVector(p.userData.velocity, dt);
		p.userData.life -= dt;
		const ground = getGroundHeightAt(p.position.x, p.position.z);
		if (p.userData.life <= 0 || p.position.y <= ground + 1) {
			spawnDust(p.position.x, ground + 1, p.position.z);
			scene.remove(p);
			world.projectiles.splice(i, 1);
		}
	}
}

function spawnDust(x, y, z) {
	const geo = new THREE.SphereGeometry(1, 6, 6);
	const mat = new THREE.MeshStandardMaterial({ color: 0xc8c1b2, transparent: true, opacity: 0.8, roughness: 1 });
	const puffs = 6 + Math.floor(Math.random() * 6);
	for (let i = 0; i < puffs; i++) {
		const m = new THREE.Mesh(geo, mat.clone());
		m.position.set(x, y, z);
		scene.add(m);
		const dir = new THREE.Vector3((Math.random() - 0.5) * 12, Math.random() * 14, (Math.random() - 0.5) * 12);
		const scale = 1 + Math.random() * 4;
		const life = 0.8 + Math.random() * 0.8;
		const start = performance.now();
		function animate() {
			const t = (performance.now() - start) / 1000;
			m.position.addScaledVector(dir, 0.016);
			m.scale.setScalar(1 + t * scale);
			m.material.opacity = THREE.MathUtils.lerp(0.8, 0.0, t / life);
			if (t < life) requestAnimationFrame(animate); else scene.remove(m);
		}
		requestAnimationFrame(animate);
	}
}

function buildCourtyardLife({ yBase, half }) {
	const count = 30;
	const personGeo = new THREE.BoxGeometry(2.5, 6, 2);
	const personMat = new THREE.MeshStandardMaterial({ color: 0xadb3ba, roughness: 0.9 });
	const citizens = new THREE.InstancedMesh(personGeo, personMat, count);
	citizens.castShadow = true; citizens.receiveShadow = true;
	const dummy = new THREE.Object3D();
	for (let i = 0; i < count; i++) {
		const px = (Math.random() * 2 - 1) * (half - 30);
		const pz = (Math.random() * 2 - 1) * (half - 30);
		const py = yBase + 2;
		dummy.position.set(px, py, pz);
		dummy.rotation.y = Math.random() * Math.PI * 2;
		dummy.updateMatrix();
		citizens.setMatrixAt(i, dummy.matrix);
		world.citizenStates.push({ x: px, z: pz, angle: dummy.rotation.y, speed: 10 + Math.random() * 12, target: null });
	}
	scene.add(citizens);
	world.citizens = citizens;

	const horseMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2d, roughness: 0.9 });
	for (let i = 0; i < 6; i++) {
		const horse = new THREE.Group();
		const body = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 3), horseMat);
		const head = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.8, 2.8), horseMat);
		head.position.set(5, 1.2, 0);
		const legs = new THREE.Mesh(new THREE.BoxGeometry(6, 0.8, 0.8), horseMat);
		legs.position.set(0, -1.6, 0);
		horse.add(body); horse.add(head); horse.add(legs);
		horse.position.set((Math.random() * 2 - 1) * (half - 40), yBase + 2.2, (Math.random() * 2 - 1) * (half - 40));
		horse.userData.dir = Math.random() * Math.PI * 2;
		horse.userData.speed = 14 + Math.random() * 14;
		horse.castShadow = true; horse.receiveShadow = true;
		scene.add(horse);
		world.horses.push(horse);
	}
}

function updateCourtyard(dt, { yBase, half }) {
	if (world.citizens) {
		const dummy = new THREE.Object3D();
		for (let i = 0; i < world.citizenStates.length; i++) {
			const s = world.citizenStates[i];
			if (!s.target || Math.hypot(s.x - s.target.x, s.z - s.target.z) < 4) {
				s.target = { x: (Math.random() * 2 - 1) * (half - 30), z: (Math.random() * 2 - 1) * (half - 30) };
			}
			const dx = s.target.x - s.x;
			const dz = s.target.z - s.z;
			const ang = Math.atan2(dz, dx);
			s.x += Math.cos(ang) * s.speed * dt * 0.2;
			s.z += Math.sin(ang) * s.speed * dt * 0.2;
			s.angle = ang;
			dummy.position.set(s.x, yBase + 2, s.z);
			dummy.rotation.y = s.angle;
			dummy.updateMatrix();
			world.citizens.setMatrixAt(i, dummy.matrix);
		}
		world.citizens.instanceMatrix.needsUpdate = true;
	}
	for (const h of world.horses) {
		h.userData.dir += (Math.random() - 0.5) * dt * 0.8;
		const nx = h.position.x + Math.cos(h.userData.dir) * h.userData.speed * dt * 0.25;
		const nz = h.position.z + Math.sin(h.userData.dir) * h.userData.speed * dt * 0.25;
		if (Math.abs(nx) < half - 20 && Math.abs(nz) < half - 20) {
			h.position.x = nx; h.position.z = nz;
		}
		h.position.y = yBase + 2.2 + Math.sin(performance.now() * 0.004 + h.userData.dir) * 0.4;
		h.rotation.y = Math.atan2(nz - h.position.z, nx - h.position.x);
	}
}

function updateCannons(dt) {
	for (const c of world.cannons) {
		c.lookAt(new THREE.Vector3(c.position.x * 1.1, c.position.y + 20, c.position.z * 1.1));
		c.userData.time += dt;
		if (c.userData.time >= c.userData.cooldown) {
			c.userData.time = 0;
			c.userData.cooldown = 2 + Math.random() * 3.5;
			fireCannon(c);
		}
	}
}

function buildScene() {
	buildTerrain();
	buildClouds();
	buildCastle();
}

function setInitialCamera() {
	camera.position.set(-1200, 680, -1100);
	camera.lookAt(0, world.plateauHeight + 40, 0);
}

let cinematic = { playing: false, start: 0, duration: 14000 };

function startCinematic() {
	cinematic.playing = true;
	cinematic.start = performance.now();
	controls.enabled = false;
}

function updateCinematic() {
	if (!cinematic.playing) return;
	const t = (performance.now() - cinematic.start) / cinematic.duration;
	const u = THREE.MathUtils.smoothstep(t, 0, 1);
	const angle = THREE.MathUtils.lerp(-Math.PI * 0.85, Math.PI * 0.35, u);
	const radius = THREE.MathUtils.lerp(1600, 520, u);
	const height = THREE.MathUtils.lerp(700, 380, u);
	const cx = 0, cz = 0, cy = world.plateauHeight + 40;
	const x = cx + Math.cos(angle) * radius;
	const z = cz + Math.sin(angle) * radius;
	camera.position.set(x, height, z);
	camera.lookAt(new THREE.Vector3(0, cy, 0));
	if (t >= 1) {
		cinematic.playing = false;
		controls.enabled = true;
	}
}

function onResize() {
	renderer.setSize(window.innerWidth, window.innerHeight);
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

document.getElementById('replayCinematic').addEventListener('click', () => {
	startCinematic();
});

buildScene();
setInitialCamera();
startCinematic();

function animate() {
	renderer.setAnimationLoop(render);
}

function render() {
	const dt = Math.min(0.033, clock.getDelta());
	updateCinematic();
	controls.update();
	updatePatrols(dt, { wallHeight: 36, half: 160, yBase: world.plateauHeight + 6 });
	updateCannons(dt);
	updateProjectiles(dt);
	updateCourtyard(dt, { yBase: world.plateauHeight + 6, half: 160 });
	for (const c of world.clouds.children) {
		c.position.x += 3 * dt;
		c.position.z += 1 * dt;
		if (c.position.x > world.terrainSize) c.position.x = -world.terrainSize;
		if (c.position.z > world.terrainSize) c.position.z = -world.terrainSize;
	}
	renderer.render(scene, camera);
}

animate();