// The side panel's "Colour splashes": ink-like fluid that the music splashes
// into the panel, swirling and fading. PavelDoGreat's WebGL Fluid Simulation
// as Delivator's audio-responsive Wallpaper Engine version has it ("Colorful
// Fluid Animation"), drawn inside its own box only: the canvas is the box,
// its edges are the fluid's walls, and only the mouse over it splashes.
// See SPLASH_DEFAULTS (splashSettings.js) for the settings (the wallpaper's own).
// The canvas is see-through: the colour (and cover) behind the visualization
// show under the fluid.

import React, { useEffect, useRef } from 'react'
import { getAnalyser, pickColor, sliceLevel, spectrumSlices } from './audio'
import { usePlayerStore } from '../store/player'
import { SPLASH_DEFAULTS } from './splashSettings'

export { SPLASH_DEFAULTS }

const PRESSURE_ITERATIONS = 20
const BLOOM_ITERATIONS = 8
const BLOOM_RESOLUTION = 256
const BLOOM_SOFT_KNEE = 0.7
// Wallpaper Engine sends its 64 bands about 30 times a second.
const AUDIO_TICK = 1 / 30
// The wallpaper's pace whatever the screen's refresh rate: 60 frames a
// second, each a 0.016 s step and one for the rest of the frame (its fading
// is per step, so more steps would fade it faster).
const FRAME = 1 / 60
const STEP = 0.016
const BANDS = 64

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  switch (((i % 6) + 6) % 6) {
    case 0: return { r: v, g: t, b: p }
    case 1: return { r: q, g: v, b: p }
    case 2: return { r: p, g: v, b: t }
    case 3: return { r: p, g: q, b: v }
    case 4: return { r: t, g: p, b: v }
    default: return { r: v, g: p, b: q }
  }
}

function hexToHsv(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: ((h / 6) % 1 + 1) % 1, s: max ? d / max : 0, v: max }
}

/** A splash colour as the simulation wants it (dim: it adds up). */
function splashColor(cfg) {
  let c
  if (cfg.colorMode === 'color') {
    const base = hexToHsv(pickColor(cfg.color, SPLASH_DEFAULTS.color))
    const spread = (Math.max(0, Math.min(180, cfg.hueRange)) / 360) * (Math.random() * 2 - 1)
    c = hsvToRgb(base.h + spread, base.s, Math.max(0.2, base.v))
  } else c = hsvToRgb(Math.random(), 1, 1)
  return { r: c.r * 0.15, g: c.g * 0.15, b: c.b * 0.15 }
}

