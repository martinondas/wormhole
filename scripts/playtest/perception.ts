// What a player can see of the world at one instant, copied out of the real game
// through the read-only visit() methods on the fields, raiders and bolts. This is
// the ONLY window the bots and the metrics have into the world, so it keeps working
// when the spawn logic or the raider AI behind those methods is rewritten.
import { type Session, type FieldKind } from '../../src/session'
import { type EnemyPhase } from '../../src/world/enemies'

export const MAX_OBJECTS = 48
export const MAX_ENEMIES = 16
export const MAX_BOLTS = 16

export const KIND_ORB = 0
export const KIND_GEM = 1
export const KIND_MINE = 2
export const KIND_LIFE = 3
const KIND_CODE: Record<FieldKind, number> = { orb: KIND_ORB, gem: KIND_GEM, mine: KIND_MINE, life: KIND_LIFE }

export const PHASE_APPROACH = 0
export const PHASE_ENGAGE = 1
export const PHASE_DEPART = 2
// An unknown future phase is treated as 'engage' (present and dangerous).
const phaseCode = (p: EnemyPhase): number => (p === 'approach' ? PHASE_APPROACH : p === 'depart' ? PHASE_DEPART : PHASE_ENGAGE)

export interface Snapshot {
  t: number // sim time (s) the snapshot was taken
  dist: number // craft distance at that time
  speed: number // craft forward speed at that time
  nObj: number
  objKind: Uint8Array
  objTheta: Float64Array
  objWd: Float64Array // absolute distance along the tube (world-fixed)
  nEn: number
  enId: Int16Array
  enTheta: Float64Array
  enZ: Float64Array // ship-relative, negative = ahead
  enPhase: Uint8Array
  enCharge: Float64Array // visible firing tell 0..1
  nBolt: number // enemy bolts only
  boltTheta: Float64Array
  boltZ: Float64Array
  boltVz: Float64Array
}

export function createSnapshot(): Snapshot {
  return {
    t: 0,
    dist: 0,
    speed: 0,
    nObj: 0,
    objKind: new Uint8Array(MAX_OBJECTS),
    objTheta: new Float64Array(MAX_OBJECTS),
    objWd: new Float64Array(MAX_OBJECTS),
    nEn: 0,
    enId: new Int16Array(MAX_ENEMIES),
    enTheta: new Float64Array(MAX_ENEMIES),
    enZ: new Float64Array(MAX_ENEMIES),
    enPhase: new Uint8Array(MAX_ENEMIES),
    enCharge: new Float64Array(MAX_ENEMIES),
    nBolt: 0,
    boltTheta: new Float64Array(MAX_BOLTS),
    boltZ: new Float64Array(MAX_BOLTS),
    boltVz: new Float64Array(MAX_BOLTS),
  }
}

// Fills `out` from the live session. One capture closure set per call site would
// allocate, so the visitor closures are created once per Perception instance.
export interface Perception {
  capture(out: Snapshot, t: number): void
}

export function createPerception(session: Session): Perception {
  let cur: Snapshot = createSnapshot()
  let kind = 0
  const onObj = (theta: number, wd: number): void => {
    if (cur.nObj >= MAX_OBJECTS) return
    cur.objKind[cur.nObj] = kind
    cur.objTheta[cur.nObj] = theta
    cur.objWd[cur.nObj] = wd
    cur.nObj++
  }
  const onEnemy = (theta: number, z: number, phase: EnemyPhase, charge01: number, id: number): void => {
    if (cur.nEn >= MAX_ENEMIES) return
    cur.enId[cur.nEn] = id
    cur.enTheta[cur.nEn] = theta
    cur.enZ[cur.nEn] = z
    cur.enPhase[cur.nEn] = phaseCode(phase)
    cur.enCharge[cur.nEn] = charge01
    cur.nEn++
  }
  const onBolt = (side: string, theta: number, z: number, vz: number): void => {
    if (side !== 'enemy' || cur.nBolt >= MAX_BOLTS) return
    cur.boltTheta[cur.nBolt] = theta
    cur.boltZ[cur.nBolt] = z
    cur.boltVz[cur.nBolt] = vz
    cur.nBolt++
  }
  return {
    capture(out: Snapshot, t: number): void {
      cur = out
      out.t = t
      out.dist = session.craft.distance
      out.speed = session.craft.speed
      out.nObj = 0
      out.nEn = 0
      out.nBolt = 0
      for (let i = 0; i < session.fields.length; i++) {
        kind = KIND_CODE[session.fieldKinds[i] ?? 'gem']
        session.fields[i]!.visit(onObj)
      }
      session.enemies.visit(onEnemy)
      session.projectiles.visit(onBolt)
    },
  }
}
