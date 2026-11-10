/**
 * A flat text panel drawn into a canvas texture. Cheap (one draw call) and
 * crisp enough at desk distance.
 */
import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

export class Label {
  readonly mesh: Mesh;
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private texture: CanvasTexture;
  private last = '';

  constructor(widthM: number, heightM: number, px = 1024) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = px;
    this.canvas.height = Math.round((px * heightM) / widthM);
    this.ctx2d = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(widthM, heightM), mat);
    this.mesh.renderOrder = 10;
  }

  /** Title on the first line, smaller body text below. */
  set(title: string, body = '', accent = '#7fe8ff'): void {
    const key = `${title}|${body}|${accent}`;
    if (key === this.last) return;
    this.last = key;
    const { width: w, height: h } = this.canvas;
    const g = this.ctx2d;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(10, 14, 24, 0.78)';
    roundRect(g, 4, 4, w - 8, h - 8, h * 0.18);
    g.fill();
    g.strokeStyle = accent;
    g.globalAlpha = 0.5;
    g.lineWidth = 4;
    g.stroke();
    g.globalAlpha = 1;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const titleSize = Math.round(h * (body ? 0.3 : 0.42));
    g.font = `600 ${titleSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
    g.fillStyle = accent;
    g.fillText(title, w / 2, body ? h * 0.34 : h / 2, w * 0.92);
    if (body) {
      g.font = `400 ${Math.round(h * 0.18)}px system-ui, -apple-system, Segoe UI, sans-serif`;
      g.fillStyle = '#e8eef8';
      g.fillText(body, w / 2, h * 0.7, w * 0.92);
    }
    this.texture.needsUpdate = true;
  }
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