const SHADERS = {
  baseVertex: `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;
    void main () {
      vUv = aPosition * 0.5 + 0.5;
      vL = vUv - vec2(texelSize.x, 0.0);
      vR = vUv + vec2(texelSize.x, 0.0);
      vT = vUv + vec2(0.0, texelSize.y);
      vB = vUv - vec2(0.0, texelSize.y);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`,
  clear: `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;
    void main () { gl_FragColor = value * texture2D(uTexture, vUv); }`,
  display: `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    void main () {
      vec3 C = texture2D(uTexture, vUv).rgb;
      float a = max(C.r, max(C.g, C.b));
      gl_FragColor = vec4(C, a);
    }`,
  displayBloom: `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform sampler2D uBloom;
    void main () {
      vec3 C = texture2D(uTexture, vUv).rgb;
      vec3 bloom = texture2D(uBloom, vUv).rgb;
      bloom = pow(bloom.rgb, vec3(1.0 / 2.2));
      C += bloom;
      float a = max(C.r, max(C.g, C.b));
      gl_FragColor = vec4(C, a);
    }`,
  displayShading: `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform vec2 texelSize;
    void main () {
      vec3 L = texture2D(uTexture, vL).rgb;
      vec3 R = texture2D(uTexture, vR).rgb;
      vec3 T = texture2D(uTexture, vT).rgb;
      vec3 B = texture2D(uTexture, vB).rgb;
      vec3 C = texture2D(uTexture, vUv).rgb;
      float dx = length(R) - length(L);
      float dy = length(T) - length(B);
      vec3 n = normalize(vec3(dx, dy, length(texelSize)));
      vec3 l = vec3(0.0, 0.0, 1.0);
      float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
      C.rgb *= diffuse;
      float a = max(C.r, max(C.g, C.b));
      gl_FragColor = vec4(C, a);
    }`,
  displayBloomShading: `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform sampler2D uBloom;
    uniform vec2 texelSize;
    void main () {
      vec3 L = texture2D(uTexture, vL).rgb;
      vec3 R = texture2D(uTexture, vR).rgb;
      vec3 T = texture2D(uTexture, vT).rgb;
      vec3 B = texture2D(uTexture, vB).rgb;
      vec3 C = texture2D(uTexture, vUv).rgb;
      float dx = length(R) - length(L);
      float dy = length(T) - length(B);
      vec3 n = normalize(vec3(dx, dy, length(texelSize)));
      vec3 l = vec3(0.0, 0.0, 1.0);
      float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
      C *= diffuse;
      vec3 bloom = texture2D(uBloom, vUv).rgb;
      bloom = pow(bloom.rgb, vec3(1.0 / 2.2));
      C += bloom;
      float a = max(C.r, max(C.g, C.b));
      gl_FragColor = vec4(C, a);
    }`,
  bloomPrefilter: `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec3 curve;
    uniform float threshold;
    void main () {
      vec3 c = texture2D(uTexture, vUv).rgb;
      float br = max(c.r, max(c.g, c.b));
      float rq = clamp(br - curve.x, 0.0, curve.y);
      rq = curve.z * rq * rq;
      c *= max(rq, br - threshold) / max(br, 0.0001);
      gl_FragColor = vec4(c, 0.0);
    }`,
  bloomBlur: `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    void main () {
      vec4 sum = vec4(0.0);
      sum += texture2D(uTexture, vL);
      sum += texture2D(uTexture, vR);
      sum += texture2D(uTexture, vT);
      sum += texture2D(uTexture, vB);
      sum *= 0.25;
      gl_FragColor = sum;
    }`,
  bloomFinal: `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform float intensity;
    void main () {
      vec4 sum = vec4(0.0);
      sum += texture2D(uTexture, vL);
      sum += texture2D(uTexture, vR);
      sum += texture2D(uTexture, vT);
      sum += texture2D(uTexture, vB);
      sum *= 0.25;
      gl_FragColor = sum * intensity;
    }`,
  splat: `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;
    void main () {
      vec2 p = vUv - point.xy;
      p.x *= aspectRatio;
      vec3 splat = exp(-dot(p, p) / radius) * color;
      vec3 base = texture2D(uTarget, vUv).xyz;
      gl_FragColor = vec4(base + splat, 1.0);
    }`,
  advectionManual: `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform vec2 dyeTexelSize;
    uniform float dt;
    uniform float dissipation;
    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
      vec2 st = uv / tsize - 0.5;
      vec2 iuv = floor(st);
      vec2 fuv = fract(st);
      vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
      vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
      vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
      vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
      return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }
    void main () {
      vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
      gl_FragColor = dissipation * bilerp(uSource, coord, dyeTexelSize);
      gl_FragColor.a = 1.0;
    }`,
  advection: `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float dissipation;
    void main () {
      vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
      gl_FragColor = dissipation * texture2D(uSource, coord);
      gl_FragColor.a = 1.0;
    }`,
  divergence: `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).x;
      float R = texture2D(uVelocity, vR).x;
      float T = texture2D(uVelocity, vT).y;
      float B = texture2D(uVelocity, vB).y;
      vec2 C = texture2D(uVelocity, vUv).xy;
      if (vL.x < 0.0) { L = -C.x; }
      if (vR.x > 1.0) { R = -C.x; }
      if (vT.y > 1.0) { T = -C.y; }
      if (vB.y < 0.0) { B = -C.y; }
      float div = 0.5 * (R - L + T - B);
      gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }`,
  curl: `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).y;
      float R = texture2D(uVelocity, vR).y;
      float T = texture2D(uVelocity, vT).x;
      float B = texture2D(uVelocity, vB).x;
      float vorticity = R - L - T + B;
      gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }`,
  vorticity: `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;
    void main () {
      float L = texture2D(uCurl, vL).x;
      float R = texture2D(uCurl, vR).x;
      float T = texture2D(uCurl, vT).x;
      float B = texture2D(uCurl, vB).x;
      float C = texture2D(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= curl * C;
      force.y *= -1.0;
      vec2 vel = texture2D(uVelocity, vUv).xy;
      gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
    }`,
  pressure: `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      float divergence = texture2D(uDivergence, vUv).x;
      float pressure = (L + R + B + T - divergence) * 0.25;
      gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }`,
  gradientSubtract: `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      vec2 velocity = texture2D(uVelocity, vUv).xy;
      velocity.xy -= vec2(R - L, T - B);
      gl_FragColor = vec4(velocity, 0.0, 1.0);
    }`,
}

