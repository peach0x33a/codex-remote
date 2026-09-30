<script setup lang="ts">
// Port of www.deepseek.com's hero background: a WebGL "checks" swirl shader plus a dotted 90px grid.
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{ theme?: 'light' | 'dark' }>(), { theme: 'light' })
const backdrop = ref<HTMLElement>(), shader = ref<HTMLCanvasElement>(), grid = ref<HTMLCanvasElement>()
const cleanups: (() => void)[] = []

const FRAGMENT = `#version 300 es
precision mediump float;
uniform float u_time, u_pixelRatio, u_scale, u_rotation, u_proportion, u_softness, u_shapeScale, u_distortion, u_swirl, u_swirlIterations;
uniform vec2 u_resolution, u_offset;
uniform vec3 u_color1, u_color2, u_color3;
out vec4 fragColor;
#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846
vec2 rotate(vec2 uv, float th) { return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv; }
float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123); }
float noise(vec2 st) {
  vec2 i = floor(st), f = fract(st);
  float a = random(i), b = random(i + vec2(1., 0.)), c = random(i + vec2(0., 1.)), d = random(i + vec2(1., 1.));
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = .5 * u_time;
  float noise_scale = .0005 + .006 * u_scale;
  uv -= .5; uv *= (noise_scale * u_resolution); uv = rotate(uv, u_rotation * .5 * PI); uv /= u_pixelRatio; uv += .5; uv += u_offset;
  float n1 = noise(uv + t), n2 = noise(uv * 2. - t), angle = n1 * TWO_PI;
  uv.x += 4. * u_distortion * n2 * cos(angle);
  uv.y += 4. * u_distortion * n2 * sin(angle);
  float iterations = ceil(clamp(u_swirlIterations, 1., 30.));
  for (float i = 1.; i <= 30.; i++) {
    if (i > iterations) break;
    uv.x += clamp(u_swirl, 0., 2.) / i * cos(t + i * 1.5 * uv.y);
    uv.y += clamp(u_swirl, 0., 2.) / i * cos(t + i * 1. * uv.x);
  }
  float proportion = clamp(u_proportion, 0., 1.);
  vec2 checks = uv * (.5 + 3.5 * u_shapeScale);
  float mixer = .5 + .5 * sin(checks.x) * cos(checks.y) + .48 * sign(proportion - .5) * pow(abs(proportion - .5), .5);
  float edge = 1. - clamp(u_softness, 0., 1.);
  vec3 col = mix(u_color1, u_color2, smoothstep(.35 * edge, .7 - .35 * edge, mixer));
  col = mix(col, u_color3, smoothstep(.3 + .35 * edge, 1. - .35 * edge, mixer));
  fragColor = vec4(col, 1.);
}`
// Parameters copied from the homepage: colors #8AA3D6/#FFF/#FFF, speed 14, distortion 20, swirl 12, 8 iterations, scale .5, rotation -5, offsetY 65.
const PARAMS = { colors: [[138, 163, 214], [255, 255, 255], [255, 255, 255]], speed: 14, distortion: 20, swirl: 12, swirlIterations: 8, scale: .5, rotation: -5, proportion: 50, softness: 100, shapeScale: 10, offset: [0, 65] }

// Keep both canvases in window coordinates. Resizing the sidebar changes only
// the clipping window, never the shader resolution or the grid origin.
function anchorToViewport() {
  const root = backdrop.value
  if (!root) return
  const align = () => {
    const rect = root.getBoundingClientRect()
    for (const canvas of [shader.value, grid.value]) {
      if (!canvas) continue
      canvas.style.width = window.innerWidth + 'px'; canvas.style.height = window.innerHeight + 'px'
      canvas.style.left = -rect.left + 'px'; canvas.style.top = -rect.top + 'px'
    }
  }
  align()
  const observer = new ResizeObserver(align)
  observer.observe(root)
  window.addEventListener('resize', align)
  window.visualViewport?.addEventListener('resize', align)
  cleanups.push(() => { observer.disconnect(); window.removeEventListener('resize', align); window.visualViewport?.removeEventListener('resize', align) })
}

function observeSize(canvas: HTMLCanvasElement, maxDpr: number, onResize: (w: number, h: number, dpr: number) => void) {
  const observer = new ResizeObserver(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr), w = canvas.clientWidth, h = canvas.clientHeight
    const width = Math.max(1, Math.round(w * dpr)), height = Math.max(1, Math.round(h * dpr))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    onResize(w, h, dpr)
  })
  observer.observe(canvas)
  return () => observer.disconnect()
}

