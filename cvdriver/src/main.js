import * as THREE from 'three';

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
player.position.set(0, 0.11, 0);
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
const moveSpeed = 0.2;
const bounds = gridSize / 2 - playerSize / 2; // Large bounds for movement
const keys = {};

window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
});
window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

function updatePlayerPosition() {
    if (keys['ArrowUp']) player.position.z -= moveSpeed;
    if (keys['ArrowDown']) player.position.z += moveSpeed;
    if (keys['ArrowLeft']) player.position.x -= moveSpeed;
    if (keys['ArrowRight']) player.position.x += moveSpeed;

    player.position.x = Math.max(-bounds, Math.min(bounds, player.position.x));
    player.position.z = Math.max(-bounds, Math.min(bounds, player.position.z));
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
    updatePlayerPosition();
    if (usePlayerCamera) {
        updatePlayerCamera();
        renderer.render(scene, playerCamera);
    } else {
        renderer.render(scene, overviewCamera);
    }
    requestAnimationFrame(animate);
}
animate();

// Handle window resize
window.addEventListener('resize', () => {
    overviewCamera.aspect = window.innerWidth / window.innerHeight;
    overviewCamera.updateProjectionMatrix();
    playerCamera.aspect = window.innerWidth / window.innerHeight;
    playerCamera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});