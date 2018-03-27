(function() {
    var MATERIAL_TYPE = zen3d.MATERIAL_TYPE;
    var CULL_FACE_TYPE = zen3d.CULL_FACE_TYPE;
    var BLEND_TYPE = zen3d.BLEND_TYPE;
    var DRAW_SIDE = zen3d.DRAW_SIDE;
    var WEBGL_UNIFORM_TYPE = zen3d.WEBGL_UNIFORM_TYPE;
    var RENDER_LAYER = zen3d.RENDER_LAYER;
    var LAYER_RENDER_LIST = zen3d.LAYER_RENDER_LIST;

    var getClippingPlanesData = function() {
        var planesData;
        var plane = new zen3d.Plane();
        return function getClippingPlanesData(planes, camera) {
            if(!planesData || planesData.length < planes.length * 4) {
                planesData = new Float32Array(planes.length * 4);
            }

            for(var i = 0; i < planes.length; i++) {
                plane.copy(planes[i]).applyMatrix4(camera.viewMatrix);
                planesData[i * 4 + 0] = plane.normal.x;
                planesData[i * 4 + 1] = plane.normal.y;
                planesData[i * 4 + 2] = plane.normal.z;
                planesData[i * 4 + 3] = plane.constant;
            }
            return planesData;
        }
    }();


    /**
     * Renderer
     * @class
     */
    var Renderer = function(view) {

        // canvas
        this.view = view;
        // gl context
        var gl = this.gl = view.getContext("webgl", {
            antialias: true, // antialias
            alpha: false, // effect performance, default false
            // premultipliedAlpha: false, // effect performance, default false
            stencil: true
        });
        // width and height, same with the canvas
        this.width = view.width;
        this.height = view.height;

        this.autoClear = true;

        this.shadowType = zen3d.SHADOW_TYPE.PCF_SOFT;

        this.clippingPlanes = []; // Planes array

        this.gammaFactor = 2.0;
    	this.gammaInput = false;
    	this.gammaOutput = false;

        // init webgl
        var properties = new zen3d.WebGLProperties();
        this.properties = properties;

        var capabilities = new zen3d.WebGLCapabilities(gl);
        this.capabilities = capabilities;

        var state = new zen3d.WebGLState(gl, capabilities);
        state.enable(gl.STENCIL_TEST);
        state.enable(gl.DEPTH_TEST);
        state.setCullFace(CULL_FACE_TYPE.BACK);
        state.setFlipSided(false);
        state.viewport(0, 0, this.width, this.height);
        state.clearColor(0, 0, 0, 0);
        this.state = state;

        this.texture = new zen3d.WebGLTexture(gl, state, properties, capabilities);

        this.geometry = new zen3d.WebGLGeometry(gl, state, properties, capabilities);

        this.performance = new zen3d.Performance();

        this.depthMaterial = new zen3d.DepthMaterial();
        this.depthMaterial.packToRGBA = true;
        this.distanceMaterial = new zen3d.DistanceMaterial();

        // object cache
        this.cache = new zen3d.RenderCache();

        this._usedTextureUnits = 0;

        this._currentRenderTarget = null;

        this._currentViewport = new zen3d.Vector4(0, 0, this.width, this.height);

        this.shadowAutoUpdate = true;
        this.shadowNeedsUpdate = false
    }

    /**
     * resize
     */
    Renderer.prototype.resize = function(width, height) {
        this.width = width;
        this.height = height;

        this.view.width = width;
        this.view.height = height;

        this.setViewport(0, 0, width, height);
    }

    /**
     * setViewport
     */
    Renderer.prototype.setViewport = function(x, y, width, height) {
        this._currentViewport.set(x, y, width, height);
        this.state.viewport(x, y, width, height);
    }

    /**
     * render scene with camera
     */
    Renderer.prototype.render = function(scene, camera, renderTarget, forceClear) {
        var performance = this.performance;

        performance.updateFps();

        performance.startCounter("render", 60);

        performance.startCounter("updateMatrix", 60);
        scene.updateMatrix();
        performance.endCounter("updateMatrix");

        camera.viewMatrix.getInverse(camera.worldMatrix); // update view matrix

        performance.startCounter("cacheScene", 60);
        this.cache.cacheScene(scene, camera);
        this.cache.sort();
        performance.endCounter("cacheScene");

        performance.startCounter("renderShadow", 60);
        var useStencil = this.state.states[this.gl.STENCIL_TEST];
        if(useStencil) {
            this.state.disable(this.gl.STENCIL_TEST);
        }
        this.renderShadow();
        if(useStencil) {
            this.state.enable(this.gl.STENCIL_TEST);
        }
        performance.endCounter("renderShadow");

        if (renderTarget === undefined) {
            renderTarget = null;
        }
        this.setRenderTarget(renderTarget);

        if (this.autoClear || forceClear) {
            this.state.clearColor(0, 0, 0, 0);
            this.clear(true, true, true);
        }

        performance.startCounter("renderList", 60);
        var renderLists = this.cache.renderLists;
        for(var i = 0; i < LAYER_RENDER_LIST.length; i++) {
            var layer = LAYER_RENDER_LIST[i];
            // TODO separate different renderers to avoid branchs
            if(layer === RENDER_LAYER.SPRITE) {
                this.renderSprites(renderLists[layer]);
            } else if(layer === RENDER_LAYER.PARTICLE) {
                this.renderParticles(renderLists[layer]);
            } else {
                this.renderList(renderLists[layer], scene.overrideMaterial);
            }
        }
        performance.endCounter("renderList");

        this.cache.clear();

        if (renderTarget) {
            this.texture.updateRenderTargetMipmap(renderTarget);
        }

        this.performance.endCounter("render");
    }

    /**
     * render shadow map for lights
     */
    Renderer.prototype.renderShadow = function() {
		if ( this.shadowAutoUpdate === false && this.shadowNeedsUpdate === false ) return;

        var gl = this.gl;
        var state = this.state;

        var lights = this.cache.lights.shadows;
        for (var i = 0; i < lights.length; i++) {
            var light = lights[i];

            var shadow = light.shadow;
            var camera = shadow.camera;
            var shadowTarget = shadow.renderTarget;
            var isPointLight = light.lightType == zen3d.LIGHT_TYPE.POINT ? true : false;
            var faces = isPointLight ? 6 : 1;
            var renderList = this.cache.shadowObjects;

            for (var j = 0; j < faces; j++) {

                if (isPointLight) {
                    shadow.update(light, j);
                    shadowTarget.activeCubeFace = j;
                } else {
                    shadow.update(light);
                }

                this.setRenderTarget(shadowTarget);

                state.clearColor(1, 1, 1, 1);
                this.clear(true, true);

                if (renderList.length == 0) {
                    continue;
                }

                for (var n = 0, l = renderList.length; n < l; n++) {
                    var renderItem = renderList[n];
                    var object = renderItem.object;
                    var material = renderItem.material;
                    var geometry = renderItem.geometry;
                    var group = renderItem.group;
                    var materialForShadow = isPointLight ? this.distanceMaterial : this.depthMaterial;

                    var program = zen3d.getProgram(gl, this, materialForShadow, object);
                    state.setProgram(program);

                    this.geometry.setGeometry(geometry);
                    this.setupVertexAttributes(program, geometry);

                    // update uniforms
                    var uniforms = program.uniforms;
                    for (var key in uniforms) {
                        var uniform = uniforms[key];
                        switch (key) {
                            // pvm matrix
                            case "u_Projection":
                                var projectionMat = camera.projectionMatrix.elements;
                                uniform.setValue(projectionMat);
                                break;
                            case "u_View":
                                var viewMatrix = camera.viewMatrix.elements;
                                uniform.setValue(viewMatrix);
                                break;
                            case "u_Model":
                                var modelMatrix = object.worldMatrix.elements;
                                uniform.setValue(modelMatrix);
                                break;
                            case "lightPos":
                                helpVector3.setFromMatrixPosition(light.worldMatrix);
                                uniform.setValue(helpVector3.x, helpVector3.y, helpVector3.z);
                                break;
                            case "nearDistance":
                                uniform.setValue(shadow.cameraNear);
                                break;
                            case "farDistance":
                                uniform.setValue(shadow.cameraFar);
                                break;
                        }
                    }

                    // boneMatrices
                    if(object.type === zen3d.OBJECT_TYPE.SKINNED_MESH) {
                        this.uploadSkeleton(uniforms, object, program.id);
                    }

                    // copy draw side
                    materialForShadow.side = material.side;

                    var frontFaceCW = object.worldMatrix.determinant() < 0;

                    this.setStates(materialForShadow, frontFaceCW);

                    this.draw(geometry, material, group);
                }

            }

            // set generateMipmaps false
            // this.texture.updateRenderTargetMipmap(shadowTarget);

        }

        this.shadowNeedsUpdate = false;
    }

    var helpVector3 = new zen3d.Vector3();

    Renderer.prototype.renderList = function(renderList, overrideMaterial) {
        var camera = this.cache.camera;
        var fog = this.cache.fog;
        var gl = this.gl;
        var state = this.state;

        var lights = this.cache.lights;

        for (var i = 0, l = renderList.length; i < l; i++) {

            var renderItem = renderList[i];
            var object = renderItem.object;
            var material = overrideMaterial ? overrideMaterial : renderItem.material;
            var geometry = renderItem.geometry;
            var group = renderItem.group;

            var program = zen3d.getProgram(gl, this, material, object, lights, fog);
            state.setProgram(program);

            this.geometry.setGeometry(geometry);
            this.setupVertexAttributes(program, geometry);

            // update uniforms
            // TODO need a better upload method
            var uniforms = program.uniforms;
            for (var key in uniforms) {
                var uniform = uniforms[key];
                switch (key) {

                    // pvm matrix
                    case "u_Projection":
                        if (object.type === zen3d.OBJECT_TYPE.CANVAS2D && object.isScreenCanvas) {
                            var projectionMat = object.orthoCamera.projectionMatrix.elements;
                        } else {
                            var projectionMat = camera.projectionMatrix.elements;
                        }

                        uniform.setValue(projectionMat);
                        break;
                    case "u_View":
                        if (object.type === zen3d.OBJECT_TYPE.CANVAS2D && object.isScreenCanvas) {
                            var viewMatrix = object.orthoCamera.viewMatrix.elements;
                        } else {
                            var viewMatrix = camera.viewMatrix.elements;
                        }

                        uniform.setValue(viewMatrix);
                        break;
                    case "u_Model":
                        var modelMatrix = object.worldMatrix.elements;
                        uniform.setValue(modelMatrix);
                        break;

                    case "u_Color":
                        var color = material.diffuse;
                        uniform.setValue(color.r, color.g, color.b);
                        break;
                    case "u_Opacity":
                        uniform.setValue(material.opacity);
                        break;

                    case "texture":
                        var slot = this.allocTexUnit();
                        this.texture.setTexture2D(material.diffuseMap, slot);
                        uniform.setValue(slot);
                        break;
                    case "normalMap":
                        var slot = this.allocTexUnit();
                        this.texture.setTexture2D(material.normalMap, slot);
                        uniform.setValue(slot);
                        break;
                    case "bumpMap":
                        var slot = this.allocTexUnit();
                        this.texture.setTexture2D(material.bumpMap, slot);
                        uniform.setValue(slot);
                        break;
                    case "bumpScale":
                        uniform.setValue(material.bumpScale);
                        break;
                    case "envMap":
                        var slot = this.allocTexUnit();
                        this.texture.setTextureCube(material.envMap, slot);
                        uniform.setValue(slot);
                        break;
                    case "cubeMap":
                        var slot = this.allocTexUnit();
                        this.texture.setTextureCube(material.cubeMap, slot);
                        uniform.setValue(slot);
                        break;

                    case "u_EnvMap_Intensity":
                        uniform.setValue(material.envMapIntensity);
                        break;
                    case "u_Specular":
                        uniform.setValue(material.shininess);
                        break;
                    case "u_SpecularColor":
                        var color = material.specular;
                        uniform.setValue(color.r, color.g, color.b, 1);
                        break;
                    case "specularMap":
                        var slot = this.allocTexUnit();
                        this.texture.setTexture2D(material.specularMap, slot);
                        uniform.setValue(slot);
                        break;
                    case "aoMap":
                        var slot = this.allocTexUnit();
                        this.texture.setTexture2D(material.aoMap, slot);
                        uniform.setValue(slot);
                        break;
                    case "aoMapIntensity":
                        uniform.setValue(material.aoMapIntensity);
                        break;
                    case "u_Roughness":
                        uniform.setValue(material.roughness);
                        break;
                    case "roughnessMap":
                        var slot = this.allocTexUnit();
                        this.texture.setTexture2D(material.roughnessMap, slot);
                        uniform.setValue(slot);
                        break;
                    case "u_Metalness":
                        uniform.setValue(material.metalness);
                        break;
                    case "metalnessMap":
                        var slot = this.allocTexUnit();
                        this.texture.setTexture2D(material.metalnessMap, slot);
                        uniform.setValue(slot);
                        break;
                    case "emissive":
                        var color = material.emissive;
                        var intensity = material.emissiveIntensity;
                        uniform.setValue(color.r * intensity, color.g * intensity, color.b * intensity);
                        break;
                    case "emissiveMap":
                        var slot = this.allocTexUnit();
                        this.texture.setTexture2D(material.emissiveMap, slot);
                        uniform.setValue(slot);
                        break;
                    case "u_CameraPosition":
                        helpVector3.setFromMatrixPosition(camera.worldMatrix);
                        uniform.setValue(helpVector3.x, helpVector3.y, helpVector3.z);
                        break;
                    case "u_FogColor":
                        var color = fog.color;
                        uniform.setValue(color.r, color.g, color.b);
                        break;
                    case "u_FogDensity":
                        uniform.setValue(fog.density);
                        break;
                    case "u_FogNear":
                        uniform.setValue(fog.near);
                        break;
                    case "u_FogFar":
                        uniform.setValue(fog.far);
                        break;
                    case "u_PointSize":
                        uniform.setValue(material.size);
                        break;
                    case "u_PointScale":
                        var scale = this.height * 0.5; // three.js do this
                        uniform.setValue(scale);
                        break;
                    case "dashSize":
                        uniform.setValue(material.dashSize);
                        break;
                    case "totalSize":
                        uniform.setValue(material.dashSize + material.gapSize);
                        break;
                    case "scale":
                        uniform.setValue(material.scale);
                        break;
                    case "clippingPlanes[0]":
                        var planesData = getClippingPlanesData(this.clippingPlanes, camera);
                        gl.uniform4fv(uniform.location, planesData);
                        break;
                    default:
                        // upload custom uniforms
                        if(material.uniforms && material.uniforms[key]) {
                            if(uniform.type === WEBGL_UNIFORM_TYPE.SAMPLER_2D) {
                                var slot = this.allocTexUnit();
                                this.texture.setTexture2D(material.uniforms[key], slot);
                                uniform.setValue(slot);
                            } else if(uniform.type === WEBGL_UNIFORM_TYPE.SAMPLER_CUBE) {
                                var slot = this.allocTexUnit();
                                this.texture.setTextureCube(material.uniforms[key], slot);
                                uniform.setValue(slot);
                            } else {
                                uniform.set(material.uniforms[key]);
                            }
                        }
                        break;
                }
            }

            // boneMatrices
            if(object.type === zen3d.OBJECT_TYPE.SKINNED_MESH) {
                this.uploadSkeleton(uniforms, object, program.id);
            }

            if (material.acceptLight) {
                this.uploadLights(uniforms, lights, object.receiveShadow, camera, program.id);
            }

            var frontFaceCW = object.worldMatrix.determinant() < 0;
            this.setStates(material, frontFaceCW);

            if(object.type === zen3d.OBJECT_TYPE.CANVAS2D) {
                var curViewX, curViewY, curViewW, curViewH;
                if(object.isScreenCanvas) {
                    curViewX = this._currentViewport.x;
                    curViewY = this._currentViewport.y;
                    curViewW = this._currentViewport.z;
                    curViewH = this._currentViewport.w;
                    object.setRenderViewport(curViewX, curViewY, curViewW, curViewH);
                    this.setViewport(object.viewport.x, object.viewport.y, object.viewport.z, object.viewport.w);
                }

                var _offset = 0;
                for (var j = 0; j < object.drawArray.length; j++) {
                    var drawData = object.drawArray[j];

                    var slot = this.allocTexUnit();
                    this.texture.setTexture2D(drawData.texture, slot);
                    uniforms.spriteTexture.setValue(slot);

                    gl.drawElements(gl.TRIANGLES, drawData.count * 6, gl.UNSIGNED_SHORT, _offset * 2);
                    _offset += drawData.count * 6;
                    this._usedTextureUnits = 0;
                }

                if(object.isScreenCanvas) {
                    this.setViewport(curViewX, curViewY, curViewW, curViewH);
                }
            } else {
                this.draw(geometry, material, group);
            }

            // reset used tex Unit
            this._usedTextureUnits = 0;
        }
    }

    var spritePosition = new zen3d.Vector3();
    var spriteRotation = new zen3d.Quaternion();
    var spriteScale = new zen3d.Vector3();

    Renderer.prototype.renderSprites = function(sprites) {
        if (sprites.length === 0) {
            return;
        }

        var camera = this.cache.camera;
        var fog = this.cache.fog;
        var gl = this.gl;
        var state = this.state;
        var geometry = zen3d.Sprite.geometry;
        var material = sprites[0].material;

        var program = zen3d.getProgram(gl, this, material);
        state.setProgram(program);

        // bind a shared geometry
        this.geometry.setGeometry(geometry);
        this.setupVertexAttributes(program, geometry);

        var uniforms = program.uniforms;
        uniforms.projectionMatrix.setValue(camera.projectionMatrix.elements);

        // fog
        var sceneFogType = 0;
        if (fog) {
            uniforms.fogColor.setValue(fog.color.r, fog.color.g, fog.color.b);

            if (fog.fogType === zen3d.FOG_TYPE.NORMAL) {
                uniforms.fogNear.setValue(fog.near);
                uniforms.fogFar.setValue(fog.far);

                uniforms.fogType.setValue(1);
                sceneFogType = 1;
            } else if (fog.fogType === zen3d.FOG_TYPE.EXP2) {
                uniforms.fogDensity.setValue(fog.density);
                uniforms.fogType.setValue(2);
                sceneFogType = 2;
            }
        } else {
            uniforms.fogType.setValue(0);
            sceneFogType = 0;
        }

        // render
        var scale = [];

        for (var i = 0, l = sprites.length; i < l; i++) {
            var sprite = sprites[i].object;
            var material = sprites[i].material;

            uniforms.alphaTest.setValue(0);
            uniforms.viewMatrix.setValue(camera.viewMatrix.elements);
            uniforms.modelMatrix.setValue(sprite.worldMatrix.elements);

            sprite.worldMatrix.decompose(spritePosition, spriteRotation, spriteScale);

            scale[0] = spriteScale.x;
            scale[1] = spriteScale.y;

            var fogType = 0;

            if (fog && material.fog) {
                fogType = sceneFogType;
            }

            uniforms.fogType.setValue(fogType);

            if (material.diffuseMap !== null) {
                // TODO offset
                // uniforms.uvOffset.setValue(uniforms.uvOffset, material.diffuseMap.offset.x, material.diffuseMap.offset.y);
                // uniforms.uvScale.setValue(uniforms.uvScale, material.diffuseMap.repeat.x, material.diffuseMap.repeat.y);
                uniforms.uvOffset.setValue(0, 0);
                uniforms.uvScale.setValue(1, 1);
            } else {
                uniforms.uvOffset.setValue(0, 0);
                uniforms.uvScale.setValue(1, 1);
            }

            uniforms.opacity.setValue(material.opacity);
            uniforms.color.setValue(material.diffuse.r, material.diffuse.g, material.diffuse.b);

            uniforms.rotation.setValue(material.rotation);
            uniforms.scale.setValue(scale[0], scale[1]);

            this.setStates(material);

            var slot = this.allocTexUnit();
            this.texture.setTexture2D(material.diffuseMap, slot);
            uniforms.map.setValue(slot);

            gl.drawElements(material.drawMode, 6, gl.UNSIGNED_SHORT, 0);

            // reset used tex Unit
            this._usedTextureUnits = 0;
        }

    }

    Renderer.prototype.renderParticles = function(particles) {
        if (particles.length === 0) {
            return;
        }

        var camera = this.cache.camera;
        var gl = this.gl;
        var state = this.state;

        for (var i = 0, l = particles.length; i < l; i++) {
            var particle = particles[i].object;
            var geometry = particles[i].geometry;
            var material = particles[i].material;

            var program = zen3d.getProgram(gl, this, material);
            state.setProgram(program);

            this.geometry.setGeometry(geometry);
            this.setupVertexAttributes(program, geometry);

            var uniforms = program.uniforms;
            uniforms.uTime.setValue(particle.time);
            uniforms.uScale.setValue(1);

            uniforms.u_Projection.setValue(camera.projectionMatrix.elements);
            uniforms.u_View.setValue(camera.viewMatrix.elements);
            uniforms.u_Model.setValue(particle.worldMatrix.elements);

            var slot = this.allocTexUnit();
            this.texture.setTexture2D(particle.particleNoiseTex, slot);
            uniforms.tNoise.setValue(slot);

            var slot = this.allocTexUnit();
            this.texture.setTexture2D(particle.particleSpriteTex, slot);
            uniforms.tSprite.setValue(slot);

            this.setStates(material);

            gl.drawArrays(material.drawMode, 0, geometry.getAttribute("a_Position").count);

            this._usedTextureUnits = 0;
        }
    }

    /**
     * upload skeleton uniforms
     */
    Renderer.prototype.uploadSkeleton = function(uniforms, object, programId) {
        if(object.skeleton && object.skeleton.bones.length > 0) {
            var skeleton = object.skeleton;
            var gl = this.gl;

            if(this.capabilities.maxVertexTextures > 0 && this.capabilities.floatTextures) {
                if(skeleton.boneTexture === undefined) {
                    var size = Math.sqrt(skeleton.bones.length * 4);
                    size = zen3d.nextPowerOfTwo(Math.ceil(size));
                    size = Math.max(4, size);

                    var boneMatrices = new Float32Array(size * size * 4);
                    boneMatrices.set(skeleton.boneMatrices);

                    var boneTexture = new zen3d.TextureData(boneMatrices, size, size);

                    skeleton.boneMatrices = boneMatrices;
                    skeleton.boneTexture = boneTexture;
                    skeleton.boneTextureSize = size;
                }

                var slot = this.allocTexUnit();
                this.texture.setTexture2D(skeleton.boneTexture, slot);

                if(uniforms["boneTexture"]) {
                    uniforms["boneTexture"].setValue(slot);
                }

                if(uniforms["boneTextureSize"]) {
                    uniforms["boneTextureSize"].setValue(skeleton.boneTextureSize);
                }
            } else {
                // TODO a cache for uniform location
                var location = gl.getUniformLocation(programId, "boneMatrices");
                gl.uniformMatrix4fv(location, false, skeleton.boneMatrices);
            }
        }
    }

    var directShadowMaps = [];
    var pointShadowMaps = [];
    var spotShadowMaps = [];

    /**
     * upload lights uniforms
     * TODO a better function for array & struct uniforms upload
     */
    Renderer.prototype.uploadLights = function(uniforms, lights, receiveShadow, camera, programId) {
        var gl = this.gl;

        if(lights.ambientsNum > 0) {
            uniforms.u_AmbientLightColor.set(lights.ambient);
        }

        for (var k = 0; k < lights.directsNum; k++) {
            var light = lights.directional[k];

            var u_Directional_direction = uniforms["u_Directional[" + k + "].direction"];
            u_Directional_direction.set(light.direction);
            var u_Directional_intensity = uniforms["u_Directional[" + k + "].intensity"];
            u_Directional_intensity.setValue(1);
            var u_Directional_color = uniforms["u_Directional[" + k + "].color"];
            u_Directional_color.set(light.color);

            var shadow = light.shadow && receiveShadow;

            var u_Directional_shadow = uniforms["u_Directional[" + k + "].shadow"];
            u_Directional_shadow.setValue(shadow ? 1 : 0);

            if(shadow) {
                var u_Directional_shadowBias = uniforms["u_Directional[" + k + "].shadowBias"];
                u_Directional_shadowBias.setValue(light.shadowBias);
                var u_Directional_shadowRadius = uniforms["u_Directional[" + k + "].shadowRadius"];
                u_Directional_shadowRadius.setValue(light.shadowRadius);
                var u_Directional_shadowMapSize = uniforms["u_Directional[" + k + "].shadowMapSize"];
                u_Directional_shadowMapSize.set(light.shadowMapSize);

                var slot = this.allocTexUnit();
                this.texture.setTexture2D(lights.directionalShadowMap[k], slot);
                directShadowMaps[k] = slot;
            }
        }
        if(directShadowMaps.length > 0) {
            var directionalShadowMap = uniforms["directionalShadowMap[0]"];
            gl.uniform1iv(directionalShadowMap.location, directShadowMaps);

            directShadowMaps.length = 0;

            var directionalShadowMatrix = uniforms["directionalShadowMatrix[0]"];
            gl.uniformMatrix4fv(directionalShadowMatrix.location, false, lights.directionalShadowMatrix);
        }

        for (var k = 0; k < lights.pointsNum; k++) {
            var light = lights.point[k];

            var u_Point_position = uniforms["u_Point[" + k + "].position"];
            u_Point_position.set(light.position);
            var u_Point_intensity = uniforms["u_Point[" + k + "].intensity"];
            u_Point_intensity.setValue(1);
            var u_Point_color = uniforms["u_Point[" + k + "].color"];
            u_Point_color.set(light.color);
            var u_Point_distance = uniforms["u_Point[" + k + "].distance"];
            u_Point_distance.setValue(light.distance);
            var u_Point_decay = uniforms["u_Point[" + k + "].decay"];
            u_Point_decay.setValue(light.decay);

            var shadow = light.shadow && receiveShadow;

            var u_Point_shadow = uniforms["u_Point[" + k + "].shadow"];
            u_Point_shadow.setValue(shadow ? 1 : 0);

            if (shadow) {
                var u_Point_shadowBias = uniforms["u_Point[" + k + "].shadowBias"];
                u_Point_shadowBias.setValue(light.shadowBias);
                var u_Point_shadowRadius = uniforms["u_Point[" + k + "].shadowRadius"];
                u_Point_shadowRadius.setValue(light.shadowRadius);
                var u_Point_shadowMapSize = uniforms["u_Point[" + k + "].shadowMapSize"];
                u_Point_shadowMapSize.set(light.shadowMapSize);
                var u_Point_shadowCameraNear = uniforms["u_Point[" + k + "].shadowCameraNear"];
                u_Point_shadowCameraNear.setValue(light.shadowCameraNear);
                var u_Point_shadowCameraFar = uniforms["u_Point[" + k + "].shadowCameraFar"];
                u_Point_shadowCameraFar.setValue(light.shadowCameraFar);

                var slot = this.allocTexUnit();
                this.texture.setTextureCube(lights.pointShadowMap[k], slot);
                pointShadowMaps[k] = slot;
            }
        }
        if(pointShadowMaps.length > 0) {
            var pointShadowMap = uniforms["pointShadowMap[0]"];
            gl.uniform1iv(pointShadowMap.location, pointShadowMaps);

            pointShadowMaps.length = 0;
        }

        for (var k = 0; k < lights.spotsNum; k++) {
            var light = lights.spot[k];

            var u_Spot_position = uniforms["u_Spot[" + k + "].position"];
            u_Spot_position.set(light.position);
            var u_Spot_direction = uniforms["u_Spot[" + k + "].direction"];
            u_Spot_direction.set(light.direction);
            var u_Spot_intensity = uniforms["u_Spot[" + k + "].intensity"];
            u_Spot_intensity.setValue(1);
            var u_Spot_color = uniforms["u_Spot[" + k + "].color"];
            u_Spot_color.set(light.color);
            var u_Spot_distance = uniforms["u_Spot[" + k + "].distance"];
            u_Spot_distance.setValue(light.distance);
            var u_Spot_decay = uniforms["u_Spot[" + k + "].decay"];
            u_Spot_decay.setValue(light.decay);
            var u_Spot_coneCos = uniforms["u_Spot[" + k + "].coneCos"];
            u_Spot_coneCos.setValue(light.coneCos);
            var u_Spot_penumbraCos = uniforms["u_Spot[" + k + "].penumbraCos"];
            u_Spot_penumbraCos.setValue(light.penumbraCos);

            var shadow = light.shadow && receiveShadow;

            var u_Spot_shadow = uniforms["u_Spot[" + k + "].shadow"];
            u_Spot_shadow.setValue(shadow ? 1 : 0);

            if (shadow) {
                var u_Spot_shadowBias = uniforms["u_Spot[" + k + "].shadowBias"];
                u_Spot_shadowBias.setValue(light.shadowBias);
                var u_Spot_shadowRadius = uniforms["u_Spot[" + k + "].shadowRadius"];
                u_Spot_shadowRadius.setValue(light.shadowRadius);
                var u_Spot_shadowMapSize = uniforms["u_Spot[" + k + "].shadowMapSize"];
                u_Spot_shadowMapSize.set(light.shadowMapSize);

                var slot = this.allocTexUnit();
                this.texture.setTexture2D(lights.spotShadowMap[k], slot);
                spotShadowMaps[k] = slot;
            }
        }
        if(spotShadowMaps.length > 0) {
            var spotShadowMap = uniforms["spotShadowMap[0]"];
            gl.uniform1iv(spotShadowMap.location, spotShadowMaps);

            spotShadowMaps.length = 0;

            var spotShadowMatrix = uniforms["spotShadowMatrix[0]"];
            gl.uniformMatrix4fv(spotShadowMatrix.location, false, lights.spotShadowMatrix);
        }
    }

    /**
     * set states
     * @param {boolean} frontFaceCW
     */
    Renderer.prototype.setStates = function(material, frontFaceCW) {
        var gl = this.gl;
        var state = this.state;

        // set blend
        if (material.transparent) {
            state.setBlend(material.blending, material.premultipliedAlpha);
        } else {
            state.setBlend(BLEND_TYPE.NONE);
        }

        // set depth test
        if (material.depthTest) {
            state.enable(gl.DEPTH_TEST);
            state.depthMask(material.depthWrite);
        } else {
            state.disable(gl.DEPTH_TEST);
        }

        // set draw side
        state.setCullFace(
            (material.side === DRAW_SIDE.DOUBLE) ? CULL_FACE_TYPE.NONE : CULL_FACE_TYPE.BACK
        );

        var flipSided = ( material.side === DRAW_SIDE.BACK );
		if ( frontFaceCW ) flipSided = ! flipSided;

        state.setFlipSided(flipSided);

        // set line width
        if(material.lineWidth !== undefined) {
            state.setLineWidth(material.lineWidth);
        }
    }

    /**
     * gl draw
     */
    Renderer.prototype.draw = function(geometry, material, group) {
        var gl = this.gl;

        var useIndexBuffer = geometry.index !== null;

        var drawStart = 0;
        var drawCount = useIndexBuffer ? geometry.index.count : geometry.getAttribute("a_Position").count;
        var groupStart = group ? group.start : 0;
        var groupCount = group ? group.count : Infinity;
        drawStart = Math.max(drawStart, groupStart);
        drawCount = Math.min(drawCount, groupCount);

        if(useIndexBuffer) {
            gl.drawElements(material.drawMode, drawCount, gl.UNSIGNED_SHORT, drawStart * 2);
        } else {
            gl.drawArrays(material.drawMode, drawStart, drawCount);
        }
    }

    /**
     * set render target
     */
    Renderer.prototype.setRenderTarget = function(target) {
        var gl = this.gl;

        if (!target) {
            if (this._currentRenderTarget === target) {

            } else {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);

                this._currentRenderTarget = null;

                this.state.viewport(
                    this._currentViewport.x,
                    this._currentViewport.y,
                    this._currentViewport.z,
                    this._currentViewport.w);
            }

            return;
        }

        var isCube = target.activeCubeFace !== undefined;

        if (this._currentRenderTarget !== target) {
            if (!isCube) {
                this.texture.setRenderTarget2D(target);
            } else {
                this.texture.setRenderTargetCube(target);
            }

            this._currentRenderTarget = target;
        } else {
            if (isCube) {
                var textureProperties = this.properties.get(target.texture);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + target.activeCubeFace, textureProperties.__webglTexture, 0);
            }
        }

        this.state.viewport(0, 0, target.width, target.height);
    }

    Renderer.prototype.getCurrentRenderTarget = function() {
        return this._currentRenderTarget;
    }

    /**
     * clear buffer
     */
    Renderer.prototype.clear = function(color, depth, stencil) {
        var gl = this.gl;

        var bits = 0;

        if (color === undefined || color) bits |= gl.COLOR_BUFFER_BIT;
        if (depth === undefined || depth) bits |= gl.DEPTH_BUFFER_BIT;
        if (stencil === undefined || stencil) bits |= gl.STENCIL_BUFFER_BIT;

        gl.clear(bits);
    }

    /**
     * alloc texture unit
     **/
    Renderer.prototype.allocTexUnit = function() {
        var textureUnit = this._usedTextureUnits;

        if (textureUnit >= this.capabilities.maxTextures) {

            console.warn('trying to use ' + textureUnit + ' texture units while this GPU supports only ' + this.capabilities.maxTextures);

        }

        this._usedTextureUnits += 1;

        return textureUnit;
    }

    Renderer.prototype.setupVertexAttributes = function(program, geometry) {
        var gl = this.gl;
        var attributes = program.attributes;
        var properties = this.properties;
        for (var key in attributes) {
            var programAttribute = attributes[key];
            var geometryAttribute = geometry.getAttribute(key);
            if(geometryAttribute) {
                var normalized = geometryAttribute.normalized;
				var size = geometryAttribute.size;
                if(programAttribute.count !== size) {
                    console.warn("Renderer: attribute " + key + " size not match! " + programAttribute.count + " : " + size);
                }

                var attribute;
                if(geometryAttribute.isInterleavedBufferAttribute) {
                    attribute = properties.get(geometryAttribute.data);
                } else {
                    attribute = properties.get(geometryAttribute);
                }
                var buffer = attribute.buffer;
				var type = attribute.type;
                if(programAttribute.format !== type) {
                    console.warn("Renderer: attribute " + key + " type not match! " + programAttribute.format + " : " + type);
                }
				var bytesPerElement = attribute.bytesPerElement;

                if(geometryAttribute.isInterleavedBufferAttribute) {
                    var data = geometryAttribute.data;
    				var stride = data.stride;
    				var offset = geometryAttribute.offset;

                    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                    gl.vertexAttribPointer(programAttribute.location, programAttribute.count, programAttribute.format, normalized, bytesPerElement * stride, bytesPerElement * offset);
                    gl.enableVertexAttribArray(programAttribute.location);
                } else {
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                    gl.vertexAttribPointer(programAttribute.location, programAttribute.count, programAttribute.format, normalized, 0, 0);
                    gl.enableVertexAttribArray(programAttribute.location);
                }
            } else {
                console.warn("Renderer: geometry attribute " + key + " not found!");
            }
        }

        // TODO bind index if could
        if(geometry.index) {
            var indexProperty = properties.get(geometry.index);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexProperty.buffer);
        }
    }

    zen3d.Renderer = Renderer;
})();