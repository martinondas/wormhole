import {
  IcosahedronGeometry,
  WireframeGeometry,
  SphereGeometry,
  Mesh,
  MeshBasicMaterial,
  Group,
  Color,
} from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { PICKUP } from '../config'
import { type WallObject } from './wallObject'

// A blue health orb: a faceted wireframe icosphere over a soft additive inner
// glow (a glowing balloon in the spirit of Descent II powerups). The outer group
// is positioned by the owner; an inner group spins and bobs for life.

// Shared geometry/material would couple lifetimes awkwardly while we are still
// tuning; one orb is cheap, so build self-contained instances for now.
export function createPickup(): WallObject {
  const inner = new Group()

  // inner fill: a darker, less-transparent blue ball (normal blend so it reads
  // as a solid body, not an additive glow). depthWrite occludes the back edges
  // and the tube behind, so the orb looks like a real object.
  const fillMat = new MeshBasicMaterial({
    color: new Color().setRGB(...PICKUP.GLOW_RGB),
    transparent: true,
    opacity: PICKUP.GLOW_OPACITY,
  })
  const glow = new Mesh(new SphereGeometry(PICKUP.RADIUS * 0.9, 20, 14), fillMat)
  inner.add(glow)

  // faceted wireframe shell (all triangle edges -> geodesic-sphere look)
  const ico = new IcosahedronGeometry(PICKUP.RADIUS, PICKUP.DETAIL)
  const wire = new WireframeGeometry(ico)
  const lineGeo = new LineSegmentsGeometry().fromWireframeGeometry(wire)
  const lineMat = new LineMaterial({
    color: new Color().setRGB(...PICKUP.EDGE_RGB).getHex(),
    linewidth: PICKUP.LINE_WIDTH,
    worldUnits: false,
    transparent: true,
    depthTest: true, // normal blend (not additive) so edges stay blue over the fill, not white
    fog: true, // fade in through the tube fog as they approach
  })
  lineMat.color.setRGB(...PICKUP.EDGE_RGB) // keep HDR (>1) values for strong bloom
  const shell = new LineSegments2(lineGeo, lineMat)
  shell.computeLineDistances()
  inner.add(shell)
  ico.dispose()
  wire.dispose()

  const object = new Group()
  object.add(inner)

  let t = 0
  return {
    object,
    update(dt: number): void {
      t += dt
      inner.rotation.y += PICKUP.SPIN_SPEED * dt
      inner.position.y = Math.sin(t * PICKUP.BOB_SPEED) * PICKUP.BOB_AMP
    },
    setResolution(w: number, h: number): void {
      lineMat.resolution.set(w, h)
    },
    setOpacity(o: number): void {
      fillMat.opacity = PICKUP.GLOW_OPACITY * o
      lineMat.opacity = o
    },
  }
}
