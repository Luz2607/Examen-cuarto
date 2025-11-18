// js/escenario.js
import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VRButton } from "three/addons/webxr/VRButton.js";

// --- Escena básica ---
const scene = new THREE.Scene();

// ⭐ Fondo blanco del ambiente
scene.background = new THREE.Color(0xffffff);

// Luces suaves para interior
const hemi = new THREE.HemisphereLight(0xffffff, 0xdddddd, 0.9);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(3, 6, 2);
dir.castShadow = true;
scene.add(dir);

// Cámara y renderer
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);

// posición del "jugador" (x,z) y altura de ojos (y)
const playerPosition = new THREE.Vector3(0, 1.6, 0);
camera.position.copy(playerPosition);

// Renderer
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local");

document.getElementById("app").appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// --- OrbitControls para modo escritorio (solo rotación) ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.4, 0);
controls.enableDamping = true;
controls.enableZoom = false;
controls.enablePan = false;

// --- HUD ---
const hud = document.getElementById("hud");
const btnCerrarHud = document.getElementById("btnCerrarHud");
const btnInfo = document.getElementById("btnInfo");

if (btnCerrarHud) {
  btnCerrarHud.addEventListener("click", () => {
    hud.classList.add("hidden");
  });
}
if (btnInfo) {
  btnInfo.addEventListener("click", () => {
    hud.classList.remove("hidden");
  });
}

// --- Variables para movimiento ---
const moveState = {
  forward: false,
  back: false,
  left: false,
  right: false
};
const moveSpeed = 1.3;      // m/s
const playerRadius = 0.35;  // radio de colisión del jugador

// Límites del cuarto (se ajustan al cargar el modelo)
const roomBounds = {
  xMin: -2,
  xMax:  2,
  zMin: -2,
  zMax:  2
};

// Altura global del piso para usarla en VR / escritorio
let floorY = 0;
let inVR = false;

// --- Teclado (modo no VR) ---
window.addEventListener("keydown", (e) => {
  if (e.key === "w" || e.key === "ArrowUp")    moveState.forward = true;
  if (e.key === "s" || e.key === "ArrowDown")  moveState.back = true;
  if (e.key === "a" || e.key === "ArrowLeft")  moveState.left = true;
  if (e.key === "d" || e.key === "ArrowRight") moveState.right = true;
});

window.addEventListener("keyup", (e) => {
  if (e.key === "w" || e.key === "ArrowUp")    moveState.forward = false;
  if (e.key === "s" || e.key === "ArrowDown")  moveState.back = false;
  if (e.key === "a" || e.key === "ArrowLeft")  moveState.left = false;
  if (e.key === "d" || e.key === "ArrowRight") moveState.right = false;
});

// --- Control VR ---
let xrSession = null;
renderer.xr.addEventListener("sessionstart", () => {
  xrSession = renderer.xr.getSession();
  inVR = true;
  // No tocamos la Y aquí: mantenemos la misma altura que en escritorio
});

renderer.xr.addEventListener("sessionend", () => {
  xrSession = null;
  inVR = false;

  // De vuelta a escritorio: ojos a 1.6 m sobre el piso
  const eyeHeight = 1.6;
  playerPosition.y = floorY + eyeHeight;
  camera.position.y = floorY + eyeHeight;
});

// --- Config local vs GitHub (modelo + texturas) ---
const isLocalhost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const MODEL_URL = isLocalhost
  ? "./assets/models/cuarto_vr.dae"   // tu archivo local
  : "https://media.githubusercontent.com/media/Luz2607/Examen-cuarto-modelo/refs/heads/main/cuarto_vr.dae";
const REMOTE_TEXTURE_BASE =
  "https://raw.githubusercontent.com/Luz2607/Examen-cuarto-modelo/main/cuarto_vr/";

