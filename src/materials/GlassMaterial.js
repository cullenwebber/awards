import * as THREE from "three";

class GlassMaterial extends THREE.ShaderMaterial {
	constructor(options = {}) {
		const uniforms = {
			uTexture: { value: null },
			uEnvMap: { value: options.envMap || null },
			uIorR: { value: options.iorR || 1.15 },
			uIorY: { value: options.iorY || 1.16 },
			uIorG: { value: options.iorG || 1.18 },
			uIorC: { value: options.iorC || 1.22 },
			uIorB: { value: options.iorB || 1.22 },
			uIorP: { value: options.iorP || 1.22 },
			uRefractPower: { value: options.refraction || 0.1 },
			uChromaticAberration: { value: options.chromaticAberration || 0.4 },
			uFrost: { value: options.frost ?? 0.0 },
			uSaturation: { value: options.saturation || 1.0 },
			uShininess: { value: options.shininess || 80.0 },
			uDiffuseness: { value: options.diffuseness || 0.06 },
			uFresnelPower: { value: options.fresnelPower || 8.0 },
			uReflectivity: { value: options.reflectivity || 0.5 },
			uScratchMap: { value: options.scratchMap || null },
			uScratchScale: { value: options.scratchScale || 2.0 },
			uScratchStrength: { value: options.scratchStrength ?? 1.0 },
			uLight: { value: options.light || new THREE.Vector3(-1.0, 1.0, 1.0) },
			uColor: {
				value: options.color
					? new THREE.Color(options.color)
					: new THREE.Color(1.0, 1.0, 1.0),
			},
			uColorTop: {
				value: options.colorTop
					? new THREE.Color(options.colorTop)
					: new THREE.Color(options.color || new THREE.Color(1.0, 1.0, 1.0)),
			},
			uGradientLow: { value: options.gradientLow ?? -0.5 },
			uGradientHigh: { value: options.gradientHigh ?? 0.5 },
			winResolution: {
				value: new THREE.Vector2(
					window.innerWidth,
					window.innerHeight,
				).multiplyScalar(Math.min(window.devicePixelRatio, 2)),
			},
		};

		super({
			vertexShader: GlassMaterial.vertexShader(),
			fragmentShader: GlassMaterial.fragmentShader(),
			uniforms,
		});

		this.frontRenderTarget = null;
		this.backRenderTarget = null;
		this.createRenderTargets();
	}

	static vertexShader() {
		return /*glsl*/ `
            varying vec3 worldNormal;
            varying vec3 eyeVector;
            varying vec3 vWorldPosition;
            varying vec2 vUv;

            void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vec4 mvPosition = viewMatrix * worldPos;

            gl_Position = projectionMatrix * mvPosition;

            worldNormal = normalize(modelMatrix * vec4(normal, 0.0)).xyz;
            eyeVector = normalize(worldPos.xyz - cameraPosition);
            vWorldPosition = worldPos.xyz;
            vUv = uv;
        }`;
	}

