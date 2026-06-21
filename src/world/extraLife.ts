import {
  Shape,
  ExtrudeGeometry,
  EdgesGeometry,
  Mesh,
  MeshBasicMaterial,
  Group,
  Color,
  FrontSide,
} from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { EXTRA_LIFE } from '../config'
import { type WallObject } from './wallObject'

// A rare extra-life pickup: a bright-green medkit cross (a chunky 3D plus). The
// plus is the universal "health / +1" icon, so it reads instantly and stays
// shape-distinct from every other wall object (orb sphere / gem diamond / mine
// ball / raider dart) even though green is the theme color. Edge-lit solid like
// the mine: a near-black depth-writing fill under glowing green fat-line edges,
// NORMAL blend (the HDR green core still blooms). It rides at the shared
// RIDE_RADIUS like the others, so the angle-only proximity check works directly.

// A centered plus polygon extruded along z. ARM = arm half-length, THICK = arm
// half-thickness; 12 vertices trace the cross outline.
function buildCross(): ExtrudeGeometry {
  const a = EXTRA_LIFE.ARM
  const t = EXTRA_LIFE.THICK
  const s = new Shape()
  s.moveTo(-t, -a)
  s.lineTo(t, -a)
  s.lineTo(t, -t)
  s.lineTo(a, -t)
  s.lineTo(a, t)
  s.lineTo(t, t)
  s.lineTo(t, a)
  s.lineTo(-t, a)
  s.lineTo(-t, t)
  s.lineTo(-a, t)
  s.lineTo(-a, -t)
  s.lineTo(-t, -t)
  s.closePath()
  const geo = new ExtrudeGeometry(s, { depth: EXTRA_LIFE.DEPTH * 2, bevelEnabled: false })
  geo.translate(0, 0, -EXTRA_LIFE.DEPTH) // center the depth on z=0 (x/y already centered)
  return geo
}

export function createExtraLife(): WallObject {
  const cross = buildCross()

  // dark, depth-writing fill so the cross reads as a solid edge-lit body
  // (transparent for the pop fade; opacity 1 at rest, like the orb/gem/mine fills).
  const fillMat = new MeshBasicMaterial({
    color: new Color().setRGB(...EXTRA_LIFE.FILL_RGB),
    side: FrontSide,
    transparent: true,
  })
  const fill = new Mesh(cross, fillMat)

  // glowing green edges (fat lines). NORMAL blend (depthTest) like the gem/mine;
  // the bloom pass still picks up the HDR (>1) green core.
  const edgesGeo = new EdgesGeometry(cross, EXTRA_LIFE.EDGE_THRESHOLD)
  const lineGeo = new LineSegmentsGeometry().fromEdgesGeometry(edgesGeo)
  const lineMat = new LineMaterial({
    color: new Color().setRGB(...EXTRA_LIFE.EDGE_RGB).getHex(),
    linewidth: EXTRA_LIFE.LINE_WIDTH,
    worldUnits: false,
    transparent: true,
    depthTest: true,
    fog: true, // fade in through the tube fog as it approaches
  })
  lineMat.color.setRGB(...EXTRA_LIFE.EDGE_RGB) // keep HDR (>1) green for strong bloom
  const edges = new LineSegments2(lineGeo, lineMat)
  edges.computeLineDistances()
  edgesGeo.dispose()

  // inner group spins + bobs + pulses; the outer group is positioned by the pool
  const inner = new Group()
  inner.add(fill)
  inner.add(edges)
  const object = new Group()
  object.add(inner)

  let t = 0
  return {
    object,
    update(dt: number): void {
      t += dt
      inner.rotation.y += EXTRA_LIFE.SPIN_SPEED * dt
      inner.position.y = Math.sin(t * EXTRA_LIFE.BOB_SPEED) * EXTRA_LIFE.BOB_AMP
      // beckoning pulse (scale only: cheap, never leaves the ride radius)
      const s = 1 + Math.sin(t * EXTRA_LIFE.PULSE_SPEED) * EXTRA_LIFE.PULSE_AMP
      inner.scale.setScalar(s)
    },
    setResolution(w: number, h: number): void {
      lineMat.resolution.set(w, h)
    },
    setOpacity(o: number): void {
      fillMat.opacity = o
      lineMat.opacity = o
    },
  }
}
