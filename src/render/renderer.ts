import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { TickMessage } from "../sim/protocol";

const LOW_ENERGY_COLOR = { r: 0xef, g: 0x44, b: 0x44 }; // red
const HIGH_ENERGY_COLOR = { r: 0x4a, g: 0xde, b: 0x80 }; // green
const ENERGY_COLOR_SCALE = 100; // energy at which a creature reads as "full health"

function energyToTint(energy: number): number {
  const t = Math.max(0, Math.min(1, energy / ENERGY_COLOR_SCALE));
  const r = Math.round(LOW_ENERGY_COLOR.r + (HIGH_ENERGY_COLOR.r - LOW_ENERGY_COLOR.r) * t);
  const g = Math.round(LOW_ENERGY_COLOR.g + (HIGH_ENERGY_COLOR.g - LOW_ENERGY_COLOR.g) * t);
  const b = Math.round(LOW_ENERGY_COLOR.b + (HIGH_ENERGY_COLOR.b - LOW_ENERGY_COLOR.b) * t);
  return (r << 16) | (g << 8) | b;
}

export class Renderer {
  private readonly app: Application;
  private readonly creatureContainer: Container;
  private readonly foodContainer: Container;
  private readonly creatureTexture: Texture;
  private readonly foodTexture: Texture;
  private readonly creatureSprites: Sprite[] = [];
  private readonly foodSprites: Sprite[] = [];

  private constructor(app: Application, creatureTexture: Texture, foodTexture: Texture) {
    this.app = app;
    this.creatureTexture = creatureTexture;
    this.foodTexture = foodTexture;
    this.foodContainer = new Container();
    this.creatureContainer = new Container();
    this.app.stage.addChild(this.foodContainer);
    this.app.stage.addChild(this.creatureContainer);
  }

  static async create(host: HTMLElement): Promise<Renderer> {
    const app = new Application();
    await app.init({ resizeTo: window, background: 0x0a0e14, antialias: true });
    host.appendChild(app.canvas);

    const creatureGraphics = new Graphics().circle(0, 0, 4).fill(0xffffff);
    const creatureTexture = app.renderer.generateTexture(creatureGraphics);
    creatureGraphics.destroy();

    const foodGraphics = new Graphics().circle(0, 0, 2.5).fill(0x86efac);
    const foodTexture = app.renderer.generateTexture(foodGraphics);
    foodGraphics.destroy();

    return new Renderer(app, creatureTexture, foodTexture);
  }

  get width(): number {
    return this.app.renderer.width;
  }

  get height(): number {
    return this.app.renderer.height;
  }

  update(message: TickMessage): void {
    this.syncPool(this.foodSprites, this.foodContainer, this.foodTexture, message.foodCount);
    for (let i = 0; i < message.foodCount; i++) {
      const sprite = this.foodSprites[i];
      sprite.x = message.foodPosX[i];
      sprite.y = message.foodPosY[i];
    }

    this.syncPool(this.creatureSprites, this.creatureContainer, this.creatureTexture, message.creatureCount);
    for (let i = 0; i < message.creatureCount; i++) {
      const sprite = this.creatureSprites[i];
      sprite.x = message.creaturePosX[i];
      sprite.y = message.creaturePosY[i];
      sprite.tint = energyToTint(message.creatureEnergy[i]);
    }
  }

  private syncPool(pool: Sprite[], parent: Container, texture: Texture, count: number): void {
    while (pool.length < count) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      parent.addChild(sprite);
      pool.push(sprite);
    }
    for (let i = 0; i < pool.length; i++) pool[i].visible = i < count;
  }
}
