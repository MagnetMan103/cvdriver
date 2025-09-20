import * as THREE from 'three';
import { Car } from './playerobject.js';

// Import and initialize Rapier physics
let RAPIER, world, playerRigidBody, groundRigidBody;

async function initPhysics() {
    // Load Rapier from CDN
    RAPIER = await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat');
    await RAPIER.init();

    // Create physics world with gravity
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    world = new RAPIER.World(gravity);

    // Create ground physics body
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(500, 0.1, 500);
    const groundRigidBodyDesc = RAPIER.RigidBodyDesc.fixed();
    groundRigidBody = world.createRigidBody(groundRigidBodyDesc);
    world.createCollider(groundColliderDesc, groundRigidBody);

    // Create player physics body
    const playerColliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.1, 0.5);
    const playerRigidBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0);
    playerRigidBody = world.createRigidBody(playerRigidBodyDesc);
    world.createCollider(playerColliderDesc, playerRigidBody);
}

// Add toggle button
const toggleBtn = document.createElement('button');
toggleBtn.textContent = 'Toggle Camera';
toggleBtn.style.position = 'absolute';
toggleBtn.style.top = '10px';
toggleBtn.style.left = '10px';
document.body.appendChild(toggleBtn);

// Get the canvas element
const canvas = document.getElementById('three-canvas');

// Create renderer
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setSize(window.innerWidth, window.innerHeight);

// Create scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeeeeee);

// Add large grid helper (black lines)
const gridSize = 100;
const gridDivisions = 100;
const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x000000, 0x000000);
gridHelper.position.y = 0;
scene.add(gridHelper);

// Create a procedurally generated road
function initialRoad() {
    const roadWidth = 4;
    const roadLength = 200;
    const roadGeometry = new THREE.PlaneGeometry(roadWidth, roadLength);
    const roadMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.01; // Slightly above the grid
    scene.add(road);
}
// used to generate new roads
let lastRoadZ = 0;
function addRoadSegment(zPosition) {
    const roadWidth = 4;
    const roadLength = 20;
    const roadGeometry = new THREE.PlaneGeometry(roadWidth, roadLength);
    const roadMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.01, zPosition);
    scene.add(road);
}

initialRoad();
// Car (replaces previous red cube player)
const car = new Car(scene);
// For existing camera logic expecting `player`, alias to car group
const player = car.carGroup;

// Basic lighting for Car's Lambert materials
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(5, 10, 2);
scene.add(dirLight);

// Cameras
const overviewCamera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
overviewCamera.position.set(0, 5, 10);
overviewCamera.lookAt(0, 0, 0);

const playerCamera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

let usePlayerCamera = false;
toggleBtn.addEventListener('click', () => {
    usePlayerCamera = !usePlayerCamera;
});

// (Removed old cube movement; Car handles its own controls in playerobject.js)

function updatePlayerCamera() {
    // Determine forward direction from car orientation (car faces -Z initially)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion).normalize();
    const heightOffset = 4;    // higher camera
    const backDistance = 12;   // farther back for zoomed out view
    const targetPos = player.position.clone()
        .add(new THREE.Vector3(0, heightOffset, 0))
        .add(forward.clone().multiplyScalar(-backDistance)); // move opposite forward to get behind
    playerCamera.position.copy(targetPos);
    playerCamera.lookAt(player.position);
}

// Animation loop
let lastTime = performance.now();
function animate() {
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    if (world && playerRigidBody) {
        // Step physics simulation
        world.step();
        // (Player physics body removed; Car uses custom movement)
    }
    // Update car simulation
    car.update(delta);
    if (usePlayerCamera) {
        updatePlayerCamera();
        renderer.render(scene, playerCamera);
    } else {
        renderer.render(scene, overviewCamera);
    }
    // Add new road segments as the player moves forward
    if (player.position.z < lastRoadZ + 100) {
        lastRoadZ -= 20;
        addRoadSegment(lastRoadZ);
    }
    requestAnimationFrame(animate);
}

// Initialize physics then start animation
initPhysics().then(() => {
    animate();
});

// Handle window resize
window.addEventListener('resize', () => {
    overviewCamera.aspect = window.innerWidth / window.innerHeight;
    overviewCamera.updateProjectionMatrix();
    playerCamera.aspect = window.innerWidth / window.innerHeight;
    playerCamera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});