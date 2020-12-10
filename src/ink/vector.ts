export class Vector {
    /**
     * Returns the vector resulting from rotating vector by angle
     */
    public static rotate(vector: Vector, angle: number): Vector {
        return new Vector(
            vector.x * Math.cos(angle) - vector.y * Math.sin(angle),
            vector.x * Math.sin(angle) + vector.y * Math.cos(angle));
    }

    /**
     * Returns the normalized form of the given vector
     */
    public static normalize(vector: Vector): Vector {
        const length = vector.length();
        return new Vector(vector.x / length, vector.y / length);
    }

    constructor(public x: number, public y: number) {
    }

    public length(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }
}
