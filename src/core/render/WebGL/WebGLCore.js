import { CULL_FACE_TYPE, BLEND_TYPE, DRAW_SIDE, WEBGL_UNIFORM_TYPE, OBJECT_TYPE, WEBGL_PIXEL_TYPE, WEBGL_PIXEL_FORMAT, WEBGL_TEXTURE_FILTER } from '../../const.js';
import { nextPowerOfTwo } from '../../base.js';
import { Vector3 } from '../../math/Vector3.js';
import { Vector4 } from '../../math/Vector4.js';
import { Plane } from '../../math/Plane.js';
import { Texture2D } from '../../texture/Texture2D.js';
import { WebGLPrograms } from './WebGLPrograms.js';
import { WebGLProperties } from './WebGLProperties.js';
import { WebGLCapabilities } from './WebGLCapabilities.js';
import { WebGLState } from './WebGLState.js';
import { WebGLTexture } from './WebGLTexture.js';
import { WebGLRenderTarget } from './WebGLRenderTarget.js';
import { WebGLGeometry } from './WebGLGeometry.js';

var helpVector3 = new Vector3();
var helpVector4 = new Vector4();

var influencesList = new WeakMap();
var morphInfluences = new Float32Array(8);

function defaultGetMaterial(renderable) {
	return renderable.material;
}

function defaultIfRender(renderable) {
	return true;
}

function noop() {}

var getClippingPlanesData = function() {
	var planesData;
	var plane = new Plane();
	return function getClippingPlanesData(planes, camera) {
		if (!planesData || planesData.length < planes.length * 4) {
			planesData = new Float32Array(planes.length * 4);
		}

		for (var i = 0; i < planes.length; i++) {
			plane.copy(planes[i]);// .applyMatrix4(camera.viewMatrix);
			planesData[i * 4 + 0] = plane.normal.x;
			planesData[i * 4 + 1] = plane.normal.y;
			planesData[i * 4 + 2] = plane.normal.z;
			planesData[i * 4 + 3] = plane.constant;
		}
		return planesData;
	}
}();

/**
 * Core render methods by WebGL.
 * @constructor
 * @memberof zen3d
 * @param {WebGLRenderingContext} gl
 */
function WebGLCore(gl) {
	this.gl = gl;

	var properties = new WebGLProperties();
	this.properties = properties;

	var capabilities = new WebGLCapabilities(gl);

	/**
     * An object containing details about the capabilities of the current RenderingContext.
     * @type {zen3d.WebGLCapabilities}
     */
	this.capabilities = capabilities;

	var state = new WebGLState(gl, capabilities);
	this.state = state;

	var texture = new WebGLTexture(gl, state, properties, capabilities);
	this.texture = texture;

	this.renderTarget = new WebGLRenderTarget(gl, state, texture, properties, capabilities);

	this.geometry = new WebGLGeometry(gl, state, properties, capabilities);

	this.programs = new WebGLPrograms(gl, state, capabilities);

	this._usedTextureUnits = 0;

	this._currentGeometryProgram = "";
}

var directShadowMaps = [];
var directDepthMaps = [];
var pointShadowMaps = [];
var spotShadowMaps = [];
var spotDepthMaps = [];

