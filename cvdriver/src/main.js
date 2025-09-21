// main.js
import { WorldManager } from './worldgen.js';
import { PhysicsManager } from './physics.js';
import { getLatestThumbCount } from './camera.js';

class Game {
    constructor() {
        this.worldManager = null;
        this.physicsManager = null;
        this.car = null;
        this.player = null;
        this.isInitialized = false;
        this.lastTime = performance.now();
    }

    async init() {
        try {
            this.worldManager = new WorldManager();
            this.physicsManager = new PhysicsManager();
            this.physicsManager.setWorldManager(this.worldManager);
            const { car, player } = await this.physicsManager.init(this.worldManager.getScene());
            this.car = car;
            this.player = player;
            this.isInitialized = true;
            console.log('Game initialized successfully');
            this.animate();
        } catch (error) {
            console.error('Failed to initialize game:', error);
        }
    }

    animate() {
        if (!this.isInitialized) return;
        const now = performance.now();
        const frameDelta = (now - this.lastTime) / 1000;
        this.lastTime = now;
        if (this.worldManager.lastRoad.z === 0) {
            this.worldManager.generateNewRoadSegments(0, 0, 0, this.physicsManager);
        }
        this.physicsManager.update(frameDelta);
        this.worldManager.render(this.player, this.car, this.physicsManager);
        requestAnimationFrame(() => this.animate());
    }
}

function pollThumbsUpToStart(game, startScreen, gameScreen) {
    const thumbCount = getLatestThumbCount();
    console.log('Thumb count:', thumbCount);
    if (startScreen.style.display === 'block' && gameScreen.style.display === 'none') {
        if (thumbCount > 0) {
            startScreen.style.display = 'none';
            gameScreen.style.display = 'block';
            game.init();
        } else {
            setTimeout(() => pollThumbsUpToStart(game, startScreen, gameScreen), 1000);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const startScreen = document.getElementById('start');
    const gameScreen = document.getElementById('game');
    const endScreen = document.getElementById('end');
    const startBtn = document.getElementById('start-button');
    const restartBtn = document.getElementById('restart-button');
    const canvas = document.getElementById('three-canvas');
    const startingVid = document.getElementById('startingvid');

    // Show camera feed in #startingvid
    if (startingVid) {
        startingVid.autoplay = true;
        startingVid.muted = true;
        startingVid.playsInline = true;
        navigator.mediaDevices.getUserMedia({ video: true, audio: false })
            .then(stream => {
                startingVid.srcObject = stream;
            })
            .catch(err => {
                console.error('Camera access error:', err);
            });
    }

    startScreen.style.display = 'block';
    gameScreen.style.display = 'none';
    endScreen.style.display = 'none';

    const game = new Game();

    pollThumbsUpToStart(game, startScreen, gameScreen);

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            startScreen.style.display = 'none';
            gameScreen.style.display = 'block';
            game.init();
        });
    }

    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            endScreen.style.display = 'none';
            gameScreen.style.display = 'block';
            game.init();
        });
    }
});