/**
 * Runs the simulation on `canvas` until destroy(). `read()` gives the current
 * settings (SPLASH_DEFAULTS' shape) every frame. Null without WebGL.
 */
function createFluid(canvas, read) {
  const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false, premultipliedAlpha: true }
  let gl = canvas.getContext('webgl2', params)
  const isWebGL2 = !!gl
  if (!isWebGL2) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params)
  if (!gl) return null

  let halfFloat = null
  let supportLinearFiltering
  if (isWebGL2) {
    gl.getExtension('EXT_color_buffer_float')
    supportLinearFiltering = gl.getExtension('OES_texture_float_linear')
  } else {
    halfFloat = gl.getExtension('OES_texture_half_float')
    supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear')
  }
  const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat?.HALF_FLOAT_OES
  if (!halfFloatTexType) return null

  const supportRenderTextureFormat = (internalFormat, format, type) => {
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null)
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.deleteFramebuffer(fbo)
    gl.deleteTexture(texture)
    return ok
  }
  const getSupportedFormat = (internalFormat, format, type) => {
    if (supportRenderTextureFormat(internalFormat, format, type)) return { internalFormat, format }
    if (!isWebGL2) return null
    if (internalFormat === gl.R16F) return getSupportedFormat(gl.RG16F, gl.RG, type)
    if (internalFormat === gl.RG16F) return getSupportedFormat(gl.RGBA16F, gl.RGBA, type)
    return null
  }
  const formatRGBA = isWebGL2 ? getSupportedFormat(gl.RGBA16F, gl.RGBA, halfFloatTexType) : getSupportedFormat(gl.RGBA, gl.RGBA, halfFloatTexType)
  const formatRG = isWebGL2 ? getSupportedFormat(gl.RG16F, gl.RG, halfFloatTexType) : formatRGBA
  const formatR = isWebGL2 ? getSupportedFormat(gl.R16F, gl.RED, halfFloatTexType) : formatRGBA
  if (!formatRGBA || !formatRG || !formatR) return null

  const shaders = []
  const compile = (type, source) => {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
    shaders.push(shader)
    return shader
  }
  const programs = []
  const makeProgram = (fragmentSource) => {
    const program = gl.createProgram()
    gl.attachShader(program, baseVertex)
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource))
    gl.bindAttribLocation(program, 0, 'aPosition')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
    const uniforms = {}
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(program, i).name
      uniforms[name] = gl.getUniformLocation(program, name)
    }
    programs.push(program)
    return { uniforms, bind: () => gl.useProgram(program) }
  }
  const baseVertex = compile(gl.VERTEX_SHADER, SHADERS.baseVertex)
  const clearProgram = makeProgram(SHADERS.clear)
  const displayProgram = makeProgram(SHADERS.display)
  const displayBloomProgram = makeProgram(SHADERS.displayBloom)
  const displayShadingProgram = makeProgram(SHADERS.displayShading)
  const displayBloomShadingProgram = makeProgram(SHADERS.displayBloomShading)
  const bloomPrefilterProgram = makeProgram(SHADERS.bloomPrefilter)
  const bloomBlurProgram = makeProgram(SHADERS.bloomBlur)
  const bloomFinalProgram = makeProgram(SHADERS.bloomFinal)
  const splatProgram = makeProgram(SHADERS.splat)
  const advectionProgram = makeProgram(supportLinearFiltering ? SHADERS.advection : SHADERS.advectionManual)
  const divergenceProgram = makeProgram(SHADERS.divergence)
  const curlProgram = makeProgram(SHADERS.curl)
  const vorticityProgram = makeProgram(SHADERS.vorticity)
  const pressureProgram = makeProgram(SHADERS.pressure)
  const gradientSubtractProgram = makeProgram(SHADERS.gradientSubtract)

  const vertexBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW)
  const indexBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.enableVertexAttribArray(0)
  const blit = (destination) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination)
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
  }

  const fbos = new Set()
  const createFBO = (w, h, internalFormat, format, type, param) => {
    gl.activeTexture(gl.TEXTURE0)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null)
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const target = {
      texture, fbo, width: w, height: h,
      attach(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id },
      dispose() { gl.deleteFramebuffer(fbo); gl.deleteTexture(texture); fbos.delete(target) },
    }
    fbos.add(target)
    return target
  }
  const createDoubleFBO = (w, h, internalFormat, format, type, param) => {
    let fbo1 = createFBO(w, h, internalFormat, format, type, param)
    let fbo2 = createFBO(w, h, internalFormat, format, type, param)
    return {
      get read() { return fbo1 }, set read(value) { fbo1 = value },
      get write() { return fbo2 }, set write(value) { fbo2 = value },
      swap() { const temp = fbo1; fbo1 = fbo2; fbo2 = temp },
      dispose() { fbo1.dispose(); fbo2.dispose() },
    }
  }
  const resizeFBO = (target, w, h, internalFormat, format, type, param) => {
    const next = createFBO(w, h, internalFormat, format, type, param)
    clearProgram.bind()
    gl.uniform1i(clearProgram.uniforms.uTexture, target.attach(0))
    gl.uniform1f(clearProgram.uniforms.value, 1)
    blit(next.fbo)
    target.dispose()
    return next
  }
  const resizeDoubleFBO = (target, w, h, internalFormat, format, type, param) => {
    target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param)
    target.write.dispose()
    target.write = createFBO(w, h, internalFormat, format, type, param)
    return target
  }

  const getResolution = (resolution) => {
    let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight
    if (aspectRatio < 1) aspectRatio = 1 / aspectRatio
    const max = Math.round(resolution * aspectRatio)
    const min = Math.round(resolution)
    return gl.drawingBufferWidth > gl.drawingBufferHeight ? { width: max, height: min } : { width: min, height: max }
  }

  let simWidth, simHeight, dyeWidth, dyeHeight
  let density = null, velocity = null, divergence = null, curl = null, pressure = null, bloom = null
  const bloomFramebuffers = []
  let builtFor = ''
  const filtering = supportLinearFiltering ? gl.LINEAR : gl.NEAREST
  const initFramebuffers = (cfg) => {
    const simRes = getResolution(cfg.simResolution)
    const dyeRes = getResolution(cfg.dyeResolution)
    simWidth = simRes.width; simHeight = simRes.height
    dyeWidth = dyeRes.width; dyeHeight = dyeRes.height
    const texType = halfFloatTexType
    density = density
      ? resizeDoubleFBO(density, dyeWidth, dyeHeight, formatRGBA.internalFormat, formatRGBA.format, texType, filtering)
      : createDoubleFBO(dyeWidth, dyeHeight, formatRGBA.internalFormat, formatRGBA.format, texType, filtering)
    velocity = velocity
      ? resizeDoubleFBO(velocity, simWidth, simHeight, formatRG.internalFormat, formatRG.format, texType, filtering)
      : createDoubleFBO(simWidth, simHeight, formatRG.internalFormat, formatRG.format, texType, filtering)
    divergence?.dispose(); curl?.dispose(); pressure?.dispose()
    divergence = createFBO(simWidth, simHeight, formatR.internalFormat, formatR.format, texType, gl.NEAREST)
    curl = createFBO(simWidth, simHeight, formatR.internalFormat, formatR.format, texType, gl.NEAREST)
    pressure = createDoubleFBO(simWidth, simHeight, formatR.internalFormat, formatR.format, texType, gl.NEAREST)

    const res = getResolution(BLOOM_RESOLUTION)
    bloom?.dispose()
    bloomFramebuffers.forEach(fbo => fbo.dispose())
    bloomFramebuffers.length = 0
    bloom = createFBO(res.width, res.height, formatRGBA.internalFormat, formatRGBA.format, texType, filtering)
    for (let i = 0; i < BLOOM_ITERATIONS; i++) {
      const width = res.width >> (i + 1)
      const height = res.height >> (i + 1)
      if (width < 2 || height < 2) break
      bloomFramebuffers.push(createFBO(width, height, formatRGBA.internalFormat, formatRGBA.format, texType, filtering))
    }
    builtFor = `${canvas.width}x${canvas.height}:${cfg.simResolution}:${cfg.dyeResolution}`
  }

  const splat = (cfg, x, y, dx, dy, color) => {
    gl.viewport(0, 0, simWidth, simHeight)
    splatProgram.bind()
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0))
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height)
    gl.uniform2f(splatProgram.uniforms.point, x / canvas.width, 1 - y / canvas.height)
    gl.uniform3f(splatProgram.uniforms.color, dx, -dy, 1)
    gl.uniform1f(splatProgram.uniforms.radius, cfg.radius / 100)
    blit(velocity.write.fbo)
    velocity.swap()

    gl.viewport(0, 0, dyeWidth, dyeHeight)
    gl.uniform1i(splatProgram.uniforms.uTarget, density.read.attach(0))
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b)
    blit(density.write.fbo)
    density.swap()
  }
  const multipleSplats = (cfg, amount) => {
    for (let i = 0; i < amount; i++) {
      const color = splashColor(cfg)
      color.r *= 10; color.g *= 10; color.b *= 10
      const x = canvas.width * Math.random()
      const y = canvas.height * Math.random()
      const dx = 1000 * (Math.random() - 0.5)
      const dy = 1000 * (Math.random() - 0.5)
      splat(cfg, x, y, dx, dy, color)
    }
  }

  const step = (cfg, dt) => {
    gl.disable(gl.BLEND)
    gl.viewport(0, 0, simWidth, simHeight)

    curlProgram.bind()
    gl.uniform2f(curlProgram.uniforms.texelSize, 1 / simWidth, 1 / simHeight)
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0))
    blit(curl.fbo)

    vorticityProgram.bind()
    gl.uniform2f(vorticityProgram.uniforms.texelSize, 1 / simWidth, 1 / simHeight)
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0))
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1))
    gl.uniform1f(vorticityProgram.uniforms.curl, cfg.curl)
    gl.uniform1f(vorticityProgram.uniforms.dt, dt)
    blit(velocity.write.fbo)
    velocity.swap()

    divergenceProgram.bind()
    gl.uniform2f(divergenceProgram.uniforms.texelSize, 1 / simWidth, 1 / simHeight)
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0))
    blit(divergence.fbo)

    clearProgram.bind()
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0))
    gl.uniform1f(clearProgram.uniforms.value, cfg.pressureDissipation)
    blit(pressure.write.fbo)
    pressure.swap()

    pressureProgram.bind()
    gl.uniform2f(pressureProgram.uniforms.texelSize, 1 / simWidth, 1 / simHeight)
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0))
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1))
      blit(pressure.write.fbo)
      pressure.swap()
    }

    gradientSubtractProgram.bind()
    gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, 1 / simWidth, 1 / simHeight)
    gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0))
    gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1))
    blit(velocity.write.fbo)
    velocity.swap()

    advectionProgram.bind()
    gl.uniform2f(advectionProgram.uniforms.texelSize, 1 / simWidth, 1 / simHeight)
    if (!supportLinearFiltering) gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, 1 / simWidth, 1 / simHeight)
    const velocityId = velocity.read.attach(0)
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId)
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId)
    gl.uniform1f(advectionProgram.uniforms.dt, dt)
    gl.uniform1f(advectionProgram.uniforms.dissipation, cfg.velocityDissipation)
    blit(velocity.write.fbo)
    velocity.swap()

    gl.viewport(0, 0, dyeWidth, dyeHeight)
    if (!supportLinearFiltering) gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, 1 / dyeWidth, 1 / dyeHeight)
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0))
    gl.uniform1i(advectionProgram.uniforms.uSource, density.read.attach(1))
    gl.uniform1f(advectionProgram.uniforms.dissipation, cfg.densityDissipation)
    blit(density.write.fbo)
    density.swap()
  }

  const applyBloom = (cfg, source, destination) => {
    if (bloomFramebuffers.length < 2) return
    let last = destination
    gl.disable(gl.BLEND)
    bloomPrefilterProgram.bind()
    const knee = cfg.bloomThreshold * BLOOM_SOFT_KNEE + 0.0001
    gl.uniform3f(bloomPrefilterProgram.uniforms.curve, cfg.bloomThreshold - knee, knee * 2, 0.25 / knee)
    gl.uniform1f(bloomPrefilterProgram.uniforms.threshold, cfg.bloomThreshold)
    gl.uniform1i(bloomPrefilterProgram.uniforms.uTexture, source.attach(0))
    gl.viewport(0, 0, last.width, last.height)
    blit(last.fbo)

    bloomBlurProgram.bind()
    for (const dest of bloomFramebuffers) {
      gl.uniform2f(bloomBlurProgram.uniforms.texelSize, 1 / last.width, 1 / last.height)
      gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0))
      gl.viewport(0, 0, dest.width, dest.height)
      blit(dest.fbo)
      last = dest
    }
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.enable(gl.BLEND)
    for (let i = bloomFramebuffers.length - 2; i >= 0; i--) {
      const baseTex = bloomFramebuffers[i]
      gl.uniform2f(bloomBlurProgram.uniforms.texelSize, 1 / last.width, 1 / last.height)
      gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0))
      gl.viewport(0, 0, baseTex.width, baseTex.height)
      blit(baseTex.fbo)
      last = baseTex
    }
    gl.disable(gl.BLEND)
    bloomFinalProgram.bind()
    gl.uniform2f(bloomFinalProgram.uniforms.texelSize, 1 / last.width, 1 / last.height)
    gl.uniform1i(bloomFinalProgram.uniforms.uTexture, last.attach(0))
    gl.uniform1f(bloomFinalProgram.uniforms.intensity, cfg.bloomIntensity)
    gl.viewport(0, 0, destination.width, destination.height)
    blit(destination.fbo)
  }

  // Straight onto the see-through canvas: what's behind it shows through.
  const render = (cfg) => {
    const useBloom = cfg.bloom && !!supportLinearFiltering
    const useShading = cfg.shading && !!supportLinearFiltering
    if (useBloom) applyBloom(cfg, density.read, bloom)
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.disable(gl.BLEND)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.BLEND)
    const program = useShading ? (useBloom ? displayBloomShadingProgram : displayShadingProgram) : (useBloom ? displayBloomProgram : displayProgram)
    program.bind()
    if (useShading) gl.uniform2f(program.uniforms.texelSize, 1 / width, 1 / height)
    gl.uniform1i(program.uniforms.uTexture, density.read.attach(0))
    if (useBloom) gl.uniform1i(program.uniforms.uBloom, bloom.attach(1))
    blit(null)
  }

  // The mouse: a trail while it moves over the canvas, a burst on a click.
  const pointer = { x: 0, y: 0, dx: 0, dy: 0, moved: false, inside: false, color: splashColor(read()) }
  const at = (e) => {
    const rect = canvas.getBoundingClientRect()
    return { x: (e.clientX - rect.left) * (canvas.width / Math.max(1, rect.width)), y: (e.clientY - rect.top) * (canvas.height / Math.max(1, rect.height)) }
  }
  const onMove = (e) => {
    const p = at(e)
    if (pointer.inside && read().mouse) {
      pointer.moved = true
      pointer.dx = (p.x - pointer.x) * 5
      pointer.dy = (p.y - pointer.y) * 5
    }
    pointer.inside = true
    pointer.x = p.x
    pointer.y = p.y
  }
  const onLeave = () => { pointer.inside = false }
  let pendingBursts = 0
  const onDown = (e) => {
    if (e.button !== 0 || !read().onClick) return
    pendingBursts += Math.floor(Math.random() * 20) + 5
  }
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('pointerdown', onDown)

  // The music, as Wallpaper Engine hands it to the wallpaper: 64 bands, ~0-1.
  let analyser = null, freq = null, slices = null
  const bands = new Float32Array(BANDS)
  const readBands = (cfg) => {
    const current = getAnalyser()
    if (current !== analyser) {
      analyser = current
      freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
      slices = analyser ? spectrumSlices(analyser, BANDS) : null
    }
    if (!analyser) { bands.fill(0); return bands }
    analyser.getByteFrequencyData(freq)
    // The analyser's levels are in decibels (a quiet bass already reads
    // half-way): less the floor, raised to the curve and scaled by the gain
    // (the audio settings), they come near Wallpaper Engine's.
    const floor = Math.max(0, Math.min(0.9, cfg.audioFloor / 100))
    const curve = Math.max(1, Math.min(8, cfg.audioCurve))
    const gain = Math.max(0.001, cfg.audioGain / 100)
    for (let i = 0; i < BANDS; i++) {
      const level = Math.max(0, (sliceLevel(freq, slices[i]) / 255 - floor) / (1 - floor))
      bands[i] = Math.pow(level, curve) * gain
    }
    return bands
  }
  // The floating threshold, 1 = 100 %: the music's splashes are divided by it.
  const dyn = { threshold: 1, rate: 0, trackId: null }
  /**
   * After each tick's `amount` (from a `bass` level), with the splashes
   * counted over dynWindow seconds: a tick of music with no splashes sinks it
   * at once, unless there were more than dynTarget a second (the gap between
   * two beats of a loud song); it climbs only while there are more than that,
   * so a few splashes don't push it up. Silence (bass 0) leaves it be.
   */
  const adaptThreshold = (cfg, bass, amount) => {
    if (!cfg.dynamic) { dyn.threshold = 1; dyn.rate = 0; return }
    const window = Math.max(0.2, cfg.dynWindow)
    dyn.rate += (amount / AUDIO_TICK - dyn.rate) * (1 - Math.exp(-AUDIO_TICK / window))
    if (amount === 0 && bass > 0 && dyn.rate < cfg.dynTarget) dyn.threshold *= Math.pow(1 - Math.min(0.9, cfg.dynFall / 100), AUDIO_TICK)
    else if (dyn.rate > cfg.dynTarget) dyn.threshold *= Math.pow(1 + cfg.dynRise / 100, AUDIO_TICK)
    dyn.threshold = Math.max(cfg.dynMin / 100, Math.min(cfg.dynMax / 100, dyn.threshold))
  }
  const audioSplats = (cfg) => {
    if (cfg.dynReset && cfg.trackId !== dyn.trackId) { dyn.threshold = 1; dyn.rate = 0 }
    dyn.trackId = cfg.trackId
    const range = Math.max(1, Math.min(62, Math.round(cfg.freqRange)))
    const start = Math.max(0, Math.min(Math.round(cfg.freqStart), 62 - range))
    const levels = readBands(cfg)
    let bass = 0
    for (let i = 0; i <= range && i + start < BANDS; i++) bass += 2 * levels[i + start]
    bass /= range * 2
    const amount = Math.floor((bass * cfg.sensitivity * 10) / (cfg.dynamic ? dyn.threshold : 1))
    adaptThreshold(cfg, bass, amount)
    return amount
  }

  let frame = 0
  let last = performance.now()
  let simClock = 0
  let audioClock = 0
  let idleClock = 0
  let colorClock = 0
  const loop = (now) => {
    frame = requestAnimationFrame(loop)
    const cfg = read()
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000))
    last = now
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    if (builtFor !== `${canvas.width}x${canvas.height}:${cfg.simResolution}:${cfg.dyeResolution}`) initFramebuffers(cfg)

    if (pendingBursts) { multipleSplats(cfg, pendingBursts); pendingBursts = 0 }
    if (pointer.moved) {
      splat(cfg, pointer.x, pointer.y, pointer.dx, pointer.dy, pointer.color)
      pointer.moved = false
    }
    colorClock += dt
    if (colorClock > 0.1) { colorClock = 0; pointer.color = splashColor(cfg) }
    // Paused: no splashes from the music (what's there fades out).
    if (cfg.audio && cfg.playing) {
      audioClock += dt
      if (audioClock >= AUDIO_TICK) {
        audioClock %= AUDIO_TICK
        const amount = audioSplats(cfg)
        if (amount > 0) multipleSplats(cfg, Math.min(amount, 200))
      }
    }
    if (cfg.idle) {
      idleClock += dt
      if (idleClock >= cfg.idleInterval) { idleClock = 0; multipleSplats(cfg, Math.round(cfg.idleAmount)) }
    } else idleClock = 0

    simClock += dt
    for (let n = 0; simClock >= FRAME && n < 4; n++) {
      simClock -= FRAME
      step(cfg, STEP)
      step(cfg, FRAME - STEP)
    }
    if (simClock >= FRAME) simClock = 0
    render(cfg)
  }

  canvas.width = Math.max(1, canvas.clientWidth)
  canvas.height = Math.max(1, canvas.clientHeight)
  initFramebuffers(read())
  // A first burst, as the wallpaper opens with: only to music playing.
  if (read().playing && read().audio) multipleSplats(read(), Math.floor(Math.random() * 20) + 3)
  frame = requestAnimationFrame(loop)

  return {
    destroy() {
      cancelAnimationFrame(frame)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
      ;[...fbos].forEach(fbo => fbo.dispose())
      programs.forEach(program => gl.deleteProgram(program))
      shaders.forEach(shader => gl.deleteShader(shader))
      gl.deleteBuffer(vertexBuffer)
      gl.deleteBuffer(indexBuffer)
    },
  }
}

export default function Splashes({ className = '', settings = SPLASH_DEFAULTS }) {
  const canvasRef = useRef(null)
  const playing = usePlayerStore(s => s.isPlaying)
  const trackId = usePlayerStore(s => s.currentTrack?.id ?? null)
  const settingsRef = useRef(settings)
  settingsRef.current = { ...settings, playing, trackId }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    let fluid = null
    try {
      fluid = createFluid(canvas, () => ({ ...SPLASH_DEFAULTS, ...settingsRef.current }))
    } catch (error) {
      console.warn('[splashes] Could not start:', error)
    }
    if (!fluid) console.warn('[splashes] WebGL with half-float textures is not available')
    // The analyser is looked up every frame (it appears on the first play).
    return () => fluid?.destroy()
  }, [])

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 block h-full w-full" />
    </div>
  )
}
