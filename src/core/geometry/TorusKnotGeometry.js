import { Geometry } from './Geometry.js';
import { BufferAttribute } from './BufferAttribute.js';
import { Vector3 } from '../math/Vector3.js';

/**
 * Creates a torus knot, the particular shape of which is defined by a pair of coprime integers, p and q.
 * If p and q are not coprime, the result will be a torus link.
 * @constructor
 * @memberof zen3d
 * @extends zen3d.Geometry
 * @param {number} [radius=1] — Radius of the torus. Default is 1.
 * @param {number} [tube=0.4] — Radius of the tube. Default is 0.4.
 * @param {Integer} [tubularSegments=64] — Default is 64.
 * @param {Integer} [radialSegments=8] — Default is 8.
 * @param {Integer} [p=2] — This value determines, how many times the geometry winds around its axis of rotational symmetry. Default is 2.
 * @param {Integer} [q=3] — This value determines, how many times the geometry winds around a circle in the interior of the torus. Default is 3.
 */
function TorusKnotGeometry(radius, tube, tubularSegments, radialSegments, p, q) {
	Geometry.call(this);

	// this.type = 'TorusKnotGeometry';

	this.parameters = {
		radius: radius,
		tube: tube,
		tubularSegments: tubularSegments,
		radialSegments: radialSegments,
		p: p,
		q: q
	};

	radius = radius || 1;
	tube = tube || 0.4;
	tubularSegments = Math.floor(tubularSegments) || 64;
	radialSegments = Math.floor(radialSegments) || 8;
	p = p || 2;
	q = q || 3;

	// buffers

	var indices = [];
	var vertices = [];
	var normals = [];
	var uvs = [];

	// helper variables

	var i, j;

	var vertex = new Vector3();
	var normal = new Vector3();

	var P1 = new Vector3();
	var P2 = new Vector3();

	var B = new Vector3();
	var T = new Vector3();
	var N = new Vector3();

	// generate vertices, normals and uvs

	for (i = 0; i <= tubularSegments; ++i) {
		// the radian "u" is used to calculate the position on the torus curve of the current tubular segement

		var u = i / tubularSegments * p * Math.PI * 2;

		// now we calculate two points. P1 is our current position on the curve, P2 is a little farther ahead.
		// these points are used to create a special "coordinate space", which is necessary to calculate the correct vertex positions

		calculatePositionOnCurve(u, p, q, radius, P1);
		calculatePositionOnCurve(u + 0.01, p, q, radius, P2);

		// calculate orthonormal basis

		T.subVectors(P2, P1);
		N.addVectors(P2, P1);
		B.crossVectors(T, N);
		N.crossVectors(B, T);

		// normalize B, N. T can be ignored, we don't use it

		B.normalize();
		N.normalize();

		for (j = 0; j <= radialSegments; ++j) {
			// now calculate the vertices. they are nothing more than an extrusion of the torus curve.
			// because we extrude a shape in the xy-plane, there is no need to calculate a z-value.

			var v = j / radialSegments * Math.PI * 2;
			var cx = -tube * Math.cos(v);
			var cy = tube * Math.sin(v);

			// now calculate the final vertex position.
			// first we orient the extrusion with our basis vectos, then we add it to the current position on the curve

			vertex.x = P1.x + (cx * N.x + cy * B.x);
			vertex.y = P1.y + (cx * N.y + cy * B.y);
			vertex.z = P1.z + (cx * N.z + cy * B.z);

			vertices.push(vertex.x, vertex.y, vertex.z);

			// normal (P1 is always the center/origin of the extrusion, thus we can use it to calculate the normal)

			normal.subVectors(vertex, P1).normalize();

			normals.push(normal.x, normal.y, normal.z);

			// uv

			uvs.push(i / tubularSegments);
			uvs.push(j / radialSegments);
		}
	}

	// generate indices

	for (j = 1; j <= tubularSegments; j++) {
		for (i = 1; i <= radialSegments; i++) {
			// indices

			var a = (radialSegments + 1) * (j - 1) + (i - 1);
			var b = (radialSegments + 1) * j + (i - 1);
			var c = (radialSegments + 1) * j + i;
			var d = (radialSegments + 1) * (j - 1) + i;

			// faces

			indices.push(a, b, d);
			indices.push(b, c, d);
		}
	}

	// build geometry

	this.setIndex(indices);
	this.addAttribute('a_Position', new BufferAttribute(new Float32Array(vertices), 3));
	this.addAttribute('a_Normal', new BufferAttribute(new Float32Array(normals), 3));
	this.addAttribute('a_Uv', new BufferAttribute(new Float32Array(uvs), 2));

	this.computeBoundingBox();
	this.computeBoundingSphere();

	// this function calculates the current position on the torus curve

	function calculatePositionOnCurve(u, p, q, radius, position) {
		var cu = Math.cos(u);
		var su = Math.sin(u);
		var quOverP = q / p * u;
		var cs = Math.cos(quOverP);

		position.x = radius * (2 + cs) * 0.5 * cu;
		position.y = radius * (2 + cs) * su * 0.5;
		position.z = radius * Math.sin(quOverP) * 0.5;
	}
}

TorusKnotGeometry.prototype = Object.create(Geometry.prototype);
TorusKnotGeometry.prototype.constructor = TorusKnotGeometry;


export { TorusKnotGeometry };