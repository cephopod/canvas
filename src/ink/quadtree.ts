import { IPoint } from "./interfaces";
import { Rectangle } from "./rectangle";

export const MaxPointsInRegion = 1024;

export class QuadTree<T extends IPoint> {
    ne: QuadTree<T> = undefined;
    nw: QuadTree<T> = undefined;
    se: QuadTree<T> = undefined;
    sw: QuadTree<T> = undefined;
    idToPoints = new Map<string, T[]>();
    anonymousPoints = [] as T[];
    count = 0;

    constructor(public bounds: Rectangle) {
    }

    search(box: Rectangle, f: (p: T, id?: string) => boolean) {
        const isect = this.bounds.intersection(box);
        if (isect !== undefined) {
            if (this.ne !== undefined) {
                this.ne.search(isect, f);
                this.nw.search(isect, f);
                this.se.search(isect, f);
                this.sw.search(isect, f);
            } else {
                for (const p of this.anonymousPoints) {
                    if (isect.containsPoint(p)) {
                        if (f(p)) {
                            break;
                        }
                    }
                }
                for (const [id, pts] of this.idToPoints) {
                    for (const p of pts) {
                        if (isect.containsPoint(p)) {
                            if (f(p, id)) {
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    distributePoint(p: T, id?: string) {
        if (this.ne.bounds.containsPoint(p)) {
            this.ne.insert(p, id);
        } else if (this.nw.bounds.containsPoint(p)) {
            this.nw.insert(p, id);
        } else if (this.sw.bounds.containsPoint(p)) {
            this.sw.insert(p, id);
        } else if (this.se.bounds.containsPoint(p)) {
            this.se.insert(p, id);
        } else {
            console.log("no child contained point!");
        }
    }

    distributePoints(pts: T[], id?: string) {
        for (const p of pts) {
            this.distributePoint(p, id);
        }
    }

    split() {
        const halfW = this.bounds.width / 2;
        const halfH = this.bounds.height / 2;
        this.ne = new QuadTree<T>(new Rectangle(halfW, 0, halfW, halfH));
        this.nw = new QuadTree<T>(new Rectangle(0, 0, halfW, halfH));
        this.se = new QuadTree<T>(new Rectangle(halfW, halfH, halfW, halfH));
        this.sw = new QuadTree<T>(new Rectangle(0, halfH, halfW, halfH));
        this.distributePoints(this.anonymousPoints);
        this.idToPoints.forEach((pts, key) => this.distributePoints(pts, key));
        this.idToPoints = undefined;
        this.anonymousPoints = undefined;
    }

    addPoint(p: T, id?: string) {
        if (id !== undefined) {
            let points = this.idToPoints.get(id);
            if (points === undefined) {
                points = [] as T[];
                this.idToPoints.set(id, points);
            }
            points.push(p);
        } else {
            this.anonymousPoints.push(p);
        }
        this.count++;
    }

    insert(p: T, id?: string) {
        if ((this.count < MaxPointsInRegion) && (this.ne === undefined)) {
            this.addPoint(p, id);
        } else {
            if (this.ne === undefined) {
                this.split();
            }
            this.distributePoint(p, id);
        }
    }
}