function startShader(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, powerPreference: 'low-power' })
  if (!gl) { canvas.style.display = 'none'; return }
  const compile = (type: number, source: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, source); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null }
  const vs = compile(gl.VERTEX_SHADER, '#version 300 es\nin vec4 a_position;\nvoid main() { gl_Position = a_position; }\n'), fs = compile(gl.FRAGMENT_SHADER, FRAGMENT)
  if (!vs || !fs) { canvas.style.display = 'none'; return }
  const program = gl.createProgram()!
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { canvas.style.display = 'none'; return }
  gl.useProgram(program)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const u = (name: string) => gl.getUniformLocation(program, name)
  const p = PARAMS
  gl.uniform1f(u('u_scale'), p.scale); gl.uniform2f(u('u_offset'), p.offset[0] / 100, p.offset[1] / 100); gl.uniform1f(u('u_rotation'), p.rotation / 90)
  const colors = props.theme === 'dark' ? [[48, 64, 97], [27, 29, 37], [18, 18, 22]] : p.colors
  colors.forEach((c, i) => gl.uniform3f(u('u_color' + (i + 1)), c[0] / 255, c[1] / 255, c[2] / 255))
  gl.uniform1f(u('u_proportion'), p.proportion / 100); gl.uniform1f(u('u_softness'), p.softness / 100); gl.uniform1f(u('u_shapeScale'), p.shapeScale / 100)
  gl.uniform1f(u('u_distortion'), p.distortion / 100); gl.uniform1f(u('u_swirl'), p.swirl / 50); gl.uniform1f(u('u_swirlIterations'), p.swirlIterations)
  const uTime = u('u_time'), uRatio = u('u_pixelRatio'), uResolution = u('u_resolution')
  // Software rasterizers (SwiftShader, llvmpipe) can't sustain the swirl loop full-screen; show a single still frame instead.
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  const software = /swiftshader|llvmpipe|software/i.test(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '')
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let still = software || motion.matches
  const start = performance.now(), frame = 1000 / 30
  let raf = 0, last = 0, visible = true
  const draw = (now: number) => {
    gl.uniform1f(uTime, (now - start) * .001 * (p.speed / 100)); gl.uniform1f(uRatio, window.devicePixelRatio || 1)
    gl.uniform2f(uResolution, canvas.width, canvas.height); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
  const tick = (now: number) => { raf = 0; if (!visible || document.hidden) return; if (!last || now - last >= frame) { last = now - (now - last) % frame; draw(now) } schedule() }
  const schedule = () => { if (!still && !raf && visible && !document.hidden) raf = requestAnimationFrame(tick) }
  const onVisibility = () => document.hidden ? (cancelAnimationFrame(raf), raf = 0) : schedule()
  const onMotion = () => { still = software || motion.matches; if (still) { cancelAnimationFrame(raf); raf = 0; draw(performance.now()) } else schedule() }
  motion.addEventListener('change', onMotion)
  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; onVisibility() })
  io.observe(canvas); document.addEventListener('visibilitychange', onVisibility)
  const stopResize = observeSize(canvas, 1.5, () => { gl.viewport(0, 0, canvas.width, canvas.height); still ? draw(performance.now()) : schedule() })
  cleanups.push(() => { cancelAnimationFrame(raf); motion.removeEventListener('change', onMotion); io.disconnect(); document.removeEventListener('visibilitychange', onVisibility); stopResize(); gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteBuffer(buffer) })
}

function startGrid(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const spacing = 90, color = props.theme === 'dark' ? '132, 154, 197' : '60, 100, 160'
  cleanups.push(observeSize(canvas, 2, (w, h, dpr) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h)
    const cols = Math.ceil(w / spacing) + 1, rows = Math.ceil(h / spacing) + 1
    const ox = (w - (cols - 1) * spacing) / 2, oy = (h - (rows - 1) * spacing) / 2
    ctx.strokeStyle = `rgba(${color}, .1)`; ctx.lineWidth = .5
    ctx.beginPath()
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols - 1; c++) { const y = oy + r * spacing, x = ox + c * spacing; ctx.moveTo(x + 10, y); ctx.lineTo(x + spacing - 10, y) }
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows - 1; r++) { const x = ox + c * spacing, y = oy + r * spacing; ctx.moveTo(x, y + 10); ctx.lineTo(x, y + spacing - 10) }
    ctx.stroke()
    ctx.fillStyle = `rgba(${color}, .04)`
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { ctx.beginPath(); ctx.arc(ox + c * spacing, oy + r * spacing, 1.8, 0, 2 * Math.PI); ctx.fill() }
  }))
}

onMounted(() => { anchorToViewport(); if (shader.value) startShader(shader.value); if (grid.value) startGrid(grid.value) })
onBeforeUnmount(() => cleanups.splice(0).forEach(stop => stop()))
</script>

<template>
  <div ref="backdrop" class="hero-backdrop" :class="{ 'is-dark': theme === 'dark' }" aria-hidden="true">
    <div class="hero-layer"><canvas ref="shader" /></div>
    <div class="hero-layer hero-grid"><canvas ref="grid" /></div>
  </div>
</template>
