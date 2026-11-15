import type { GarmentMesh } from './rig';

/**
 * WebGL2 compositor:
 *  1. draws the mirrored webcam frame
 *  2. draws the skinned garment mesh on top, where each pixel
 *     - is trimmed to the person's silhouette,
 *     - lets hands/hair show in front of the torso cloth,
 *     - picks up the folds and shadows of the clothes the user is actually wearing.
 */

const VIDEO_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = vec2(1.0 - p.x, 1.0 - p.y); // mirrored; texture row 0 is the top of the frame
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const VIDEO_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_video;
out vec4 o;
void main() { o = vec4(texture(u_video, v_uv).rgb, 1.0); }`;

const MESH_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
in float a_limb;
uniform vec2 u_res;
out vec2 v_uv;
out float v_limb;
void main() {
  v_uv = a_uv;
  v_limb = a_limb;
  gl_Position = vec4(a_pos.x / u_res.x * 2.0 - 1.0, 1.0 - a_pos.y / u_res.y * 2.0, 0.0, 1.0);
}`;

const MESH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_limb;
uniform vec2 u_res;
uniform sampler2D u_garment;
uniform sampler2D u_video;
uniform sampler2D u_mask;   // r = person, g = skin/hair
uniform bool u_useMask;
uniform float u_opacity;
uniform float u_shading;
out vec4 o;
void main() {
  vec4 g = texture(u_garment, v_uv);           // premultiplied
  if (g.a < 0.02) discard;
  // Fabric is opaque: only the outermost edge stays soft, never the inside.
  float a = smoothstep(0.05, 0.5, g.a);
  g = vec4(g.rgb / g.a * a, a);
  // Screen position → mirrored camera texture coords (texture row 0 = top of image).
  vec2 s = vec2(gl_FragCoord.x / u_res.x, 1.0 - gl_FragCoord.y / u_res.y);
  vec2 cam = vec2(1.0 - s.x, s.y);

  float keep = 1.0;
  if (u_useMask) {
    float person = smoothstep(0.2, 0.6, textureLod(u_mask, cam, 1.5).r); // soft edge, hugs the outline
    float skin = smoothstep(0.35, 0.75, textureLod(u_mask, cam, 0.5).g);
    // Hands/hair in front of the torso show through; sleeves still cover bare arms.
    keep = person * (1.0 - skin * (1.0 - v_limb));
  }

  // Transfer only the big folds/shadows of the user's own clothes (band-pass on brightness),
  // not their fine print or seams — those made the garment look see-through.
  vec3 w = vec3(0.299, 0.587, 0.114);
  float l = dot(textureLod(u_video, cam, 2.5).rgb, w);
  float b = dot(textureLod(u_video, cam, 5.5).rgb, w);
  float shade = mix(1.0, clamp((l + 0.05) / (b + 0.05), 0.75, 1.2), u_shading);

  o = vec4(g.rgb * shade, g.a) * keep * u_opacity;
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const prog = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
  return prog;
}

function makeTexture(gl: WebGL2RenderingContext) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export interface DrawOptions {
  opacity: number;
  shading: number;
  useMask: boolean;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private videoProg: WebGLProgram;
  private meshProg: WebGLProgram;
  private videoTex: WebGLTexture;
  private maskTex: WebGLTexture;
  private garmentTex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private posBuf: WebGLBuffer;
  private uvBuf: WebGLBuffer;
  private limbBuf: WebGLBuffer;
  private idxBuf: WebGLBuffer;
  private mesh: GarmentMesh | null = null;
  private maskData: Uint8Array | null = null;
  private hasMask = false;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.videoProg = compile(gl, VIDEO_VS, VIDEO_FS);
    this.meshProg = compile(gl, MESH_VS, MESH_FS);
    for (const n of ['u_res', 'u_garment', 'u_video', 'u_mask', 'u_useMask', 'u_opacity', 'u_shading']) {
      this.u[n] = gl.getUniformLocation(this.meshProg, n);
    }
    this.videoTex = makeTexture(gl);
    this.maskTex = makeTexture(gl);
    this.garmentTex = makeTexture(gl);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const attr = (name: string, size: number) => {
      const buf = gl.createBuffer()!;
      const loc = gl.getAttribLocation(this.meshProg, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return buf;
    };
    this.posBuf = attr('a_pos', 2);
    this.uvBuf = attr('a_uv', 2);
    this.limbBuf = attr('a_limb', 1);
    this.idxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bindVertexArray(null);
  }

  setMesh(mesh: GarmentMesh | null) {
    this.mesh = mesh;
    if (!mesh) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.garmentTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mesh.asset.canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.limbBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.limb, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.out.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  /** Segmentation classes → texture (r = person, g = skin/hair). */
  setMask(classes: Uint8Array, w: number, h: number) {
    const gl = this.gl;
    const n = w * h;
    if (this.maskData?.length !== n * 2) this.maskData = new Uint8Array(n * 2);
    const d = this.maskData;
    for (let i = 0; i < n; i++) {
      const c = classes[i];
      d[i * 2] = c === 0 ? 0 : 255;
      d[i * 2 + 1] = c >= 1 && c <= 3 ? 255 : 0; // hair, body skin, face skin
    }
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w, h, 0, gl.RG, gl.UNSIGNED_BYTE, d);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.hasMask = true;
  }

  render(video: HTMLVideoElement, drawGarment: boolean, o: DrawOptions) {
    const gl = this.gl;
    const W = video.videoWidth;
    const H = video.videoHeight;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.disable(gl.BLEND);
    gl.useProgram(this.videoProg);
    gl.uniform1i(gl.getUniformLocation(this.videoProg, 'u_video'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const mesh = this.mesh;
    if (!drawGarment || !mesh || !mesh.indices.length) return;

    gl.useProgram(this.meshProg);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.garmentTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.uniform2f(this.u.u_res, W, H);
    gl.uniform1i(this.u.u_video, 0);
    gl.uniform1i(this.u.u_garment, 1);
    gl.uniform1i(this.u.u_mask, 2);
    gl.uniform1i(this.u.u_useMask, o.useMask && this.hasMask ? 1 : 0);
    gl.uniform1f(this.u.u_opacity, o.opacity);
    gl.uniform1f(this.u.u_shading, o.shading);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.out);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }
}