	static fragmentShader() {
		return /*glsl*/ `
            uniform float uIorR;
            uniform float uIorY;
            uniform float uIorG;
            uniform float uIorC;
            uniform float uIorB;
            uniform float uIorP;

            uniform float uSaturation;
            uniform float uChromaticAberration;
            uniform float uFrost;
            uniform float uRefractPower;
            uniform float uFresnelPower;
            uniform float uShininess;
            uniform float uDiffuseness;
            uniform vec3 uLight;
            uniform vec3 uColor;
            uniform vec3 uColorTop;
            uniform float uGradientLow;
            uniform float uGradientHigh;
            uniform float uReflectivity;
            uniform sampler2D uScratchMap;
            uniform float uScratchScale;
            uniform float uScratchStrength;

            uniform vec2 winResolution;
            uniform sampler2D uTexture;
            uniform samplerCube uEnvMap;

            varying vec3 worldNormal;
            varying vec3 eyeVector;
            varying vec3 vWorldPosition;
            varying vec2 vUv;

            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
            }

            vec3 sat(vec3 rgb, float adjustment) {
                const vec3 W = vec3(0.2125, 0.7154, 0.0721);
                vec3 intensity = vec3(dot(rgb, W));
                return mix(intensity, rgb, adjustment);
            }

            float fresnel(vec3 eyeVector, vec3 worldNormal, float power) {
                float fresnelFactor = abs(dot(eyeVector, worldNormal));
                float inversefresnelFactor = 1.0 - fresnelFactor;
                return pow(inversefresnelFactor, power);
            }

            float specular(vec3 light, float shininess, float diffuseness) {
                vec3 normal = worldNormal;
                vec3 lightVector = normalize(-light);
                vec3 halfVector = normalize(eyeVector + lightVector);
                float NdotL = dot(normal, lightVector);
                float NdotH = dot(normal, halfVector);
                float kDiffuse = max(0.0, NdotL);
                float NdotH2 = NdotH * NdotH;
                float kSpecular = pow(NdotH2, shininess);
                return kSpecular + kDiffuse * diffuseness;
            }

            const int LOOP = 8;

            void main() {
                vec2 uv = gl_FragCoord.xy / winResolution.xy;
                vec3 normal = worldNormal;
                vec3 color = vec3(0.0);

                // Isolate the bright scratch streaks from the gray base.
                float scratch = smoothstep(0.5, 1.0, texture2D(uScratchMap, vUv * uScratchScale).r);

                for (int i = 0; i < LOOP; i++) {
                    float slide = float(i) / float(LOOP) * 0.03;

                    // Frost: scatter each tap by a random offset so the 8-tap
                    // loop becomes a blur, mimicking a rough/etched surface.
                    vec2 frost = (vec2(
                        hash(gl_FragCoord.xy + float(i) * 1.7),
                        hash(gl_FragCoord.xy + float(i) * 3.1 + 19.0)
                    ) - 0.5) * (uFrost + scratch * uScratchStrength) * 0.1;
                    vec2 uvF = uv + frost;

                    vec3 refractVecR = refract(eyeVector, normal, (1.0/uIorR));
                    vec3 refractVecY = refract(eyeVector, normal, (1.0/uIorY));
                    vec3 refractVecG = refract(eyeVector, normal, (1.0/uIorG));
                    vec3 refractVecC = refract(eyeVector, normal, (1.0/uIorC));
                    vec3 refractVecB = refract(eyeVector, normal, (1.0/uIorB));
                    vec3 refractVecP = refract(eyeVector, normal, (1.0/uIorP));

                    float r = texture2D(uTexture, uvF + refractVecR.xy * (uRefractPower + slide * 1.0) * uChromaticAberration).x * 0.5;

                    float y = (texture2D(uTexture, uvF + refractVecY.xy * (uRefractPower + slide * 1.0) * uChromaticAberration).x * 2.0 +
                                texture2D(uTexture, uvF + refractVecY.xy * (uRefractPower + slide * 1.0) * uChromaticAberration).y * 2.0 -
                                texture2D(uTexture, uvF + refractVecY.xy * (uRefractPower + slide * 1.0) * uChromaticAberration).z) / 6.0;

                    float g = texture2D(uTexture, uvF + refractVecG.xy * (uRefractPower + slide * 2.0) * uChromaticAberration).y * 0.5;

                    float c = (texture2D(uTexture, uvF + refractVecC.xy * (uRefractPower + slide * 2.5) * uChromaticAberration).y * 2.0 +
                                texture2D(uTexture, uvF + refractVecC.xy * (uRefractPower + slide * 2.5) * uChromaticAberration).z * 2.0 -
                                texture2D(uTexture, uvF + refractVecC.xy * (uRefractPower + slide * 2.5) * uChromaticAberration).x) / 6.0;

                    float b = texture2D(uTexture, uvF + refractVecB.xy * (uRefractPower + slide * 3.0) * uChromaticAberration).z * 0.5;

                    float p = (texture2D(uTexture, uvF + refractVecP.xy * (uRefractPower + slide * 1.0) * uChromaticAberration).z * 2.0 +
                                texture2D(uTexture, uvF + refractVecP.xy * (uRefractPower + slide * 1.0) * uChromaticAberration).x * 2.0 -
                                texture2D(uTexture, uvF + refractVecP.xy * (uRefractPower + slide * 1.0) * uChromaticAberration).y) / 6.0;

                    float R = r + (2.0*p + 2.0*y - c)/3.0;
                    float G = g + (2.0*y + 2.0*c - p)/3.0;
                    float B = b + (2.0*c + 2.0*p - y)/3.0;

                    color.r += R;
                    color.g += G;
                    color.b += B;
                }

                // Normalize by loop count first
                color /= float(LOOP);

                // Then apply saturation once to the final color
                color = sat(color, uSaturation);

                float specularLight = specular(uLight, uShininess, uDiffuseness);
                color += specularLight;

                // Calculate reflection
                vec3 reflectVec = reflect(eyeVector, normal);
                vec4 envColor = textureCube(uEnvMap, reflectVec);

                // Fresnel for reflection strength
                float f = fresnel(eyeVector, normal, uFresnelPower);

                // Mix refraction with reflection based on fresnel and reflectivity
                color = mix(color, envColor.rgb, f * uReflectivity);

                // Add fresnel rim light
                color.rgb += f * vec3(0.1);

                // Scratches catch the light so the micro-abrasions glint.
                color += scratch * uScratchStrength * (f * 0.5 + 0.15);

                // Vertical gradient tint: blend bottom -> top color by world height.
                float gradT = smoothstep(uGradientLow, uGradientHigh, vWorldPosition.y);
                vec3 tint = mix(uColor, uColorTop, gradT);

                // Apply base color tint with reduced influence
                color = mix(color * 0.8, color * tint, 0.7);

                // Frosted scattering: lift toward a milky tint so the glass
                // reads as translucent/etched rather than clear.
                vec3 milk = mix(color, tint, 0.5) + 0.15;
                color = mix(color, milk, clamp(uFrost, 0.0, 1.0));

                gl_FragColor = vec4(color, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
            `;
	}

