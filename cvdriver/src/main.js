import * as THREE from 'three';

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
const gridSize = 1000;
const gridDivisions = 1000;
const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x000000, 0x000000);
gridHelper.position.y = 0;
scene.add(gridHelper);

// Player
const playerSize = 1;
const playerGeometry = new THREE.BoxGeometry(playerSize, 0.2, playerSize);
const playerMaterial = new THREE.MeshBasicMaterial({ color: 0xff3333 });
const player = new THREE.Mesh(playerGeometry, playerMaterial);
player.position.set(0, 5, 0);
scene.add(player);

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

// Movement
const moveSpeed = 2;
const bounds = gridSize / 2 - playerSize / 2; // Large bounds for movement
const keys = {};

window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
});
window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

function updatePlayerPosition() {
    if (!playerRigidBody) return;

    const currentPos = playerRigidBody.translation();
    const currentVel = playerRigidBody.linvel();

    let newVelX = currentVel.x;
    let newVelZ = currentVel.z;

    if (keys['ArrowUp']) newVelZ = -moveSpeed * 10;
    else if (keys['ArrowDown']) newVelZ = moveSpeed * 10;
    else newVelZ = 0;

    if (keys['ArrowLeft']) newVelX = -moveSpeed * 10;
    else if (keys['ArrowRight']) newVelX = moveSpeed * 10;
    else newVelX = 0;

    // Check bounds
    if (currentPos.x <= -bounds && newVelX < 0) newVelX = 0;
    if (currentPos.x >= bounds && newVelX > 0) newVelX = 0;
    if (currentPos.z <= -bounds && newVelZ < 0) newVelZ = 0;
    if (currentPos.z >= bounds && newVelZ > 0) newVelZ = 0;

    playerRigidBody.setLinvel({ x: newVelX, y: currentVel.y, z: newVelZ }, true);
}

function updatePlayerCamera() {
    playerCamera.position.set(
        player.position.x,
        player.position.y + 2,
        player.position.z + 3
    );
    playerCamera.lookAt(player.position.x, player.position.y, player.position.z);
}

// Animation loop
function animate() {
    if (world && playerRigidBody) {
        // Step physics simulation
        world.step();

        // Update player mesh position from physics body
        const position = playerRigidBody.translation();
        player.position.set(position.x, position.y, position.z);

        // Update player rotation from physics body
        const rotation = playerRigidBody.rotation();
        player.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }

    updatePlayerPosition();
    if (usePlayerCamera) {
        updatePlayerCamera();
        renderer.render(scene, playerCamera);
    } else {
        renderer.render(scene, overviewCamera);
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