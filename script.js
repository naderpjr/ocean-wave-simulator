(() => {
    'use strict';

    
    const isMobile = Math.min(window.innerWidth, window.innerHeight) < 600;

    const CONFIG = {
        
        width: 90,
        depth: 87,
        zStart: -75,                       
        spacing: isMobile ? 0.5 : 0.32, 
        jitter: 0.35,

        pointSize: 0.11,
        bg: 0x02050d,

        amplitude: 0.85,
        speed: 0.5,

        
        hoverSpacing: 1.1,  
        hoverStrength: 0.3,
        clickStrength: 1.7,
        dragStrength: 0.6
    };

    const WAVES = [
        [1.0, 0.3, 0.20, 22],
        [0.6, 0.8, 0.18, 14],
        [-0.4, 0.9, 0.15, 9],
        [0.9, -0.5, 0.12, 5],
        [0.2, 1.0, 0.10, 3]
    ];

    const MAX_RIPPLES = 12;


    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        powerPreference: 'high-performance'
    });
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(CONFIG.bg);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 9, 22);
    camera.lookAt(0, 0, -6);

    
    const cols = Math.floor(CONFIG.width / CONFIG.spacing);
    const rows = Math.floor(CONFIG.depth / CONFIG.spacing);
    const count = cols * rows;
    const positions = new Float32Array(count * 3);

    let n = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            positions[n++] = (c - cols / 2) * CONFIG.spacing + (Math.random() - 0.5) * CONFIG.spacing * CONFIG.jitter * 2;
            positions[n++] = 0;
            positions[n++] = CONFIG.zStart + r * CONFIG.spacing + (Math.random() - 0.5) * CONFIG.spacing * CONFIG.jitter * 2;
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const vertexShader =  `
        uniform float uTime;
        uniform float uSize;
        uniform float uPixelRatio;
        uniform float uScale;        // converts world size -> pixels
        uniform float uAmp;
        uniform float uSpeed;
        uniform vec4  uWaves[${WAVES.length}];     // dir.xy, steepness, wavelength
        uniform vec4  uRipples[${MAX_RIPPLES}];    // x, z, startTime, strength
        uniform vec3  uPointer;                    // x, z, strength (0..1)

        varying float vHeight;
        varying float vFade;
        varying float vGlow;

        const float TAU = 6.28318530718;

        void main() {
            vec3 offset = vec3(0.0);
            float maxH = 0.0;

            // --- Gerstner waves: points move in a circle -> sharp crests ---
            for (int i = 0; i < ${WAVES.length}; i++) {
                vec4 w = uWaves[i];
                vec2 dir = normalize(w.xy);
                float k = TAU / w.w;                   // wave number
                float c = sqrt(9.8 / k) * uSpeed;      // deep-water wave speed
                float a = w.z / k;                     // amplitude from steepness
                float f = k * dot(dir, position.xz) - c * k * uTime;

                offset.xz += dir * a * cos(f);
                offset.y  += a * sin(f);
                maxH += a;
            }
            offset *= uAmp;
            maxH *= uAmp;

            // --- Ripples: an expanding ring that fades with time and distance ---
            for (int j = 0; j < ${MAX_RIPPLES}; j++) {
                vec4 r = uRipples[j];
                float age = uTime - r.z;
                if (age > 0.0 && age < 5.0) {
                    float dist  = distance(position.xz, r.xy);
                    float front = age * 4.0;                        // ring radius
                    float x     = dist - front;
                    float env   = exp(-x * x / 2.5) * exp(-age * 0.8) / (1.0 + front * 0.3);
                    offset.y += r.w * sin(x * 2.4) * env * 1.4;
                }
            }

            // --- Cursor: soft dip + glow under the pointer ---
            float pd = distance(position.xz, uPointer.xy);
            vGlow = uPointer.z * exp(-pd * pd * 0.06);
            offset.y -= uPointer.z * exp(-pd * pd * 0.15) * 0.35;

            vec3 world = position + offset;
            vHeight = offset.y / max(maxH, 0.001);

            vec4 mv = modelViewMatrix * vec4(world, 1.0);
            gl_Position = projectionMatrix * mv;

            float depth = -mv.z;
            vFade = (1.0 - smoothstep(40.0, 95.0, depth))
                  * (1.0 - smoothstep(30.0, 45.0, abs(position.x)))
                  * smoothstep(0.5, 3.0, depth);

            gl_PointSize = max(uSize * uPixelRatio * uScale / depth, 1.5 * uPixelRatio) * (1.0 + vGlow * 0.9);
        }
    `;

    const fragmentShader = `
        varying float vHeight;
        varying float vFade;
        varying float vGlow;

        void main() {
            // round, soft-edged point
            float d = length(gl_PointCoord - 0.5);
            if (d > 0.5) discard;
            float soft = smoothstep(0.5, 0.05, d);

            vec3 deep    = vec3(0.04, 0.28, 0.75);
            vec3 shallow = vec3(0.20, 0.85, 1.00);

            float t    = smoothstep(-0.6, 0.9, vHeight);
            float foam = smoothstep(0.55, 1.0, vHeight);

            vec3 col = mix(deep, shallow, t);
            col = mix(col, vec3(1.0), foam * 0.8);   // white foam on crests
            col += vGlow * vec3(0.35, 0.6, 1.0);     // cursor glow

            float alpha = soft * vFade * (0.5 + 0.5 * t);
            gl_FragColor = vec4(col, alpha);
        }
    `;

    
    const ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -1000, 0));

    const uniforms = {
        uTime: { value: 0 },
        uSize: { value: CONFIG.pointSize },
        uPixelRatio: { value: pixelRatio },
        uScale: { value: 1 },
        uAmp: { value: CONFIG.amplitude },
        uSpeed: { value: CONFIG.speed },
        uWaves: { value: WAVES.map(w => new THREE.Vector4(...w)) },
        uRipples: { value: ripples },
        uPointer: { value: new THREE.Vector3(0, 0, 0) }
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const sea = new THREE.Points(geometry, material);
    sea.frustumCulled = false;
    scene.add(sea);

    
    const clock = new THREE.Clock();
    let elapsed = 0;
    let rippleIndex = 0;

    function addRipple(x, z, strength) {
        ripples[rippleIndex].set(x, z, elapsed, strength);
        rippleIndex = (rippleIndex + 1) % MAX_RIPPLES;
    }

    const raycaster = new THREE.Raycaster();
    const seaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();

    const pointerTarget = new THREE.Vector2();
    const lastRipple = new THREE.Vector2(9999, 9999);
    let pointerActive = false;
    let pointerStrength = 0;
    let pressed = false;

    
    function screenToSea(clientX, clientY) {
        ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        return raycaster.ray.intersectPlane(seaPlane, hit) !== null;
    }

    window.addEventListener('pointermove', e => {
        if (!screenToSea(e.clientX, e.clientY)) { pointerActive = false; return; }
        pointerActive = true;
        pointerTarget.set(hit.x, hit.z);

        
        if (lastRipple.distanceTo(pointerTarget) > CONFIG.hoverSpacing) {
            addRipple(hit.x, hit.z, pressed ? CONFIG.dragStrength : CONFIG.hoverStrength);
            lastRipple.copy(pointerTarget);
        }
    }, { passive: true });

    window.addEventListener('pointerdown', e => {
        pressed = true;
        if (!screenToSea(e.clientX, e.clientY)) return;
        pointerActive = true;
        pointerTarget.set(hit.x, hit.z);
        uniforms.uPointer.value.set(hit.x, hit.z, uniforms.uPointer.value.z); 
        addRipple(hit.x, hit.z, CONFIG.clickStrength);
        lastRipple.copy(pointerTarget);
    });

    const release = e => {
        pressed = false;
        if (e.pointerType === 'touch') pointerActive = false;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    document.documentElement.addEventListener('pointerleave', () => { pointerActive = false; pressed = false; });

    function animate() {
        requestAnimationFrame(animate);

        const dt = Math.min(clock.getDelta(), 0.05);
        elapsed += dt;
        uniforms.uTime.value = elapsed;

        const p = uniforms.uPointer.value;
        const follow = 1 - Math.exp(-dt * 10);
        p.x += (pointerTarget.x - p.x) * follow;
        p.y += (pointerTarget.y - p.y) * follow;
        pointerStrength += ((pointerActive ? 1 : 0) - pointerStrength) * (1 - Math.exp(-dt * 6));
        p.z = pointerStrength;

        camera.position.x = Math.sin(elapsed * 0.1) * 2.0;
        camera.position.y = 9 + Math.sin(elapsed * 0.13) * 0.4;
        camera.lookAt(0, 0, -6);

        renderer.render(scene, camera);
    }


    function onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    }
    window.addEventListener('resize', onResize, { passive: true });
    onResize();

    animate();
})();