	createRenderTargets() {
		const pixelRatio = Math.min(window.devicePixelRatio, 2);
		const width = window.innerWidth * pixelRatio;
		const height = window.innerHeight * pixelRatio;

		this.frontRenderTarget = new THREE.WebGLRenderTarget(width, height, {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBFormat,
			stencilBuffer: false,
		});
		this.backRenderTarget = new THREE.WebGLRenderTarget(width, height, {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBFormat,
			stencilBuffer: false,
		});
	}

	renderPasses(renderer, scene, camera, meshes, excludeMeshes = []) {
		meshes.forEach((mesh) => (mesh.visible = false));
		// Hide meshes that sit in front of the glass (e.g. text) so they are
		// not captured into the refraction targets and end up refracting inside
		// the glass. They are restored before the final on-screen render.
		excludeMeshes.forEach((mesh) => (mesh.visible = false));

		// Render scene without glass to backside render target
		renderer.setRenderTarget(this.backRenderTarget);
		renderer.clear();
		renderer.render(scene, camera);

		// Show glass with backside texture
		meshes.forEach((mesh) => {
			mesh.material.texture = this.backRenderTarget.texture;
			mesh.material.side = THREE.BackSide;
			mesh.visible = true;
		});

		// Render scene with backside glass to front render target
		renderer.setRenderTarget(this.frontRenderTarget);
		renderer.clear();
		renderer.render(scene, camera);

		// Switch glass to frontside texture
		meshes.forEach((mesh) => {
			mesh.material.texture = this.frontRenderTarget.texture;
			mesh.material.side = THREE.FrontSide;
		});

		// Restore the excluded meshes so they draw on top in the main render.
		excludeMeshes.forEach((mesh) => (mesh.visible = true));

		// Reset to default framebuffer
		renderer.setRenderTarget(null);
	}

	set texture(value) {
		this.uniforms.uTexture.value = value;
	}

	get texture() {
		return this.uniforms.uTexture.value;
	}

	set iorR(value) {
		this.uniforms.uIorR.value = value;
	}

	get iorR() {
		return this.uniforms.uIorR.value;
	}