// LoadingManager para reescribir rutas de texturas SOLO en GitHub
const manager = new THREE.LoadingManager();
if (!isLocal) {
  manager.setURLModifier((url) => {
    // Si ya es absoluta (http/https), la dejamos igual
    if (/^https?:\/\//i.test(url)) return url;

    // Si el .dae pide "Carpet_Frieze_Low.jpg"
    // la convertimos a:
    // https://raw.githubusercontent.com/.../cuarto_vr/Carpet_Frieze_Low.jpg
    return REMOTE_TEXTURE_BASE + url;
  });
}

// --- Cargar tu cuarto (COLLADA / DAE) ---
const loader = new ColladaLoader(manager);
loader.load(
  MODEL_URL,
  (collada) => {
    const model = collada.scene;

    // 🔹 Limpiamos líneas / wireframe, sin ocultar muebles
    model.traverse((child) => {
      if (child.type === "Line" || child.type === "LineSegments") {
        child.visible = false;
      }
      if (child.isMesh) {
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        mats.forEach((mat) => {
          if (!mat) return;
          mat.wireframe = false;
        });
      }
    });

    scene.add(model);

    // Centramos el modelo alrededor del origen
    let box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);

    // Recalcular caja después de centrar
    box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());

    // ⭐ Detectar techo por altura (parte superior del cuarto)
    const roomHeight = size.y;
    const ceilingThreshold = box.max.y - roomHeight * 0.15; // top 15%

    model.traverse((obj) => {
      if (!obj.isMesh) return;

      // bounding box en coordenadas de mundo
      obj.updateWorldMatrix(true, false);
      const geo = obj.geometry;
      if (!geo) return;
      geo.computeBoundingBox();
      const bb = geo.boundingBox.clone();
      bb.applyMatrix4(obj.matrixWorld);

      // Si la malla está en la franja superior ⇒ la tratamos como techo
      if (bb.min.y >= ceilingThreshold) {
        obj.material = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          side: THREE.DoubleSide
        });
      }
    });

    // Altura real del piso + altura de ojos (para escritorio)
    floorY = box.min.y;
    const eyeHeight = 1.6;
    const eyeY = floorY + eyeHeight;

    // Definimos límites "seguros" del cuarto
    const wallOffset = playerRadius + 0.15;

    roomBounds.xMin = box.min.x + wallOffset;
    roomBounds.xMax = box.max.x - wallOffset;
    roomBounds.zMin = box.min.z + wallOffset;
    roomBounds.zMax = box.max.z - wallOffset;

    // Posición inicial en escritorio: centro del cuarto, altura ojos
    const startX = (roomBounds.xMin + roomBounds.xMax) / 2;
    const startZ = (roomBounds.zMin + roomBounds.zMax) / 2;
    playerPosition.set(startX, eyeY, startZ);
    camera.position.copy(playerPosition);

    // Mirar hacia el frente del cuarto (eje -Z) y actualizar controls
    camera.lookAt(startX, eyeY, startZ - 1);
    controls.target.set(startX, eyeY - 0.1, startZ - 1);
    controls.update();

    console.log(
      "Cuarto DAE cargado. Tamaño:",
      size,
      "Límites:",
      roomBounds,
      "PisoY:",
      floorY
    );
  },
  undefined,
  (error) => {
    console.error("Error al cargar cuarto_vr.dae", error);
  }
);

// --- Movimiento + colisiones ---
const tempDir = new THREE.Vector3();
const tempSide = new THREE.Vector3();

function applyMovement(delta, isVRFrame = false, xrFrame = null) {
  let moveX = 0;
  let moveZ = 0;

  // 1) Teclado (no VR)
  if (!isVRFrame) {
    if (moveState.forward) moveZ -= 1;
    if (moveState.back)    moveZ += 1;
    if (moveState.left)    moveX -= 1;
    if (moveState.right)   moveX += 1;
  }

  // 2) Control VR (stick o botón)
  if (isVRFrame && xrSession && xrFrame) {
    for (const src of xrSession.inputSources) {
      if (!src.gamepad) continue;
      const gp = src.gamepad;

      const ax0 = gp.axes[0] ?? 0;
      const ax1 = gp.axes[1] ?? 0;
      const ax2 = gp.axes[2] ?? 0;
      const ax3 = gp.axes[3] ?? 0;

      const stickX = Math.abs(ax2) > 0.15 ? ax2 : ax0;
      const stickY = Math.abs(ax3) > 0.15 ? ax3 : ax1;

      moveX += stickX;
      moveZ += stickY;

      // Botón principal para avanzar siempre hacia adelante
      const primaryPressed = gp.buttons[0]?.pressed;
      if (primaryPressed) {
        moveZ -= 0.8;
      }
    }
  }

  if (moveX === 0 && moveZ === 0) return;

  const moveVec = new THREE.Vector2(moveX, moveZ);
  if (moveVec.lengthSq() > 1e-4) moveVec.normalize();

  // Dirección adelante / derecha según la cámara
  camera.getWorldDirection(tempDir);
  tempDir.y = 0;
  tempDir.normalize();

  tempSide.set(tempDir.z, 0, -tempDir.x).normalize();

  const worldMove = new THREE.Vector3();
  worldMove
    .copy(tempDir)
    .multiplyScalar(moveVec.y)
    .add(tempSide.multiplyScalar(moveVec.x));

  const speed = moveSpeed * delta;
  worldMove.multiplyScalar(speed);

  // Nueva posición tentativa
  const newPos = playerPosition.clone().add(worldMove);

  // Colisión con los límites del cuarto
  newPos.x = THREE.MathUtils.clamp(newPos.x, roomBounds.xMin, roomBounds.xMax);
  newPos.z = THREE.MathUtils.clamp(newPos.z, roomBounds.zMin, roomBounds.zMax);

  // Altura fija: ojos a 1.6 m sobre el piso (PC y VR)
  const eyeY = floorY + 1.6;
  newPos.y = eyeY;

  playerPosition.copy(newPos);
  camera.position.copy(playerPosition);
}

// --- Resize ---
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Bucle de render ---
const clock = new THREE.Clock();

renderer.setAnimationLoop((time, frame) => {
  const delta = clock.getDelta();
  const isVR = renderer.xr.isPresenting;

  applyMovement(delta, isVR, frame);

  controls.update();   // suavidad en vista de escritorio

  renderer.render(scene, camera);
});
