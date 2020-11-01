import { IPoint } from "./interfaces";
import { Rectangle } from "./rectangle";

export const MaxPointsInRegion = 256;

interface QTAnimations {
    split(children: Rectangle[]): void;
}

export class QuadTree<T extends IPoint> {
    animations: QTAnimations;
    ne: QuadTree<T> = undefined;
    nw: QuadTree<T> = undefined;
    se: QuadTree<T> = undefined;
    sw: QuadTree<T> = undefined;
    idToPoints = new Map<string, T[]>();
    anonymousPoints = [] as T[];
    count = 0;
    registerId: (id: string, qt: QuadTree<T>, p: T) => void;

    constructor(public bounds: Rectangle) {
    }

    setIdRegistration(registerId: (id: string, qt: QuadTree<T>, p: T) => void) {
        this.registerId = registerId;
    }

    setAnimations(qta: QTAnimations) {
        this.animations = qta;
    }

    gather_intersect(box: Rectangle, rects: Rectangle[]) {
        const isect = this.bounds.intersection(box);
        if (isect !== undefined) {
            if (this.ne === undefined) {
                rects.push(isect);
            } else {
                this.ne.gather_intersect(isect, rects);
                this.nw.gather_intersect(isect, rects);
                this.se.gather_intersect(isect, rects);
                this.sw.gather_intersect(isect, rects);
            }
        }
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

    spawn(r: Rectangle) {
        const qt = new QuadTree<T>(r);
        qt.registerId = this.registerId;
        qt.animations = this.animations;
        return qt;
    }

    split() {
        const halfW = this.bounds.width / 2;
        const halfH = this.bounds.height / 2;
        this.ne = this.spawn(new Rectangle(this.bounds.x + halfW, this.bounds.y, halfW, halfH));
        this.nw = this.spawn(new Rectangle(this.bounds.x, this.bounds.y, halfW, halfH));
        this.se = this.spawn(new Rectangle(this.bounds.x + halfW, this.bounds.y + halfH, halfW, halfH));
        this.sw = this.spawn(new Rectangle(this.bounds.x, this.bounds.y + halfH, halfW, halfH));
        this.distributePoints(this.anonymousPoints);
        this.idToPoints.forEach((pts, key) => this.distributePoints(pts, key));
        this.idToPoints = undefined;
        this.anonymousPoints = undefined;
        this.count = 0;
        if (this.animations !== undefined) {
            this.animations.split([this.ne.bounds, this.nw.bounds, this.se.bounds, this.sw.bounds]);
        }
    }

    addPoint(p: T, id?: string) {
        if (id !== undefined) {
            let points = this.idToPoints.get(id);
            if (points === undefined) {
                points = [] as T[];
                this.idToPoints.set(id, points);
                if (this.registerId !== undefined) {
                    this.registerId(id, this, p);
                }
            }
            points.push(p);
        } else {
            this.anonymousPoints.push(p);
        }
        this.count++;
    }

    insert(p: T, id?: string) {
        if ((this.ne === undefined) && (this.count < MaxPointsInRegion)) {
            this.addPoint(p, id);
        } else {
            if (this.ne === undefined) {
                this.split();
            }
            this.distributePoint(p, id);
        }
    }
}
