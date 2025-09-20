export function generateRoadSchematic(initialX,initialY, initialZ=0) {
    // returns an array of points representing a path of the road that will be like a parabola with curves and turns
    const points = [];
    let z = initialZ;
    let x = initialX;
    let y = initialY;
    let angle = 0;
    for (let i = 0; i < 10; i++) {
        z -= 20;
        angle += (Math.random() - 0.5) * 2; // random small turn
        x += Math.sin(angle) * 5; // curve effect
        y = 0 // flat road for now, can add hills later
        points.push({ x, y, z, angle });
    }
    return points;
}