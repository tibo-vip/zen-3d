(function(){
zen3d.ShaderChunk = {
RE_BlinnPhong: "void RE_BlinnPhong(vec4 k, vec4 light, vec3 N, vec3 L, vec3 V, float n_s, inout vec4 reflectLight) {\n    vec3 H = normalize(L + V);\n    reflectLight += k * light * pow(max(dot(N, H), 0.), n_s);\n}",
RE_Lambert: "void RE_Lambert(vec4 k, vec4 light, vec3 N, vec3 L, inout vec4 reflectLight) {\n    float dotNL = max(dot(N, L), 0.);\n    reflectLight += k * light * dotNL;\n}",
RE_Phong: "void RE_Phong(vec4 k, vec4 light, vec3 N, vec3 L, vec3 V, float n_s, inout vec4 reflectLight) {\n    vec3 R = max(dot(2.0 * N, L), 0.) * N - L;\n    reflectLight += k * light * pow(max(dot(V, R), 0.), n_s);\n}",
ambientlight_pars_frag: "struct AmbientLight\n{\n    vec4 color;\n    float intensity;\n};\nuniform AmbientLight u_Ambient[USE_AMBIENT_LIGHT];",
begin_frag: "vec4 outColor = vec4(u_Color, u_Opacity);",
begin_vert: "vec3 transformed = vec3(a_Position);\n#if defined(USE_NORMAL) || defined(USE_ENV_MAP)\n    vec3 objectNormal = vec3(a_Normal);\n#endif",
common_frag: "uniform mat4 u_View;\nuniform float u_Opacity;\nuniform vec3 u_Color;\nuniform vec3 u_CameraPosition;",
common_vert: "attribute vec3 a_Position;\nattribute vec3 a_Normal;\n#include <transpose>\n#include <inverse>\nuniform mat4 u_Projection;\nuniform mat4 u_View;\nuniform mat4 u_Model;\nuniform vec3 u_CameraPosition;",
diffuseMap_frag: "#ifdef USE_DIFFUSE_MAP\n    outColor *= texture2D(texture, v_Uv);\n#endif",
diffuseMap_pars_frag: "#ifdef USE_DIFFUSE_MAP\n    uniform sampler2D texture;\n#endif",
directlight_pars_frag: "struct DirectLight\n{\n    vec3 direction;\n    vec4 color;\n    float intensity;\n    int shadow;\n};\nuniform DirectLight u_Directional[USE_DIRECT_LIGHT];",
end_frag: "gl_FragColor = outColor;",
envMap_frag: "#ifdef USE_ENV_MAP\n    vec4 envColor = textureCube(envMap, v_EnvPos);\n    outColor += envColor * u_EnvMap_Intensity;\n#endif",
envMap_pars_frag: "#ifdef USE_ENV_MAP\n    varying vec3 v_EnvPos;\n    uniform samplerCube envMap;\n    uniform float u_EnvMap_Intensity;\n#endif",
envMap_pars_vert: "#ifdef USE_ENV_MAP\n    varying vec3 v_EnvPos;\n#endif",
envMap_vert: "#ifdef USE_ENV_MAP\n    v_EnvPos = reflect(normalize((u_Model * vec4(transformed, 1.0)).xyz - u_CameraPosition), (transpose(inverse(u_Model)) * vec4(objectNormal, 1.0)).xyz);\n#endif",
fog_frag: "#ifdef USE_FOG\n    float depth = gl_FragCoord.z / gl_FragCoord.w;\n    #ifdef USE_EXP2_FOG\n        float fogFactor = whiteCompliment( exp2( - u_FogDensity * u_FogDensity * depth * depth * LOG2 ) );\n    #else\n        float fogFactor = smoothstep( u_FogNear, u_FogFar, depth );\n    #endif\n    gl_FragColor.rgb = mix( gl_FragColor.rgb, u_FogColor, fogFactor );\n#endif",
fog_pars_frag: "#ifdef USE_FOG\n    uniform vec3 u_FogColor;\n    #ifdef USE_EXP2_FOG\n        uniform float u_FogDensity;\n    #else\n        uniform float u_FogNear;\n        uniform float u_FogFar;\n    #endif\n#endif",
inverse: "mat4 inverse(mat4 m) {\n    float\n    a00 = m[0][0], a01 = m[0][1], a02 = m[0][2], a03 = m[0][3],\n    a10 = m[1][0], a11 = m[1][1], a12 = m[1][2], a13 = m[1][3],\n    a20 = m[2][0], a21 = m[2][1], a22 = m[2][2], a23 = m[2][3],\n    a30 = m[3][0], a31 = m[3][1], a32 = m[3][2], a33 = m[3][3],\n    b00 = a00 * a11 - a01 * a10,\n    b01 = a00 * a12 - a02 * a10,\n    b02 = a00 * a13 - a03 * a10,\n    b03 = a01 * a12 - a02 * a11,\n    b04 = a01 * a13 - a03 * a11,\n    b05 = a02 * a13 - a03 * a12,\n    b06 = a20 * a31 - a21 * a30,\n    b07 = a20 * a32 - a22 * a30,\n    b08 = a20 * a33 - a23 * a30,\n    b09 = a21 * a32 - a22 * a31,\n    b10 = a21 * a33 - a23 * a31,\n    b11 = a22 * a33 - a23 * a32,\n    det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;\n    return mat4(\n        a11 * b11 - a12 * b10 + a13 * b09,\n        a02 * b10 - a01 * b11 - a03 * b09,\n        a31 * b05 - a32 * b04 + a33 * b03,\n        a22 * b04 - a21 * b05 - a23 * b03,\n        a12 * b08 - a10 * b11 - a13 * b07,\n        a00 * b11 - a02 * b08 + a03 * b07,\n        a32 * b02 - a30 * b05 - a33 * b01,\n        a20 * b05 - a22 * b02 + a23 * b01,\n        a10 * b10 - a11 * b08 + a13 * b06,\n        a01 * b08 - a00 * b10 - a03 * b06,\n        a30 * b04 - a31 * b02 + a33 * b00,\n        a21 * b02 - a20 * b04 - a23 * b00,\n        a11 * b07 - a10 * b09 - a12 * b06,\n        a00 * b09 - a01 * b07 + a02 * b06,\n        a31 * b01 - a30 * b03 - a32 * b00,\n        a20 * b03 - a21 * b01 + a22 * b00) / det;\n}",
light_frag: "#ifdef USE_LIGHT\n    vec4 light;\n    vec3 L;\n    vec4 reflectLight = vec4(0., 0., 0., 0.);\n    vec4 diffuseColor = outColor.xyzw;\n    #ifdef USE_AMBIENT_LIGHT\n    for(int i = 0; i < USE_AMBIENT_LIGHT; i++) {\n        reflectLight += diffuseColor * u_Ambient[i].color * u_Ambient[i].intensity;\n    }\n    #endif\n    #if defined(USE_PHONG) && ( defined(USE_DIRECT_LIGHT) || defined(USE_POINT_LIGHT) || defined(USE_SPOT_LIGHT) )\n        vec3 V = normalize( (u_View * vec4(u_CameraPosition, 1.)).xyz - v_ViewModelPos);\n    #endif\n    #ifdef USE_DIRECT_LIGHT\n    for(int i = 0; i < USE_DIRECT_LIGHT; i++) {\n        L = -u_Directional[i].direction;\n        light = u_Directional[i].color * u_Directional[i].intensity;\n        L = normalize(L);\n        RE_Lambert(diffuseColor, light, N, L, reflectLight);\n        #ifdef USE_PHONG\n        RE_BlinnPhong(u_SpecularColor, light, N, normalize(L), V, u_Specular, reflectLight);\n        #endif\n    }\n    #endif\n    #ifdef USE_POINT_LIGHT\n    for(int i = 0; i < USE_POINT_LIGHT; i++) {\n        L = u_Point[i].position - v_ViewModelPos;\n        float dist = pow(clamp(1. - length(L) / u_Point[i].distance, 0.0, 1.0), u_Point[i].decay);\n        light = u_Point[i].color * u_Point[i].intensity * dist;\n        L = normalize(L);\n        RE_Lambert(diffuseColor, light, N, L, reflectLight);\n        #ifdef USE_PHONG\n        RE_BlinnPhong(u_SpecularColor, light, N, normalize(L), V, u_Specular, reflectLight);\n        #endif\n    }\n    #endif\n    #ifdef USE_SPOT_LIGHT\n    for(int i = 0; i < USE_SPOT_LIGHT; i++) {\n        L = u_Spot[i].position - v_ViewModelPos;\n        float lightDistance = length(L);\n        L = normalize(L);\n        float angleCos = dot( L, -normalize(u_Spot[i].direction) );\n        if( all( bvec2(angleCos > u_Spot[i].coneCos, lightDistance < u_Spot[i].distance) ) ) {\n            float spotEffect = smoothstep( u_Spot[i].coneCos, u_Spot[i].penumbraCos, angleCos );\n            float dist = pow(clamp(1. - lightDistance / u_Spot[i].distance, 0.0, 1.0), u_Spot[i].decay);\n            light = u_Spot[i].color * u_Spot[i].intensity * dist * spotEffect;\n            RE_Lambert(diffuseColor, light, N, L, reflectLight);\n            #ifdef USE_PHONG\n            RE_BlinnPhong(u_SpecularColor, light, N, normalize(L), V, u_Specular, reflectLight);\n            #endif\n        }\n    }\n    #endif\n    outColor = reflectLight.xyzw;\n#endif",
light_pars_frag: "#ifdef USE_AMBIENT_LIGHT\n    #include <ambientlight_pars_frag>\n#endif\n#ifdef USE_DIRECT_LIGHT\n    #include <directlight_pars_frag>\n#endif\n#ifdef USE_POINT_LIGHT\n    #include <pointlight_pars_frag>\n#endif\n#ifdef USE_SPOT_LIGHT\n    #include <spotlight_pars_frag>\n#endif",
normalMap_pars_frag: "#include <tbn>\n#include <tsn>\nuniform sampler2D normalMap;",
normal_frag: "#ifdef USE_NORMAL\n    vec3 N;\n    #ifdef USE_NORMAL_MAP\n        vec3 normalMapColor = texture2D(normalMap, v_Uv).rgb;\n        mat3 tspace = tsn(normalize(v_Normal), -v_ViewModelPos, vec2(v_Uv.x, 1.0 - v_Uv.y));\n        N = normalize(tspace * (normalMapColor * 2.0 - 1.0));\n    #else\n        N = normalize(v_Normal);\n    #endif\n#endif",
normal_pars_frag: "#ifdef USE_NORMAL\n    varying vec3 v_Normal;\n#endif",
normal_pars_vert: "#ifdef USE_NORMAL\n    varying vec3 v_Normal;\n#endif",
normal_vert: "#ifdef USE_NORMAL\n    v_Normal = (transpose(inverse(u_View * u_Model)) * vec4(objectNormal, 1.0)).xyz;\n#endif",
packing: "const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;\nconst vec3 PackFactors = vec3( 256. * 256. * 256., 256. * 256.,  256. );\nconst vec4 UnpackFactors = UnpackDownscale / vec4( PackFactors, 1. );\nconst float ShiftRight8 = 1. / 256.;\nvec4 packDepthToRGBA( const in float v ) {\n    vec4 r = vec4( fract( v * PackFactors ), v );\n    r.yzw -= r.xyz * ShiftRight8;    return r * PackUpscale;\n}\nfloat unpackRGBAToDepth( const in vec4 v ) {\n    return dot( v, UnpackFactors );\n}",
pointlight_pars_frag: "struct PointLight\n{\n    vec3 position;\n    vec4 color;\n    float intensity;\n    float distance;\n    float decay;\n    int shadow;\n};\nuniform PointLight u_Point[USE_POINT_LIGHT];",
premultipliedAlpha_frag: "#ifdef USE_PREMULTIPLIED_ALPHA\n    gl_FragColor.rgb = gl_FragColor.rgb * gl_FragColor.a;\n#endif",
pvm_vert: "gl_Position = u_Projection * u_View * u_Model * vec4(transformed, 1.0);",
shadowMap_frag: "#ifdef USE_SHADOW\n    outColor *= getShadowMask();\n#endif",
shadowMap_pars_frag: "#ifdef USE_SHADOW\n    #include <packing>\n    #ifdef USE_DIRECT_LIGHT\n        uniform sampler2D directionalShadowMap[ USE_DIRECT_LIGHT ];\n        varying vec4 vDirectionalShadowCoord[ USE_DIRECT_LIGHT ];\n    #endif\n    #ifdef USE_POINT_LIGHT\n        uniform samplerCube pointShadowMap[ USE_POINT_LIGHT ];\n    #endif\n    #ifdef USE_SPOT_LIGHT\n        uniform sampler2D spotShadowMap[ USE_SPOT_LIGHT ];\n        varying vec4 vSpotShadowCoord[ USE_SPOT_LIGHT ];\n    #endif\n    float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {\n        return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );\n    }\n    float textureCubeCompare( samplerCube depths, vec3 uv, float compare ) {\n        return step( compare, unpackRGBAToDepth( textureCube( depths, uv ) ) );\n    }\n    float getShadow( sampler2D shadowMap, vec4 shadowCoord ) {\n        shadowCoord.xyz /= shadowCoord.w;\n        shadowCoord.z += 0.0003;\n        bvec4 inFrustumVec = bvec4 ( shadowCoord.x >= 0.0, shadowCoord.x <= 1.0, shadowCoord.y >= 0.0, shadowCoord.y <= 1.0 );\n        bool inFrustum = all( inFrustumVec );\n        bvec2 frustumTestVec = bvec2( inFrustum, shadowCoord.z <= 1.0 );\n        bool frustumTest = all( frustumTestVec );\n        if ( frustumTest ) {\n            return texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );\n        }\n        return 1.0;\n    }\n    float getPointShadow( samplerCube shadowMap, vec3 V ) {\n        return textureCubeCompare( shadowMap, normalize(V), length(V) / 1000.);\n    }\n    float getShadowMask() {\n        float shadow = 1.0;\n        #ifdef USE_DIRECT_LIGHT\n            for ( int i = 0; i < USE_DIRECT_LIGHT; i ++ ) {\n                shadow *= bool( u_Directional[i].shadow ) ? getShadow( directionalShadowMap[ i ], vDirectionalShadowCoord[ i ] ) : 1.0;\n            }\n        #endif\n        #ifdef USE_POINT_LIGHT\n            for ( int i = 0; i < USE_POINT_LIGHT; i ++ ) {\n                vec3 worldV = (vec4(v_ViewModelPos, 1.) * u_View - vec4(u_Point[i].position, 1.) * u_View).xyz;\n                shadow *= bool( u_Point[i].shadow ) ? getPointShadow( pointShadowMap[ i ], worldV ) : 1.0;\n            }\n        #endif\n        #ifdef USE_SPOT_LIGHT\n            for ( int i = 0; i < USE_SPOT_LIGHT; i ++ ) {\n                shadow *= bool( u_Spot[i].shadow ) ? getShadow( spotShadowMap[ i ], vSpotShadowCoord[ i ] ) : 1.0;\n            }\n        #endif\n        return shadow;\n    }\n#endif",
shadowMap_pars_vert: "#ifdef USE_SHADOW\n    #ifdef USE_DIRECT_LIGHT\n        uniform mat4 directionalShadowMatrix[ USE_DIRECT_LIGHT ];\n        varying vec4 vDirectionalShadowCoord[ USE_DIRECT_LIGHT ];\n    #endif\n    #ifdef USE_POINT_LIGHT\n    #endif\n    #ifdef USE_SPOT_LIGHT\n        uniform mat4 spotShadowMatrix[ USE_SPOT_LIGHT ];\n        varying vec4 vSpotShadowCoord[ USE_SPOT_LIGHT ];\n    #endif\n#endif",
shadowMap_vert: "#ifdef USE_SHADOW\n    vec4 worldPosition = u_Model * vec4(transformed, 1.0);\n    #ifdef USE_DIRECT_LIGHT\n        for ( int i = 0; i < USE_DIRECT_LIGHT; i ++ ) {\n            vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * worldPosition;\n        }\n    #endif\n    #ifdef USE_POINT_LIGHT\n    #endif\n    #ifdef USE_SPOT_LIGHT\n        for ( int i = 0; i < USE_SPOT_LIGHT; i ++ ) {\n            vSpotShadowCoord[ i ] = spotShadowMatrix[ i ] * worldPosition;\n        }\n    #endif\n#endif",
skinning_pars_vert: "#ifdef USE_SKINNING\n    attribute vec4 skinIndex;\n\tattribute vec4 skinWeight;\n    \n    uniform mat4 boneMatrices[MAX_BONES];\n    mat4 getBoneMatrix(const in float i) {\n\t\tmat4 bone = boneMatrices[int(i)];\n\t\treturn bone;\n\t}\n#endif",
skinning_vert: "#ifdef USE_SKINNING\n    mat4 boneMatX = getBoneMatrix( skinIndex.x );\n    mat4 boneMatY = getBoneMatrix( skinIndex.y );\n    mat4 boneMatZ = getBoneMatrix( skinIndex.z );\n    mat4 boneMatW = getBoneMatrix( skinIndex.w );\n    vec4 skinVertex = vec4(transformed, 1.0);\n    vec4 skinned = vec4( 0.0 );\n\tskinned += boneMatX * skinVertex * skinWeight.x;\n\tskinned += boneMatY * skinVertex * skinWeight.y;\n\tskinned += boneMatZ * skinVertex * skinWeight.z;\n\tskinned += boneMatW * skinVertex * skinWeight.w;\n    transformed = vec3(skinned.xyz / skinned.w);\n    #if defined(USE_NORMAL) || defined(USE_ENV_MAP)\n        mat4 skinMatrix = mat4( 0.0 );\n        skinMatrix += skinWeight.x * boneMatX;\n        skinMatrix += skinWeight.y * boneMatY;\n        skinMatrix += skinWeight.z * boneMatZ;\n        skinMatrix += skinWeight.w * boneMatW;\n        objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;\n    #endif\n#endif",
spotlight_pars_frag: "struct SpotLight\n{\n    vec3 position;\n    vec4 color;\n    float intensity;\n    float distance;\n    float decay;\n    float coneCos;\n    float penumbraCos;\n    vec3 direction;\n    int shadow;\n};\nuniform SpotLight u_Spot[USE_SPOT_LIGHT];",
tbn: "mat3 tbn(vec3 N, vec3 p, vec2 uv) {\n    vec3 dp1 = dFdx(p.xyz);\n    vec3 dp2 = dFdy(p.xyz);\n    vec2 duv1 = dFdx(uv.st);\n    vec2 duv2 = dFdy(uv.st);\n    vec3 dp2perp = cross(dp2, N);\n    vec3 dp1perp = cross(N, dp1);\n    vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;\n    vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;\n    float invmax = 1.0 / sqrt(max(dot(T,T), dot(B,B)));\n    return mat3(T * invmax, B * invmax, N);\n}",
transpose: "mat4 transpose(mat4 inMatrix) {\n    vec4 i0 = inMatrix[0];\n    vec4 i1 = inMatrix[1];\n    vec4 i2 = inMatrix[2];\n    vec4 i3 = inMatrix[3];\n    mat4 outMatrix = mat4(\n        vec4(i0.x, i1.x, i2.x, i3.x),\n        vec4(i0.y, i1.y, i2.y, i3.y),\n        vec4(i0.z, i1.z, i2.z, i3.z),\n        vec4(i0.w, i1.w, i2.w, i3.w)\n    );\n    return outMatrix;\n}",
tsn: "mat3 tsn(vec3 N, vec3 V, vec2 uv) {\n    vec3 q0 = dFdx( V.xyz );\n    vec3 q1 = dFdy( V.xyz );\n    vec2 st0 = dFdx( uv.st );\n    vec2 st1 = dFdy( uv.st );\n    vec3 S = normalize( q0 * st1.t - q1 * st0.t );\n    vec3 T = normalize( -q0 * st1.s + q1 * st0.s );\n    mat3 tsn = mat3( S, T, N );\n    return tsn;\n}",
uv_pars_frag: "#if defined(USE_DIFFUSE_MAP) || defined(USE_NORMAL_MAP)\n    varying vec2 v_Uv;\n#endif",
uv_pars_vert: "#if defined(USE_DIFFUSE_MAP) || defined(USE_NORMAL_MAP)\n    attribute vec2 a_Uv;\n    varying vec2 v_Uv;\n#endif",
uv_vert: "#if defined(USE_DIFFUSE_MAP) || defined(USE_NORMAL_MAP)\n    v_Uv = a_Uv;\n#endif",
viewModelPos_pars_frag: "#if defined(USE_POINT_LIGHT) || defined(USE_SPOT_LIGHT) || defined(USE_NORMAL_MAP) || ( defined(USE_PHONG) && defined(USE_DIRECT_LIGHT) )\n    varying vec3 v_ViewModelPos;\n#endif",
viewModelPos_pars_vert: "#if defined(USE_POINT_LIGHT) || defined(USE_SPOT_LIGHT) || defined(USE_NORMAL_MAP) || ( defined(USE_PHONG) && defined(USE_DIRECT_LIGHT) )\n    varying vec3 v_ViewModelPos;\n#endif",
viewModelPos_vert: "#if defined(USE_POINT_LIGHT) || defined(USE_SPOT_LIGHT) || defined(USE_NORMAL_MAP) || ( defined(USE_PHONG) && defined(USE_DIRECT_LIGHT) )\n    v_ViewModelPos = (u_View * u_Model * vec4(transformed, 1.0)).xyz;\n#endif",
}
})();