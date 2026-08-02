"use client";

import * as THREE from "three";
import { useMemo } from "react";

type FatArrowProps = {
  fromWorld: THREE.Vector3;
  toWorld: THREE.Vector3;
  color?: string;
  opacity?: number;
};

/**
 * A bold, flat arrow (shaft + triangular head) lying in the plane spanned
 * by the travel direction and a fixed perpendicular reference — not a
 * billboard, so it doesn't need per-frame camera updates, but still reads
 * as a solid, unmissable directional glyph the way SketchUp's move-tool
 * marketing graphics draw it, instead of a thin three.js ArrowHelper line.
 */
export default function FatArrow({
  fromWorld,
  toWorld,
  color = "#7c3aed",
  opacity = 0.92,
}: FatArrowProps) {
  const geometry = useMemo(() => {
    const span = toWorld.clone().sub(fromWorld);
    const length = Math.max(span.length(), 1e-6);
    const direction = span.clone().normalize();

    const worldUp = new THREE.Vector3(0, 1, 0);
    const reference =
      Math.abs(direction.dot(worldUp)) > 0.92
        ? new THREE.Vector3(1, 0, 0)
        : worldUp;
    const across = new THREE.Vector3()
      .crossVectors(direction, reference)
      .normalize();

    const shaftHalfWidth = Math.max(length * 0.055, 1e-5);
    const headLength = Math.min(length * 0.4, shaftHalfWidth * 7);
    const headHalfWidth = shaftHalfWidth * 2.2;

    const shaftEnd = fromWorld
      .clone()
      .add(direction.clone().multiplyScalar(length - headLength));

    const point = (base: THREE.Vector3, out: number) =>
      base.clone().add(across.clone().multiplyScalar(out));

    const vertices = [
      // Shaft quad (two triangles).
      point(fromWorld, -shaftHalfWidth),
      point(fromWorld, shaftHalfWidth),
      point(shaftEnd, shaftHalfWidth),

      point(fromWorld, -shaftHalfWidth),
      point(shaftEnd, shaftHalfWidth),
      point(shaftEnd, -shaftHalfWidth),

      // Arrowhead triangle.
      point(shaftEnd, -headHalfWidth),
      point(shaftEnd, headHalfWidth),
      toWorld,
    ];

    const positions = new Float32Array(vertices.length * 3);

    vertices.forEach((vertex, index) => {
      positions[index * 3] = vertex.x;
      positions[index * 3 + 1] = vertex.y;
      positions[index * 3 + 2] = vertex.z;
    });

    const geom = new THREE.BufferGeometry();

    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    return geom;
  }, [fromWorld, toWorld]);

  if (fromWorld.distanceToSquared(toWorld) < 1e-10) {
    return null;
  }

  return (
    <mesh
      geometry={geometry}
      renderOrder={999}
      frustumCulled={false}
      raycast={() => null}
    >
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
