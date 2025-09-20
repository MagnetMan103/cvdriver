// main.js - Main game loop that coordinates world and physics managers
import { WorldManager } from './worldgen.js';
import { PhysicsManager } from './physics.js';

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
            // Initialize world manager
            this.worldManager = new WorldManager();

            // Initialize physics manager
            this.physicsManager = new PhysicsManager();
            const { car, player } = await this.physicsManager.init(this.worldManager.getScene());

            this.car = car;
            this.player = player;
            this.isInitialized = true;

            console.log('Game initialized successfully');

            // Start the game loop
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

        // Generate initial road if needed
        if (this.worldManager.lastRoad.z === 0) {
            this.worldManager.generateNewRoadSegments(0, 0, 0, this.physicsManager);
        }

        // Update physics
        this.physicsManager.update(frameDelta);

        // Update world/rendering
        this.worldManager.render(this.player, this.car, this.physicsManager);

        // Continue animation loop
        requestAnimationFrame(() => this.animate());
    }
}

// Initialize and start the game
const game = new Game();
game.init();