	set iorY(value) {
		this.uniforms.uIorY.value = value;
	}

	get iorY() {
		return this.uniforms.uIorY.value;
	}

	set iorG(value) {
		this.uniforms.uIorG.value = value;
	}

	get iorG() {
		return this.uniforms.uIorG.value;
	}

	set iorC(value) {
		this.uniforms.uIorC.value = value;
	}

	get iorC() {
		return this.uniforms.uIorC.value;
	}

	set iorB(value) {
		this.uniforms.uIorB.value = value;
	}

	get iorB() {
		return this.uniforms.uIorB.value;
	}

	set iorP(value) {
		this.uniforms.uIorP.value = value;
	}

	get iorP() {
		return this.uniforms.uIorP.value;
	}

	set refraction(value) {
		this.uniforms.uRefractPower.value = value;
	}

	get refraction() {
		return this.uniforms.uRefractPower.value;
	}

	set chromaticAberration(value) {
		this.uniforms.uChromaticAberration.value = value;
	}

	get chromaticAberration() {
		return this.uniforms.uChromaticAberration.value;
	}

	set frost(value) {
		this.uniforms.uFrost.value = value;
	}

	get frost() {
		return this.uniforms.uFrost.value;
	}

	set saturation(value) {
		this.uniforms.uSaturation.value = value;
	}

	get saturation() {
		return this.uniforms.uSaturation.value;
	}

	set shininess(value) {
		this.uniforms.uShininess.value = value;
	}

	get shininess() {
		return this.uniforms.uShininess.value;
	}

	set diffuseness(value) {
		this.uniforms.uDiffuseness.value = value;
	}

	get diffuseness() {
		return this.uniforms.uDiffuseness.value;
	}

	set fresnelPower(value) {
		this.uniforms.uFresnelPower.value = value;
	}

	get fresnelPower() {
		return this.uniforms.uFresnelPower.value;
	}

	set light(value) {
		this.uniforms.uLight.value = value;
	}

	get light() {
		return this.uniforms.uLight.value;
	}

	set color(value) {
		if (typeof value === "string" || typeof value === "number") {
			this.uniforms.uColor.value.set(value);
		} else {
			this.uniforms.uColor.value.copy(value);
		}
	}

	get color() {
		return this.uniforms.uColor.value;
	}

	set colorTop(value) {
		if (typeof value === "string" || typeof value === "number") {
			this.uniforms.uColorTop.value.set(value);
		} else {
			this.uniforms.uColorTop.value.copy(value);
		}
	}

	get colorTop() {
		return this.uniforms.uColorTop.value;
	}

	// Set the world-space Y range the gradient spans (bottom, top).
	setGradientBounds(low, high) {
		this.uniforms.uGradientLow.value = low;
		this.uniforms.uGradientHigh.value = high;
	}

	set scratchMap(value) {
		this.uniforms.uScratchMap.value = value;
	}

	get scratchMap() {
		return this.uniforms.uScratchMap.value;
	}

	set scratchStrength(value) {
		this.uniforms.uScratchStrength.value = value;
	}

	get scratchStrength() {
		return this.uniforms.uScratchStrength.value;
	}

	set scratchScale(value) {
		this.uniforms.uScratchScale.value = value;
	}

	get scratchScale() {
		return this.uniforms.uScratchScale.value;
	}

	set envMap(value) {
		this.uniforms.uEnvMap.value = value;
	}

	get envMap() {
		return this.uniforms.uEnvMap.value;
	}

	set reflectivity(value) {
		this.uniforms.uReflectivity.value = value;
	}

	get reflectivity() {
		return this.uniforms.uReflectivity.value;
	}

	updateResolution(width, height, pixelRatio = window.devicePixelRatio) {
		const ratio = Math.min(pixelRatio, 2);
		this.uniforms.winResolution.value.set(width, height).multiplyScalar(ratio);

		// Keep the refraction targets matched to the drawing buffer size.
		this.frontRenderTarget?.setSize(width * ratio, height * ratio);
		this.backRenderTarget?.setSize(width * ratio, height * ratio);
	}
}

export default GlassMaterial;