Object.assign(WebGLCore.prototype, /** @lends zen3d.WebGLCore.prototype */{

	/**
     * Clear buffers.
     * @param {boolean} [color=false]
     * @param {boolean} [depth=false]
     * @param {boolean} [stencil=false]
     */
	clear: function(color, depth, stencil) {
		var gl = this.gl;

		var bits = 0;

		if (color === undefined || color) bits |= gl.COLOR_BUFFER_BIT;
		if (depth === undefined || depth) bits |= gl.DEPTH_BUFFER_BIT;
		if (stencil === undefined || stencil) bits |= gl.STENCIL_BUFFER_BIT;

		gl.clear(bits);
	},

	/**
     * Render opaque and transparent objects.
     * @param {zen3d.Scene} scene
     * @param {zen3d.Camera} camera
     * @param {boolean} [updateRenderList=true]
     */
	render: function(scene, camera, updateRenderList) {
		updateRenderList = (updateRenderList !== undefined ? updateRenderList : true);
		var renderList;
		if (updateRenderList) {
			renderList = scene.updateRenderList(camera);
		} else {
			renderList = scene.getRenderList(camera);
		}

		this.renderPass(renderList.opaque, camera, {
			scene: scene,
			getMaterial: function(renderable) {
				return scene.overrideMaterial || renderable.material;
			}
		});

		this.renderPass(renderList.transparent, camera, {
			scene: scene,
			getMaterial: function(renderable) {
				return scene.overrideMaterial || renderable.material;
			}
		});
	},

	/**
     * Render a single renderable list in camera in sequence.
     * @param {Array} list - List of all renderables.
     * @param {zen3d.Camera} camera - Camera provide view matrix and porjection matrix.
     * @param {Object} [config=] - The config for this render.
     * @param {Function} [config.getMaterial=] - Get renderable material.
     * @param {Function} [config.beforeRender=] - Before render each renderable.
     * @param {Function} [config.afterRender=] - After render each renderable
     * @param {Function} [config.ifRender=] - If render the renderable.
     * @param {zen3d.Scene} [config.scene=] - Rendering scene, have some rendering context.
     */
	renderPass: function(renderList, camera, config) {
		config = config || {};

		var gl = this.gl;
		var state = this.state;
		var vaoExt = this.capabilities.getExtension("OES_vertex_array_object");

		var getMaterial = config.getMaterial || defaultGetMaterial;
		var beforeRender = config.beforeRender || noop;
		var afterRender = config.afterRender || noop;
		var ifRender = config.ifRender || defaultIfRender;
		var scene = config.scene || {};

		var currentRenderTarget = state.currentRenderTarget;

		for (var i = 0, l = renderList.length; i < l; i++) {
			var renderItem = renderList[i];

			if (!ifRender(renderItem)) {
				continue;
			}

			var object = renderItem.object;
			var material = getMaterial.call(this, renderItem);
			var geometry = renderItem.geometry;
			var group = renderItem.group;

			object.onBeforeRender(renderItem, material);
			beforeRender.call(this, renderItem, material);

			var materialProperties = this.properties.get(material);
			if (material.needsUpdate === false) {
				if (materialProperties.program === undefined) {
					material.needsUpdate = true;
				} else if (materialProperties.fog !== scene.fog) {
					material.needsUpdate = true;
				} else if (scene.clippingPlanes && scene.clippingPlanes.length !==  materialProperties.numClippingPlanes) {
					material.needsUpdate = true;
				} else if (camera.gammaInput !==  materialProperties.gammaInput ||
                    camera.gammaOutput !==  materialProperties.gammaOutput ||
                    camera.gammaFactor !==  materialProperties.gammaFactor) {
					material.needsUpdate = true;
				} else {
					var acceptLight = material.acceptLight && !!scene.lights && scene.lights.totalNum > 0;
					if (acceptLight !== materialProperties.acceptLight) {
						material.needsUpdate = true;
					} else if (acceptLight) {
						if (!scene.lights.hash.compare(materialProperties.lightsHash) ||
							object.receiveShadow !== materialProperties.receiveShadow ||
							object.shadowType !== materialProperties.shadowType) {
							material.needsUpdate = true;
						}
					}
				}
			}
			if (material.needsUpdate) {
				if (materialProperties.program === undefined) {
					material.addEventListener('dispose', this.onMaterialDispose, this);
				}
				var oldProgram = materialProperties.program;
				materialProperties.program = this.programs.getProgram(camera, material, object, scene);
				if (oldProgram) {
					this.programs.releaseProgram(oldProgram);
				}
				materialProperties.fog = scene.fog;

				if (scene.lights) {
					materialProperties.acceptLight = material.acceptLight;
					materialProperties.lightsHash = scene.lights.hash.copyTo(materialProperties.lightsHash);
					materialProperties.receiveShadow = object.receiveShadow;
					materialProperties.shadowType = object.shadowType;
				} else {
					materialProperties.acceptLight = false;
				}

				materialProperties.numClippingPlanes = scene.clippingPlanes ? scene.clippingPlanes.length : 0;
				materialProperties.gammaInput = camera.gammaInput;
				materialProperties.gammaOutput = camera.gammaOutput;
				materialProperties.gammaFactor = camera.gammaFactor;

				material.needsUpdate = false;
			}
			var program = materialProperties.program;
			state.setProgram(program);

			var geometryProperties = this.geometry.setGeometry(geometry);

			// update morph targets
			if (object.morphTargetInfluences) {
				this.updateMorphtargets(object, geometry, program);
			}

			if (object.morphTargetInfluences) {
				this.setupVertexAttributes(program, geometry);
				this._currentGeometryProgram = "";
			} else if (this.capabilities.version >= 2) { // use VAO
				if (!geometryProperties._vaos[program.id]) {
					geometryProperties._vaos[program.id] = gl.createVertexArray();
					gl.bindVertexArray(geometryProperties._vaos[program.id]);
					this.setupVertexAttributes(program, geometry);
				} else {
					gl.bindVertexArray(geometryProperties._vaos[program.id]);
				}
			} else if (vaoExt) { // use VAO extension
				if (!geometryProperties._vaos[program.id]) {
					geometryProperties._vaos[program.id] = vaoExt.createVertexArrayOES();
					vaoExt.bindVertexArrayOES(geometryProperties._vaos[program.id]);
					this.setupVertexAttributes(program, geometry);
				} else {
					vaoExt.bindVertexArrayOES(geometryProperties._vaos[program.id]);
				}
			} else {
				var geometryProgram = program.id + "_" + geometry.id;
				if (geometryProgram !== this._currentGeometryProgram) {
					this.setupVertexAttributes(program, geometry);
					this._currentGeometryProgram = geometryProgram;
				}
				this._currentGeometryProgram = geometryProgram;
			}

			// update uniforms
			var uniforms = program.uniforms;
			for (var n = 0, ll = uniforms.seq.length; n < ll; n++) {
				var uniform = uniforms.seq[n];
				var key = uniform.id;

				// upload custom uniforms
				if (material.uniforms && material.uniforms[key] !== undefined) {
					uniform.set(material.uniforms[key], this);
					continue;
				}

				switch (key) {
				// pvm matrix
				case "u_Projection":
					if (object.type === OBJECT_TYPE.CANVAS2D && object.isScreenCanvas) {
						var projectionMat = object.orthoCamera.projectionMatrix.elements;
					} else {
						var projectionMat = camera.projectionMatrix.elements;
					}

					uniform.set(projectionMat);
					break;
				case "u_View":
					if (object.type === OBJECT_TYPE.CANVAS2D && object.isScreenCanvas) {
						var viewMatrix = object.orthoCamera.viewMatrix.elements;
					} else {
						var viewMatrix = camera.viewMatrix.elements;
					}

					uniform.set(viewMatrix);
					break;
				case "u_Model":
					var modelMatrix = object.worldMatrix.elements;
					uniform.set(modelMatrix);
					break;

				case "u_Color":
					var color = material.diffuse;
					uniform.setValue(color.r, color.g, color.b);
					break;
				case "u_Opacity":
					uniform.set(material.opacity);
					break;

				case "diffuseMap":
					uniform.set(material.diffuseMap, this);
					break;
				case "normalMap":
					uniform.set(material.normalMap, this);
					break;
				case "bumpMap":
					uniform.set(material.bumpMap, this);
					break;
				case "bumpScale":
					uniform.set(material.bumpScale);
					break;
				case "envMap":
					uniform.set(material.envMap, this);
					break;
				case "cubeMap":
					uniform.set(material.cubeMap, this);
					break;

				case "u_EnvMap_Intensity":
					uniform.set(material.envMapIntensity);
					break;
				case "maxMipLevel":
					uniform.set(this.properties.get(material.envMap).__maxMipLevel || 0);
					break;
				case "u_Specular":
					uniform.set(material.shininess);
					break;
				case "u_SpecularColor":
					var color = material.specular;
					uniform.setValue(color.r, color.g, color.b);
					break;
				case "specularMap":
					uniform.set(material.specularMap, this);
					break;
				case "aoMap":
					uniform.set(material.aoMap, this);
					break;
				case "aoMapIntensity":
					uniform.set(material.aoMapIntensity);
					break;
				case "u_Roughness":
					uniform.set(material.roughness);
					break;
				case "roughnessMap":
					uniform.set(material.roughnessMap, this);
					break;
				case "u_Metalness":
					uniform.set(material.metalness);
					break;
				case "metalnessMap":
					uniform.set(material.metalnessMap, this);
					break;
				case "glossiness":
					uniform.set(material.glossiness);
					break;
				case "glossinessMap":
					uniform.set(material.glossinessMap, this);
					break;
				case "emissive":
					var color = material.emissive;
					var intensity = material.emissiveIntensity;
					uniform.setValue(color.r * intensity, color.g * intensity, color.b * intensity);
					break;
				case "emissiveMap":
					uniform.set(material.emissiveMap, this);
					break;
				case "u_CameraPosition":
					helpVector3.setFromMatrixPosition(camera.worldMatrix);
					uniform.setValue(helpVector3.x, helpVector3.y, helpVector3.z);
					break;
				case "u_FogColor":
					var color = scene.fog.color;
					uniform.setValue(color.r, color.g, color.b);
					break;
				case "u_FogDensity":
					uniform.set(scene.fog.density);
					break;
				case "u_FogNear":
					uniform.set(scene.fog.near);
					break;
				case "u_FogFar":
					uniform.set(scene.fog.far);
					break;
				case "u_PointSize":
					uniform.set(material.size);
					break;
				case "u_PointScale":
					var scale = currentRenderTarget.height * 0.5; // three.js do this
					uniform.set(scale);
					break;
				case "dashSize":
					uniform.set(material.dashSize);
					break;
				case "totalSize":
					uniform.set(material.dashSize + material.gapSize);
					break;
				case "scale":
					uniform.set(material.scale);
					break;
				case "clippingPlanes":
					var planesData = getClippingPlanesData(scene.clippingPlanes || [], camera);
					uniform.set(planesData);
					break;
				case "uvTransform":
					var uvScaleMap;
					uvScaleMap = material.diffuseMap ||
                            material.specularMap || material.normalMap || material.bumpMap ||
                            material.roughnessMap || material.metalnessMap || material.emissiveMap;
					if (uvScaleMap) {
						if (uvScaleMap.matrixAutoUpdate) {
							uvScaleMap.updateMatrix();
						}
						uniform.set(uvScaleMap.matrix.elements);
					}
					break;
				default:
					break;
				}
			}

			// boneMatrices
			if (object.type === OBJECT_TYPE.SKINNED_MESH) {
				this.uploadSkeleton(uniforms, object, program.program);
			}

			if (material.acceptLight && scene.lights) {
				this.uploadLights(uniforms, scene.lights, object.receiveShadow, camera);
			}

			var frontFaceCW = object.worldMatrix.determinant() < 0;
			this.setStates(material, frontFaceCW);

			var viewport = helpVector4.set(
				currentRenderTarget.width,
				currentRenderTarget.height,
				currentRenderTarget.width,
				currentRenderTarget.height
			).multiply(camera.rect);

			viewport.z -= viewport.x;
			viewport.w -= viewport.y;

			viewport.x = Math.floor(viewport.x);
			viewport.y = Math.floor(viewport.y);
			viewport.z = Math.floor(viewport.z);
			viewport.w = Math.floor(viewport.w);

			if (object.type === OBJECT_TYPE.CANVAS2D) {
				if (object.isScreenCanvas) {
					object.setRenderViewport(viewport.x, viewport.y, viewport.z, viewport.w);
					state.viewport(object.viewport.x, object.viewport.y, object.viewport.z, object.viewport.w);
				}

				var _offset = 0;
				for (var j = 0; j < object.drawArray.length; j++) {
					var drawData = object.drawArray[j];

					uniforms.set("spriteTexture", drawData.texture, this);

					gl.drawElements(gl.TRIANGLES, drawData.count * 6, gl.UNSIGNED_SHORT, _offset * 2);
					_offset += drawData.count * 6;
					this._usedTextureUnits = 0;
				}
			} else {
				state.viewport(viewport.x, viewport.y, viewport.z, viewport.w);

				this.draw(geometry, material, group);
			}

			if (this.capabilities.version >= 2) {
				gl.bindVertexArray(null);
			} else if (vaoExt) {
				vaoExt.bindVertexArrayOES(null);
			}

			// reset used tex Unit
			this._usedTextureUnits = 0;

			// Ensure depth buffer writing is enabled so it can be cleared on next render

			state.depthBuffer.setTest(true);
			state.depthBuffer.setMask(true);
			state.colorBuffer.setMask(true);

			afterRender(this, renderItem);
			object.onAfterRender(renderItem);
		}
	},

	// Set states.
	setStates: function(material, frontFaceCW) {
		var state = this.state;

		// set blend
		if (material.transparent) {
			state.setBlend(material.blending, material.blendEquation, material.blendSrc, material.blendDst, material.blendEquationAlpha, material.blendSrcAlpha, material.blendDstAlpha, material.premultipliedAlpha);
		} else {
			state.setBlend(BLEND_TYPE.NONE);
		}

		// set buffers
		state.depthBuffer.setTest(material.depthTest);
		state.depthBuffer.setMask(material.depthWrite);
		state.colorBuffer.setMask(material.colorWrite);

		// set draw side
		state.setCullFace(
			(material.side === DRAW_SIDE.DOUBLE) ? CULL_FACE_TYPE.NONE : CULL_FACE_TYPE.BACK
		);

		var flipSided = (material.side === DRAW_SIDE.BACK);
		if (frontFaceCW) flipSided = !flipSided;

		state.setFlipSided(flipSided);

		// set line width
		if (material.lineWidth !== undefined) {
			state.setLineWidth(material.lineWidth);
		}

		state.setPolygonOffset(material.polygonOffset, material.polygonOffsetFactor, material.polygonOffsetUnits);
	},

	// GL draw.
	draw: function(geometry, material, group) {
		var gl = this.gl;
		var properties = this.properties;
		var capabilities = this.capabilities;

		var useIndexBuffer = geometry.index !== null;

		var drawStart = 0;
		var drawCount = useIndexBuffer ? geometry.index.count : geometry.getAttribute("a_Position").count;
		var groupStart = group ? group.start : 0;
		var groupCount = group ? group.count : Infinity;
		drawStart = Math.max(drawStart, groupStart);
		drawCount = Math.min(drawCount, groupCount);

		if (useIndexBuffer) {
			var indexProperty = properties.get(geometry.index);
			var bytesPerElement = indexProperty.bytesPerElement;
			var type = indexProperty.type;

			if (type === gl.UNSIGNED_INT) {
				if (capabilities.version < 2 && !capabilities.getExtension('OES_element_index_uint')) {
					console.warn("draw elements type not support UNSIGNED_INT!");
				}
			}

			if (geometry.isInstancedGeometry) {
				if (geometry.maxInstancedCount > 0) {
					if (capabilities.version >= 2) {
						gl.drawElementsInstanced(material.drawMode, drawCount, type, drawStart * bytesPerElement, geometry.maxInstancedCount);
					} else if (capabilities.getExtension('ANGLE_instanced_arrays')) {
						capabilities.getExtension('ANGLE_instanced_arrays').drawElementsInstancedANGLE(material.drawMode, drawCount, type, drawStart * bytesPerElement, geometry.maxInstancedCount);
					} else {
						console.warn("no support instanced draw.");
					}
				}
			} else {
				gl.drawElements(material.drawMode, drawCount, type, drawStart * bytesPerElement);
			}
		} else {
			if (geometry.isInstancedGeometry) {
				if (geometry.maxInstancedCount > 0) {
					if (capabilities.version >= 2) {
						gl.drawArraysInstanced(material.drawMode, drawStart, drawCount, geometry.maxInstancedCount);
					} else if (capabilities.getExtension('ANGLE_instanced_arrays')) {
						capabilities.getExtension('ANGLE_instanced_arrays').drawArraysInstancedANGLE(material.drawMode, drawStart, drawCount, geometry.maxInstancedCount);
					} else {
						console.warn("no support instanced draw.");
					}
				}
			} else {
				gl.drawArrays(material.drawMode, drawStart, drawCount);
			}
		}
	},

	// Upload skeleton uniforms.
	uploadSkeleton: function(uniforms, object, programId) {
		if (object.skeleton && object.skeleton.bones.length > 0) {
			var skeleton = object.skeleton;
			var capabilities = this.capabilities;

			skeleton.updateBones();

			if (capabilities.maxVertexTextures > 0 && (!!capabilities.getExtension('OES_texture_float') || capabilities.version >= 2)) {
				if (skeleton.boneTexture === undefined) {
					var size = Math.sqrt(skeleton.bones.length * 4);
					size = nextPowerOfTwo(Math.ceil(size));
					size = Math.max(4, size);

					var boneMatrices = new Float32Array(size * size * 4);
					boneMatrices.set(skeleton.boneMatrices);
					var boneTexture = new Texture2D();
					boneTexture.image = { data: boneMatrices, width: size, height: size };
					if (capabilities.version >= 2) {
						boneTexture.internalformat = WEBGL_PIXEL_FORMAT.RGBA32F;
						boneTexture.format = WEBGL_PIXEL_FORMAT.RGBA;
					}
					boneTexture.type = WEBGL_PIXEL_TYPE.FLOAT;
					boneTexture.magFilter = WEBGL_TEXTURE_FILTER.NEAREST;
					boneTexture.minFilter = WEBGL_TEXTURE_FILTER.NEAREST;
					boneTexture.generateMipmaps = false;
					boneTexture.flipY = false;

					skeleton.boneMatrices = boneMatrices;
					skeleton.boneTexture = boneTexture;
				}

				uniforms.set("boneTexture", skeleton.boneTexture, this);
				uniforms.set("boneTextureSize", skeleton.boneTexture.image.width);
			} else {
				uniforms.set("boneMatrices", skeleton.boneMatrices);
			}

			uniforms.set("bindMatrix", object.bindMatrix.elements);
			uniforms.set("bindMatrixInverse", object.bindMatrixInverse.elements);
		}
	},

	// Upload lights uniforms.
	uploadLights: function(uniforms, lights, receiveShadow, camera) {
		if (lights.ambientsNum > 0) {
			uniforms.set("u_AmbientLightColor", lights.ambient);
		}

		if (lights.directsNum > 0) {
			uniforms.set("u_Directional", lights.directional);

			if (uniforms.has("directionalShadowMap")) {
				if (this.capabilities.version >= 2) {
					uniforms.set("directionalShadowMap", lights.directionalShadowDepthMap, this);
				} else {
					uniforms.set("directionalShadowMap", lights.directionalShadowMap, this);
				}
				uniforms.set("directionalShadowMatrix", lights.directionalShadowMatrix);
			}

			if (uniforms.has("directionalDepthMap")) {
				uniforms.set("directionalDepthMap", lights.directionalShadowMap, this);
			}
		}

		if (lights.pointsNum > 0) {
			uniforms.set("u_Point", lights.point);

			if (uniforms.has("pointShadowMap")) {
				uniforms.set("pointShadowMap", lights.pointShadowMap, this);
			}
		}

		if (lights.spotsNum > 0) {
			uniforms.set("u_Spot", lights.spot);

			if (uniforms.has("spotShadowMap")) {
				if (this.capabilities.version >= 2) {
					uniforms.set("spotShadowMap", lights.spotShadowDepthMap, this);
				} else {
					uniforms.set("spotShadowMap", lights.spotShadowMap, this);
				}
				uniforms.set("spotShadowMatrix", lights.spotShadowMatrix);
			}

			if (uniforms.has("spotDepthMap")) {
				uniforms.set("spotDepthMap", lights.spotShadowMap, this);
			}
		}
	},

	// Alloc texture unit.
	allocTexUnit: function() {
		var textureUnit = this._usedTextureUnits;

		if (textureUnit >= this.capabilities.maxTextures) {
			console.warn('trying to use ' + textureUnit + ' texture units while this GPU supports only ' + this.capabilities.maxTextures);
		}

		this._usedTextureUnits += 1;

		return textureUnit;
	},

	updateMorphtargets: function(object, geometry, program) {
		var objectInfluences = object.morphTargetInfluences;

		if (!influencesList.has(geometry)) {
			influencesList.set(geometry, objectInfluences.slice(0));
		}

		var morphTargets = geometry.morphAttributes.position;
		var morphNormals = geometry.morphAttributes.normal;

		// Remove current morphAttributes

		var influences = influencesList.get(geometry);

		for (var i = 0; i < influences.length; i++) {
			var influence = influences[i];

			if (influence !== 0) {
				if (morphTargets) geometry.removeAttribute('morphTarget' + i);
				if (morphNormals) geometry.removeAttribute('morphNormal' + i);
			}
		}

		// Collect influences

		for (var i = 0; i < objectInfluences.length; i++) {
			influences[i] = objectInfluences[i];
		}

		influences.length = objectInfluences.length;

		// Add morphAttributes

		var count = 0;

		for (var i = 0; i < influences.length; i++) {
			var influence = influences[i];

			if (influence > 0) {
				if (morphTargets) geometry.addAttribute('morphTarget' + count, morphTargets[i]);
				if (morphNormals) geometry.addAttribute('morphNormal' + count, morphNormals[i]);

				morphInfluences[count] = influence;

				count++;
			}
		}

		for (;count < 8; count++) {
			morphInfluences[count] = 0;
		}

		program.uniforms.set('morphTargetInfluences', morphInfluences);
	},

	setupVertexAttributes: function(program, geometry) {
		var gl = this.gl;
		var attributes = program.attributes;
		var properties = this.properties;
		var capabilities = this.capabilities;
		for (var key in attributes) {
			var programAttribute = attributes[key];
			var geometryAttribute = geometry.getAttribute(key);
			if (geometryAttribute) {
				var normalized = geometryAttribute.normalized;
				var size = geometryAttribute.size;
				if (programAttribute.count !== size) {
					console.warn("WebGLCore: attribute " + key + " size not match! " + programAttribute.count + " : " + size);
				}

				var attribute;
				if (geometryAttribute.isInterleavedBufferAttribute) {
					attribute = properties.get(geometryAttribute.data);
				} else {
					attribute = properties.get(geometryAttribute);
				}
				var buffer = attribute.buffer;
				var type = attribute.type;
				if (programAttribute.format !== type) {
					// console.warn("WebGLCore: attribute " + key + " type not match! " + programAttribute.format + " : " + type);
				}
				var bytesPerElement = attribute.bytesPerElement;

				if (geometryAttribute.isInterleavedBufferAttribute) {
					var data = geometryAttribute.data;
					var stride = data.stride;
					var offset = geometryAttribute.offset;

					gl.enableVertexAttribArray(programAttribute.location);

					if (data && data.isInstancedInterleavedBuffer) {
						if (capabilities.version >= 2) {
							gl.vertexAttribDivisor(programAttribute.location, data.meshPerAttribute);
						} else if (capabilities.getExtension('ANGLE_instanced_arrays')) {
							capabilities.getExtension('ANGLE_instanced_arrays').vertexAttribDivisorANGLE(programAttribute.location, data.meshPerAttribute);
						} else {
							console.warn("vertexAttribDivisor not supported");
						}

						if (geometry.maxInstancedCount === undefined) {
							geometry.maxInstancedCount = data.meshPerAttribute * data.count;
						}
					}

					gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
					gl.vertexAttribPointer(programAttribute.location, programAttribute.count, type, normalized, bytesPerElement * stride, bytesPerElement * offset);
				} else {
					gl.enableVertexAttribArray(programAttribute.location);

					if (geometryAttribute && geometryAttribute.isInstancedBufferAttribute) {
						if (capabilities.version >= 2) {
							gl.vertexAttribDivisor(programAttribute.location, geometryAttribute.meshPerAttribute);
						} else if (capabilities.getExtension('ANGLE_instanced_arrays')) {
							capabilities.getExtension('ANGLE_instanced_arrays').vertexAttribDivisorANGLE(programAttribute.location, geometryAttribute.meshPerAttribute);
						} else {
							console.warn("vertexAttribDivisor not supported");
						}

						if (geometry.maxInstancedCount === undefined) {
							geometry.maxInstancedCount = geometryAttribute.meshPerAttribute * geometryAttribute.count;
						}
					}

					gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
					gl.vertexAttribPointer(programAttribute.location, programAttribute.count, type, normalized, 0, 0);
				}
			} else {
				// console.warn("WebGLCore: geometry attribute " + key + " not found!");
			}
		}

		// bind index if could
		if (geometry.index) {
			var indexProperty = properties.get(geometry.index);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexProperty.buffer);
		}
	},

	onMaterialDispose: function(event) {
		var material = event.target;
		var materialProperties = this.properties.get(material);

		material.removeEventListener('dispose', this.onMaterialDispose, this);

		var program = materialProperties.program;

		if (program !== undefined) {
			// release program reference
			this.programs.releaseProgram(program);
		}

		this.properties.delete(material);
	}

});

export { WebGLCore };