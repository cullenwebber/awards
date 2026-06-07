import * as THREE from "three";
import WebGLContext from "../core/WebGLContext";
import ImportGltf from "../utils/ImportGltf";
import { CameraRig } from "../utils/CameraRig";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import GlassMaterial from "../materials/GlassMaterial";

export default class Scene {
	constructor() {
		this.context = null;
		this.camera = null;
		this.cameraRig = null;
		this.width = 0;
		this.height = 0;
		this.aspectRatio = 0;
		this.scene = null;
		this.envMap = null;
		this.#init();
	}

	async #init() {
		this.#setContext();
		this.#setupScene();
		this.#setupCamera();
		this.#setupCameraRig();
		this.#addLights();
		await this.#addObjects();
	}

	#setContext() {
		this.context = new WebGLContext();
	}

	#setupScene() {
		this.scene = new THREE.Scene();
		const environment = new RoomEnvironment();
		const pmremGenerator = new THREE.PMREMGenerator(this.context.renderer);
		this.envMap = pmremGenerator.fromScene(environment).texture;
		this.scene.environment = this.envMap;
		this.scene.environmentIntensity = 1.0;
		// this.scene.background = new THREE.Color(0x000000);

		// The glass shader samples a samplerCube, so it needs a real cube
		// texture (the PMREM output is a packed 2D texture and will not
		// reflect correctly). Bake the RoomEnvironment into a cubemap.
		const cubeTarget = new THREE.WebGLCubeRenderTarget(256);
		const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeTarget);
		cubeCamera.update(this.context.renderer, environment);
		this.envCubeMap = cubeTarget.texture;
	}

	#setupCamera() {
		this.#calculateAspectRatio();
		this.camera = new THREE.PerspectiveCamera(45, this.aspectRatio, 1, 100);
		this.camera.position.z = 3;
	}

	#setupCameraRig() {
		this.cameraRig = new CameraRig(this.camera, {
			target: new THREE.Vector3(0, 0, 0),
			xLimit: [-2, 2],
			yLimit: [-0.75, 0.75],
		});
	}

	#addLights() {}

	async #addObjects() {
		const scratchMap = new THREE.TextureLoader().load(
			`${import.meta.env.BASE_URL}scratches-roughness.png`,
		);
		scratchMap.wrapS = scratchMap.wrapT = THREE.RepeatWrapping;
		scratchMap.colorSpace = THREE.NoColorSpace;

		this.glassMaterial = new GlassMaterial({
			envMap: this.envCubeMap,
			scratchMap,
			colorTop: 0xcfeafc,
			color: 0x5fa8e0,
			frost: 0.0,
			saturation: 1,
			chromaticAberration: 0.3,
			refraction: 0.02,
			reflectivity: 1.0,
			scratchStrength: 0.4,
			scratchScale: 1.5,
		});
		const normalMap = new THREE.TextureLoader().load(
			`${import.meta.env.BASE_URL}normal.png`,
		);
		normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
		normalMap.colorSpace = THREE.NoColorSpace;

		this.metalMaterial = new THREE.MeshStandardMaterial({
			normalMap,
			normalScale: new THREE.Vector2(0.075, 0.075),
			color: 0xf7ffe7,
			metalness: 1.0,
			roughness: 0.1,
		});
		this.textMaterial = new THREE.MeshStandardMaterial({
			color: 0xffffff,
			metalness: 1.0,
			roughness: 0.2,
		});
		this.glassMeshes = [];
		this.textMeshes = [];

		new ImportGltf(`${import.meta.env.BASE_URL}award.glb`, {
			onLoad: (model) => {
				this.mesh = model;
				this.mesh.scale.setScalar(0.5);
				this.mesh.rotation.y = Math.PI / 2;

				const body = model.getObjectByName("body");
				const triangle = model.getObjectByName("triangle");

				triangle.material = this.metalMaterial;
				if (body && body.isMesh) {
					body.material = this.glassMaterial;
					this.glassMeshes.push(body);

					// Fit the vertical gradient to the glass world-space height.
					const box = new THREE.Box3().setFromObject(body);
					this.glassMaterial.setGradientBounds(box.min.y, box.max.y);
				}

				// Text sits in front of the glass; keep it out of the
				// refraction passes so it renders on top instead of inside.
				// (three.js strips the "." from names like "Text.001", so we
				// match by prefix rather than exact name.)
				model.traverse((child) => {
					if (child.isMesh && child.name.startsWith("Text")) {
						child.material = this.textMaterial;
						this.textMeshes.push(child);
					}
				});

				this.scene.add(model);
			},
		});
	}

	#calculateAspectRatio() {
		const { width, height } = this.context.getFullScreenDimensions();
		this.width = width;
		this.height = height;
		this.aspectRatio = this.width / this.height;
	}

	animate(delta, elapsed) {
		this.cameraRig?.update(delta);

		if (this.glassMaterial && this.glassMeshes?.length) {
			this.glassMaterial.renderPasses(
				this.context.renderer,
				this.scene,
				this.camera,
				this.glassMeshes,
				this.textMeshes,
			);
		}
	}

	onResize(width, height) {
		this.width = width;
		this.height = height;
		this.aspectRatio = width / height;

		this.camera.aspect = this.aspectRatio;
		this.camera.updateProjectionMatrix();

		this.glassMaterial?.updateResolution(width, height);
	}
}
